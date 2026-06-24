import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TrustedDeviceService } from './trusted-device.service';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256Hex } from '../crypto.util';

const mockPrisma = {
  trustedDevice: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn().mockReturnValue({ trustDays: 30 }),
};

describe('TrustedDeviceService', () => {
  let service: TrustedDeviceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustedDeviceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(TrustedDeviceService);
  });

  describe('isTrusted', () => {
    it('returns false for a missing token', async () => {
      expect(await service.isTrusted(1, null)).toBe(false);
      expect(mockPrisma.trustedDevice.findUnique).not.toHaveBeenCalled();
    });

    it('returns false when the device belongs to another user', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({
        id: 1,
        userId: 999,
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      });
      expect(await service.isTrusted(1, 'tok')).toBe(false);
    });

    it('returns false for an expired device', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      expect(await service.isTrusted(1, 'tok')).toBe(false);
    });

    it('returns false for a revoked device', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({
        id: 1,
        userId: 1,
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: new Date(),
      });
      expect(await service.isTrusted(1, 'tok')).toBe(false);
    });

    it('matches by hash, slides the expiry, and returns true', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({
        id: 5,
        userId: 1,
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      });
      mockPrisma.trustedDevice.update.mockResolvedValue({});

      const result = await service.isTrusted(1, 'raw-token');

      expect(result).toBe(true);
      expect(mockPrisma.trustedDevice.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256Hex('raw-token') },
      });
      const updateArg = mockPrisma.trustedDevice.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 5 });
      expect(updateArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('trust', () => {
    it('stores the token hash (not the raw token) and returns the raw token', async () => {
      mockPrisma.trustedDevice.create.mockResolvedValue({});
      const token = await service.trust(1, {
        userAgent: 'Mozilla/5.0 (Windows NT) Chrome/120',
        ipAddress: '1.2.3.4',
      });

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      const data = mockPrisma.trustedDevice.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(sha256Hex(token));
      expect(data.tokenHash).not.toBe(token);
      expect(data.label).toBe('Chrome on Windows');
    });
  });

  describe('revoke / revokeAll', () => {
    it('revoke returns false when nothing matched', async () => {
      mockPrisma.trustedDevice.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.revoke(1, 7)).toBe(false);
    });

    it('revoke returns true when a device was revoked', async () => {
      mockPrisma.trustedDevice.updateMany.mockResolvedValue({ count: 1 });
      expect(await service.revoke(1, 7)).toBe(true);
    });

    it('revokeAll returns the count', async () => {
      mockPrisma.trustedDevice.updateMany.mockResolvedValue({ count: 3 });
      expect(await service.revokeAll(1)).toBe(3);
    });
  });
});
