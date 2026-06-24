import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { TwoFactorService } from './twofa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { TotpService } from './totp.service';
import { EmailOtpService } from './email-otp.service';
import { TrustedDeviceService } from './trusted-device.service';
import { Role } from '../../users/entities/role.enum';
import { User } from '../../users/entities/user.entity';
import { sha256Hex } from '../crypto.util';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    userId: 1,
    username: 'staff',
    passwordHash: 'h',
    fullName: null,
    email: null,
    role: Role.Operative,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: null,
    createdBy: null,
    linkedCustomerId: null,
    mustChangePassword: false,
    twoFactorMethod: 'totp',
    twoFactorEnabled: false,
    totpSecret: null,
    twoFactorEnrolledAt: null,
    ...overrides,
  };
}

const mockPrisma = {
  recoveryCode: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 8 }),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
};

const mockUsers = {
  findByIdRaw: jest.fn(),
  setPendingTotpSecret: jest.fn().mockResolvedValue(undefined),
  enableTwoFactor: jest.fn().mockResolvedValue(undefined),
  disableTwoFactor: jest.fn().mockResolvedValue(undefined),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
};

const mockAuth = {
  issueFullToken: jest
    .fn()
    .mockReturnValue({ status: 'ok', accessToken: 'full' }),
};

const mockTotp = {
  generateSecret: jest.fn().mockReturnValue('SECRET'),
  encrypt: jest.fn().mockReturnValue('enc'),
  decrypt: jest.fn().mockReturnValue('SECRET'),
  verifyToken: jest.fn(),
  buildEnrollment: jest.fn().mockResolvedValue({
    otpauthUrl: 'otpauth://x',
    qrDataUrl: 'data:image/png;base64,AAA',
  }),
};

const mockEmailOtp = {
  send: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn(),
};

const mockTrusted = {
  trust: jest.fn().mockResolvedValue('device-token'),
  list: jest.fn(),
  revoke: jest.fn(),
  revokeAll: jest.fn().mockResolvedValue(2),
};

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuth.issueFullToken.mockReturnValue({
      status: 'ok',
      accessToken: 'full',
    });
    mockTrusted.trust.mockResolvedValue('device-token');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsers },
        { provide: AuthService, useValue: mockAuth },
        { provide: TotpService, useValue: mockTotp },
        { provide: EmailOtpService, useValue: mockEmailOtp },
        { provide: TrustedDeviceService, useValue: mockTrusted },
      ],
    }).compile();
    service = module.get(TwoFactorService);
  });

  describe('setup', () => {
    it('TOTP: stores a pending secret and returns the QR payload', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(makeUser());
      const res = await service.setup(1);
      expect(res.method).toBe('totp');
      expect(res.qrDataUrl).toContain('data:image');
      expect(mockUsers.setPendingTotpSecret).toHaveBeenCalledWith(1, 'enc');
    });

    it('email: sends a code and returns a masked address', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorMethod: 'email', username: 'jane@example.com' }),
      );
      const res = await service.setup(1);
      expect(res.method).toBe('email');
      expect(mockEmailOtp.send).toHaveBeenCalledWith(1, 'jane@example.com');
      expect(res.sentTo).toContain('@example.com');
    });
  });

  describe('enable', () => {
    it('TOTP: enables 2FA and returns recovery codes on a valid code', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(makeUser({ totpSecret: 'enc' }));
      mockTotp.verifyToken.mockReturnValue(true);

      const res = await service.enable(1, '123456', false, {});

      expect(mockUsers.enableTwoFactor).toHaveBeenCalledWith(1);
      expect(res.recoveryCodes).toHaveLength(8);
      expect(mockPrisma.recoveryCode.createMany).toHaveBeenCalled();
      expect(res.accessToken).toBe('full');
    });

    it('throws on an invalid code', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(makeUser({ totpSecret: 'enc' }));
      mockTotp.verifyToken.mockReturnValue(false);
      await expect(service.enable(1, '000000', false, {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsers.enableTwoFactor).not.toHaveBeenCalled();
    });
  });

  describe('verifyLogin', () => {
    it('issues a full token and does not trust the device by default', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, totpSecret: 'enc' }),
      );
      mockTotp.verifyToken.mockReturnValue(true);

      const res = await service.verifyLogin(1, '123456', false, {});

      expect(res.accessToken).toBe('full');
      expect(res.deviceToken).toBeUndefined();
      expect(mockTrusted.trust).not.toHaveBeenCalled();
    });

    it('trusts the device when rememberDevice is set', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, totpSecret: 'enc' }),
      );
      mockTotp.verifyToken.mockReturnValue(true);

      const res = await service.verifyLogin(1, '123456', true, {});

      expect(mockTrusted.trust).toHaveBeenCalled();
      expect(res.deviceToken).toBe('device-token');
    });

    it('falls back to a recovery code', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, totpSecret: 'enc' }),
      );
      mockTotp.verifyToken.mockReturnValue(false);
      mockPrisma.recoveryCode.findMany.mockResolvedValue([
        { id: 3, codeHash: sha256Hex('abcde-fghij') },
      ]);

      const res = await service.verifyLogin(1, 'abcde-fghij', false, {});

      expect(res.accessToken).toBe('full');
      expect(mockPrisma.recoveryCode.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('throws on a wrong code with no recovery match', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, totpSecret: 'enc' }),
      );
      mockTotp.verifyToken.mockReturnValue(false);
      mockPrisma.recoveryCode.findMany.mockResolvedValue([]);

      await expect(service.verifyLogin(1, 'nope', false, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('disable', () => {
    it('verifies the code, disables 2FA, and revokes all devices', async () => {
      mockUsers.findByIdRaw.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, totpSecret: 'enc' }),
      );
      mockTotp.verifyToken.mockReturnValue(true);

      await service.disable(1, '123456');

      expect(mockUsers.disableTwoFactor).toHaveBeenCalledWith(1);
      expect(mockPrisma.recoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 1 },
      });
      expect(mockTrusted.revokeAll).toHaveBeenCalledWith(1);
    });
  });
});
