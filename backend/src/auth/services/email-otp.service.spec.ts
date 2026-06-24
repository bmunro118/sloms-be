import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { EmailOtpService } from './email-otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256Hex } from '../crypto.util';

const mockPrisma = {
  emailOtp: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

// No ACS connection string → dev fallback (logs instead of sending).
const mockConfig = {
  get: jest.fn().mockReturnValue({
    emailOtpTtlMinutes: 10,
    emailResendCooldownSeconds: 60,
    emailOtpMaxAttempts: 5,
  }),
};

describe('EmailOtpService', () => {
  let service: EmailOtpService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailOtpService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(EmailOtpService);
  });

  describe('send', () => {
    it('invalidates prior codes and stores a new hashed code', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue(null);
      mockPrisma.emailOtp.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.emailOtp.create.mockResolvedValue({});

      await service.send(1, 'a@b.com');

      expect(mockPrisma.emailOtp.updateMany).toHaveBeenCalled();
      const data = mockPrisma.emailOtp.create.mock.calls[0][0].data;
      expect(data.userId).toBe(1);
      expect(data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('enforces the resend cooldown', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue({
        id: 1,
        createdAt: new Date(),
      });
      await expect(service.send(1, 'a@b.com')).rejects.toThrow(HttpException);
      expect(mockPrisma.emailOtp.create).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('returns false when there is no pending code', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue(null);
      expect(await service.verify(1, '123456')).toBe(false);
    });

    it('consumes the code and returns true on a correct match', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue({
        id: 9,
        attempts: 0,
        codeHash: sha256Hex('123456'),
      });
      mockPrisma.emailOtp.update.mockResolvedValue({});

      expect(await service.verify(1, '123456')).toBe(true);
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('increments attempts and returns false on a wrong code', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue({
        id: 9,
        attempts: 1,
        codeHash: sha256Hex('123456'),
      });
      mockPrisma.emailOtp.update.mockResolvedValue({});

      expect(await service.verify(1, '999999')).toBe(false);
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { attempts: { increment: 1 } },
      });
    });

    it('invalidates the code once max attempts are reached', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValue({
        id: 9,
        attempts: 5,
        codeHash: sha256Hex('123456'),
      });
      mockPrisma.emailOtp.update.mockResolvedValue({});

      expect(await service.verify(1, '123456')).toBe(false);
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });
});
