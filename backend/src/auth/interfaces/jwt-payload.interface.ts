import { Role } from '../../users/entities/role.enum';

export interface JwtPayload {
  sub: number; // userId
  username: string;
  role: Role;
  linkedCustomerId: number | null;
  /** Absent on full-access tokens. 'password_change' tokens are only valid for POST /auth/change-password. */
  scope?: 'password_change';
}
