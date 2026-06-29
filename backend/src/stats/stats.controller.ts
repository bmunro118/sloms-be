import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/entities/role.enum';
import { StatsService } from './stats.service';
import { TimeseriesQueryDto } from './dto/timeseries-query.dto';
import { BuilderQueryDto } from './dto/builder-query.dto';

@ApiTags('stats')
@ApiBearerAuth('access-token')
@Controller('stats')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /**
   * GET /stats/timeseries
   * Replaces the eight Access PivotChart forms — one bucketed dataset.
   */
  @Get('timeseries')
  @Roles(Role.ReadOnly, Role.Manager, Role.Admin)
  @ApiOperation({
    summary: 'Revenue / figures time-series for charting',
    description:
      'Aggregates dispatched, non-void orders into year/quarter/month/week ' +
      'buckets. Each point carries revenue, orders, items and avgPrice so the ' +
      'client can switch metric without refetching. Staff only.',
  })
  @ApiOkResponse({ description: 'Bucketed time-series with all measures.' })
  timeseries(@Query() query: TimeseriesQueryDto) {
    return this.statsService.timeseries(query);
  }

  /**
   * POST /stats/builder
   * Reimplements the Access "Stat Builder" tab.
   */
  @Post('builder')
  @Roles(Role.ReadOnly, Role.Manager, Role.Admin)
  @ApiOperation({
    summary: 'Per-account figures breakdown + KPIs',
    description:
      'For the chosen customers and dispatch-date range, returns a breakdown ' +
      'grouped by model or category plus the five headline KPIs (revenue, ' +
      'order count, item count, average price, average items per order). ' +
      'Read-only; POST is used so the customer list can be large. Staff only.',
  })
  @ApiOkResponse({ description: 'Breakdown rows and totals.' })
  builder(@Body() dto: BuilderQueryDto) {
    return this.statsService.builder(dto);
  }
}
