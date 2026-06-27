import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  StatBucket,
  StatMetric,
  TimeseriesQueryDto,
} from './dto/timeseries-query.dto';
import { BuilderQueryDto, StatGroupBy } from './dto/builder-query.dto';

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface TimeseriesPoint {
  /** Human label for the bucket, e.g. "2025", "2025-Q1", "2025-01", "2025-W05" */
  period: string;
  /** ISO date of the bucket's first day */
  periodStart: string;
  revenue: number;
  orders: number;
  items: number;
  avgPrice: number;
}

export interface TimeseriesResult {
  bucket: StatBucket;
  metric: StatMetric;
  from: string;
  to: string;
  series: TimeseriesPoint[];
}

export interface BuilderRow {
  modelCode: string | null;
  description: string | null;
  category: string | null;
  quantity: number;
  sales: number;
}

export interface BuilderResult {
  filters: {
    customerIds: number[];
    from: string;
    to: string;
    groupBy: StatGroupBy;
  };
  totals: {
    revenueTotal: number;
    orderCount: number;
    itemCount: number;
    avgPrice: number;
    avgItemsPerOrder: number;
  };
  rows: BuilderRow[];
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Time-series graphs (frmStats "Revenue Graphs")
  // ───────────────────────────────────────────────────────────────────────────

  async timeseries(query: TimeseriesQueryDto): Promise<TimeseriesResult> {
    const bucket = query.bucket;
    const metric = query.metric ?? StatMetric.Revenue;

    const { from, to } = await this.resolveWindow(bucket, query.from, query.to);

    // Revenue recognised on dispatch; voided orders and items excluded — the
    // same rules the Access vwStat* views enforce.
    const conds: Prisma.Sql[] = [
      Prisma.sql`o."Void" = false`,
      Prisma.sql`oi."Void" = false`,
      Prisma.sql`o."DispatchedOn" IS NOT NULL`,
      Prisma.sql`o."DispatchedOn" >= ${from}`,
      Prisma.sql`o."DispatchedOn" < ${to}`,
    ];
    if (query.customerId && query.customerId.length > 0) {
      conds.push(Prisma.sql`o."CustomerAccount" = ANY(${query.customerId})`);
    }
    if (query.band) {
      conds.push(Prisma.sql`c."Band" = ${query.band}`);
    }
    const where = Prisma.join(conds, ' AND ');

    // bucket is a validated enum, safe to inline as a date_trunc literal.
    const truncUnit = Prisma.raw(`'${bucket}'`);

    const rows = await this.prisma.$queryRaw<
      {
        periodStart: Date;
        revenue: number;
        orders: number;
        items: number;
        avgPrice: number;
      }[]
    >(Prisma.sql`
      SELECT
        date_trunc(${truncUnit}, o."DispatchedOn")                  AS "periodStart",
        COALESCE(SUM(oi."Price"), 0)::float8                        AS "revenue",
        COUNT(DISTINCT (o."OrderNumber", o."OrderBatch"))::int      AS "orders",
        COUNT(oi.*)::int                                           AS "items",
        CASE WHEN COUNT(oi.*) = 0 THEN 0
             ELSE (SUM(oi."Price") / COUNT(oi.*)) END::float8       AS "avgPrice"
      FROM "Order" o
      JOIN "OrderedItems" oi
        ON oi."ParentOrder" = o."OrderNumber"
       AND oi."ParentBatch" = o."OrderBatch"
      JOIN "Customers" c ON c."CustomerID" = o."CustomerAccount"
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1
    `);

    return {
      bucket,
      metric,
      from: toIso(from),
      to: toIso(to),
      series: rows.map((r) => ({
        period: formatPeriod(r.periodStart, bucket),
        periodStart: toIso(r.periodStart),
        revenue: r.revenue,
        orders: r.orders,
        items: r.items,
        avgPrice: r.avgPrice,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stat Builder (frmAccountFigures)
  // ───────────────────────────────────────────────────────────────────────────

  async builder(dto: BuilderQueryDto): Promise<BuilderResult> {
    const groupBy = dto.groupBy ?? StatGroupBy.Model;
    const customerIds = await this.resolveCustomerIds(dto);

    const from = startOfDay(dto.from);
    const to = nextDay(dto.to); // inclusive end-of-day

    const where = Prisma.join(
      [
        Prisma.sql`o."Void" = false`,
        Prisma.sql`oi."Void" = false`,
        Prisma.sql`o."DispatchedOn" IS NOT NULL`,
        Prisma.sql`o."DispatchedOn" >= ${from}`,
        Prisma.sql`o."DispatchedOn" < ${to}`,
        Prisma.sql`o."CustomerAccount" = ANY(${customerIds})`,
      ],
      ' AND ',
    );

    // groupBy is a validated enum -> safe column reference.
    const dimension =
      groupBy === StatGroupBy.Category
        ? Prisma.raw(`oi."Category"`)
        : Prisma.raw(`oi."ModelCode"`);

    const rows = await this.prisma.$queryRaw<
      {
        modelCode: string | null;
        description: string | null;
        category: string | null;
        quantity: number;
        sales: number;
      }[]
    >(Prisma.sql`
      SELECT
        MIN(oi."ModelCode")          AS "modelCode",
        MIN(pli."Description")        AS "description",
        MIN(oi."Category")            AS "category",
        COUNT(oi.*)::int              AS "quantity",
        COALESCE(SUM(oi."Price"), 0)::float8 AS "sales"
      FROM "Order" o
      JOIN "OrderedItems" oi
        ON oi."ParentOrder" = o."OrderNumber"
       AND oi."ParentBatch" = o."OrderBatch"
      LEFT JOIN "PriceListItem" pli ON pli."ItemID" = oi."ModelCode"
      WHERE ${where}
      GROUP BY ${dimension}
      ORDER BY COUNT(oi.*) DESC
    `);

    const totals = await this.prisma.$queryRaw<
      {
        revenueTotal: number;
        itemCount: number;
        orderCount: number;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(oi."Price"), 0)::float8                   AS "revenueTotal",
        COUNT(oi.*)::int                                       AS "itemCount",
        COUNT(DISTINCT (o."OrderNumber", o."OrderBatch"))::int AS "orderCount"
      FROM "Order" o
      JOIN "OrderedItems" oi
        ON oi."ParentOrder" = o."OrderNumber"
       AND oi."ParentBatch" = o."OrderBatch"
      WHERE ${where}
    `);

    const t = totals[0] ?? { revenueTotal: 0, itemCount: 0, orderCount: 0 };

    return {
      filters: { customerIds, from: dto.from, to: dto.to, groupBy },
      totals: {
        revenueTotal: t.revenueTotal,
        orderCount: t.orderCount,
        itemCount: t.itemCount,
        avgPrice: t.itemCount === 0 ? 0 : t.revenueTotal / t.itemCount,
        avgItemsPerOrder: t.orderCount === 0 ? 0 : t.itemCount / t.orderCount,
      },
      rows,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /** Resolve the dispatch-date window, defaulting to the legacy Access spans. */
  private async resolveWindow(
    bucket: StatBucket,
    fromStr?: string,
    toStr?: string,
  ): Promise<{ from: Date; to: Date }> {
    const to = toStr ? nextDay(toStr) : startOfTomorrow();

    if (fromStr) {
      return { from: startOfDay(fromStr), to };
    }

    const now = new Date();
    if (bucket === StatBucket.Week) {
      const from = new Date(now);
      from.setDate(from.getDate() - 52 * 7);
      from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    if (bucket === StatBucket.Month) {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 24);
      from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    // year / quarter -> STAT_GRAPH_YEARS calendar years (default 5)
    const years = await this.getStatGraphYears();
    const from = new Date(now.getFullYear() - (years - 1), 0, 1, 0, 0, 0, 0);
    return { from, to };
  }

  private async getStatGraphYears(): Promise<number> {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { key: 'STAT_GRAPH_YEARS' },
    });
    const parsed = setting?.val ? parseInt(setting.val, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
  }

  private async resolveCustomerIds(dto: BuilderQueryDto): Promise<number[]> {
    const ids = new Set<number>(dto.customerIds ?? []);

    if (dto.accountNumbers && dto.accountNumbers.length > 0) {
      const matches = await this.prisma.customer.findMany({
        where: { accountNumber: { in: dto.accountNumbers } },
        select: { customerId: true },
      });
      matches.forEach((m) => ids.add(m.customerId));
    }

    if (ids.size === 0) {
      throw new BadRequestException(
        'Provide at least one customerId or accountNumber',
      );
    }
    return [...ids];
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

function nextDay(dateStr: string): Date {
  const d = startOfDay(dateStr);
  d.setDate(d.getDate() + 1);
  return d;
}

function startOfTomorrow(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatPeriod(d: Date, bucket: StatBucket): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (bucket) {
    case StatBucket.Year:
      return String(year);
    case StatBucket.Quarter:
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case StatBucket.Month:
      return `${year}-${String(month).padStart(2, '0')}`;
    case StatBucket.Week:
      return `${year}-W${String(isoWeek(d)).padStart(2, '0')}`;
  }
}

/** ISO-8601 week number for a UTC date (matches Postgres date_trunc('week')). */
function isoWeek(d: Date): number {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return (
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    )
  );
}
