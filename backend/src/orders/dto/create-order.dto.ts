import {
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @Min(0)
  orderNumber: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderBatch?: number;

  @IsOptional()
  @IsInt()
  customerAccount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  orderContact?: string;

  @IsOptional()
  @IsInt()
  deliveryAddress?: number;

  @IsOptional()
  @IsDateString()
  receivedOn?: string;

  @IsOptional()
  @IsDateString()
  dispatchedOn?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  itemCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  avgPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  priceBand?: string;

  @IsOptional()
  @IsBoolean()
  void?: boolean;
}
