import { User } from '../../users/entities/user.entity';

/** Response shape for POST /customers/:id/onboard. */
export interface OnboardResult {
  customerId: number;
  /** The email/username the customer will sign in with. */
  loginEmail: string;
  /** The newly created portal user (without the password hash). */
  user: Omit<User, 'passwordHash'>;
}
