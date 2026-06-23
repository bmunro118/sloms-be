import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Role } from '../entities/role.enum';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  password: string;

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

  @IsInt()
  @Min(1)
  @IsOptional()
  linkedCustomerId?: number;
}
