import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordChangeJwtStrategy } from './strategies/password-change-jwt.strategy';
import { TwoFactorPendingJwtStrategy } from './strategies/twofa-pending-jwt.strategy';
import { TwoFactorEnrollJwtStrategy } from './strategies/twofa-enroll-jwt.strategy';
import { TrustedDeviceService } from './services/trusted-device.service';
import { TotpService } from './services/totp.service';
import { EmailOtpService } from './services/email-otp.service';
import { TwoFactorService } from './services/twofa.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'sloms_jwt_secret_change_me',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordChangeJwtStrategy,
    TwoFactorPendingJwtStrategy,
    TwoFactorEnrollJwtStrategy,
    TrustedDeviceService,
    TotpService,
    EmailOtpService,
    TwoFactorService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
