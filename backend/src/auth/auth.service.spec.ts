import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService, AuditEvent } from '../users/users.service';
import { TrustedDeviceService } from './services/trusted-device.service';
import { EmailOtpService } from './services/email-otp.service';
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

const mockConfigService = {
  get: jest.fn().mockReturnValue({
    trustDays: 30,
    pendingTokenTtl: '15m',
    emailOtpTtlMinutes: 10,
  }),
};

const mockTrustedDevices = {
  isTrusted: jest.fn().mockResolvedValue(true),
  trust: jest.fn(),
};

const mockEmailOtp = {
  send: jest.fn().mockResolvedValue(undefined),
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
    twoFactorMethod: 'totp',
    twoFactorEnabled: true,
    totpSecret: null,
    twoFactorEnrolledAt: new Date(),
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
    mockTrustedDevices.isTrusted.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TrustedDeviceService, useValue: mockTrustedDevices },
        { provide: EmailOtpService, useValue: mockEmailOtp },
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

    it('returns enroll status when 2FA is not yet enabled', async () => {
      const user = makeUser({
        twoFactorEnabled: false,
        twoFactorMethod: 'totp',
      });
      mockJwtService.sign.mockReturnValue('enroll-token');

      const result = await service.login(user);

      expect(result.status).toBe('enroll');
      expect(result.enrollRequired).toBe(true);
      expect(result.twoFactorMethod).toBe('totp');
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'twofa_enroll' }),
        { expiresIn: '15m' },
      );
    });

    it('returns 2fa status and sends email for an untrusted email-2FA user', async () => {
      const user = makeUser({
        twoFactorEnabled: true,
        twoFactorMethod: 'email',
        role: Role.Customer,
        username: 'cust@example.com',
        email: null,
        linkedCustomerId: 7,
      });
      mockTrustedDevices.isTrusted.mockResolvedValue(false);
      mockJwtService.sign.mockReturnValue('pending-token');

      const result = await service.login(user, { deviceToken: null });

      expect(result.status).toBe('2fa');
      expect(result.twoFactorRequired).toBe(true);
      expect(mockEmailOtp.send).toHaveBeenCalledWith(1, 'cust@example.com');
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'twofa_pending' }),
        { expiresIn: '15m' },
      );
    });

    it('skips 2FA for an enabled user on a trusted device', async () => {
      const user = makeUser({ twoFactorEnabled: true });
      mockTrustedDevices.isTrusted.mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('full-token');

      const result = await service.login(user, { deviceToken: 'tok' });

      expect(result.status).toBe('ok');
      expect(result.accessToken).toBe('full-token');
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
