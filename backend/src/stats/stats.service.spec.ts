import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StatsService } from './stats.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatBucket, StatMetric } from './dto/timeseries-query.dto';
import { StatGroupBy } from './dto/builder-query.dto';

const mockPrisma = {
  $queryRaw: jest.fn(),
  globalSetting: { findUnique: jest.fn() },
  customer: { findMany: jest.fn() },
};

describe('StatsService', () => {
  let service: StatsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<StatsService>(StatsService);
  });

  // ─── timeseries ─────────────────────────────────────────────────────────────

  describe('timeseries', () => {
    it('maps rows to chart points and formats month period labels', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          periodStart: new Date('2025-01-01T00:00:00Z'),
          revenue: 100,
          orders: 4,
          items: 10,
          avgPrice: 10,
        },
        {
          periodStart: new Date('2025-02-01T00:00:00Z'),
          revenue: 250,
          orders: 5,
          items: 20,
          avgPrice: 12.5,
        },
      ]);

      const res = await service.timeseries({
        bucket: StatBucket.Month,
        metric: StatMetric.Revenue,
        from: '2025-01-01',
        to: '2025-02-28',
      });

      expect(res.bucket).toBe(StatBucket.Month);
      expect(res.series).toHaveLength(2);
      expect(res.series[0]).toMatchObject({
        period: '2025-01',
        periodStart: '2025-01-01',
        revenue: 100,
        orders: 4,
        items: 10,
        avgPrice: 10,
      });
      expect(res.series[1].period).toBe('2025-02');
    });

    it('formats quarter and year labels', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          periodStart: new Date('2025-04-01T00:00:00Z'),
          revenue: 1,
          orders: 1,
          items: 1,
          avgPrice: 1,
        },
      ]);

      const q = await service.timeseries({
        bucket: StatBucket.Quarter,
        from: '2025-01-01',
        to: '2025-12-31',
      });
      expect(q.series[0].period).toBe('2025-Q2');

      mockPrisma.$queryRaw.mockResolvedValue([
        {
          periodStart: new Date('2025-01-01T00:00:00Z'),
          revenue: 1,
          orders: 1,
          items: 1,
          avgPrice: 1,
        },
      ]);
      const y = await service.timeseries({
        bucket: StatBucket.Year,
        from: '2020-01-01',
        to: '2025-12-31',
      });
      expect(y.series[0].period).toBe('2025');
    });

    it('defaults the year window from STAT_GRAPH_YEARS when no dates given', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue({
        key: 'STAT_GRAPH_YEARS',
        val: '3',
      });
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const res = await service.timeseries({ bucket: StatBucket.Year });

      const expectedFromYear = new Date().getFullYear() - (3 - 1);
      expect(res.from).toBe(`${expectedFromYear}-01-01`);
      expect(mockPrisma.globalSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'STAT_GRAPH_YEARS' },
      });
    });

    it('falls back to 5 years when the setting is missing/invalid', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const res = await service.timeseries({ bucket: StatBucket.Quarter });
      const expectedFromYear = new Date().getFullYear() - (5 - 1);
      expect(res.from).toBe(`${expectedFromYear}-01-01`);
    });
  });

  // ─── builder ────────────────────────────────────────────────────────────────

  describe('builder', () => {
    it('computes KPIs from the totals row', async () => {
      // rows query, then totals query
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          {
            modelCode: 'EM2108 B',
            description: 'Mould',
            category: 'Moulds',
            quantity: 6,
            sales: 600,
          },
        ])
        .mockResolvedValueOnce([
          { revenueTotal: 1000, itemCount: 8, orderCount: 2 },
        ]);

      const res = await service.builder({
        customerIds: [12],
        from: '2025-01-01',
        to: '2025-03-31',
        groupBy: StatGroupBy.Model,
      });

      expect(res.totals).toEqual({
        revenueTotal: 1000,
        orderCount: 2,
        itemCount: 8,
        avgPrice: 125, // 1000 / 8
        avgItemsPerOrder: 4, // 8 / 2
      });
      expect(res.rows).toHaveLength(1);
      expect(res.filters.customerIds).toEqual([12]);
    });

    it('avoids divide-by-zero when there is no data', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { revenueTotal: 0, itemCount: 0, orderCount: 0 },
        ]);

      const res = await service.builder({
        customerIds: [99],
        from: '2025-01-01',
        to: '2025-03-31',
      });

      expect(res.totals.avgPrice).toBe(0);
      expect(res.totals.avgItemsPerOrder).toBe(0);
    });

    it('resolves account numbers to customer IDs', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { customerId: 7 },
        { customerId: 9 },
      ]);
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { revenueTotal: 0, itemCount: 0, orderCount: 0 },
        ]);

      const res = await service.builder({
        accountNumbers: ['ROYALNAT', 'COUNTY'],
        from: '2025-01-01',
        to: '2025-03-31',
      });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith({
        where: { accountNumber: { in: ['ROYALNAT', 'COUNTY'] } },
        select: { customerId: true },
      });
      expect(res.filters.customerIds.sort()).toEqual([7, 9]);
    });

    it('throws when no customer is identified', async () => {
      await expect(
        service.builder({ from: '2025-01-01', to: '2025-03-31' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
