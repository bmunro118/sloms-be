import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PagingDto } from '../../common/paging';

/**
 * Query parameters for GET /users/audit-log.
 *
 * Extends PagingDto so the global ValidationPipe (whitelist +
 * forbidNonWhitelisted) accepts the audit-log filter params instead of
 * rejecting them as unknown properties — the same fix applied to the orders
 * list via FindOrdersQueryDto.
 */
export class FindAuditLogQueryDto extends PagingDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by event type (LOGIN_SUCCESS, LOGIN_FAILURE, LOGIN_LOCKED, ACCOUNT_LOCKED, ACCOUNT_UNLOCKED)',
  })
  @IsOptional()
  @IsString()
  event?: string;
}
