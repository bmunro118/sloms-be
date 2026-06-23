import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../../users/entities/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Retrieve the roles metadata set by @Roles() on the handler or class
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator is present, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // user is populated by JwtStrategy.validate() — must be present
    if (!user || !user.role) {
      return false;
    }

    // Admin always has full access regardless of what roles are listed
    if (user.role === Role.Admin) {
      return true;
    }

    return requiredRoles.includes(user.role);
  }
}
