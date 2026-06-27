import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  IsDateString,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StatBucket {
  Year = 'year',
  Quarter = 'quarter',
  Month = 'month',
  Week = 'week',
}

export enum StatMetric {
  Revenue = 'revenue',
  Orders = 'orders',
  Items = 'items',
  AvgPrice = 'avgPrice',
}

/**
 * Query parameters for GET /stats/timeseries.
 *
 * Replaces the eight Access PivotChart forms (frmStats "Revenue Graphs" tab):
 * one dataset, bucketed by year/quarter/month/week. Every row carries all
 * measures so the FE can switch `metric` without refetching.
 *
 * When `from`/`to` are omitted the window defaults to the legacy Access values:
 *   year/quarter -> STAT_GRAPH_YEARS calendar years (GlobalSetting, default 5)
 *   month        -> last 24 months
 *   week         -> last 52 weeks
 */
export class TimeseriesQueryDto {
  @ApiProperty({ enum: StatBucket, description: 'Time bucket to group by' })
  @IsEnum(StatBucket)
  bucket!: StatBucket;

  @ApiPropertyOptional({
    enum: StatMetric,
    default: StatMetric.Revenue,
    description: 'Primary metric (all metrics are returned regardless)',
  })
  @IsOptional()
  @IsEnum(StatMetric)
  metric?: StatMetric = StatMetric.Revenue;

  @ApiPropertyOptional({
    description: 'Window start (inclusive), YYYY-MM-DD',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Window end (inclusive), YYYY-MM-DD',
    example: '2025-12-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Optional customer filter. Repeatable (?customerId=1&customerId=2) ' +
      'or comma-separated (?customerId=1,2). Omit for whole-business totals.',
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : String(value).split(','))
      .map((v: string | number) => Number(v))
      .filter((n: number) => Number.isInteger(n)),
  )
  @IsInt({ each: true })
  @Type(() => Number)
  customerId?: number[];

  @ApiPropertyOptional({ description: 'Optional customer price-band filter' })
  @IsOptional()
  @IsString()
  band?: string;
}
