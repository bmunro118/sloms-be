import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailClient } from '@azure/communication-email';
import { PrismaService } from '../../prisma/prisma.service';
import { TwoFactorConfig } from '../../config/twofa.config';
import { numericCode, sha256Hex, safeEqualHex } from '../crypto.util';

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);
  private client: EmailClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const conn = this.cfg.acsConnectionString;
    if (conn) {
      this.client = new EmailClient(conn);
    } else {
      this.logger.warn(
        'ACS_CONNECTION_STRING not set — email OTP codes will be logged instead of sent (dev only).',
      );
    }
  }

  private get cfg(): TwoFactorConfig {
    return this.config.get<TwoFactorConfig>('twofa')!;
  }

  /**
   * Generates a fresh code, invalidates any prior pending codes for the user,
   * stores the new code's hash, and emails it. Enforces a resend cooldown.
   */
  async send(userId: number, email: string): Promise<void> {
    const now = new Date();

    // Resend cooldown: reject if a code was issued very recently.
    const latest = await this.prisma.emailOtp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (elapsed < this.cfg.emailResendCooldownSeconds) {
        throw new HttpException(
          `Please wait ${Math.ceil(
            this.cfg.emailResendCooldownSeconds - elapsed,
          )}s before requesting another code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Invalidate prior pending codes so only the newest is acceptable.
    await this.prisma.emailOtp.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });

    const code = numericCode(6);
    await this.prisma.emailOtp.create({
      data: {
        userId,
        codeHash: sha256Hex(code),
        expiresAt: new Date(
          now.getTime() + this.cfg.emailOtpTtlMinutes * 60_000,
        ),
      },
    });

    await this.deliver(email, code);
  }

  /**
   * Verifies a submitted code against the latest pending, non-expired code.
   * Consumes the code on success; counts the attempt and invalidates after the
   * configured maximum on failure.
   */
  async verify(userId: number, code: string): Promise<boolean> {
    const now = new Date();
    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return false;

    if (otp.attempts >= this.cfg.emailOtpMaxAttempts) {
      await this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { consumedAt: now },
      });
      return false;
    }

    if (safeEqualHex(sha256Hex(code.trim()), otp.codeHash)) {
      await this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { consumedAt: now },
      });
      return true;
    }

    await this.prisma.emailOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  private async deliver(email: string, code: string): Promise<void> {
    const ttl = this.cfg.emailOtpTtlMinutes;
    if (!this.client || !this.cfg.acsSenderAddress) {
      // Dev fallback — no ACS configured.
      this.logger.warn(
        `[DEV] Email OTP for ${email}: ${code} (expires in ${ttl}m)`,
      );
      return;
    }

    const poller = await this.client.beginSend({
      senderAddress: this.cfg.acsSenderAddress,
      content: {
        subject: 'Your SLOMS verification code',
        plainText: `Your SLOMS verification code is ${code}. It expires in ${ttl} minutes. If you did not try to sign in, ignore this email.`,
        html: `<p>Your SLOMS verification code is <strong>${code}</strong>.</p><p>It expires in ${ttl} minutes. If you did not try to sign in, you can ignore this email.</p>`,
      },
      recipients: { to: [{ address: email }] },
    });
    await poller.pollUntilDone();
  }
}
