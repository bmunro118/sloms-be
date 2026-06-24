import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisableTwoFactorDto {
  @ApiProperty({
    description:
      'Current TOTP/email code or a recovery code, to authorize disabling.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;
}
