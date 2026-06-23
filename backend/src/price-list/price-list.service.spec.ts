import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PriceListService } from './price-list.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockTx = {
  priceListRevision: {
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = {
  priceListRevision: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  priceListItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  priceListType: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
    update: jest.fn(),
  },
  itemPrice: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    createMany: jest.fn(),
  },
  customer: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRevision(overrides = {}): any {
  return {
    id: 1,
    name: 'Test Revision',
    status: 'active',
    importedAt: new Date(),
    activatedAt: new Date(),
    notes: null,
    importedBy: null,
    ...overrides,
  };
}

function makeListType(overrides = {}): any {
  return {
    id: 1,
    name: 'NHS Band 1',
    displayName: 'NHS Band 1',
    sortOrder: 1,
    isActive: true,
    void: false,
    voidDateStamp: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: null,
    ...overrides,
  };
}

function makeItem(overrides = {}): any {
  return {
    itemId: 'ITEM001',
    category: 'Hearing Aid',
    description: 'Test Item',
    void: false,
    voidDateStamp: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: null,
    prices: [],
    ...overrides,
  };
}

function makeCsv(
  rows: Record<string, string>[],
  extraCols: string[] = [],
): Buffer {
  const cols = ['ItemID', 'Category', 'Description', ...extraCols];
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => r[c] ?? '').join(','));
  return Buffer.from([header, ...lines].join('\n'));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PriceListService', () => {
  let service: PriceListService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceListService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PriceListService>(PriceListService);
  });

  // ─── listRevisions ─────────────────────────────────────────────────────────

  describe('listRevisions', () => {
    it('returns revisions ordered by importedAt desc', async () => {
      const revisions = [makeRevision({ id: 2 }), makeRevision({ id: 1 })];
      mockPrisma.priceListRevision.findMany.mockResolvedValue(revisions);

      const result = await service.listRevisions();

      expect(result).toHaveLength(2);
      expect(mockPrisma.priceListRevision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { importedAt: 'desc' } }),
      );
    });
  });

  // ─── getRevision ───────────────────────────────────────────────────────────

  describe('getRevision', () => {
    it('returns the revision when found', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(makeRevision());
      const result = await service.getRevision(1);
      expect(result.id).toBe(1);
    });

    it('throws NotFoundException when revision does not exist', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(null);
      await expect(service.getRevision(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── activateRevision ──────────────────────────────────────────────────────

  describe('activateRevision', () => {
    it('throws NotFoundException when revision does not exist', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(null);
      await expect(service.activateRevision(99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when revision is already active', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(
        makeRevision({ status: 'active' }),
      );
      await expect(service.activateRevision(1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('archives current active revision and activates the target', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(
        makeRevision({ status: 'draft' }),
      );
      const activated = makeRevision({
        status: 'active',
        activatedAt: new Date(),
      });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
      mockTx.priceListRevision.update.mockResolvedValue(activated);

      const result = await service.activateRevision(1);

      expect(mockTx.priceListRevision.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active' },
          data: { status: 'archived' },
        }),
      );
      expect(mockTx.priceListRevision.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
      expect(result.status).toBe('active');
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('uses the active revision when no revisionId given', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.priceListRevision.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'active' } }),
      );
    });

    it('uses the specified revision when revisionId given', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(
        makeRevision({ id: 3 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findAll(3);

      expect(mockPrisma.priceListRevision.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 } }),
      );
    });

    it('throws NotFoundException when no active revision exists', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(null);
      await expect(service.findAll()).rejects.toThrow(NotFoundException);
    });

    it('pivots prices onto items correctly', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
        makeListType({ id: 2, name: 'Specsavers' }),
      ]);
      mockPrisma.priceListItem.findMany.mockResolvedValue([
        makeItem({ itemId: 'ITEM001', prices: [{ listId: 1, price: 10.5 }] }),
      ]);

      const result = await service.findAll();

      expect(result[0].prices['NHS Band 1']).toBe(10.5);
      expect(result[0].prices['Specsavers']).toBeNull();
    });
  });

  // ─── findByCategory ────────────────────────────────────────────────────────

  describe('findByCategory', () => {
    it('filters items by category', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findByCategory('Hearing Aid');

      expect(mockPrisma.priceListItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: 'Hearing Aid', void: false },
        }),
      );
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findUnique.mockResolvedValue(null);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(service.findOne('MISSING')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns item with pivoted prices', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
      ]);
      mockPrisma.priceListItem.findUnique.mockResolvedValue(
        makeItem({ prices: [{ listId: 1, price: 9.0 }] }),
      );

      const result = await service.findOne('ITEM001');
      expect(result.prices['NHS Band 1']).toBe(9.0);
    });
  });

  // ─── getPriceForList ───────────────────────────────────────────────────────

  describe('getPriceForList', () => {
    it('throws NotFoundException when list type does not exist', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findUnique.mockResolvedValue(null);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(
        service.getPriceForList('ITEM001', 'Unknown'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findUnique.mockResolvedValue(makeListType());
      mockPrisma.priceListItem.findUnique.mockResolvedValue(null);

      await expect(
        service.getPriceForList('MISSING', 'NHS Band 1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns null price when no entry exists for the item+list combination', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findUnique.mockResolvedValue(
        makeListType({ id: 1 }),
      );
      mockPrisma.priceListItem.findUnique.mockResolvedValue(makeItem());
      mockPrisma.itemPrice.findUnique.mockResolvedValue(null);

      const result = await service.getPriceForList('ITEM001', 'NHS Band 1');
      expect(result.price).toBeNull();
    });

    it('returns the price when an entry exists', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findUnique.mockResolvedValue(
        makeListType({ id: 1 }),
      );
      mockPrisma.priceListItem.findUnique.mockResolvedValue(makeItem());
      mockPrisma.itemPrice.findUnique.mockResolvedValue({ price: 12.5 });

      const result = await service.getPriceForList('ITEM001', 'NHS Band 1');
      expect(result.price).toBe(12.5);
      expect(result.revisionId).toBe(1);
    });
  });

  // ─── exportCsv ─────────────────────────────────────────────────────────────

  describe('exportCsv', () => {
    it('returns a CSV string with correct headers', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
      ]);
      mockPrisma.priceListItem.findMany.mockResolvedValue([
        makeItem({ prices: [{ listId: 1, price: 10.0 }] }),
      ]);

      const csv = await service.exportCsv();
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('ItemID,Category,Description,NHS Band 1');
      expect(lines[1]).toContain('ITEM001');
      expect(lines[1]).toContain('10');
    });

    it('outputs empty string for null prices', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
      ]);
      mockPrisma.priceListItem.findMany.mockResolvedValue([
        makeItem({ prices: [] }),
      ]);

      const csv = await service.exportCsv();
      const dataLine = csv.trim().split('\n')[1];
      expect(dataLine).toMatch(/ITEM001,Hearing Aid,Test Item,$/);
    });

    it('uses specified revision when revisionId given', async () => {
      mockPrisma.priceListRevision.findUnique.mockResolvedValue(
        makeRevision({ id: 5 }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);

      await service.exportCsv(5);

      expect(mockPrisma.priceListRevision.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });
  });

  // ─── importCsv — validation ────────────────────────────────────────────────

  describe('importCsv — validation', () => {
    it('throws BadRequestException for invalid CSV', async () => {
      await expect(
        service.importCsv(
          Buffer.from('not\x00valid\x00csv\x00\x00\x00'),
          'Test',
          null,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty CSV', async () => {
      await expect(
        service.importCsv(
          Buffer.from('ItemID,Category,Description\n'),
          'Test',
          null,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when ItemID column is missing', async () => {
      const csv = Buffer.from('Code,Category\nABC,Hearing Aid\n');
      await expect(service.importCsv(csv, 'Test', null, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when duplicate ItemIDs exist in CSV', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(service.importCsv(csv, 'Test', null, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('normalises ItemIDs: strips whitespace, special chars, and uppercases', async () => {
      const csv = makeCsv([
        { ItemID: ' item-001 ', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      await service.importCsv(csv, 'Test', null, null);

      expect(mockPrisma.priceListItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'ITEM001' } }),
      );
    });

    it('detects duplicates after normalisation', async () => {
      // Both rows normalise to ITEM001
      const csv = makeCsv([
        { ItemID: 'item-001', Category: 'Cat', Description: 'Desc' },
        { ItemID: 'ITEM 001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(service.importCsv(csv, 'Test', null, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when merge=true and no active revision', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(null);
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(
        service.importCsv(csv, 'Test', null, null, false, true),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── importCsv — warnings ──────────────────────────────────────────────────

  describe('importCsv — warnings', () => {
    it('warns when an active customer band is absent from the CSV', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['Specsavers'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([{ band: 'NHS Band 1' }]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ name: 'Specsavers' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'Test', null, null);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('NHS Band 1');
    });

    it('does not warn when the band is present in the CSV', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['NHS Band 1'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([{ band: 'NHS Band 1' }]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ name: 'NHS Band 1' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'Test', null, null);
      expect(result.warnings).toHaveLength(0);
    });

    it('does not warn in merge mode when a missing band is covered by the active revision', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['Specsavers'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      // Active revision already has NHS Band 1
      mockPrisma.itemPrice.findMany.mockResolvedValue([
        {
          itemId: 'ITEM001',
          listId: 1,
          price: 9.0,
          list: { name: 'NHS Band 1' },
        },
      ]);
      mockPrisma.customer.findMany.mockResolvedValue([{ band: 'NHS Band 1' }]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 2, name: 'Specsavers' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(
        csv,
        'Test',
        null,
        null,
        false,
        true,
      );
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ─── importCsv — new list detection ───────────────────────────────────────

  describe('importCsv — new list detection', () => {
    it('identifies lists that are new to the registry', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['Brand New Band'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      // Registry doesn't know about this band
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.aggregate.mockResolvedValue({
        _max: { sortOrder: 10 },
      });
      mockPrisma.priceListType.create.mockResolvedValue({});
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'Test', null, null);
      expect(result.listsNewToRegistry).toContain('Brand New Band');
      expect(result.listsNewToActiveRevision).toHaveLength(0);
    });

    it('identifies lists in the registry but absent from the active revision', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['Specsavers'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      // Active revision has no Specsavers prices
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      // Registry knows about Specsavers
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ name: 'Specsavers' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'Test', null, null);
      expect(result.listsNewToRegistry).toHaveLength(0);
      expect(result.listsNewToActiveRevision).toContain('Specsavers');
    });
  });

  // ─── importCsv — dry run ───────────────────────────────────────────────────

  describe('importCsv — dry run', () => {
    it('returns null revision and does not write anything', async () => {
      const csv = makeCsv(
        [{ ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' }],
        ['NHS Band 1'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ name: 'NHS Band 1' }),
      ]);

      const result = await service.importCsv(csv, 'Test', null, null, true);

      expect(result.revision).toBeNull();
      expect(mockPrisma.priceListRevision.create).not.toHaveBeenCalled();
      expect(mockPrisma.priceListItem.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.itemPrice.createMany).not.toHaveBeenCalled();
    });

    it('still blocks on duplicate ItemIDs in dry run', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(
        service.importCsv(csv, 'Test', null, null, true),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns correct item counts in dry run', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
        { ItemID: 'ITEM002', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      // ITEM001 already in active revision, ITEM002 is new
      mockPrisma.itemPrice.findMany.mockResolvedValue([
        {
          itemId: 'ITEM001',
          listId: 1,
          price: 5.0,
          list: { name: 'NHS Band 1' },
        },
      ]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      const result = await service.importCsv(csv, 'Test', null, null, true);

      expect(result.csvItemCount).toBe(2);
      expect(result.itemsUpdated).toBe(1);
      expect(result.itemsAdded).toBe(1);
    });
  });

  // ─── importCsv — replace mode ──────────────────────────────────────────────

  describe('importCsv — replace mode', () => {
    it('creates a draft revision and inserts only CSV prices', async () => {
      const csv = makeCsv(
        [
          {
            ItemID: 'ITEM001',
            Category: 'Hearing Aid',
            Description: 'Widget',
            'NHS Band 1': '10.50',
          },
        ],
        ['NHS Band 1'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
      ]);
      const draftRevision = makeRevision({
        id: 2,
        status: 'draft',
        name: 'My Import',
      });
      mockPrisma.priceListRevision.create.mockResolvedValue(draftRevision);
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'My Import', null, null);

      expect(mockPrisma.priceListRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'draft', name: 'My Import' }),
        }),
      );
      expect(mockPrisma.itemPrice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              itemId: 'ITEM001',
              listId: 1,
              price: 10.5,
              revisionId: 2,
            }),
          ]),
        }),
      );
      expect(result.revision?.status).toBe('draft');
      expect(result.itemsCarriedForward).toBeNull();
      expect(result.mergedItemCount).toBeNull();
      expect(result.listsCarriedForward).toBeNull();
    });

    it('registers new list types before inserting prices', async () => {
      const csv = makeCsv(
        [
          {
            ItemID: 'ITEM001',
            Category: 'Cat',
            Description: 'Desc',
            'New Band': '5.00',
          },
        ],
        ['New Band'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      // First call (registry check) returns empty, second call (fetch for write) returns new type
      mockPrisma.priceListType.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeListType({ id: 99, name: 'New Band' })]);
      mockPrisma.priceListType.aggregate.mockResolvedValue({
        _max: { sortOrder: 5 },
      });
      mockPrisma.priceListType.create.mockResolvedValue({});
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      await service.importCsv(csv, 'Test', null, null);

      expect(mockPrisma.priceListType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'New Band', sortOrder: 6 }),
        }),
      );
    });

    it('passes importedBy as createdBy when upserting items', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      await service.importCsv(csv, 'Test', null, 'jsmith');

      expect(mockPrisma.priceListItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ createdBy: 'jsmith' }),
        }),
      );
    });

    it('passes importedBy as createdBy when registering new list types', async () => {
      const csv = makeCsv(
        [
          {
            ItemID: 'ITEM001',
            Category: 'Cat',
            Description: 'Desc',
            'New Band': '5.00',
          },
        ],
        ['New Band'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeListType({ id: 99, name: 'New Band' })]);
      mockPrisma.priceListType.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      mockPrisma.priceListType.create.mockResolvedValue({});
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      await service.importCsv(csv, 'Test', null, 'jsmith');

      expect(mockPrisma.priceListType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Band',
            createdBy: 'jsmith',
          }),
        }),
      );
    });
  });

  // ─── importCsv — merge mode ────────────────────────────────────────────────

  describe('importCsv — merge mode', () => {
    it('seeds priceMap with active revision prices then overlays CSV', async () => {
      const csv = makeCsv(
        [
          {
            ItemID: 'ITEM001',
            Category: 'Cat',
            Description: 'Desc',
            'NHS Band 1': '15.00',
          },
        ],
        ['NHS Band 1'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      // Active revision has ITEM001/Band1 at 10 and ITEM002/Band1 at 20
      mockPrisma.itemPrice.findMany.mockResolvedValue([
        {
          itemId: 'ITEM001',
          listId: 1,
          price: 10.0,
          list: { name: 'NHS Band 1' },
        },
        {
          itemId: 'ITEM002',
          listId: 1,
          price: 20.0,
          list: { name: 'NHS Band 1' },
        },
      ]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 1, name: 'NHS Band 1' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      await service.importCsv(csv, 'Test', null, null, false, true);

      const createManyCall = mockPrisma.itemPrice.createMany.mock.calls[0][0];
      const prices: any[] = createManyCall.data;

      // CSV override: ITEM001/Band1 should be 15, not the active revision's 10
      const item1Price = prices.find(
        (p: any) => p.itemId === 'ITEM001' && p.listId === 1,
      );
      expect(item1Price?.price).toBe(15.0);

      // Carried forward: ITEM002/Band1 should be present at 20
      const item2Price = prices.find(
        (p: any) => p.itemId === 'ITEM002' && p.listId === 1,
      );
      expect(item2Price?.price).toBe(20.0);
    });

    it('returns correct merge-specific counts', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      // Active revision has ITEM001 and ITEM002
      mockPrisma.itemPrice.findMany.mockResolvedValue([
        {
          itemId: 'ITEM001',
          listId: 1,
          price: 10.0,
          list: { name: 'NHS Band 1' },
        },
        {
          itemId: 'ITEM002',
          listId: 1,
          price: 20.0,
          list: { name: 'NHS Band 1' },
        },
      ]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(
        csv,
        'Test',
        null,
        null,
        false,
        true,
      );

      expect(result.csvItemCount).toBe(1);
      expect(result.itemsUpdated).toBe(1); // ITEM001 was in active revision
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsCarriedForward).toBe(1); // ITEM002 carried forward
      expect(result.mergedItemCount).toBe(2);
    });

    it('returns listsCarriedForward for lists not in the CSV', async () => {
      const csv = makeCsv(
        [
          {
            ItemID: 'ITEM001',
            Category: 'Cat',
            Description: 'Desc',
            Specsavers: '5.00',
          },
        ],
        ['Specsavers'],
      );
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([
        {
          itemId: 'ITEM001',
          listId: 1,
          price: 9.0,
          list: { name: 'NHS Band 1' },
        },
      ]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([
        makeListType({ id: 2, name: 'Specsavers' }),
      ]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(
        csv,
        'Test',
        null,
        null,
        false,
        true,
      );

      expect(result.listsCarriedForward).toContain('NHS Band 1');
      expect(result.listsCarriedForward).not.toContain('Specsavers');
    });

    it('returns null merge fields in replace mode', async () => {
      const csv = makeCsv([
        { ItemID: 'ITEM001', Category: 'Cat', Description: 'Desc' },
      ]);
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.itemPrice.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);
      mockPrisma.priceListRevision.create.mockResolvedValue(
        makeRevision({ id: 2, status: 'draft' }),
      );
      mockPrisma.priceListItem.upsert.mockResolvedValue({});
      mockPrisma.itemPrice.createMany.mockResolvedValue({});

      const result = await service.importCsv(csv, 'Test', null, null);

      expect(result.itemsCarriedForward).toBeNull();
      expect(result.mergedItemCount).toBeNull();
      expect(result.listsCarriedForward).toBeNull();
    });
  });

  // ─── voidItem ──────────────────────────────────────────────────────────────

  describe('voidItem', () => {
    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.priceListItem.findUnique.mockResolvedValue(null);
      await expect(service.voidItem('MISSING')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when item is already voided', async () => {
      mockPrisma.priceListItem.findUnique.mockResolvedValue(
        makeItem({ void: true }),
      );
      await expect(service.voidItem('ITEM001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets void=true, voidDateStamp, and voidedBy', async () => {
      mockPrisma.priceListItem.findUnique.mockResolvedValue(makeItem());
      const voided = makeItem({
        void: true,
        voidDateStamp: new Date(),
        voidedBy: 'jsmith',
      });
      mockPrisma.priceListItem.update.mockResolvedValue(voided);

      const result = await service.voidItem('ITEM001', 'jsmith');

      expect(mockPrisma.priceListItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId: 'ITEM001' },
          data: expect.objectContaining({
            void: true,
            voidDateStamp: expect.any(Date),
            voidedBy: 'jsmith',
          }),
        }),
      );
      expect(result.void).toBe(true);
      expect(result.voidedBy).toBe('jsmith');
    });
  });

  // ─── voidListType ──────────────────────────────────────────────────────────

  describe('voidListType', () => {
    it('throws NotFoundException when list type does not exist', async () => {
      mockPrisma.priceListType.findUnique.mockResolvedValue(null);
      await expect(service.voidListType(99)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when list type is already voided', async () => {
      mockPrisma.priceListType.findUnique.mockResolvedValue(
        makeListType({ void: true }),
      );
      await expect(service.voidListType(1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets void=true, voidDateStamp, and voidedBy', async () => {
      mockPrisma.priceListType.findUnique.mockResolvedValue(makeListType());
      const voided = makeListType({
        void: true,
        voidDateStamp: new Date(),
        voidedBy: 'jsmith',
      });
      mockPrisma.priceListType.update.mockResolvedValue(voided);

      const result = await service.voidListType(1, 'jsmith');

      expect(mockPrisma.priceListType.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            void: true,
            voidDateStamp: expect.any(Date),
            voidedBy: 'jsmith',
          }),
        }),
      );
      expect(result.void).toBe(true);
      expect(result.voidedBy).toBe('jsmith');
    });
  });

  // ─── void filtering ────────────────────────────────────────────────────────

  describe('void filtering', () => {
    it('findAll excludes voided items', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.priceListItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ void: false }),
        }),
      );
    });

    it('findByCategory excludes voided items', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findByCategory('Hearing Aid');

      expect(mockPrisma.priceListItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ void: false }),
        }),
      );
    });

    it('findOne throws NotFoundException for a voided item', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findUnique.mockResolvedValue(
        makeItem({ void: true }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(service.findOne('ITEM001')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getActiveListTypes excludes voided list types', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListItem.findMany.mockResolvedValue([]);
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.priceListType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ void: false }),
        }),
      );
    });

    it('getPriceForList treats a voided list type as not found', async () => {
      mockPrisma.priceListRevision.findFirst.mockResolvedValue(
        makeRevision({ id: 1 }),
      );
      mockPrisma.priceListType.findUnique.mockResolvedValue(
        makeListType({ void: true }),
      );
      mockPrisma.priceListType.findMany.mockResolvedValue([]);

      await expect(
        service.getPriceForList('ITEM001', 'NHS Band 1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
