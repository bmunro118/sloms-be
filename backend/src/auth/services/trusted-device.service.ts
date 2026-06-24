import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TwoFactorConfig } from '../../config/twofa.config';
import { randomToken, sha256Hex } from '../crypto.util';

export interface DeviceContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get trustDays(): number {
    return this.config.get<TwoFactorConfig>('twofa')!.trustDays;
  }

  /**
   * Returns true if the presented raw device token matches a live (non-revoked,
   * non-expired) trusted device for this user. On a match the trust window is
   * slid forward (lastSeenAt + expiresAt bumped).
   */
  async isTrusted(
    userId: number,
    rawToken: string | undefined | null,
  ): Promise<boolean> {
    if (!rawToken) return false;
    const tokenHash = sha256Hex(rawToken);
    const device = await this.prisma.trustedDevice.findUnique({
      where: { tokenHash },
    });

    const now = new Date();
    if (
      !device ||
      device.userId !== userId ||
      device.revokedAt ||
      device.expiresAt <= now
    ) {
      return false;
    }

    await this.prisma.trustedDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: now, expiresAt: this.newExpiry(now) },
    });
    return true;
  }

  /**
   * Mints a new trusted-device token, stores its hash, and returns the raw token
   * for the client to persist (cookie for web, secure storage for mobile).
   */
  async trust(userId: number, ctx: DeviceContext = {}): Promise<string> {
    const rawToken = randomToken();
    const now = new Date();
    await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: sha256Hex(rawToken),
        label: this.deriveLabel(ctx.userAgent),
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        ipAddress: ctx.ipAddress ?? null,
        expiresAt: this.newExpiry(now),
      },
    });
    return rawToken;
  }

  async list(userId: number) {
    return this.prisma.trustedDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        label: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    });
  }

  /** Revokes a single device. Returns false if it does not belong to the user. */
  async revoke(userId: number, deviceId: number): Promise<boolean> {
    const result = await this.prisma.trustedDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  /** Revokes every active device for a user (on password change / 2FA disable). */
  async revokeAll(userId: number): Promise<number> {
    const result = await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private newExpiry(from: Date): Date {
    return new Date(from.getTime() + this.trustDays * 24 * 60 * 60 * 1000);
  }

  private deriveLabel(userAgent?: string | null): string | null {
    if (!userAgent) return null;
    const browser = /Edg/.test(userAgent)
      ? 'Edge'
      : /Chrome/.test(userAgent)
        ? 'Chrome'
        : /Firefox/.test(userAgent)
          ? 'Firefox'
          : /Safari/.test(userAgent)
            ? 'Safari'
            : 'Browser';
    const os = /Windows/.test(userAgent)
      ? 'Windows'
      : /Mac OS|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /iPhone|iPad|iOS/.test(userAgent)
            ? 'iOS'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : 'device';
    return `${browser} on ${os}`;
  }
}
