import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService, AuditEvent } from "../users/users.service";
import { JwtPayload } from "./interfaces/jwt-payload.interface";
import { User } from "../users/entities/user.entity";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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
        .writeAuditLog(username, AuditEvent.LOGIN_FAILURE, "Unknown username", undefined, ipAddress)
        .catch(() => {});
      throw new UnauthorizedException("Invalid username or password");
    }

    if (!user.isActive) {
      await this.usersService
        .writeAuditLog(username, AuditEvent.LOGIN_FAILURE, "Account inactive", user.userId, ipAddress)
        .catch(() => {});
      throw new UnauthorizedException("Invalid username or password");
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
            "Account locked after too many failed login attempts",
            user.userId,
            ipAddress,
          )
          .catch(() => {});
      } else {
        await this.usersService
          .writeAuditLog(username, AuditEvent.LOGIN_FAILURE, "Wrong password", user.userId, ipAddress)
          .catch(() => {});
      }

      throw new UnauthorizedException("Invalid username or password");
    }

    return user;
  }

  /**
   * Issues a signed JWT for a successfully authenticated user.
   * If mustChangePassword is set, issues a short-lived scoped token instead of a full-access token.
   * The scoped token is only accepted by POST /auth/change-password.
   */
  async login(
    user: User,
    ipAddress?: string,
  ): Promise<{
    accessToken: string;
    userId: number;
    username: string;
    role: string;
    fullName: string | null;
    linkedCustomerId: number | null;
    mustChangePassword?: true;
  }> {
    // Reset failed-login state since credentials were valid
    this.usersService.recordLogin(user.userId).catch(() => {});

    if (user.mustChangePassword) {
      const payload: JwtPayload = {
        sub: user.userId,
        username: user.username,
        role: user.role,
        linkedCustomerId: user.linkedCustomerId ?? null,
        scope: 'password_change',
      };
      this.usersService
        .writeAuditLog(user.username, AuditEvent.PASSWORD_CHANGE_REQUIRED, undefined, user.userId, ipAddress)
        .catch(() => {});
      return {
        accessToken: this.jwtService.sign(payload, { expiresIn: '15m' }),
        mustChangePassword: true,
        userId: user.userId,
        username: user.username,
        role: user.role,
        fullName: user.fullName ?? null,
        linkedCustomerId: user.linkedCustomerId ?? null,
      };
    }

    const payload: JwtPayload = {
      sub: user.userId,
      username: user.username,
      role: user.role,
      linkedCustomerId: user.linkedCustomerId ?? null,
    };
    this.usersService
      .writeAuditLog(user.username, AuditEvent.LOGIN_SUCCESS, undefined, user.userId, ipAddress)
      .catch(() => {});

    return {
      accessToken: this.jwtService.sign(payload),
      userId: user.userId,
      username: user.username,
      role: user.role,
      fullName: user.fullName ?? null,
      linkedCustomerId: user.linkedCustomerId ?? null,
    };
  }

  /**
   * Called from POST /auth/change-password.
   * Validates the new password, clears the mustChangePassword flag, and returns a full-access token.
   */
  async completePasswordChange(
    userId: number,
    username: string,
    newPassword: string,
    ipAddress?: string,
  ) {
    await this.usersService.setNewPasswordAndClearFlag(userId, newPassword);
    this.usersService
      .writeAuditLog(username, AuditEvent.PASSWORD_CHANGED, undefined, userId, ipAddress)
      .catch(() => {});
    const user = await this.usersService.findByUsername(username);
    // user cannot be null here — we just updated it
    return this.login(user!, ipAddress);
  }

  /**
   * Decodes and verifies a JWT, returning the payload.
   */
  verifyToken(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
