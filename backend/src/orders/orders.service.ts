import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PagingDto, PagedResult } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';
import { serializePrisma } from '../prisma/prisma-serializer';
import { Order } from './entities/order.entity';
import { OrderedItem } from './entities/ordered-item.entity';
import { OrderTracking } from './entities/order-tracking.entity';
import { OrderStatus } from './enums/order-status.enum';
import { ItemStatus } from './enums/item-status.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CreateOrderedItemDto } from './dto/create-ordered-item.dto';
import { UpdateOrderedItemDto } from './dto/update-ordered-item.dto';
import { PriceListService } from '../price-list/price-list.service';

function getISOWeekYear(date: Date): { week: number; year: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return { week, year: d.getUTCFullYear() };
}

function computeOrderStatus(
  isVoided: boolean,
  dispatchedOn: Date | null | undefined,
  activeItems: { checkedOut: boolean }[],
): OrderStatus {
  if (isVoided) return OrderStatus.Voided;
  if (dispatchedOn) return OrderStatus.Dispatched;
  if (activeItems.length === 0) return OrderStatus.Received;
  if (activeItems.every((i) => i.checkedOut)) return OrderStatus.Ready;
  return OrderStatus.InProduction;
}

function computeItemStatus(
  checkedOut: boolean,
  parentDispatchedOn: Date | null | undefined,
): ItemStatus {
  if (parentDispatchedOn) return ItemStatus.Dispatched;
  if (checkedOut) return ItemStatus.Ready;
  return ItemStatus.InProduction;
}

function computeOrderTotals(activeItems: { price: number | null }[]): {
  itemCount: number;
  orderTotal: number;
  avgPrice: number;
} {
  const itemCount = activeItems.length;
  const orderTotal = activeItems.reduce((sum, i) => sum + (i.price ?? 0), 0);
  const avgPrice = itemCount > 0 ? orderTotal / itemCount : 0;
  return { itemCount, orderTotal, avgPrice };
}

/**
 * Coerces ISO date strings on an order DTO — including date-only values like
 * "2026-06-23" that pass @IsDateString — into Date objects so Prisma accepts
 * them. Only returns keys that are actually present on the DTO.
 */
function normalizeOrderDates(dto: {
  receivedOn?: string;
  dispatchedOn?: string;
}): { receivedOn?: Date; dispatchedOn?: Date } {
  const out: { receivedOn?: Date; dispatchedOn?: Date } = {};
  if (dto.receivedOn !== undefined) out.receivedOn = new Date(dto.receivedOn);
  if (dto.dispatchedOn !== undefined)
    out.dispatchedOn = new Date(dto.dispatchedOn);
  return out;
}

function attachComputedOrderFields(raw: any): Order {
  const activeItems = (raw.items ?? []).filter((i: any) => !i.void);
  const { itemCount, orderTotal, avgPrice } = computeOrderTotals(activeItems);
  return {
    ...serializePrisma<Order>(raw),
    itemCount,
    orderTotal,
    avgPrice,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceListService: PriceListService,
  ) {}

  /**
   * Atomically allocates the next counter value for `key` in the shared
   * "Sequences" table, seeding/advancing it per the given SQL fragments.
   * `insertSeed` is used when the key doesn't exist yet; `updateExpr` is used
   * to derive the next value when it does (typically `Counter + 1`, optionally
   * wrapped in GREATEST(...) against a re-derived floor).
   */
  private async allocateSequence(
    key: string,
    insertSeed: Prisma.Sql,
    updateExpr: Prisma.Sql,
  ): Promise<number> {
    const result = await this.prisma.$queryRaw<[{ counter: number }]>(
      Prisma.sql`
        INSERT INTO "Sequences" ("Key", "Counter")
        VALUES (${key}, ${insertSeed})
        ON CONFLICT ("Key") DO UPDATE
          SET "Counter" = ${updateExpr}
        RETURNING "Counter" AS counter
      `,
    );

    return result[0].counter;
  }

  private async generateSerial(): Promise<string> {
    const { week, year } = getISOWeekYear(new Date());
    const strWeek = String(week).padStart(2, '0');
    const strYear = String(year).slice(-2);
    const key = `item-${year}-${strWeek}`;

    const counter = await this.allocateSequence(
      key,
      Prisma.sql`1`,
      Prisma.sql`"Sequences"."Counter" + 1`,
    );

    // The serial format is S + YY(2) + WW(2) + counter(4) = 9 chars, which is
    // the width of SerialNumber (VarChar(9)). A weekly counter past 9999 would
    // produce a 10-char serial that silently overflows the column at INSERT, so
    // fail loudly here instead.
    if (counter > 9999) {
      throw new InternalServerErrorException(
        `Serial counter for week ${strYear}${strWeek} exceeded 9999; the ` +
          `9-character serial format cannot represent more items this week.`,
      );
    }

    const strCounter = String(counter).padStart(4, '0');
    return `S${strYear}${strWeek}${strCounter}`;
  }

  /**
   * Atomically allocates the next order number from the shared "Sequences"
   * table. The counter is seeded from the current MAX(OrderNumber) so generated
   * numbers never collide with imported/legacy orders, and GREATEST keeps it
   * ahead of any orders created with an explicit number (e.g. extra batches).
   */
  private async generateOrderNumber(): Promise<number> {
    const floor = Prisma.sql`(SELECT COALESCE(MAX("OrderNumber"), 0) + 1 FROM "Order")`;
    return this.allocateSequence(
      'order',
      floor,
      Prisma.sql`GREATEST("Sequences"."Counter" + 1, ${floor})`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getCurrentVatRateId(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const vatRate = await this.prisma.vatRate.findFirst({
      where: {
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
      },
      orderBy: { validFrom: 'desc' },
    });

    if (!vatRate) {
      throw new BadRequestException('No active VAT rate configured');
    }

    return vatRate.vatRateId;
  }

  /**
   * Recomputes order status from current item states and writes it to the DB
   * if it has changed. Appends a history row on each real transition.
   */
  private async syncStatus(
    orderNumber: number,
    orderBatch: number,
  ): Promise<void> {
    const raw = await this.prisma.order.findUnique({
      where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
      include: { items: true },
    });

    if (!raw) return;

    const activeItems = (raw.items ?? []).filter((i) => !i.void);
    const newStatus = computeOrderStatus(
      raw.void,
      raw.dispatchedOn,
      activeItems,
    );

    if (newStatus === raw.status) return;

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
        data: { status: newStatus, statusChangedOn: now },
      }),
      this.prisma.orderStatusHistory.create({
        data: { orderNumber, orderBatch, status: newStatus, changedOn: now },
      }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async findAll(
    includeVoided = false,
    paging = new PagingDto(),
    status?: string,
  ): Promise<PagedResult<Order>> {
    const where: any = includeVoided ? {} : { void: false };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: [{ orderNumber: 'desc' }, { orderBatch: 'desc' }],
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return new PagedResult(
      orders.map(attachComputedOrderFields),
      total,
      paging,
    );
  }

  async findByCustomer(
    customerId: number,
    includeVoided = false,
    paging = new PagingDto(),
    status?: string,
  ): Promise<PagedResult<Order>> {
    const where: any = includeVoided
      ? { customerAccount: customerId }
      : { customerAccount: customerId, void: false };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: [{ orderNumber: 'desc' }, { orderBatch: 'desc' }],
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return new PagedResult(
      orders.map(attachComputedOrderFields),
      total,
      paging,
    );
  }

  async findOne(orderNumber: number, orderBatch: number): Promise<Order> {
    const raw = await this.prisma.order.findUnique({
      where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
      include: {
        customer: true,
        deliveryAddressDetail: true,
        vatRate: true,
        items: true,
        statusHistory: { orderBy: { changedOn: 'asc' } },
      },
    });

    if (!raw) {
      throw new NotFoundException(
        `Order #${orderNumber} (batch ${orderBatch}) not found`,
      );
    }

    return attachComputedOrderFields(raw);
  }

  async create(
    dto: CreateOrderDto,
    createdBy: string | null = null,
  ): Promise<Order> {
    const orderBatch = dto.orderBatch ?? 1;
    const orderNumber = dto.orderNumber ?? (await this.generateOrderNumber());

    // Independent of one another — run together rather than as two
    // sequential round-trips.
    const [existing, vatRateId] = await Promise.all([
      this.prisma.order.findUnique({
        where: {
          orderNumber_orderBatch: { orderNumber, orderBatch },
        },
      }),
      this.getCurrentVatRateId(),
    ]);

    if (existing) {
      throw new BadRequestException(
        `Order #${orderNumber} (batch ${orderBatch}) already exists`,
      );
    }

    const now = new Date();
    const [raw] = await this.prisma.$transaction([
      this.prisma.order.create({
        data: {
          ...dto,
          ...normalizeOrderDates(dto),
          orderNumber,
          orderBatch,
          vatRateId,
          status: OrderStatus.Received,
          statusChangedOn: now,
          createdOn: now,
          createdBy,
        },
        include: { items: true },
      }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderNumber,
          orderBatch,
          status: OrderStatus.Received,
          changedOn: now,
        },
      }),
    ]);

    return attachComputedOrderFields(raw);
  }

  async update(
    orderNumber: number,
    orderBatch: number,
    dto: UpdateOrderDto,
  ): Promise<Order> {
    const order = await this.findOne(orderNumber, orderBatch);
    if (order.void) {
      throw new BadRequestException(
        `Order #${orderNumber} (batch ${orderBatch}) is voided and cannot be updated`,
      );
    }

    await this.prisma.order.update({
      where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
      data: { ...dto, ...normalizeOrderDates(dto) },
    });

    return this.findOne(orderNumber, orderBatch);
  }

  async void(
    orderNumber: number,
    orderBatch: number,
    voidedBy: string | null = null,
  ): Promise<Order> {
    const order = await this.findOne(orderNumber, orderBatch);
    if (order.void) {
      throw new BadRequestException(
        `Order #${orderNumber} (batch ${orderBatch}) is already voided`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
        data: {
          void: true,
          voidDateStamp: now,
          voidedBy,
          status: OrderStatus.Voided,
          statusChangedOn: now,
        },
      }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderNumber,
          orderBatch,
          status: OrderStatus.Voided,
          changedOn: now,
        },
      }),
    ]);

    return this.findOne(orderNumber, orderBatch);
  }

  async getTracking(
    orderNumber: number,
    orderBatch: number,
  ): Promise<OrderTracking> {
    const raw = await this.prisma.order.findUnique({
      where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
      include: {
        items: true,
        statusHistory: { orderBy: { changedOn: 'asc' } },
      },
    });

    if (!raw) {
      throw new NotFoundException(
        `Order #${orderNumber} (batch ${orderBatch}) not found`,
      );
    }

    const activeItems = (raw.items ?? []).filter((i) => !i.void);

    return {
      orderNumber: raw.orderNumber,
      orderBatch: raw.orderBatch,
      customerRef: raw.customerRef,
      status: raw.status as OrderStatus,
      statusChangedOn: raw.statusChangedOn,
      history: (raw.statusHistory ?? []).map((h) => ({
        status: h.status as OrderStatus,
        changedOn: h.changedOn,
      })),
      items: activeItems.map((i) => ({
        serialNumber: i.serialNumber,
        description: i.description,
        side: i.side,
        status: computeItemStatus(i.checkedOut, raw.dispatchedOn),
      })),
    };
  }

  async dispatch(orderNumber: number, orderBatch: number): Promise<Order> {
    const order = await this.findOne(orderNumber, orderBatch);
    if (order.void) {
      throw new BadRequestException(
        `Order #${orderNumber} (batch ${orderBatch}) is voided`,
      );
    }
    if (order.dispatchedOn) {
      throw new BadRequestException(
        `Order #${orderNumber} (batch ${orderBatch}) has already been dispatched`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
        data: {
          dispatchedOn: now,
          dispatchDateStamp: now,
          status: OrderStatus.Dispatched,
          statusChangedOn: now,
        },
      }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderNumber,
          orderBatch,
          status: OrderStatus.Dispatched,
          changedOn: now,
        },
      }),
    ]);

    return this.findOne(orderNumber, orderBatch);
  }

  // ---------------------------------------------------------------------------
  // Ordered items
  // ---------------------------------------------------------------------------

  async findItems(
    orderNumber: number,
    orderBatch: number,
    paging = new PagingDto(),
  ): Promise<PagedResult<OrderedItem>> {
    const order = await this.findOne(orderNumber, orderBatch);

    const where = {
      parentOrder: orderNumber,
      parentBatch: orderBatch,
      void: false,
    };
    const [items, total] = await Promise.all([
      this.prisma.orderedItem.findMany({
        where,
        orderBy: [{ serialNumber: 'asc' }],
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.orderedItem.count({ where }),
    ]);

    const serialized = serializePrisma<OrderedItem[]>(items).map((item) => ({
      ...item,
      status: computeItemStatus(item.checkedOut, order.dispatchedOn),
    }));

    return new PagedResult(serialized, total, paging);
  }

  async findItem(serialNumber: string): Promise<OrderedItem> {
    const item = await this.prisma.orderedItem.findUnique({
      where: { serialNumber },
      include: { order: true },
    });

    if (!item) {
      throw new NotFoundException(
        `Item with serial number '${serialNumber}' not found`,
      );
    }

    const serialized = serializePrisma<OrderedItem>(item);
    return {
      ...serialized,
      status: computeItemStatus(
        serialized.checkedOut,
        item.order?.dispatchedOn,
      ),
    };
  }

  async createItem(
    dto: CreateOrderedItemDto,
    createdBy: string | null = null,
  ): Promise<OrderedItem> {
    const parentBatch = dto.parentBatch ?? 1;
    const order = await this.findOne(dto.parentOrder, parentBatch);

    const serialNumber = await this.generateSerial();
    const { week } = getISOWeekYear(new Date());

    // Auto-price from the active price list when the item has a catalogue
    // model code and the order has a price band. This overrides any
    // client-supplied price so pricing stays authoritative and consistent
    // regardless of what the caller sends. Off-catalogue items (no model
    // code, no match, or no band) keep the client-supplied price untouched.
    const autoPrice =
      dto.modelCode && order.priceBand
        ? await this.priceListService.findActivePrice(
            dto.modelCode,
            order.priceBand,
          )
        : null;

    await this.prisma.orderedItem.create({
      data: {
        ...dto,
        serialNumber,
        week,
        parentBatch,
        createdOn: new Date(),
        createdBy,
        ...(autoPrice
          ? {
              price: autoPrice.price,
              priceListRevisionId: autoPrice.revisionId,
              priceListName: order.priceBand,
            }
          : {}),
      },
    });

    await this.syncStatus(dto.parentOrder, parentBatch);
    return this.findItem(serialNumber);
  }

  async updateItem(
    serialNumber: string,
    dto: UpdateOrderedItemDto,
  ): Promise<OrderedItem> {
    const item = await this.findItem(serialNumber);
    if (item.void) {
      throw new BadRequestException(
        `Item '${serialNumber}' is voided and cannot be updated`,
      );
    }

    // Re-price whenever the model code is being set/changed, same rule as
    // createItem: a catalogue match overrides any client-supplied price,
    // an off-catalogue/unmatched model code leaves the client's price alone.
    const priceBand = item.order?.priceBand;
    const autoPrice =
      dto.modelCode && priceBand
        ? await this.priceListService.findActivePrice(dto.modelCode, priceBand)
        : null;

    // If the update touches price or model code but there's no catalogue match,
    // the price is now a manual value — clear the price-list provenance so the
    // item doesn't keep claiming a list/revision it no longer came from.
    const pricingTouched =
      dto.price !== undefined || dto.modelCode !== undefined;

    await this.prisma.orderedItem.update({
      where: { serialNumber },
      data: {
        ...dto,
        ...(autoPrice
          ? {
              price: autoPrice.price,
              priceListRevisionId: autoPrice.revisionId,
              priceListName: priceBand,
            }
          : pricingTouched
            ? { priceListRevisionId: null, priceListName: null }
            : {}),
      },
    });

    return this.findItem(serialNumber);
  }

  async voidItem(
    serialNumber: string,
    voidedBy: string | null = null,
  ): Promise<OrderedItem> {
    const item = await this.findItem(serialNumber);
    if (item.void) {
      throw new BadRequestException(`Item '${serialNumber}' is already voided`);
    }

    await this.prisma.orderedItem.update({
      where: { serialNumber },
      data: { void: true, voidDateStamp: new Date(), voidedBy },
    });

    await this.syncStatus(item.parentOrder, item.parentBatch);
    return this.findItem(serialNumber);
  }

  async checkoutItem(serialNumber: string): Promise<OrderedItem> {
    const item = await this.findItem(serialNumber);
    if (item.void) {
      throw new BadRequestException(`Item '${serialNumber}' is voided`);
    }
    if (item.checkedOut) {
      throw new BadRequestException(
        `Item '${serialNumber}' is already checked out`,
      );
    }

    await this.prisma.orderedItem.update({
      where: { serialNumber },
      data: { checkedOut: true, checkoutDateStamp: new Date() },
    });

    await this.syncStatus(item.parentOrder, item.parentBatch);
    return this.findItem(serialNumber);
  }

  async uncheckedOutItem(serialNumber: string): Promise<OrderedItem> {
    const item = await this.findItem(serialNumber);
    if (item.void) {
      throw new BadRequestException(`Item '${serialNumber}' is voided`);
    }
    if (!item.checkedOut) {
      throw new BadRequestException(
        `Item '${serialNumber}' is not checked out`,
      );
    }

    await this.prisma.orderedItem.update({
      where: { serialNumber },
      data: { checkedOut: false, checkoutDateStamp: null },
    });

    await this.syncStatus(item.parentOrder, item.parentBatch);
    return this.findItem(serialNumber);
  }
}
