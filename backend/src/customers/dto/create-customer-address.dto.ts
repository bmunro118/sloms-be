import {
  IsString,
  IsEmail,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsInt,
} from 'class-validator';

export class CreateCustomerAddressDto {
  @IsOptional()
  @IsInt()
  customerAccount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  siteCompanyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  delBuildingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  delAddressLn1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  delAddressLn2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  delTownOrCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  delCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  delPostCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  siteContactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(50)
  siteContactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  siteContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  siteContactMobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  siteContactFax?: string;

  @IsOptional()
  @IsBoolean()
  defaultAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  void?: boolean;
}
