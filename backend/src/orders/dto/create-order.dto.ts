import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  /**
   * Optional. When omitted, the server auto-generates the next order number.
   * An explicit value is only needed to add a new batch under an existing order.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  orderNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orderBatch?: number;

  @IsInt()
  customerAccount: number;

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
  @IsString()
  @MaxLength(20)
  priceBand?: string;

  @IsOptional()
  @IsBoolean()
  void?: boolean;
}
