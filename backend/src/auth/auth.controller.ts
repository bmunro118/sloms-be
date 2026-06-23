import {
  Controller,
  Post,
  Get,
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
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeGuard } from './guards/password-change.guard';
import { LoginDto } from './dto/login.dto';
import { ForceChangePasswordDto } from './dto/force-change-password.dto';
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with username and password',
    description:
      'Returns a signed JWT. Web clients (clientType: "web") receive it in an HttpOnly cookie; ' +
      'mobile clients receive it in the response body.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: {
        summary: 'Admin login',
        value: { username: 'admin', password: 'Admin@1234' },
      },
      staff: {
        summary: 'Staff login',
        value: { username: 'jsmith', password: 'Password1!' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Login successful — returns userId, username, role, fullName. accessToken is included for mobile; web receives it via Set-Cookie.',
  })
  async login(
    @Request() req: any,
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip: string | undefined =
      req.ip ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
    const result = await this.authService.login(req.user, ip);

    if (dto.clientType === 'web') {
      if (result.mustChangePassword) {
        // Scoped token goes in a separate cookie so the change-password strategy can find it
        res.cookie('pc_token', result.accessToken, {
          ...COOKIE_OPTIONS,
          maxAge: 15 * 60 * 1000,
        });
      } else {
        res.cookie('access_token', result.accessToken, COOKIE_OPTIONS);
      }
      const { accessToken: _, ...body } = result;
      return body;
    }

    return result;
  }

  @Post('change-password')
  @UseGuards(PasswordChangeGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a forced password change',
    description:
      'Only accepts the short-lived password_change-scoped token (Bearer or pc_token cookie). ' +
      'Returns a full-access token on success.',
  })
  @ApiBody({ type: ForceChangePasswordDto })
  @ApiOkResponse({
    description: 'Password updated — returns a full-access token.',
  })
  async changePasswordAtLogin(
    @Request() req: any,
    @Body() dto: ForceChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip: string | undefined =
      req.ip ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
    const result = await this.authService.completePasswordChange(
      req.user.userId,
      req.user.username,
      dto.newPassword,
      ip,
    );

    if (dto.clientType === 'web') {
      res.clearCookie('pc_token');
      res.cookie('access_token', result.accessToken, COOKIE_OPTIONS);
      const { accessToken: _, ...body } = result;
      return body;
    }

    return result;
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
