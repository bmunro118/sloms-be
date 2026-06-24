import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Passport strategy for the 2FA enrollment endpoints (/auth/2fa/setup|enable).
 *
 * Accepts two kinds of token:
 * - scope 'twofa_enroll' — the mandatory-enrollment gate issued at login when a
 *   user has not yet set up 2FA (mirrors the mustChangePassword flow), and
 * - full-access tokens (no scope) — so an already-enrolled user can re-run
 *   setup / re-enroll while logged in.
 *
 * Other pre-auth scopes (password_change, twofa_pending) are rejected.
 */
@Injectable()
export class TwoFactorEnrollJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-2fa-enroll',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.enroll_token ?? null,
        (req: Request) => req?.cookies?.access_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'sloms_jwt_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.scope && payload.scope !== 'twofa_enroll') {
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
