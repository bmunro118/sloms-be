import {
  IsDateString,
  IsNumber,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVatRateDto {
  @IsNumber()
  @Min(0)
  rate: number;

  @IsString()
  @MaxLength(50)
  label: string;

  @IsDateString()
  validFrom: string;
}
