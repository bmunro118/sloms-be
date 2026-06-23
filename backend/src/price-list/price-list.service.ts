import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CsvImportResult,
  PriceListItem,
  PriceListRevision,
  PriceListRow,
  PriceListType,
} from './entities/price-list.entity';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

function normaliseItemId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class PriceListService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async getActiveRevision(): Promise<PriceListRevision> {
    const revision = await this.prisma.priceListRevision.findFirst({
      where: { status: 'active' },
    });
    if (!revision) {
      throw new NotFoundException('No active price list revision found');
    }
    return revision as PriceListRevision;
  }

  private async getActiveListTypes(): Promise<PriceListType[]> {
    return this.prisma.priceListType.findMany({
      where: { isActive: true, void: false },
      orderBy: { sortOrder: 'asc' },
    }) as Promise<PriceListType[]>;
  }

  private async buildRows(
    items: (PriceListItem & {
      prices: { listId: number; price: number | null }[];
    })[],
    listTypes: PriceListType[],
  ): Promise<PriceListRow[]> {
    return items.map((item) => {
      const priceMap = new Map(item.prices.map((p) => [p.listId, p.price]));
      const prices: Record<string, number | null> = {};
      for (const lt of listTypes) {
        prices[lt.name] = priceMap.get(lt.id) ?? null;
      }
      return {
        itemId: item.itemId,
        category: item.category,
        description: item.description,
        prices,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Revision management
  // ---------------------------------------------------------------------------

  async listRevisions(): Promise<PriceListRevision[]> {
    return this.prisma.priceListRevision.findMany({
      orderBy: { importedAt: 'desc' },
    }) as Promise<PriceListRevision[]>;
  }

  async getRevision(id: number): Promise<PriceListRevision> {
    const revision = await this.prisma.priceListRevision.findUnique({
      where: { id },
    });
    if (!revision) {
      throw new NotFoundException(`Revision ${id} not found`);
    }
    return revision as PriceListRevision;
  }

  async activateRevision(id: number): Promise<PriceListRevision> {
    const target = await this.getRevision(id);

    if (target.status === 'active') {
      throw new ConflictException(`Revision ${id} is already active`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Archive the currently active revision if there is one
      await tx.priceListRevision.updateMany({
        where: { status: 'active' },
        data: { status: 'archived' },
      });

      const activated = await tx.priceListRevision.update({
        where: { id },
        data: { status: 'active', activatedAt: new Date() },
      });

      return activated as PriceListRevision;
    });
  }

  // ---------------------------------------------------------------------------
  // Query methods (always use active revision)
  // ---------------------------------------------------------------------------

  async findAll(revisionId?: number): Promise<PriceListRow[]> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const [items, listTypes] = await Promise.all([
      this.prisma.priceListItem.findMany({
        where: { void: false },
        orderBy: [{ category: 'asc' }, { itemId: 'asc' }],
        include: {
          prices: { where: { revisionId: revision.id } },
        },
      }),
      this.getActiveListTypes(),
    ]);

    return this.buildRows(items, listTypes);
  }

  async findByCategory(
    category: string,
    revisionId?: number,
  ): Promise<PriceListRow[]> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const [items, listTypes] = await Promise.all([
      this.prisma.priceListItem.findMany({
        where: { category, void: false },
        orderBy: { itemId: 'asc' },
        include: {
          prices: { where: { revisionId: revision.id } },
        },
      }),
      this.getActiveListTypes(),
    ]);

    return this.buildRows(items, listTypes);
  }

  async findOne(itemId: string, revisionId?: number): Promise<PriceListRow> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const [item, listTypes] = await Promise.all([
      this.prisma.priceListItem.findUnique({
        where: { itemId },
        include: {
          prices: { where: { revisionId: revision.id } },
        },
      }),
      this.getActiveListTypes(),
    ]);

    if (!item || item.void) {
      throw new NotFoundException(`Price list item '${itemId}' not found`);
    }

    const [row] = await this.buildRows([item], listTypes);
    return row;
  }

  async voidItem(
    itemId: string,
    voidedBy: string | null = null,
  ): Promise<PriceListItem> {
    const item = await this.prisma.priceListItem.findUnique({
      where: { itemId },
    });
    if (!item) {
      throw new NotFoundException(`Price list item '${itemId}' not found`);
    }
    if (item.void) {
      throw new BadRequestException(
        `Price list item '${itemId}' is already voided`,
      );
    }
    return this.prisma.priceListItem.update({
      where: { itemId },
      data: { void: true, voidDateStamp: new Date(), voidedBy },
    }) as Promise<PriceListItem>;
  }

  async voidListType(
    id: number,
    voidedBy: string | null = null,
  ): Promise<PriceListType> {
    const listType = await this.prisma.priceListType.findUnique({
      where: { id },
    });
    if (!listType) {
      throw new NotFoundException(`Price list type ${id} not found`);
    }
    if (listType.void) {
      throw new BadRequestException(`Price list type ${id} is already voided`);
    }
    return this.prisma.priceListType.update({
      where: { id },
      data: { void: true, voidDateStamp: new Date(), voidedBy },
    }) as Promise<PriceListType>;
  }

  async getPriceForList(
    itemId: string,
    listName: string,
    revisionId?: number,
  ): Promise<{
    itemId: string;
    description: string | null;
    list: string;
    price: number | null;
    revisionId: number;
  }> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const listType = await this.prisma.priceListType.findUnique({
      where: { name: listName },
    });

    if (!listType || listType.void) {
      const all = await this.prisma.priceListType.findMany({
        where: { isActive: true, void: false },
        orderBy: { sortOrder: 'asc' },
        select: { name: true },
      });
      throw new NotFoundException(
        `Price list '${listName}' not found. ` +
          `Valid lists are: ${all.map((l) => l.name).join(', ')}`,
      );
    }

    const item = await this.prisma.priceListItem.findUnique({
      where: { itemId },
    });
    if (!item) {
      throw new NotFoundException(`Price list item '${itemId}' not found`);
    }

    const entry = await this.prisma.itemPrice.findUnique({
      where: {
        itemId_listId_revisionId: {
          itemId,
          listId: listType.id,
          revisionId: revision.id,
        },
      },
    });

    return {
      itemId,
      description: item.description,
      list: listName,
      price: entry?.price ?? null,
      revisionId: revision.id,
    };
  }

  async getAllListsForItem(
    itemId: string,
    revisionId?: number,
  ): Promise<{
    itemId: string;
    description: string | null;
    category: string | null;
    revisionId: number;
    lists: Record<string, number | null>;
  }> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const row = await this.findOne(itemId, revision.id);
    return {
      itemId: row.itemId,
      description: row.description,
      category: row.category,
      revisionId: revision.id,
      lists: row.prices,
    };
  }

  async getListTypes(): Promise<PriceListType[]> {
    return this.getActiveListTypes();
  }

  // ---------------------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------------------

  async exportCsv(revisionId?: number): Promise<string> {
    const revision = revisionId
      ? await this.getRevision(revisionId)
      : await this.getActiveRevision();

    const [items, listTypes] = await Promise.all([
      this.prisma.priceListItem.findMany({
        orderBy: [{ category: 'asc' }, { itemId: 'asc' }],
        include: {
          prices: { where: { revisionId: revision.id } },
        },
      }),
      this.getActiveListTypes(),
    ]);

    const rows = await this.buildRows(items, listTypes);
    const listNames = listTypes.map((lt) => lt.name);

    const records = rows.map((row) => {
      const record: Record<string, string> = {
        ItemID: row.itemId,
        Category: row.category ?? '',
        Description: row.description ?? '',
      };
      for (const name of listNames) {
        const val = row.prices[name];
        record[name] = val != null ? String(val) : '';
      }
      return record;
    });

    return stringify(records, {
      header: true,
      columns: ['ItemID', 'Category', 'Description', ...listNames],
    });
  }

  // ---------------------------------------------------------------------------
  // CSV import — always creates a new draft revision
  // ---------------------------------------------------------------------------

  async importCsv(
    csvBuffer: Buffer,
    revisionName: string,
    notes: string | null,
    importedBy: string | null,
    dryRun = false,
    merge = false,
  ): Promise<CsvImportResult> {
    let records: Record<string, string>[];
    try {
      records = parse(csvBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('Failed to parse CSV file');
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    const headers = Object.keys(records[0]);
    const metaCols = new Set(['ItemID', 'Category', 'Description']);
    const listNames = headers.filter((h) => !metaCols.has(h));

    if (!headers.includes('ItemID')) {
      throw new BadRequestException("CSV must contain an 'ItemID' column");
    }

    // Block on duplicate ItemIDs within the CSV
    // Normalise all ItemIDs in-place before any further processing
    for (const record of records) {
      if (record['ItemID'] != null) {
        record['ItemID'] = normaliseItemId(record['ItemID']);
      }
    }

    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const record of records) {
      const itemId = record['ItemID'];
      if (!itemId) continue;
      if (seenIds.has(itemId)) {
        duplicateIds.add(itemId);
      }
      seenIds.add(itemId);
    }
    if (duplicateIds.size > 0) {
      throw new BadRequestException(
        `CSV contains duplicate ItemIDs: ${[...duplicateIds].join(', ')}`,
      );
    }

    // Fetch the active revision once — needed for merge, new-list detection, and warnings
    const activeRevision = await this.prisma.priceListRevision.findFirst({
      where: { status: 'active' },
      select: { id: true },
    });

    if (merge && !activeRevision) {
      throw new BadRequestException(
        'Merge requires an active revision to exist — no active revision found',
      );
    }

    // Active revision list names (used for new-list detection and merge)
    const activeListNames = new Set<string>();
    // Active prices as a map keyed by "itemId:listId" → price (used for merge)
    type PriceEntry = { itemId: string; listId: number; price: number | null };
    const activePriceMap = new Map<string, PriceEntry>();

    if (activeRevision) {
      const activePrices = await this.prisma.itemPrice.findMany({
        where: { revisionId: activeRevision.id },
        select: {
          itemId: true,
          listId: true,
          price: true,
          list: { select: { name: true } },
        },
      });
      for (const p of activePrices) {
        activeListNames.add(p.list.name);
        activePriceMap.set(`${p.itemId}:${p.listId}`, {
          itemId: p.itemId,
          listId: p.listId,
          price: p.price,
        });
      }
    }

    const csvListSet = new Set(listNames);

    // In merge mode, bands carried forward from the active revision satisfy the warning check
    const effectiveListSet = merge
      ? new Set([...csvListSet, ...activeListNames])
      : csvListSet;

    const activeBands = await this.prisma.customer.findMany({
      where: { suspended: false, band: { not: null } },
      select: { band: true },
      distinct: ['band'],
    });
    const warnings: string[] = activeBands
      .map((c) => c.band as string)
      .filter((band) => !effectiveListSet.has(band))
      .map(
        (band) =>
          `Price band "${band}" is assigned to active customers but is not present in this import`,
      );

    // Resolve new lists — two flavours, both read-only so safe for dry run
    const registryTypes = await this.prisma.priceListType.findMany({
      where: { name: { in: listNames } },
      select: { name: true },
    });
    const registryNames = new Set(registryTypes.map((t) => t.name));
    const listsNewToRegistry = listNames.filter((n) => !registryNames.has(n));
    const listsNewToActiveRevision = listNames.filter(
      (n) => registryNames.has(n) && !activeListNames.has(n),
    );

    // Compute per-item breakdown against the active revision
    const activeItemIds = new Set(
      [...activePriceMap.keys()].map((k) => k.split(':')[0]),
    );
    const csvItemIds = records.map((r) => r['ItemID']).filter(Boolean);
    const csvItemCount = csvItemIds.length;
    const itemsAdded = csvItemIds.filter((id) => !activeItemIds.has(id)).length;
    const itemsUpdated = csvItemIds.filter((id) =>
      activeItemIds.has(id),
    ).length;

    // Merge-specific counts (null in replace mode)
    const activeUniqueItemIds = new Set(activeItemIds);
    const csvItemIdSet = new Set(csvItemIds);
    const itemsCarriedForward = merge
      ? [...activeUniqueItemIds].filter((id) => !csvItemIdSet.has(id)).length
      : null;
    const mergedItemCount = merge
      ? csvItemCount + (itemsCarriedForward ?? 0)
      : null;
    const listsCarriedForward = merge
      ? [...activeListNames].filter((n) => !csvListSet.has(n))
      : null;

    if (dryRun) {
      return {
        revision: null,
        csvItemCount,
        itemsAdded,
        itemsUpdated,
        itemsCarriedForward,
        mergedItemCount,
        listsCarriedForward,
        listsNewToRegistry,
        listsNewToActiveRevision,
        warnings,
      };
    }

    // Register any brand-new list types
    const newListNames = listsNewToRegistry;
    if (newListNames.length > 0) {
      const maxSort = await this.prisma.priceListType.aggregate({
        _max: { sortOrder: true },
      });
      let nextSort = (maxSort._max.sortOrder ?? 0) + 1;
      for (const name of newListNames) {
        await this.prisma.priceListType.create({
          data: {
            name,
            displayName: name,
            sortOrder: nextSort++,
            createdBy: importedBy,
          },
        });
      }
    }

    // Fetch all list types referenced by this CSV (now guaranteed to exist)
    const allTypes = await this.prisma.priceListType.findMany({
      where: { name: { in: listNames } },
    });
    const typeByName = new Map(allTypes.map((t) => [t.name, t]));

    // Create a new draft revision
    const revision = await this.prisma.priceListRevision.create({
      data: { name: revisionName, status: 'draft', notes, importedBy },
    });

    // Upsert PriceListItem rows for every item in the CSV
    await Promise.all(
      records.map((record) => {
        const itemId = record['ItemID'];
        const category = record['Category']?.trim() || null;
        const description = record['Description']?.trim() || null;
        return this.prisma.priceListItem.upsert({
          where: { itemId },
          create: { itemId, category, description, createdBy: importedBy },
          update: { category, description },
        });
      }),
    );

    // Build the price data for the new revision.
    // In merge mode: start from the active revision's prices, then overlay the CSV.
    // In replace mode: use only the CSV prices.
    const priceMap = new Map<
      string,
      { itemId: string; listId: number; price: number | null }
    >();

    if (merge) {
      for (const [key, entry] of activePriceMap) {
        priceMap.set(key, { ...entry });
      }
    }

    for (const record of records) {
      const itemId = record['ItemID'];
      if (!itemId) continue;
      for (const name of listNames) {
        const listType = typeByName.get(name);
        if (!listType) continue;
        const raw = record[name]?.trim();
        const price = raw ? parseFloat(raw) : null;
        priceMap.set(`${itemId}:${listType.id}`, {
          itemId,
          listId: listType.id,
          price,
        });
      }
    }

    await this.prisma.itemPrice.createMany({
      data: [...priceMap.values()].map((p) => ({
        ...p,
        revisionId: revision.id,
      })),
    });

    return {
      revision: revision as PriceListRevision,
      csvItemCount,
      itemsAdded,
      itemsUpdated,
      itemsCarriedForward,
      mergedItemCount,
      listsCarriedForward,
      listsNewToRegistry,
      listsNewToActiveRevision,
      warnings,
    };
  }
}
