import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards POST /auth/verify-2fa and /auth/2fa/resend — accepts only twofa_pending tokens. */
@Injectable()
export class TwoFactorPendingGuard extends AuthGuard('jwt-2fa-pending') {}
