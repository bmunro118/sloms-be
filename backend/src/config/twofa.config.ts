import { registerAs } from '@nestjs/config';

export type TwoFactorConfig = {
  /** How long a device stays trusted before 2FA is required again, in days (sliding). */
  trustDays: number;
  /** Lifetime of an emailed OTP code, in minutes. */
  emailOtpTtlMinutes: number;
  /** Minimum seconds between successive email-OTP sends for the same login attempt. */
  emailResendCooldownSeconds: number;
  /** Maximum verify attempts against a single emailed OTP before it is invalidated. */
  emailOtpMaxAttempts: number;
  /** Lifetime of the short-lived twofa_pending / twofa_enroll scoped tokens. */
  pendingTokenTtl: string;
  /** TOTP issuer label shown in authenticator apps. */
  totpIssuer: string;
  /** AES-256 key (hex/base64) used to encrypt TOTP secrets at rest. */
  totpEncKey: string | undefined;
  /** Azure Communication Services email connection string. */
  acsConnectionString: string | undefined;
  /** Verified ACS sender address (e.g. DoNotReply@<guid>.azurecomm.net). */
  acsSenderAddress: string | undefined;
};

function int(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export default registerAs(
  'twofa',
  (): TwoFactorConfig => ({
    trustDays: int(process.env.TWOFA_TRUST_DAYS, 30),
    emailOtpTtlMinutes: int(process.env.TWOFA_EMAIL_OTP_TTL_MINUTES, 10),
    emailResendCooldownSeconds: int(
      process.env.TWOFA_EMAIL_RESEND_COOLDOWN_SECONDS,
      60,
    ),
    emailOtpMaxAttempts: int(process.env.TWOFA_EMAIL_OTP_MAX_ATTEMPTS, 5),
    pendingTokenTtl: process.env.TWOFA_PENDING_TOKEN_TTL || '15m',
    totpIssuer: process.env.TWOFA_TOTP_ISSUER || 'SLOMS',
    totpEncKey: process.env.TOTP_ENC_KEY,
    acsConnectionString: process.env.ACS_CONNECTION_STRING,
    acsSenderAddress: process.env.ACS_SENDER_ADDRESS,
  }),
);
