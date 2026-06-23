import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, IsIn } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ForceChangePasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;

  @ApiPropertyOptional({
    enum: ['web', 'mobile'],
    description: 'Must match the clientType used during login.',
  })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  clientType?: 'web' | 'mobile';
}
