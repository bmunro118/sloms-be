import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PagingDto, PagedResult } from '../common/paging';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { serializePrisma } from '../prisma/prisma-serializer';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Role } from './entities/role.enum';
import { AuditLogEntry } from './entities/audit-log.entity';

const SALT_ROUNDS = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Customers log in with their email (it's also their 2FA delivery address). */
function defaultTwoFactorMethod(role: Role): 'email' | 'totp' {
  return role === Role.Customer ? 'email' : 'totp';
}

const MAX_FAILED_ATTEMPTS = parseInt(
  process.env.AUTH_MAX_FAILED_ATTEMPTS ?? '5',
  10,
);
const LOCKOUT_MINUTES = parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? '15', 10);

export const AuditEvent = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  TWOFA_ENROLLED: 'TWOFA_ENROLLED',
  TWOFA_DISABLED: 'TWOFA_DISABLED',
  TWOFA_VERIFY_SUCCESS: 'TWOFA_VERIFY_SUCCESS',
  TWOFA_VERIFY_FAILURE: 'TWOFA_VERIFY_FAILURE',
  TWOFA_ENROLL_REQUIRED: 'TWOFA_ENROLL_REQUIRED',
  NEW_DEVICE_CHALLENGED: 'NEW_DEVICE_CHALLENGED',
  DEVICE_TRUSTED: 'DEVICE_TRUSTED',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  RECOVERY_CODE_USED: 'RECOVERY_CODE_USED',
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUsername(username: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    return user ? serializePrisma<User>(user) : null;
  }

  private sanitize(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async findAll(
    includeInactive = false,
    paging = new PagingDto(),
  ): Promise<PagedResult<Omit<User, 'passwordHash'>>> {
    const where = includeInactive ? {} : { isActive: true };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { username: 'asc' },
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PagedResult(
      serializePrisma<User[]>(users).map((user) => this.sanitize(user)),
      total,
      paging,
    );
  }

  async findOne(id: number): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.findUnique({ where: { userId: id } });

    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    return this.sanitize(serializePrisma<User>(user));
  }

  async create(
    dto: CreateUserDto,
    createdBy?: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const existing = await this.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException(
        `Username "${dto.username}" is already taken`,
      );
    }

    if (dto.role === Role.Customer && !dto.linkedCustomerId) {
      throw new BadRequestException(
        'A user with the Customer role must have a linkedCustomerId',
      );
    }

    if (dto.role !== Role.Customer && dto.linkedCustomerId) {
      throw new BadRequestException(
        'linkedCustomerId can only be set for users with the Customer role',
      );
    }

    const role = dto.role ?? Role.ReadOnly;
    if (role === Role.Customer && !EMAIL_RE.test(dto.username)) {
      throw new BadRequestException(
        'A Customer user must have a valid email address as their username',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        fullName: dto.fullName ?? null,
        email: dto.email ?? null,
        role,
        isActive: true,
        createdBy: createdBy ?? null,
        linkedCustomerId: dto.linkedCustomerId ?? null,
        mustChangePassword: true,
        twoFactorMethod: defaultTwoFactorMethod(role),
      },
    });

    return this.sanitize(serializePrisma<User>(user));
  }

  async update(
    id: number,
    dto: UpdateUserDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const current = await this.prisma.user.findUnique({
      where: { userId: id },
    });
    if (!current) {
      throw new NotFoundException(`User #${id} not found`);
    }

    const user = serializePrisma<User>(current);

    if (dto.username && dto.username !== user.username) {
      const existing = await this.findByUsername(dto.username);
      if (existing) {
        throw new ConflictException(
          `Username "${dto.username}" is already taken`,
        );
      }
    }

    const effectiveRole = dto.role ?? user.role;

    if (effectiveRole === Role.Customer && dto.linkedCustomerId === null) {
      throw new BadRequestException(
        'A user with the Customer role must have a linkedCustomerId',
      );
    }

    if (effectiveRole !== Role.Customer && dto.linkedCustomerId) {
      throw new BadRequestException(
        'linkedCustomerId can only be set for users with the Customer role',
      );
    }

    const effectiveUsername = dto.username ?? user.username;
    if (effectiveRole === Role.Customer && !EMAIL_RE.test(effectiveUsername)) {
      throw new BadRequestException(
        'A Customer user must have a valid email address as their username',
      );
    }

    const data: Record<string, unknown> = {};

    if (dto.username !== undefined) data.username = dto.username;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.linkedCustomerId !== undefined) {
      data.linkedCustomerId = dto.linkedCustomerId;
    }
    // Changing role switches the 2FA channel — reset enrollment so the user
    // re-enrolls on the correct factor (TOTP for staff, email for customers).
    if (dto.role !== undefined && dto.role !== user.role) {
      data.role = dto.role;
      data.twoFactorMethod = defaultTwoFactorMethod(dto.role);
      data.twoFactorEnabled = false;
      data.totpSecret = null;
      data.twoFactorEnrolledAt = null;
    }

    const saved = await this.prisma.user.update({
      where: { userId: id },
      data,
    });

    return this.sanitize(serializePrisma<User>(saved));
  }

  async changePassword(
    id: number,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const current = await this.prisma.user.findUnique({
      where: { userId: id },
    });
    if (!current) {
      throw new NotFoundException(`User #${id} not found`);
    }

    const user = serializePrisma<User>(current);
    const isMatch = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { userId: id },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, SALT_ROUNDS),
      },
    });

    return { message: 'Password updated successfully' };
  }

  async deactivate(id: number): Promise<Omit<User, 'passwordHash'>> {
    const saved = await this.prisma.user
      .update({
        where: { userId: id },
        data: { isActive: false },
      })
      .catch(() => null);

    if (!saved) {
      throw new NotFoundException(`User #${id} not found`);
    }

    return this.sanitize(serializePrisma<User>(saved));
  }

  async reactivate(id: number): Promise<Omit<User, 'passwordHash'>> {
    const saved = await this.prisma.user
      .update({
        where: { userId: id },
        data: { isActive: true },
      })
      .catch(() => null);

    if (!saved) {
      throw new NotFoundException(`User #${id} not found`);
    }

    return this.sanitize(serializePrisma<User>(saved));
  }

  async recordLogin(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { userId: id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  /**
   * Increments failedLoginCount for a user. Locks the account if the threshold is reached.
   * Returns true if the account was just locked by this call.
   */
  async recordFailedLogin(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return false;

    const newCount = user.failedLoginCount + 1;
    const justLocked = newCount >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = justLocked
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
      : null;

    await this.prisma.user.update({
      where: { userId },
      data: {
        failedLoginCount: newCount,
        lockedUntil: lockedUntil ?? user.lockedUntil,
      },
    });

    return justLocked && !user.lockedUntil;
  }

  async writeAuditLog(
    username: string,
    event: AuditEventType,
    detail?: string,
    userId?: number,
    ipAddress?: string,
  ): Promise<void> {
    await this.prisma.userAuditLog.create({
      data: {
        userId: userId ?? null,
        username,
        event,
        detail: detail ?? null,
        ipAddress: ipAddress ?? null,
      },
    });
  }

  async getAuditLog(paging = new PagingDto(), userId?: number, event?: string) {
    const where: Record<string, unknown> = {};
    if (userId !== undefined) where.userId = userId;
    if (event) where.event = event;

    const [logs, total] = await Promise.all([
      this.prisma.userAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.userAuditLog.count({ where }),
    ]);

    return new PagedResult(
      serializePrisma<AuditLogEntry[]>(logs),
      total,
      paging,
    );
  }

  async unlockAccount(id: number): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.findUnique({ where: { userId: id } });
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    const saved = await this.prisma.user.update({
      where: { userId: id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    return this.sanitize(serializePrisma<User>(saved));
  }

  async remove(
    id: number,
    requestingUserId: number,
  ): Promise<{ message: string }> {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.prisma.user.findUnique({ where: { userId: id } });
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    await this.prisma.user.delete({ where: { userId: id } });
    return {
      message: `User "${user.username}" has been permanently deleted`,
    };
  }

  async resetPassword(
    id: number,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { userId: id } });
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    await this.prisma.user.update({
      where: { userId: id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
        mustChangePassword: true,
      },
    });

    return {
      message: `Password for "${user.username}" has been reset successfully`,
    };
  }

  async setNewPasswordAndClearFlag(
    id: number,
    newPassword: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { userId: id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
        mustChangePassword: false,
      },
    });
  }

  /** Returns the full user record (including secrets) by id, or null. */
  async findByIdRaw(id: number): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { userId: id } });
    return user ? serializePrisma<User>(user) : null;
  }

  /** Stores an encrypted TOTP secret during enrollment (2FA not yet enabled). */
  async setPendingTotpSecret(
    id: number,
    encryptedSecret: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { userId: id },
      data: { totpSecret: encryptedSecret },
    });
  }

  /** Marks 2FA as enabled after a successful enrollment verification. */
  async enableTwoFactor(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { userId: id },
      data: { twoFactorEnabled: true, twoFactorEnrolledAt: new Date() },
    });
  }

  /** Disables 2FA and clears any TOTP secret. */
  async disableTwoFactor(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { userId: id },
      data: {
        twoFactorEnabled: false,
        totpSecret: null,
        twoFactorEnrolledAt: null,
      },
    });
  }
}
