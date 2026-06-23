import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ─── Query DTO ────────────────────────────────────────────────────────────────

export class PagingDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of records per page',
    default: 25,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  /** Returns the zero-based offset for use in TypeORM skip/take */
  get offset(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 25);
  }
}

// ─── Response wrapper ─────────────────────────────────────────────────────────

export class PagedResult<T> {
  /** The records for this page */
  data: T[];

  /** Total number of matching records across all pages */
  total: number;

  /** Current page number (1-based) */
  page: number;

  /** Records per page */
  limit: number;

  /** Total number of pages */
  pageCount: number;

  /** Whether a next page exists */
  hasNextPage: boolean;

  /** Whether a previous page exists */
  hasPreviousPage: boolean;

  constructor(data: T[], total: number, paging: PagingDto) {
    const page = paging.page ?? 1;
    const limit = paging.limit ?? 25;
    const pageCount = Math.ceil(total / limit) || 1;

    this.data = data;
    this.total = total;
    this.page = page;
    this.limit = limit;
    this.pageCount = pageCount;
    this.hasNextPage = page < pageCount;
    this.hasPreviousPage = page > 1;
  }
}
