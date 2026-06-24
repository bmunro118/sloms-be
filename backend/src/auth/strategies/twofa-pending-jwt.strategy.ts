import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Passport strategy for the second-factor step of login.
 * Accepts only tokens that carry scope: 'twofa_pending' — issued after a valid
 * password but before the 2FA code has been verified. Valid only for
 * POST /auth/verify-2fa and POST /auth/2fa/resend.
 */
@Injectable()
export class TwoFactorPendingJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-2fa-pending',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Web clients receive the scoped token in a separate tfa_token cookie
        (req: Request) => req?.cookies?.tfa_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'sloms_jwt_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.scope !== 'twofa_pending') {
      throw new UnauthorizedException('Invalid token scope');
    }
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      linkedCustomerId: payload.linkedCustomerId ?? null,
    };
  }
}
