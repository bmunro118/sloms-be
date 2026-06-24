import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { TwoFactorConfig } from '../../config/twofa.config';
import { encryptSecret, decryptSecret } from '../crypto.util';

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {
    // Allow a ±1 time-step (30s) window to tolerate clock skew.
    authenticator.options = { window: 1 };
  }

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
    return authenticator.generateSecret();
  }

  /** Builds the otpauth:// URI and a QR-code data URL for authenticator apps. */
  async buildEnrollment(
    username: string,
    secret: string,
  ): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
    const otpauthUrl = authenticator.keyuri(
      username,
      this.cfg.totpIssuer,
      secret,
    );
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrDataUrl };
  }

  verifyToken(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: token.trim(), secret });
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
