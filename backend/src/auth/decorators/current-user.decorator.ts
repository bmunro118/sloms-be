import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Role } from "../../users/entities/role.enum";

export interface CurrentUserPayload {
  userId: number;
  username: string;
  role: Role;
  linkedCustomerId: number | null;
}

/**
 * Parameter decorator that extracts the authenticated user from the request.
 *
 * Populated by JwtStrategy.validate() after a valid Bearer token is verified.
 *
 * Usage:
 *   @Get('me')
 *   getMe(@CurrentUser() user: CurrentUserPayload) { ... }
 *
 *   @Get('me/id')
 *   getId(@CurrentUser('userId') id: number) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: CurrentUserPayload = request.user;

    if (!user) {
      return null;
    }

    return field ? user[field] : user;
  },
);
