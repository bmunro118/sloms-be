import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsInt,
  MaxLength,
  Min,
} from "class-validator";

export class CreateOrderedItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(5)
  patientInitial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  patientSurname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  week?: number;

  @IsOptional()
  @IsInt()
  parentOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  parentBatch?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1)
  side?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  colour?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tubing?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  options?: string;

  @IsOptional()
  @IsBoolean()
  checkedOut?: boolean;

  @IsOptional()
  @IsDateString()
  checkoutDateStamp?: string;

  @IsOptional()
  @IsBoolean()
  void?: boolean;
}
