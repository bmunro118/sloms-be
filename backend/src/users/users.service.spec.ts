import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService, AuditEvent } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from './entities/role.enum';
import { PagingDto } from '../common/paging';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn(),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  userAuditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

function makeDbUser(overrides = {}) {
  return {
    userId: 1,
    username: 'testuser',
    passwordHash: 'hashed',
    fullName: 'Test User',
    email: 'test@example.com',
    role: Role.ReadOnly,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: null,
    createdBy: null,
    linkedCustomerId: null,
    mustChangePassword: false,
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ─── findByUsername ───────────────────────────────────────────────────────────

  describe('findByUsername', () => {
    it('returns null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.findByUsername('ghost')).toBeNull();
    });

    it('returns serialized user when found', async () => {
      const dbUser = makeDbUser();
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      const result = await service.findByUsername('testuser');
      expect(result?.username).toBe('testuser');
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });

    it('returns sanitized user (no passwordHash)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
      const result = await service.findOne(1);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.username).toBe('testuser');
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paged result with active users by default', async () => {
      const users = [makeDbUser()];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.findAll();
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('passwordHash');
    });

    it('includes inactive users when flag is set', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.findAll(true);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('throws ConflictException when username is taken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());

      await expect(
        service.create({
          username: 'testuser',
          password: 'pass',
          role: Role.ReadOnly,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when Customer role has no linkedCustomerId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          username: 'newuser',
          password: 'pass',
          role: Role.Customer,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when non-Customer role has linkedCustomerId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          username: 'newuser',
          password: 'pass',
          role: Role.Manager,
          linkedCustomerId: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates user with mustChangePassword=true and hashed password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const created = makeDbUser({ mustChangePassword: true });
      mockPrisma.user.create.mockResolvedValue(created);

      const result = await service.create({
        username: 'newuser',
        password: 'pass',
        role: Role.ReadOnly,
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('pass', 12);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mustChangePassword: true,
            passwordHash: 'hashed_password',
          }),
        }),
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('creates Customer-role user when linkedCustomerId is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(
        makeDbUser({ role: Role.Customer, linkedCustomerId: 10 }),
      );

      await service.create({
        username: 'custuser@example.com',
        password: 'pass',
        role: Role.Customer,
        linkedCustomerId: 10,
      });

      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('rejects a Customer-role user whose username is not an email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          username: 'custuser',
          password: 'pass',
          role: Role.Customer,
          linkedCustomerId: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.update(99, { username: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when new username is taken by another user', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeDbUser({ userId: 1, username: 'old' }))
        .mockResolvedValueOnce(makeDbUser({ userId: 2, username: 'taken' }));

      await expect(service.update(1, { username: 'taken' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when setting Customer role without linkedCustomerId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ role: Role.Manager }),
      );

      await expect(
        service.update(1, { role: Role.Customer, linkedCustomerId: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates user and returns sanitized result', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
      mockPrisma.user.update.mockResolvedValue(
        makeDbUser({ fullName: 'Updated' }),
      );

      const result = await service.update(1, { fullName: 'Updated' });
      expect(result.fullName).toBe('Updated');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  // ─── changePassword ───────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword(99, {
          currentPassword: 'old',
          newPassword: 'new',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException on wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(1, {
          currentPassword: 'wrong',
          newPassword: 'new',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates password hash on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue(makeDbUser());

      const result = await service.changePassword(1, {
        currentPassword: 'old',
        newPassword: 'new',
      });
      expect(result.message).toMatch(/success/i);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed_password' }),
        }),
      );
    });
  });

  // ─── deactivate / reactivate ──────────────────────────────────────────────────

  describe('deactivate', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.update.mockResolvedValue(null);
      await expect(service.deactivate(99)).rejects.toThrow(NotFoundException);
    });

    it('sets isActive to false', async () => {
      mockPrisma.user.update.mockResolvedValue(makeDbUser({ isActive: false }));
      const result = await service.deactivate(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(result.isActive).toBe(false);
    });
  });

  describe('reactivate', () => {
    it('sets isActive to true', async () => {
      mockPrisma.user.update.mockResolvedValue(makeDbUser({ isActive: true }));
      const result = await service.reactivate(1);
      expect(result.isActive).toBe(true);
    });
  });

  // ─── recordLogin / recordFailedLogin ──────────────────────────────────────────

  describe('recordLogin', () => {
    it('clears failedLoginCount and lockedUntil', async () => {
      mockPrisma.user.update.mockResolvedValue(makeDbUser());
      await service.recordLogin(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: null,
          }),
        }),
      );
    });
  });

  describe('recordFailedLogin', () => {
    it('returns false when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.recordFailedLogin(99)).toBe(false);
    });

    it('increments failedLoginCount', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ failedLoginCount: 2 }),
      );
      mockPrisma.user.update.mockResolvedValue({});
      await service.recordFailedLogin(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginCount: 3 }),
        }),
      );
    });

    it('returns true and sets lockedUntil on reaching MAX_FAILED_ATTEMPTS', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ failedLoginCount: 4, lockedUntil: null }),
      );
      mockPrisma.user.update.mockResolvedValue({});
      const justLocked = await service.recordFailedLogin(1);
      expect(justLocked).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('returns false when already locked (not newly locking)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ failedLoginCount: 4, lockedUntil: new Date() }),
      );
      mockPrisma.user.update.mockResolvedValue({});
      const justLocked = await service.recordFailedLogin(1);
      expect(justLocked).toBe(false);
    });
  });

  // ─── unlockAccount ────────────────────────────────────────────────────────────

  describe('unlockAccount', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.unlockAccount(99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resets failedLoginCount and lockedUntil', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ failedLoginCount: 5 }),
      );
      mockPrisma.user.update.mockResolvedValue(
        makeDbUser({ failedLoginCount: 0, lockedUntil: null }),
      );

      const result = await service.unlockAccount(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { failedLoginCount: 0, lockedUntil: null },
        }),
      );
      expect(result.failedLoginCount).toBe(0);
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws BadRequestException when deleting own account', async () => {
      await expect(service.remove(1, 1)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when target user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.remove(99, 1)).rejects.toThrow(NotFoundException);
    });

    it('deletes user and returns confirmation message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeDbUser({ userId: 2, username: 'other' }),
      );
      mockPrisma.user.delete.mockResolvedValue({});

      const result = await service.remove(2, 1);
      expect(result.message).toMatch(/other/);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { userId: 2 },
      });
    });
  });

  // ─── resetPassword ────────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword(99, 'newpass')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets new password hash and mustChangePassword=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeDbUser());
      mockPrisma.user.update.mockResolvedValue({});

      await service.resetPassword(1, 'newpass');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });
  });

  // ─── writeAuditLog / getAuditLog ──────────────────────────────────────────────

  describe('writeAuditLog', () => {
    it('creates audit log entry', async () => {
      mockPrisma.userAuditLog.create.mockResolvedValue({});
      await service.writeAuditLog(
        'testuser',
        AuditEvent.LOGIN_SUCCESS,
        undefined,
        1,
        '127.0.0.1',
      );
      expect(mockPrisma.userAuditLog.create).toHaveBeenCalled();
    });
  });

  describe('getAuditLog', () => {
    it('returns paged audit log entries', async () => {
      const entry = {
        auditId: 1,
        username: 'testuser',
        event: AuditEvent.LOGIN_SUCCESS,
      };
      mockPrisma.userAuditLog.findMany.mockResolvedValue([entry]);
      mockPrisma.userAuditLog.count.mockResolvedValue(1);

      const result = await service.getAuditLog(new PagingDto());
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('filters by userId and event when provided', async () => {
      mockPrisma.userAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.userAuditLog.count.mockResolvedValue(0);

      await service.getAuditLog(new PagingDto(), 1, AuditEvent.LOGIN_FAILURE);

      expect(mockPrisma.userAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1, event: AuditEvent.LOGIN_FAILURE },
        }),
      );
    });
  });
});
