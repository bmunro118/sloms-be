import { SetMetadata } from '@nestjs/common';
import { Role } from '../../users/entities/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Attach one or more required roles to a route handler or controller.
 *
 * Usage:
 *   @Roles(Role.Admin)
 *   @Roles(Role.Admin, Role.Manager)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
