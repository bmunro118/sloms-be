import { IsOptional, IsString } from 'class-validator';

export class UpsertUserSettingDto {
  @IsOptional()
  @IsString()
  val?: string;
}
