import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Passport strategy used exclusively for the POST /auth/change-password endpoint.
 * Accepts only tokens that carry scope: 'password_change'.
 * Full-access tokens are rejected, preventing privilege escalation through this endpoint.
 */
@Injectable()
export class PasswordChangeJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-password-change',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Web clients receive the scoped token in a separate pc_token cookie
        (req: Request) => req?.cookies?.pc_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'sloms_jwt_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.scope !== 'password_change') {
      throw new UnauthorizedException('Invalid token scope');
    }
    return {
      userId: payload.sub,
      username: payload.username,
    };
  }
}
