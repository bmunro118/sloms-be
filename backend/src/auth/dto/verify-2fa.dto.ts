import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'TOTP/email 6-digit code, or a recovery code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @ApiPropertyOptional({
    description:
      'Trust this device for the configured window (default 30 days).',
  })
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;

  @ApiPropertyOptional({ enum: ['web', 'mobile'] })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  clientType?: 'web' | 'mobile';
}
