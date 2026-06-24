import {
  randomBytes,
  createHash,
  randomInt,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'crypto';

/** Generates a high-entropy opaque token (for trusted-device cookies). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hex digest — used to store opaque tokens / OTP codes without reversibility. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two equal-length hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Generates a zero-padded numeric code of the given length (default 6). */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

/** Generates a recovery code like "a1b2c-3d4e5" (10 lowercase base32-ish chars). */
export function recoveryCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[randomInt(0, alphabet.length)];
    if (i === 4) out += '-';
  }
  return out;
}

function encKey(rawKey: string): Buffer {
  // Accept hex/base64/utf8; normalise to 32 bytes via SHA-256 so any
  // sufficiently-random Key Vault secret works as an AES-256 key.
  return createHash('sha256').update(rawKey).digest();
}

/** AES-256-GCM encrypt. Returns iv:tag:ciphertext (all hex). */
export function encryptSecret(plaintext: string, rawKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(rawKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Reverses {@link encryptSecret}. */
export function decryptSecret(payload: string, rawKey: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encKey(rawKey),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
