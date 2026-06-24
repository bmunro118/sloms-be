import { Role } from '../../users/entities/role.enum';

export interface JwtPayload {
  sub: number; // userId
  username: string;
  role: Role;
  linkedCustomerId: number | null;
  /**
   * Absent on full-access tokens. Scoped tokens are single-purpose and rejected by JwtAuthGuard:
   * - 'password_change' — only valid for POST /auth/change-password
   * - 'twofa_enroll'     — only valid for the /auth/2fa/setup|enable enrollment endpoints
   * - 'twofa_pending'    — only valid for POST /auth/verify-2fa and /auth/2fa/resend (post-password, pre-2FA)
   */
  scope?: 'password_change' | 'twofa_enroll' | 'twofa_pending';
}
