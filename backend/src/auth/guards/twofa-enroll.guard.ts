import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards the /auth/2fa/setup|enable endpoints — accepts twofa_enroll or full tokens. */
@Injectable()
export class TwoFactorEnrollGuard extends AuthGuard('jwt-2fa-enroll') {}
