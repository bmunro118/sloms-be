import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService, AuditEvent } from '../users/users.service';
import { Role } from '../users/entities/role.enum';
import { User } from '../users/entities/user.entity';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const mockUsersService = {
  findByUsername: jest.fn(),
  writeAuditLog: jest.fn(),
  recordFailedLogin: jest.fn(),
  recordLogin: jest.fn(),
  setNewPasswordAndClearFlag: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

function makeUser(overrides: Partial<User> = {}): User {
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

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.writeAuditLog.mockResolvedValue(undefined);
    mockUsersService.recordLogin.mockResolvedValue(undefined);
    mockUsersService.recordFailedLogin.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('throws UnauthorizedException when user does not exist', async () => {
      mockUsersService.findByUsername.mockResolvedValue(null);
      await expect(service.validateUser('unknown', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      mockUsersService.findByUsername.mockResolvedValue(
        makeUser({ isActive: false }),
      );
      await expect(service.validateUser('testuser', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when account is locked', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
      mockUsersService.findByUsername.mockResolvedValue(
        makeUser({ lockedUntil }),
      );
      await expect(service.validateUser('testuser', 'pass')).rejects.toThrow(
        /temporarily locked/,
      );
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockUsersService.findByUsername.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.validateUser('testuser', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsersService.recordFailedLogin).toHaveBeenCalledWith(1);
    });

    it('logs ACCOUNT_LOCKED when recordFailedLogin returns true', async () => {
      mockUsersService.findByUsername.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      mockUsersService.recordFailedLogin.mockResolvedValue(true);

      await expect(service.validateUser('testuser', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsersService.writeAuditLog).toHaveBeenCalledWith(
        'testuser',
        AuditEvent.ACCOUNT_LOCKED,
        expect.any(String),
        1,
        undefined,
      );
    });

    it('returns user on valid credentials', async () => {
      const user = makeUser();
      mockUsersService.findByUsername.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('testuser', 'correct');
      expect(result).toEqual(user);
    });

    it('ignores a past lockedUntil (expired lock)', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const user = makeUser({ lockedUntil: pastDate });
      mockUsersService.findByUsername.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('testuser', 'correct');
      expect(result).toEqual(user);
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns full-access token for normal user', async () => {
      const user = makeUser();
      mockJwtService.sign.mockReturnValue('full-token');

      const result = await service.login(user);

      expect(result.accessToken).toBe('full-token');
      expect(result.mustChangePassword).toBeUndefined();
      expect(result.userId).toBe(1);
      expect(result.username).toBe('testuser');
    });

    it('returns scoped token when mustChangePassword is true', async () => {
      const user = makeUser({ mustChangePassword: true });
      mockJwtService.sign.mockReturnValue('scoped-token');

      const result = await service.login(user);

      expect(result.accessToken).toBe('scoped-token');
      expect(result.mustChangePassword).toBe(true);
      // scoped token is signed with expiresIn: '15m'
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'password_change' }),
        { expiresIn: '15m' },
      );
    });

    it('calls recordLogin on every login', async () => {
      const user = makeUser();
      mockJwtService.sign.mockReturnValue('token');

      await service.login(user);

      expect(mockUsersService.recordLogin).toHaveBeenCalledWith(1);
    });

    it('returns linkedCustomerId in response', async () => {
      const user = makeUser({ linkedCustomerId: 42, role: Role.Customer });
      mockJwtService.sign.mockReturnValue('token');

      const result = await service.login(user);
      expect(result.linkedCustomerId).toBe(42);
    });
  });

  // ─── completePasswordChange ───────────────────────────────────────────────────

  describe('completePasswordChange', () => {
    it('sets new password, writes audit log, and returns login response', async () => {
      const user = makeUser();
      mockUsersService.setNewPasswordAndClearFlag.mockResolvedValue(undefined);
      mockUsersService.findByUsername.mockResolvedValue(user);
      mockJwtService.sign.mockReturnValue('new-token');

      const result = await service.completePasswordChange(
        1,
        'testuser',
        'NewPass1!',
      );

      expect(mockUsersService.setNewPasswordAndClearFlag).toHaveBeenCalledWith(
        1,
        'NewPass1!',
      );
      expect(mockUsersService.writeAuditLog).toHaveBeenCalledWith(
        'testuser',
        AuditEvent.PASSWORD_CHANGED,
        undefined,
        1,
        undefined,
      );
      expect(result.accessToken).toBe('new-token');
    });
  });

  // ─── verifyToken ─────────────────────────────────────────────────────────────

  describe('verifyToken', () => {
    it('returns decoded payload on valid token', () => {
      const payload = {
        sub: 1,
        username: 'testuser',
        role: Role.ReadOnly,
        linkedCustomerId: null,
      };
      mockJwtService.verify.mockReturnValue(payload);

      expect(service.verifyToken('valid-token')).toEqual(payload);
    });

    it('throws UnauthorizedException on invalid token', () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      expect(() => service.verifyToken('bad-token')).toThrow(
        UnauthorizedException,
      );
    });
  });
});
