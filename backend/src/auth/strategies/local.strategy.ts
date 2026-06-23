import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'username',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  /**
   * Passport calls this automatically when the LocalAuthGuard is applied.
   * validateUser now throws directly with an appropriate UnauthorizedException,
   * so we just propagate any errors here.
   */
  async validate(req: any, username: string, password: string): Promise<User> {
    const ip: string | undefined =
      req.ip ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
    return this.authService.validateUser(username, password, ip);
  }
}
