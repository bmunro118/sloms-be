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
    return user;
  }
}
