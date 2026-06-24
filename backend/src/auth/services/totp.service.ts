import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { TwoFactorConfig } from '../../config/twofa.config';
import { encryptSecret, decryptSecret } from '../crypto.util';

/** Allow ±1 time-step (30s) to tolerate clock skew between server and device. */
const EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {}

  private get cfg(): TwoFactorConfig {
    return this.config.get<TwoFactorConfig>('twofa')!;
  }

  private get encKey(): string {
    const key = this.cfg.totpEncKey;
    if (!key) {
      throw new InternalServerErrorException(
        'TOTP_ENC_KEY is not configured; cannot handle TOTP secrets.',
      );
    }
    return key;
  }

  generateSecret(): string {
    return generateSecret();
  }

  /** Builds the otpauth:// URI and a QR-code data URL for authenticator apps. */
  async buildEnrollment(
    username: string,
    secret: string,
  ): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
    const otpauthUrl = generateURI({
      issuer: this.cfg.totpIssuer,
      label: username,
      secret,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrDataUrl };
  }

  async verifyToken(token: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({
        token: token.trim(),
        secret,
        epochTolerance: EPOCH_TOLERANCE_SECONDS,
      });
      return result.valid;
    } catch {
      return false;
    }
  }

  /** Encrypts a TOTP secret for storage at rest. */
  encrypt(secret: string): string {
    return encryptSecret(secret, this.encKey);
  }

  /** Decrypts a stored TOTP secret. */
  decrypt(encrypted: string): string {
    return decryptSecret(encrypted, this.encKey);
  }
}
