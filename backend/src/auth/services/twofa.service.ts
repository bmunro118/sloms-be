import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService, AuditEvent } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';
import { AuthService, LoginContext, LoginResult } from '../auth.service';
import { TotpService } from './totp.service';
import { EmailOtpService } from './email-otp.service';
import { TrustedDeviceService } from './trusted-device.service';
import { recoveryCode, sha256Hex, safeEqualHex } from '../crypto.util';

const RECOVERY_CODE_COUNT = 8;

export interface VerifyResult extends LoginResult {
  /** Raw trusted-device token to persist, present only when the device was trusted. */
  deviceToken?: string;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly authService: AuthService,
    private readonly totp: TotpService,
    private readonly emailOtp: EmailOtpService,
    private readonly trustedDevices: TrustedDeviceService,
  ) {}

  private method(user: User): 'totp' | 'email' {
    return (user.twoFactorMethod ?? 'totp') as 'totp' | 'email';
  }

  private async requireUser(userId: number): Promise<User> {
    const user = await this.users.findByIdRaw(userId);
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  /**
   * Begins enrollment. For TOTP, generates and stores a pending secret and
   * returns the QR payload. For email, sends a verification code.
   */
  async setup(userId: number): Promise<{
    method: 'totp' | 'email';
    otpauthUrl?: string;
    qrDataUrl?: string;
    sentTo?: string;
  }> {
    const user = await this.requireUser(userId);

    if (this.method(user) === 'totp') {
      const secret = this.totp.generateSecret();
      await this.users.setPendingTotpSecret(userId, this.totp.encrypt(secret));
      const { otpauthUrl, qrDataUrl } = await this.totp.buildEnrollment(
        user.username,
        secret,
      );
      return { method: 'totp', otpauthUrl, qrDataUrl };
    }

    const email = user.email ?? user.username;
    await this.emailOtp.send(userId, email);
    return { method: 'email', sentTo: maskEmail(email) };
  }

  /**
   * Completes enrollment by verifying the first code, enabling 2FA, and
   * issuing a full-access token. For TOTP, returns one-time recovery codes.
   */
  async enable(
    userId: number,
    code: string,
    rememberDevice: boolean,
    ctx: LoginContext,
  ): Promise<VerifyResult & { recoveryCodes?: string[] }> {
    const user = await this.requireUser(userId);
    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled for this account');
    }

    let ok = false;
    let recoveryCodes: string[] | undefined;

    if (this.method(user) === 'totp') {
      if (!user.totpSecret) {
        throw new BadRequestException('Call /auth/2fa/setup before enabling');
      }
      ok = await this.totp.verifyToken(
        code,
        this.totp.decrypt(user.totpSecret),
      );
    } else {
      ok = await this.emailOtp.verify(userId, code);
    }

    if (!ok) {
      this.audit(user, AuditEvent.TWOFA_VERIFY_FAILURE, ctx.ipAddress);
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.users.enableTwoFactor(userId);
    if (this.method(user) === 'totp') {
      recoveryCodes = await this.regenerateRecoveryCodes(userId);
    }
    this.audit(user, AuditEvent.TWOFA_ENROLLED, ctx.ipAddress);

    const result = await this.finishLogin(user, rememberDevice, ctx);
    return { ...result, recoveryCodes };
  }

  /**
   * Login step-2: verifies a TOTP/email code (or recovery code), issues a full
   * token, and optionally trusts the device.
   */
  async verifyLogin(
    userId: number,
    code: string,
    rememberDevice: boolean,
    ctx: LoginContext,
  ): Promise<VerifyResult> {
    const user = await this.requireUser(userId);
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    let ok = false;
    if (this.method(user) === 'totp') {
      ok =
        !!user.totpSecret &&
        (await this.totp.verifyToken(code, this.totp.decrypt(user.totpSecret)));
    } else {
      ok = await this.emailOtp.verify(userId, code);
    }

    // Recovery-code fallback (works for either method).
    if (!ok && (await this.consumeRecoveryCode(userId, code))) {
      ok = true;
      this.audit(user, AuditEvent.RECOVERY_CODE_USED, ctx.ipAddress);
    }

    if (!ok) {
      this.audit(user, AuditEvent.TWOFA_VERIFY_FAILURE, ctx.ipAddress);
      throw new UnauthorizedException('Invalid verification code');
    }

    this.audit(user, AuditEvent.TWOFA_VERIFY_SUCCESS, ctx.ipAddress);
    return this.finishLogin(user, rememberDevice, ctx);
  }

  /** Re-sends an email OTP during the login challenge (cooldown enforced). */
  async resend(userId: number): Promise<{ sentTo: string }> {
    const user = await this.requireUser(userId);
    if (this.method(user) !== 'email') {
      throw new BadRequestException('Resend is only available for email 2FA');
    }
    const email = user.email ?? user.username;
    await this.emailOtp.send(userId, email);
    return { sentTo: maskEmail(email) };
  }

  /** Disables 2FA after verifying the current factor, and revokes all devices. */
  async disable(
    userId: number,
    code: string,
    ipAddress?: string,
  ): Promise<void> {
    const user = await this.requireUser(userId);
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    let ok = false;
    if (this.method(user) === 'totp') {
      ok =
        !!user.totpSecret &&
        (await this.totp.verifyToken(code, this.totp.decrypt(user.totpSecret)));
    } else {
      ok = await this.emailOtp.verify(userId, code);
    }
    if (!ok && (await this.consumeRecoveryCode(userId, code))) ok = true;

    if (!ok) {
      this.audit(user, AuditEvent.TWOFA_VERIFY_FAILURE, ipAddress);
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.users.disableTwoFactor(userId);
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    await this.trustedDevices.revokeAll(userId);
    this.audit(user, AuditEvent.TWOFA_DISABLED, ipAddress);
  }

  listDevices(userId: number) {
    return this.trustedDevices.list(userId);
  }

  async revokeDevice(userId: number, deviceId: number): Promise<void> {
    const ok = await this.trustedDevices.revoke(userId, deviceId);
    if (!ok) throw new BadRequestException('Device not found');
    const user = await this.requireUser(userId);
    this.audit(user, AuditEvent.DEVICE_REVOKED, undefined);
  }

  async revokeAllDevices(userId: number): Promise<{ revoked: number }> {
    const revoked = await this.trustedDevices.revokeAll(userId);
    const user = await this.requireUser(userId);
    this.audit(user, AuditEvent.DEVICE_REVOKED, undefined);
    return { revoked };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async finishLogin(
    user: User,
    rememberDevice: boolean,
    ctx: LoginContext,
  ): Promise<VerifyResult> {
    const result = this.authService.issueFullToken(user);
    if (!rememberDevice) return result;

    const deviceToken = await this.trustedDevices.trust(user.userId, {
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
    });
    this.audit(user, AuditEvent.DEVICE_TRUSTED, ctx.ipAddress);
    return { ...result, deviceToken };
  }

  private async regenerateRecoveryCodes(userId: number): Promise<string[]> {
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      recoveryCode(),
    );
    await this.prisma.recoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: sha256Hex(c) })),
    });
    return codes;
  }

  private async consumeRecoveryCode(
    userId: number,
    code: string,
  ): Promise<boolean> {
    const hash = sha256Hex(code.trim().toLowerCase());
    const codes = await this.prisma.recoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    const match = codes.find((c) => safeEqualHex(c.codeHash, hash));
    if (!match) return false;
    await this.prisma.recoveryCode.update({
      where: { id: match.id },
      data: { usedAt: new Date() },
    });
    return true;
  }

  private audit(user: User, event: string, ipAddress?: string): void {
    this.users
      .writeAuditLog(
        user.username,
        event as Parameters<UsersService['writeAuditLog']>[1],
        undefined,
        user.userId,
        ipAddress,
      )
      .catch(() => {});
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const shown = local.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
