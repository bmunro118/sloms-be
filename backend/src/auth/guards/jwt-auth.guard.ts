import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) throw err ?? new UnauthorizedException();
    if (user.scope === 'password_change') {
      throw new ForbiddenException(
        'You must change your password before accessing this resource.',
      );
    }
    // Any other scoped (pre-auth) token — e.g. twofa_enroll / twofa_pending —
    // is single-purpose and must never grant full access.
    if (user.scope) {
      throw new ForbiddenException(
        'This token is not valid for accessing this resource.',
      );
    }
    return user;
  }
}
