import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, LoginContext, LoginResult } from './auth.service';
import { TwoFactorService } from './services/twofa.service';
import { TwoFactorConfig } from '../config/twofa.config';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeGuard } from './guards/password-change.guard';
import { TwoFactorPendingGuard } from './guards/twofa-pending.guard';
import { TwoFactorEnrollGuard } from './guards/twofa-enroll.guard';
import { LoginDto } from './dto/login.dto';
import { ForceChangePasswordDto } from './dto/force-change-password.dto';
import { VerifyTwoFactorDto } from './dto/verify-2fa.dto';
import { EnableTwoFactorDto } from './dto/enable-2fa.dto';
import { DisableTwoFactorDto } from './dto/disable-2fa.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from './decorators/current-user.decorator';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  maxAge: 8 * 60 * 60 * 1000,
};

const SCOPED_COOKIE_MAXAGE = 15 * 60 * 1000;

/** Maps a login/verify status to the transient cookie that carries its scoped token. */
const STATUS_COOKIE: Record<string, string> = {
  password_change: 'pc_token',
  enroll: 'enroll_token',
  '2fa': 'tfa_token',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly config: ConfigService,
  ) {}

  private ctx(req: any): LoginContext {
    return {
      ipAddress:
        req.ip ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim(),
      userAgent: req.headers?.['user-agent'] ?? null,
      deviceToken:
        req.cookies?.device_id ?? req.headers?.['x-device-token'] ?? null,
    };
  }

  private get deviceCookieOptions() {
    const days = this.config.get<TwoFactorConfig>('twofa')!.trustDays;
    return { ...COOKIE_OPTIONS, maxAge: days * 24 * 60 * 60 * 1000 };
  }

  /**
   * Sends a login/verify result. For web clients, places the appropriate token
   * in an HttpOnly cookie (and the device token on success) and strips secrets
   * from the body. Mobile clients receive tokens in the body.
   */
  private respond(
    res: Response,
    result: LoginResult & { deviceToken?: string },
    clientType?: 'web' | 'mobile',
  ) {
    if (clientType !== 'web') {
      return result;
    }

    if (result.status === 'ok') {
      res.cookie('access_token', result.accessToken, COOKIE_OPTIONS);
      res.clearCookie('pc_token');
      res.clearCookie('enroll_token');
      res.clearCookie('tfa_token');
      if (result.deviceToken) {
        res.cookie('device_id', result.deviceToken, this.deviceCookieOptions);
      }
    } else {
      res.cookie(STATUS_COOKIE[result.status], result.accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: SCOPED_COOKIE_MAXAGE,
      });
    }

    const { accessToken: _t, deviceToken: _d, ...body } = result;
    return body;
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with username and password',
    description:
      'Returns a signed JWT (web: HttpOnly cookie; mobile: response body). The ' +
      'response status is one of: ok | password_change | enroll | 2fa. For ' +
      'enroll/2fa the token is scoped and the client must complete the matching flow.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: {
        summary: 'Admin login',
        value: { username: 'admin', password: 'Admin@1234' },
      },
    },
  })
  @ApiOkResponse({ description: 'Login outcome (see status field).' })
  async login(
    @Request() req: any,
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(req.user, this.ctx(req));
    return this.respond(res, result, dto.clientType);
  }

  @Post('change-password')
  @UseGuards(PasswordChangeGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a forced password change',
    description:
      'Only accepts the short-lived password_change-scoped token. Re-runs the ' +
      'login gate afterwards (so 2FA enrollment / new-device challenge still apply).',
  })
  @ApiBody({ type: ForceChangePasswordDto })
  @ApiOkResponse({
    description: 'Password updated — returns the next login step.',
  })
  async changePasswordAtLogin(
    @Request() req: any,
    @Body() dto: ForceChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.completePasswordChange(
      req.user.userId,
      req.user.username,
      dto.newPassword,
      this.ctx(req),
    );
    res.clearCookie('pc_token');
    return this.respond(res, result, dto.clientType);
  }

  @Post('2fa/setup')
  @UseGuards(TwoFactorEnrollGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Begin 2FA enrollment',
    description:
      'TOTP users receive an otpauth URI + QR data URL; email users are sent a code. ' +
      'Accepts a twofa_enroll-scoped token (mandatory enrollment) or a full token.',
  })
  async setup2fa(@Request() req: any) {
    return this.twoFactor.setup(req.user.userId);
  }

  @Post('2fa/enable')
  @UseGuards(TwoFactorEnrollGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete 2FA enrollment',
    description:
      'Verifies the first code and enables 2FA. TOTP users receive one-time ' +
      'recovery codes. Issues a full-access token on success.',
  })
  @ApiBody({ type: EnableTwoFactorDto })
  async enable2fa(
    @Request() req: any,
    @Body() dto: EnableTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.twoFactor.enable(
      req.user.userId,
      dto.code,
      dto.rememberDevice ?? false,
      this.ctx(req),
    );
    res.clearCookie('enroll_token');
    const { recoveryCodes, ...rest } = result;
    const body = this.respond(res, rest, dto.clientType);
    return recoveryCodes ? { ...body, recoveryCodes } : body;
  }

  @Post('verify-2fa')
  @UseGuards(TwoFactorPendingGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete the second-factor login step',
    description:
      'Accepts the twofa_pending-scoped token plus a code (or recovery code). ' +
      'Issues a full-access token and optionally trusts the device.',
  })
  @ApiBody({ type: VerifyTwoFactorDto })
  async verify2fa(
    @Request() req: any,
    @Body() dto: VerifyTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.twoFactor.verifyLogin(
      req.user.userId,
      dto.code,
      dto.rememberDevice ?? false,
      this.ctx(req),
    );
    res.clearCookie('tfa_token');
    return this.respond(res, result, dto.clientType);
  }

  @Post('2fa/resend')
  @UseGuards(TwoFactorPendingGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Resend the email 2FA code (email users only)',
    description: 'Rate-limited by the configured resend cooldown.',
  })
  async resend2fa(@Request() req: any) {
    return this.twoFactor.resend(req.user.userId);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Disable 2FA',
    description:
      'Requires a full token and a current code. Clears the secret, removes ' +
      'recovery codes, and revokes all trusted devices.',
  })
  @ApiBody({ type: DisableTwoFactorDto })
  async disable2fa(@Request() req: any, @Body() dto: DisableTwoFactorDto) {
    await this.twoFactor.disable(
      req.user.userId,
      dto.code,
      this.ctx(req).ipAddress,
    );
    return { message: '2FA has been disabled' };
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List trusted devices' })
  listDevices(@CurrentUser('userId') userId: number) {
    return this.twoFactor.listDevices(userId);
  }

  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a single trusted device' })
  async revokeDevice(
    @CurrentUser('userId') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.twoFactor.revokeDevice(userId, id);
    return { message: 'Device revoked' };
  }

  @Delete('devices')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke all trusted devices' })
  revokeAllDevices(@CurrentUser('userId') userId: number) {
    return this.twoFactor.revokeAllDevices(userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get current user session info',
    description:
      'Returns the decoded JWT payload (userId, username, role) for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Returns userId, username, and role from the JWT.',
  })
  getMe(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }
}
