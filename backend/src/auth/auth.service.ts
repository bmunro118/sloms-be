import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService, AuditEvent } from '../users/users.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../users/entities/user.entity';
import { TrustedDeviceService } from './services/trusted-device.service';
import { EmailOtpService } from './services/email-otp.service';
import { TwoFactorConfig } from '../config/twofa.config';

/** Context carried from the HTTP request into the login flow. */
export interface LoginContext {
  ipAddress?: string;
  userAgent?: string | null;
  /** The raw trusted-device token presented by the client (cookie / header). */
  deviceToken?: string | null;
}

export type LoginStatus = 'ok' | 'password_change' | 'enroll' | '2fa';

export interface LoginResult {
  status: LoginStatus;
  accessToken: string;
  userId: number;
  username: string;
  role: string;
  fullName: string | null;
  linkedCustomerId: number | null;
  /** @deprecated use status — kept for client compatibility */
  mustChangePassword?: true;
  enrollRequired?: true;
  twoFactorRequired?: true;
  twoFactorMethod?: 'totp' | 'email';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly emailOtp: EmailOtpService,
  ) {}

  /**
   * Validates username + password.
   * Returns the full User record on success.
   * Throws UnauthorizedException with an appropriate message on failure.
   * Tracks failed login attempts and locks accounts after the configured threshold.
   */
  async validateUser(
    username: string,
    password: string,
    ipAddress?: string,
  ): Promise<User> {
    const user = await this.usersService.findByUsername(username);

    if (!user) {
      // Log without a userId — username may not exist
      await this.usersService
        .writeAuditLog(
          username,
          AuditEvent.LOGIN_FAILURE,
          'Unknown username',
          undefined,
          ipAddress,
        )
        .catch(() => {});
      throw new UnauthorizedException('Invalid username or password');
    }

    if (!user.isActive) {
      await this.usersService
        .writeAuditLog(
          username,
          AuditEvent.LOGIN_FAILURE,
          'Account inactive',
          user.userId,
          ipAddress,
        )
        .catch(() => {});
      throw new UnauthorizedException('Invalid username or password');
    }

    // Check if the account is currently locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      await this.usersService
        .writeAuditLog(
          username,
          AuditEvent.LOGIN_LOCKED,
          `Account locked for ${minutesLeft} more minute(s)`,
          user.userId,
          ipAddress,
        )
        .catch(() => {});
      throw new UnauthorizedException(
        `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
      );
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      const justLocked = await this.usersService
        .recordFailedLogin(user.userId)
        .catch(() => false);

      if (justLocked) {
        await this.usersService
          .writeAuditLog(
            username,
            AuditEvent.ACCOUNT_LOCKED,
            'Account locked after too many failed login attempts',
            user.userId,
            ipAddress,
          )
          .catch(() => {});
      } else {
        await this.usersService
          .writeAuditLog(
            username,
            AuditEvent.LOGIN_FAILURE,
            'Wrong password',
            user.userId,
            ipAddress,
          )
          .catch(() => {});
      }

      throw new UnauthorizedException('Invalid username or password');
    }

    return user;
  }

  private get twofaCfg(): TwoFactorConfig {
    return this.config.get<TwoFactorConfig>('twofa')!;
  }

  private baseFields(user: User) {
    return {
      userId: user.userId,
      username: user.username,
      role: user.role,
      fullName: user.fullName ?? null,
      linkedCustomerId: user.linkedCustomerId ?? null,
    };
  }

  private signScoped(user: User, scope: JwtPayload['scope']): string {
    const payload: JwtPayload = {
      sub: user.userId,
      username: user.username,
      role: user.role,
      linkedCustomerId: user.linkedCustomerId ?? null,
      scope,
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.twofaCfg.pendingTokenTtl as any,
    });
  }

  /** Issues a full-access (scopeless) token. */
  issueFullToken(user: User): LoginResult {
    const payload: JwtPayload = {
      sub: user.userId,
      username: user.username,
      role: user.role,
      linkedCustomerId: user.linkedCustomerId ?? null,
    };
    return {
      status: 'ok',
      accessToken: this.jwtService.sign(payload),
      ...this.baseFields(user),
    };
  }

  /**
   * Decides what a successful password check grants. Precedence:
   *   1. forced password change  → password_change scoped token
   *   2. 2FA not yet enrolled     → twofa_enroll scoped token (mandatory enrollment)
   *   3. new (untrusted) device   → twofa_pending scoped token (+ email code sent)
   *   4. otherwise                → full-access token
   */
  async login(user: User, ctx: LoginContext = {}): Promise<LoginResult> {
    const { ipAddress } = ctx;
    // Reset failed-login state since credentials were valid
    this.usersService.recordLogin(user.userId).catch(() => {});

    if (user.mustChangePassword) {
      this.audit(user, AuditEvent.PASSWORD_CHANGE_REQUIRED, ipAddress);
      return {
        status: 'password_change',
        accessToken: this.signScoped(user, 'password_change'),
        mustChangePassword: true,
        ...this.baseFields(user),
      };
    }

    const method = (user.twoFactorMethod ?? 'totp') as 'totp' | 'email';

    if (!user.twoFactorEnabled) {
      this.audit(user, AuditEvent.TWOFA_ENROLL_REQUIRED, ipAddress);
      return {
        status: 'enroll',
        accessToken: this.signScoped(user, 'twofa_enroll'),
        enrollRequired: true,
        twoFactorMethod: method,
        ...this.baseFields(user),
      };
    }

    const trusted = await this.trustedDevices.isTrusted(
      user.userId,
      ctx.deviceToken,
    );
    if (!trusted) {
      this.audit(user, AuditEvent.NEW_DEVICE_CHALLENGED, ipAddress);
      if (method === 'email') {
        // username is the customer's email; deliver the login code there.
        await this.emailOtp.send(user.userId, user.email ?? user.username);
      }
      return {
        status: '2fa',
        accessToken: this.signScoped(user, 'twofa_pending'),
        twoFactorRequired: true,
        twoFactorMethod: method,
        ...this.baseFields(user),
      };
    }

    this.audit(user, AuditEvent.LOGIN_SUCCESS, ipAddress);
    return this.issueFullToken(user);
  }

  private audit(user: User, event: string, ipAddress?: string): void {
    this.usersService
      .writeAuditLog(
        user.username,
        event as Parameters<UsersService['writeAuditLog']>[1],
        undefined,
        user.userId,
        ipAddress,
      )
      .catch(() => {});
  }

  /**
   * Called from POST /auth/change-password.
   * Validates the new password, clears the mustChangePassword flag, and returns a full-access token.
   */
  async completePasswordChange(
    userId: number,
    username: string,
    newPassword: string,
    ctx: LoginContext = {},
  ): Promise<LoginResult> {
    await this.usersService.setNewPasswordAndClearFlag(userId, newPassword);
    this.usersService
      .writeAuditLog(
        username,
        AuditEvent.PASSWORD_CHANGED,
        undefined,
        userId,
        ctx.ipAddress,
      )
      .catch(() => {});
    const user = await this.usersService.findByUsername(username);
    // user cannot be null here — we just updated it. Re-run the gate so the
    // user still hits 2FA enrollment / new-device challenge as appropriate.
    return this.login(user!, ctx);
  }

  /**
   * Decodes and verifies a JWT, returning the payload.
   */
  verifyToken(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
