import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from './enums/order-status.enum';
import { ItemStatus } from './enums/item-status.enum';

const mockPrisma = {
  order: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orderedItem: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orderStatusHistory: {
    create: jest.fn(),
  },
  vatRate: {
    findFirst: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

function makeOrder(overrides: any = {}) {
  return {
    orderNumber: 1001,
    orderBatch: 1,
    customerAccount: 1,
    customerRef: null,
    orderContact: null,
    deliveryAddress: null,
    receivedOn: null,
    dispatchedOn: null,
    vatRateId: 1,
    priceBand: null,
    void: false,
    voidDateStamp: null,
    voidedBy: null,
    createdBy: null,
    createdOn: new Date(),
    dispatchDateStamp: null,
    status: OrderStatus.Received,
    statusChangedOn: null,
    items: [],
    ...overrides,
  };
}

function makeItem(overrides: any = {}) {
  return {
    serialNumber: 'S260010001',
    patientInitial: null,
    patientSurname: null,
    modelCode: null,
    week: 1,
    parentOrder: 1001,
    parentBatch: 1,
    customerRef: null,
    side: null,
    description: null,
    category: null,
    price: 100,
    vent: null,
    colour: null,
    tubing: null,
    options: null,
    checkedOut: false,
    checkoutDateStamp: null,
    void: false,
    voidDateStamp: null,
    voidedBy: null,
    createdBy: null,
    createdOn: new Date(),
    ...overrides,
  };
}

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    // $transaction([op1, op2, ...]) — execute each op and return results array
    mockPrisma.$transaction.mockImplementation((ops: Promise<any>[]) => Promise.all(ops));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('filters voided orders by default', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findAll();

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { void: false } }),
      );
    });

    it('includes voided orders when flag is set', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findAll(true);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by status when provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findAll(false, undefined, OrderStatus.InProduction);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { void: false, status: OrderStatus.InProduction } }),
      );
    });

    it('computes runtime totals from items', async () => {
      const items = [makeItem({ price: 100, void: false }), makeItem({ serialNumber: 'S260010002', price: 200, void: false })];
      mockPrisma.order.findMany.mockResolvedValue([makeOrder({ items })]);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.data[0].itemCount).toBe(2);
      expect(result.data[0].orderTotal).toBe(300);
      expect(result.data[0].avgPrice).toBe(150);
    });

    it('excludes voided items from computed totals', async () => {
      const items = [
        makeItem({ price: 100, void: false }),
        makeItem({ serialNumber: 'S260010002', price: 999, void: true }),
      ];
      mockPrisma.order.findMany.mockResolvedValue([makeOrder({ items })]);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.data[0].itemCount).toBe(1);
      expect(result.data[0].orderTotal).toBe(100);
    });
  });

  // ─── findByCustomer ───────────────────────────────────────────────────────────

  describe('findByCustomer', () => {
    it('scopes query to the given customerId', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findByCustomer(5);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerAccount: 5, void: false } }),
      );
    });

    it('filters by status when provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.findByCustomer(5, false, undefined, OrderStatus.Dispatched);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerAccount: 5, void: false, status: OrderStatus.Dispatched } }),
      );
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne(1001, 1)).rejects.toThrow(NotFoundException);
    });

    it('returns order with computed totals', async () => {
      const items = [makeItem({ price: 150, void: false })];
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ items }));

      const result = await service.findOne(1001, 1);

      expect(result.orderNumber).toBe(1001);
      expect(result.itemCount).toBe(1);
      expect(result.orderTotal).toBe(150);
      expect(result.avgPrice).toBe(150);
    });
  });

  // ─── getTracking ─────────────────────────────────────────────────────────────

  describe('getTracking', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getTracking(1001, 1)).rejects.toThrow(NotFoundException);
    });

    it('returns order identity and current status', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ customerRef: 'SS-REF-001', status: OrderStatus.InProduction, statusChangedOn: new Date(), items: [], statusHistory: [] }),
      );

      const result = await service.getTracking(1001, 1);

      expect(result.orderNumber).toBe(1001);
      expect(result.orderBatch).toBe(1);
      expect(result.customerRef).toBe('SS-REF-001');
      expect(result.status).toBe(OrderStatus.InProduction);
      expect(result.statusChangedOn).toBeInstanceOf(Date);
    });

    it('returns history entries in order', async () => {
      const t1 = new Date('2026-01-14T09:00:00Z');
      const t2 = new Date('2026-01-15T08:30:00Z');
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [],
          statusHistory: [
            { id: 1, status: OrderStatus.Received,     changedOn: t1 },
            { id: 2, status: OrderStatus.InProduction, changedOn: t2 },
          ],
        }),
      );

      const result = await service.getTracking(1001, 1);

      expect(result.history).toHaveLength(2);
      expect(result.history[0]).toEqual({ status: OrderStatus.Received,     changedOn: t1 });
      expect(result.history[1]).toEqual({ status: OrderStatus.InProduction, changedOn: t2 });
    });

    it('excludes voided items and computes item status', async () => {
      const activeItem  = makeItem({ checkedOut: true,  void: false });
      const voidedItem  = makeItem({ serialNumber: 'SN9999999', void: true });
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ items: [activeItem, voidedItem], statusHistory: [] }),
      );

      const result = await service.getTracking(1001, 1);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].serialNumber).toBe('S260010001');
      expect(result.items[0].status).toBe(ItemStatus.Ready);
    });

    it('exposes only serialNumber, description, side and status on items', async () => {
      const item = makeItem({ description: 'ITE Standard', side: 'R', checkedOut: false });
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ items: [item], statusHistory: [] }),
      );

      const result = await service.getTracking(1001, 1);

      expect(result.items[0]).toEqual({
        serialNumber: 'S260010001',
        description: 'ITE Standard',
        side: 'R',
        status: ItemStatus.InProduction,
      });
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('throws BadRequestException when order already exists', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());
      await expect(
        service.create({ orderNumber: 1001, orderBatch: 1, customerAccount: 1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults orderBatch to 1 when not provided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.vatRate.findFirst.mockResolvedValue({ vatRateId: 1, rate: 20, label: 'Standard UK', validFrom: new Date(), validTo: null });
      mockPrisma.order.create.mockResolvedValue(makeOrder());

      await service.create({ orderNumber: 1001, customerAccount: 1 } as any);

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderBatch: 1 }),
        }),
      );
    });

    it('sets initial status to Received and records statusChangedOn', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.vatRate.findFirst.mockResolvedValue({ vatRateId: 1, rate: 20, label: 'Standard UK', validFrom: new Date(), validTo: null });
      mockPrisma.order.create.mockResolvedValue(makeOrder());

      await service.create({ orderNumber: 1001, customerAccount: 1 } as any);

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.Received,
            statusChangedOn: expect.any(Date),
          }),
        }),
      );
    });

    it('passes createdBy to the order create call', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.vatRate.findFirst.mockResolvedValue({ vatRateId: 1, rate: 20, label: 'Standard UK', validFrom: new Date(), validTo: null });
      mockPrisma.order.create.mockResolvedValue(makeOrder({ createdBy: 'jsmith' }));

      await service.create({ orderNumber: 1001, customerAccount: 1 } as any, 'jsmith');

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdBy: 'jsmith' }),
        }),
      );
    });

    it('writes a Received history entry', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.vatRate.findFirst.mockResolvedValue({ vatRateId: 1, rate: 20, label: 'Standard UK', validFrom: new Date(), validTo: null });
      mockPrisma.order.create.mockResolvedValue(makeOrder());

      await service.create({ orderNumber: 1001, customerAccount: 1 } as any);

      expect(mockPrisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderNumber: 1001, status: OrderStatus.Received, changedOn: expect.any(Date) }),
        }),
      );
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.update(1001, 1, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order is voided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ void: true }));
      await expect(service.update(1001, 1, {} as any)).rejects.toThrow(BadRequestException);
    });

    it('updates and returns the order', async () => {
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ customerRef: 'X' }));
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.update(1001, 1, { customerRef: 'X' } as any);
      expect(result.customerRef).toBe('X');
    });
  });

  // ─── void ────────────────────────────────────────────────────────────────────

  describe('void', () => {
    it('throws BadRequestException when order is already voided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ void: true }));
      await expect(service.void(1001, 1)).rejects.toThrow(BadRequestException);
    });

    it('sets void=true, voidedBy, status=Voided, and statusChangedOn', async () => {
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ void: true, voidedBy: 'jsmith', status: OrderStatus.Voided }));
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.void(1001, 1, 'jsmith');

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            void: true,
            voidDateStamp: expect.any(Date),
            voidedBy: 'jsmith',
            status: OrderStatus.Voided,
            statusChangedOn: expect.any(Date),
          }),
        }),
      );
      expect(result.status).toBe(OrderStatus.Voided);
    });

    it('writes a Voided history entry', async () => {
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ void: true, status: OrderStatus.Voided }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.void(1001, 1, 'jsmith');

      expect(mockPrisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderNumber: 1001, status: OrderStatus.Voided, changedOn: expect.any(Date) }),
        }),
      );
    });
  });

  // ─── dispatch ────────────────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('throws BadRequestException when order is voided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ void: true }));
      await expect(service.dispatch(1001, 1)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order is already dispatched', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ dispatchedOn: new Date() }));
      await expect(service.dispatch(1001, 1)).rejects.toThrow(BadRequestException);
    });

    it('sets dispatchedOn, status=Dispatched, and statusChangedOn', async () => {
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ dispatchedOn: new Date(), status: OrderStatus.Dispatched }));
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.dispatch(1001, 1);

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dispatchedOn: expect.any(Date),
            dispatchDateStamp: expect.any(Date),
            status: OrderStatus.Dispatched,
            statusChangedOn: expect.any(Date),
          }),
        }),
      );
      expect(result.status).toBe(OrderStatus.Dispatched);
    });

    it('writes a Dispatched history entry', async () => {
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ dispatchedOn: new Date(), status: OrderStatus.Dispatched }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.dispatch(1001, 1);

      expect(mockPrisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderNumber: 1001, status: OrderStatus.Dispatched, changedOn: expect.any(Date) }),
        }),
      );
    });
  });

  // ─── syncStatus (via createItem / voidItem / checkoutItem) ───────────────────

  describe('status transitions via syncStatus', () => {
    it('transitions to InProduction when first item is created', async () => {
      const item = makeItem();
      mockPrisma.orderedItem.create.mockResolvedValue({});
      mockPrisma.orderedItem.findUnique.mockResolvedValue({ ...item, order: makeOrder() });
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      // findOne for parent check, syncStatus findUnique, syncStatus update, findOne for return
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())                                        // parent check
        .mockResolvedValueOnce(makeOrder({ items: [item], status: OrderStatus.Received })) // syncStatus read
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));   // findOne after
      mockPrisma.order.update.mockResolvedValue({});

      await service.createItem({ parentOrder: 1001 } as any);

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.InProduction,
            statusChangedOn: expect.any(Date),
          }),
        }),
      );
    });

    it('does not write to DB when status has not changed', async () => {
      const item = makeItem({ checkedOut: false });
      mockPrisma.orderedItem.create.mockResolvedValue({});
      mockPrisma.orderedItem.findUnique.mockResolvedValue({ ...item, order: makeOrder() });
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())                                                   // parent check
        .mockResolvedValueOnce(makeOrder({ items: [item], status: OrderStatus.InProduction })) // syncStatus — already correct
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));              // findOne for return
      mockPrisma.order.update.mockResolvedValue({});

      await service.createItem({ parentOrder: 1001 } as any);

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('transitions to Ready when all items are checked out', async () => {
      const item = makeItem({ checkedOut: false });
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })  // findItem guard
        .mockResolvedValueOnce({ ...item, checkedOut: true, order: makeOrder() }); // findItem return
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [{ ...item, checkedOut: true }], status: OrderStatus.InProduction })) // syncStatus read
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.Ready })); // findItem's order
      mockPrisma.order.update.mockResolvedValue({});

      await service.checkoutItem('S260010001');

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.Ready, statusChangedOn: expect.any(Date) }),
        }),
      );
    });

    it('transitions back to InProduction when a checkout is reversed', async () => {
      const item = makeItem({ checkedOut: true, checkoutDateStamp: new Date() });
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, checkedOut: false, order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [{ ...item, checkedOut: false }], status: OrderStatus.Ready }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.uncheckedOutItem('S260010001');

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.InProduction, statusChangedOn: expect.any(Date) }),
        }),
      );
    });

    it('writes a history entry on each syncStatus transition', async () => {
      const item = makeItem({ checkedOut: false });
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, checkedOut: true, order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [{ ...item, checkedOut: true }], status: OrderStatus.InProduction }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.Ready }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.checkoutItem('S260010001');

      expect(mockPrisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderNumber: 1001, status: OrderStatus.Ready, changedOn: expect.any(Date) }),
        }),
      );
    });

    it('does not write a history entry when status has not changed', async () => {
      const item = makeItem({ checkedOut: false });
      mockPrisma.orderedItem.create.mockResolvedValue({});
      mockPrisma.orderedItem.findUnique.mockResolvedValue({ ...item, order: makeOrder() });
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ items: [item], status: OrderStatus.InProduction }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));

      await service.createItem({ parentOrder: 1001 } as any);

      expect(mockPrisma.orderStatusHistory.create).not.toHaveBeenCalled();
    });
  });

  // ─── serial number generation (generateSerial via createItem) ────────────────

  describe('serial number generation', () => {
    // Arrange a happy-path createItem where the new item leaves the order in the
    // status it already had (so syncStatus is a no-op and the only thing under
    // test is the serial produced by generateSerial).
    const arrangeCreateItem = (counter: number) => {
      const item = makeItem();
      mockPrisma.orderedItem.create.mockResolvedValue({});
      mockPrisma.orderedItem.findUnique.mockResolvedValue({ ...item, order: makeOrder() });
      mockPrisma.$queryRaw.mockResolvedValue([{ counter }]);
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())                                                  // parent check
        .mockResolvedValueOnce(makeOrder({ items: [item], status: OrderStatus.InProduction })) // syncStatus read (no change)
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));
      mockPrisma.order.update.mockResolvedValue({});
    };

    it('generates a 9-character serial that fits SerialNumber VarChar(9)', async () => {
      arrangeCreateItem(1);

      await service.createItem({ parentOrder: 1001 } as any);

      const data = mockPrisma.orderedItem.create.mock.calls[0][0].data;
      expect(data.serialNumber).toMatch(/^S\d{8}$/);
      expect(data.serialNumber).toHaveLength(9);
    });

    it('stays 9 chars at the weekly counter boundary (9999)', async () => {
      arrangeCreateItem(9999);

      await service.createItem({ parentOrder: 1001 } as any);

      const data = mockPrisma.orderedItem.create.mock.calls[0][0].data;
      expect(data.serialNumber).toHaveLength(9);
      expect(data.serialNumber.endsWith('9999')).toBe(true);
    });

    it('throws instead of overflowing when the weekly counter exceeds 9999', async () => {
      // Only the parent-check findUnique runs before generateSerial throws.
      mockPrisma.order.findUnique.mockResolvedValueOnce(makeOrder());
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 10000 }]);

      await expect(
        service.createItem({ parentOrder: 1001 } as any),
      ).rejects.toThrow(InternalServerErrorException);
      expect(mockPrisma.orderedItem.create).not.toHaveBeenCalled();
    });

    it('aliases the RETURNING column to lowercase so the row maps to .counter', async () => {
      // Regression guard: Postgres returns "Counter" (quoted-identifier case);
      // the query must alias it to `counter` for result[0].counter to be defined.
      arrangeCreateItem(1);

      await service.createItem({ parentOrder: 1001 } as any);

      const sqlParts = mockPrisma.$queryRaw.mock.calls[0][0] as string[];
      expect(sqlParts.join('')).toMatch(/RETURNING\s+"Counter"\s+AS\s+counter/i);
    });
  });

  // ─── findItem ─────────────────────────────────────────────────────────────────

  describe('findItem', () => {
    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(null);
      await expect(service.findItem('UNKNOWN')).rejects.toThrow(NotFoundException);
    });

    it('sets item status=InProduction when not checked out', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(
        makeItem({ checkedOut: false, order: makeOrder({ dispatchedOn: null }) }),
      );
      const result = await service.findItem('S260010001');
      expect(result.status).toBe(ItemStatus.InProduction);
    });

    it('sets item status=Ready when checked out and order not dispatched', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(
        makeItem({ checkedOut: true, order: makeOrder({ dispatchedOn: null }) }),
      );
      const result = await service.findItem('S260010001');
      expect(result.status).toBe(ItemStatus.Ready);
    });

    it('sets item status=Dispatched when parent order is dispatched', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(
        makeItem({ checkedOut: true, order: makeOrder({ dispatchedOn: new Date() }) }),
      );
      const result = await service.findItem('S260010001');
      expect(result.status).toBe(ItemStatus.Dispatched);
    });
  });

  // ─── createItem ───────────────────────────────────────────────────────────────

  describe('createItem', () => {
    it('generates a serial number', async () => {
      const item = makeItem();
      mockPrisma.orderedItem.create.mockResolvedValue({});
      mockPrisma.orderedItem.findUnique.mockResolvedValue({ ...item, order: makeOrder() });
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder({ items: [item], status: OrderStatus.InProduction }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.createItem({ parentOrder: 1001 } as any);
      expect(result.serialNumber).toMatch(/^S/);
    });
  });

  // ─── updateItem ───────────────────────────────────────────────────────────────

  describe('updateItem', () => {
    it('throws BadRequestException when item is voided', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(
        makeItem({ void: true, order: makeOrder() }),
      );
      await expect(service.updateItem('S260010001', {} as any)).rejects.toThrow(BadRequestException);
    });

    it('updates item and returns the updated record', async () => {
      const item = makeItem();
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, description: 'Updated', order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});

      const result = await service.updateItem('S260010001', { description: 'Updated' } as any);
      expect(result.description).toBe('Updated');
    });
  });

  // ─── voidItem ────────────────────────────────────────────────────────────────

  describe('voidItem', () => {
    it('throws BadRequestException when item is already voided', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(
        makeItem({ void: true, order: makeOrder() }),
      );
      await expect(service.voidItem('S260010001')).rejects.toThrow(BadRequestException);
    });

    it('sets void=true, voidDateStamp, voidedBy, and syncs status', async () => {
      const item = makeItem();
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, void: true, order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [], status: OrderStatus.InProduction }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.Received }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.voidItem('S260010001', 'jsmith');

      expect(mockPrisma.orderedItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ void: true, voidDateStamp: expect.any(Date), voidedBy: 'jsmith' }),
        }),
      );
    });
  });

  // ─── checkoutItem ─────────────────────────────────────────────────────────────

  describe('checkoutItem', () => {
    it('throws BadRequestException when item is voided', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(makeItem({ void: true, order: makeOrder() }));
      await expect(service.checkoutItem('S260010001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when item is already checked out', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(makeItem({ checkedOut: true, order: makeOrder() }));
      await expect(service.checkoutItem('S260010001')).rejects.toThrow(BadRequestException);
    });

    it('sets checkedOut=true and checkoutDateStamp', async () => {
      const item = makeItem();
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, checkedOut: true, order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [{ ...item, checkedOut: true }], status: OrderStatus.InProduction }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.Ready }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.checkoutItem('S260010001');

      expect(mockPrisma.orderedItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ checkedOut: true, checkoutDateStamp: expect.any(Date) }),
        }),
      );
    });
  });

  // ─── uncheckedOutItem ─────────────────────────────────────────────────────────

  describe('uncheckedOutItem', () => {
    it('throws BadRequestException when item is voided', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(makeItem({ void: true, order: makeOrder() }));
      await expect(service.uncheckedOutItem('S260010001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when item is not checked out', async () => {
      mockPrisma.orderedItem.findUnique.mockResolvedValue(makeItem({ checkedOut: false, order: makeOrder() }));
      await expect(service.uncheckedOutItem('S260010001')).rejects.toThrow(BadRequestException);
    });

    it('sets checkedOut=false and clears checkoutDateStamp', async () => {
      const item = makeItem({ checkedOut: true, checkoutDateStamp: new Date() });
      mockPrisma.orderedItem.findUnique
        .mockResolvedValueOnce({ ...item, order: makeOrder() })
        .mockResolvedValueOnce({ ...item, checkedOut: false, checkoutDateStamp: null, order: makeOrder() });
      mockPrisma.orderedItem.update.mockResolvedValue({});
      mockPrisma.order.findUnique
        .mockResolvedValueOnce(makeOrder({ items: [{ ...item, checkedOut: false }], status: OrderStatus.Ready }))
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.InProduction }));
      mockPrisma.order.update.mockResolvedValue({});

      await service.uncheckedOutItem('S260010001');

      expect(mockPrisma.orderedItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ checkedOut: false, checkoutDateStamp: null }),
        }),
      );
    });
  });
});
