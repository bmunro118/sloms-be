import {
  IsString,
  IsEmail,
  IsOptional,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class CreateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  centreNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invBuildingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invAddressLn1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invAddressLn2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invTownOrCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  invPostCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(50)
  contactEmail?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  reportEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactMobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactFax?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  band?: string;

  @IsOptional()
  @IsBoolean()
  suspended?: boolean;
}
