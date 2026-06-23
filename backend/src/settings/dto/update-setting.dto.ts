import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateSettingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  val?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  exposed?: boolean;
}
