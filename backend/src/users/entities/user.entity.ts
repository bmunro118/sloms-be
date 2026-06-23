import { Role } from "./role.enum";

export interface User {
  userId: number;
  username: string;
  passwordHash: string;
  fullName: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdAt: Date | null;
  createdBy: string | null;
  linkedCustomerId: number | null;
  mustChangePassword: boolean;
}
