import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  MinLength,
  MaxLength,
} from "class-validator";
import { Role } from "../entities/role.enum";

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  username?: string;

  @IsString()
  @IsOptional()
  @MinLength(8)
  @MaxLength(100)
  password?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  fullName?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  linkedCustomerId?: number | null;
}
