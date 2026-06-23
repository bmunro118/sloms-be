import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PagingDto } from '../../common/paging';

/**
 * Query parameters for the orders list endpoints.
 *
 * Extends PagingDto so the global ValidationPipe (whitelist +
 * forbidNonWhitelisted) accepts the order-specific filter params instead of
 * rejecting them as unknown properties.
 */
export class FindOrdersQueryDto extends PagingDto {
  @ApiPropertyOptional({
    description: 'Include voided orders',
    example: 'true',
  })
  @IsOptional()
  @IsString()
  includeVoided?: string;

  @ApiPropertyOptional({ description: 'Filter by customer account id' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by order status: Received, InProduction, Ready, Dispatched, Voided',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
