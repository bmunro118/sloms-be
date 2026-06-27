import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  IsDateString,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StatGroupBy {
  Model = 'model',
  Category = 'category',
}

/**
 * Request body for POST /stats/builder.
 *
 * Reimplements the Access "Stat Builder" tab (frmAccountFigures): pick one or
 * more customers and a dispatch-date range, group by model or category, and get
 * a per-group breakdown plus the five headline KPIs. Posted (not GET) because
 * the customer list can be long; the operation is read-only.
 *
 * Provide `customerIds` and/or `accountNumbers` — at least one customer must be
 * identified by either means.
 */
export class BuilderQueryDto {
  @ApiPropertyOptional({
    description: 'Customer IDs to include',
    type: [Number],
    example: [12, 45],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  customerIds?: number[];

  @ApiPropertyOptional({
    description: 'Customer account numbers to include (alternative to IDs)',
    type: [String],
    example: ['ROYALNAT'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountNumbers?: string[];

  @ApiProperty({
    description: 'Window start (inclusive), YYYY-MM-DD',
    example: '2025-01-01',
  })
  @IsDateString()
  from!: string;

  @ApiProperty({
    description: 'Window end (inclusive), YYYY-MM-DD',
    example: '2025-03-31',
  })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({
    enum: StatGroupBy,
    default: StatGroupBy.Model,
    description: 'Group the breakdown rows by model code or product category',
  })
  @IsOptional()
  @IsEnum(StatGroupBy)
  groupBy?: StatGroupBy = StatGroupBy.Model;
}
