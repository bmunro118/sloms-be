import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { generate } from 'otplib';
import { TotpService } from './totp.service';

const mockConfig = {
  get: jest.fn().mockReturnValue({
    totpIssuer: 'SLOMS',
    totpEncKey: 'test-enc-key-0123456789',
  }),
};

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TotpService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(TotpService);
  });

  it('generates a base32 secret', () => {
    const secret = service.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('encrypt/decrypt round-trips a secret', () => {
    const secret = service.generateSecret();
    const encrypted = service.encrypt(secret);
    expect(encrypted).not.toBe(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('verifies a current token and rejects a wrong one', async () => {
    const secret = service.generateSecret();
    const validToken = await generate({ secret });

    expect(await service.verifyToken(validToken, secret)).toBe(true);
    expect(await service.verifyToken('000000', secret)).toBe(false);
  });

  it('builds an otpauth URI and a QR data URL', async () => {
    const secret = service.generateSecret();
    const { otpauthUrl, qrDataUrl } = await service.buildEnrollment(
      'alice',
      secret,
    );
    expect(otpauthUrl).toContain('otpauth://totp/');
    expect(otpauthUrl).toContain('SLOMS');
    expect(qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('throws when no encryption key is configured', () => {
    mockConfig.get.mockReturnValueOnce({ totpIssuer: 'SLOMS' });
    expect(() => service.encrypt('x')).toThrow(/TOTP_ENC_KEY/);
  });
});
