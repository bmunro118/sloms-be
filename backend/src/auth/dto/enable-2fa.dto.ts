import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnableTwoFactorDto {
  @ApiProperty({
    description: 'First verification code to confirm enrollment.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @ApiPropertyOptional({ description: 'Trust this device after enrolling.' })
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;

  @ApiPropertyOptional({ enum: ['web', 'mobile'] })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  clientType?: 'web' | 'mobile';
}
