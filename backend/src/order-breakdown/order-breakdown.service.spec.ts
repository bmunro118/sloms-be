import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrderBreakdownService } from './order-breakdown.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock Playwright
// jest.mock is hoisted, so factories must not reference outer variables.
// We expose the mocks via module-level refs populated in beforeEach.
// ---------------------------------------------------------------------------

jest.mock('playwright', () => {
  const mockPage = {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-mock')),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
    __mockPage: mockPage,
    __mockBrowser: mockBrowser,
  };
});

// Retrieve the mock objects after the module has been registered
// eslint-disable-next-line @typescript-eslint/no-require-imports
const playwrightMock = require('playwright') as {
  chromium: { launch: jest.Mock };
  __mockPage: { setContent: jest.Mock; pdf: jest.Mock; close: jest.Mock };
  __mockBrowser: { newPage: jest.Mock; close: jest.Mock };
};
const mockPage = playwrightMock.__mockPage;
const mockBrowser = playwrightMock.__mockBrowser;

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockPrisma = {
  order: {
    findUnique: jest.fn(),
  },
  globalSetting: {
    findMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    orderNumber: 1001,
    orderBatch: 1,
    customerRef: 'PO-2024-001',
    receivedOn: new Date('2024-06-01'),
    dispatchedOn: new Date('2024-06-10'),
    customerAccount: 42,
    customer: {
      customerId: 42,
      companyName: 'Acme Hearing',
      invBuildingName: null,
      invAddressLn1: '123 Main St',
      invAddressLn2: null,
      invTownOrCity: 'London',
      invCounty: null,
      invPostCode: 'EC1A 1BB',
    },
    deliveryAddressDetail: {
      siteCompanyName: 'Acme Delivery',
      delBuildingName: null,
      delAddressLn1: '456 Side Rd',
      delAddressLn2: null,
      delTownOrCity: 'Manchester',
      delCounty: null,
      delPostCode: 'M1 1AA',
    },
    vatRate: { rate: 20 },
    items: [
      {
        serialNumber: 'S260010001',
        modelCode: 'HA-PRO-3',
        description: 'Pro Hearing Aid',
        patientSurname: 'Smith',
        patientInitial: 'J',
        customerRef: 'REF-001',
        side: 'R',
        price: 149.99,
        void: false,
      },
    ],
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    'company.name': 'Sonic Labs',
    'company.address': '1 Tech Park|London|EC2A 4NE',
    'company.email': 'info@soniclabs.co.uk',
    'company.registrationNo': '12345678',
    'company.vatNo': 'GB123456789',
    ...overrides,
  };
  return Object.entries(defaults).map(([key, val]) => ({ key, val }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderBreakdownService', () => {
  let service: OrderBreakdownService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.globalSetting.findMany.mockResolvedValue(makeSettings());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderBreakdownService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrderBreakdownService>(OrderBreakdownService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  // ── generateOrderBreakdown ────────────────────────────────────────────────

  describe('generateOrderBreakdown', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.generateOrderBreakdown(9999, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a Buffer containing PDF data', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      const result = await service.generateOrderBreakdown(1001, 1);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockPage.setContent).toHaveBeenCalledTimes(1);
      expect(mockPage.pdf).toHaveBeenCalledTimes(1);
      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it('passes HTML to setContent and requests A4 format', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('<!DOCTYPE html>');
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'A4' }),
      );
    });

    it('includes order number, customer name, and item serial in HTML', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('SLI001001');       // formatted order number
      expect(html).toContain('Acme Hearing');    // customer name
      expect(html).toContain('S260010001');      // serial number
    });

    it('uses customer companyName as account when customer relation is present', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('Acme Hearing');
    });

    it('falls back to customerAccount number when customer relation is absent', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ customer: null, customerAccount: 42 }),
      );

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('42');
    });

    it('renders empty delivery address when deliveryAddressDetail is null', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ deliveryAddressDetail: null }),
      );

      const result = await service.generateOrderBreakdown(1001, 1);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders empty invoice address when customer is null', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ customer: null }),
      );

      const result = await service.generateOrderBreakdown(1001, 1);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('defaults VAT rate to 20% when vatRate relation is absent', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        makeOrder({ vatRate: null }),
      );

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('20%');
    });
  });

  // ── Company details ───────────────────────────────────────────────────────

  describe('company details in rendered HTML', () => {
    it('includes company name from global settings', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('Sonic Labs');
    });

    it('splits company address on pipe characters', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('1 Tech Park');
      expect(html).toContain('EC2A 4NE');
    });

    it('falls back to "Sonic Labs" when company.name setting is missing', async () => {
      // Return settings without the company.name key so the service falls back to the default
      mockPrisma.globalSetting.findMany.mockResolvedValue(
        makeSettings().filter((s) => s.key !== 'company.name'),
      );
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      // Re-compile with fresh settings mock
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrderBreakdownService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();
      const svc = module.get<OrderBreakdownService>(OrderBreakdownService);
      await svc.onModuleInit();

      await svc.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('Sonic Labs');

      await svc.onModuleDestroy();
    });
  });

  // ── Totals ────────────────────────────────────────────────────────────────

  describe('totals calculation', () => {
    it('calculates VAT and includes totals in HTML', async () => {
      const order = makeOrder({
        items: [
          { ...makeOrder().items[0], price: 100, void: false },
          { ...makeOrder().items[0], serialNumber: 'S260010002', price: 50, void: false },
        ],
        vatRate: { rate: 20 },
      });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      // excVat = 150, vat at 20% = 30, incVat = 180
      expect(html).toContain('£150.00');
      expect(html).toContain('£30.00');
      expect(html).toContain('£180.00');
    });

    it('handles orders with no items (zero totals)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder({ items: [] }));

      const result = await service.generateOrderBreakdown(1001, 1);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // ── Patient name ─────────────────────────────────────────────────────────

  describe('patient name rendering', () => {
    it('renders "Surname Initial" when both are present', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('Smith J');
    });

    it('renders only surname when initial is absent', async () => {
      const order = makeOrder({
        items: [{ ...makeOrder().items[0], patientInitial: null }],
      });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      await service.generateOrderBreakdown(1001, 1);

      const [html] = mockPage.setContent.mock.calls[0];
      expect(html).toContain('Smith');
    });

    it('renders nothing for patient when both surname and initial are null', async () => {
      const order = makeOrder({
        items: [{ ...makeOrder().items[0], patientSurname: null, patientInitial: null }],
      });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      const result = await service.generateOrderBreakdown(1001, 1);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // ── PDF options ───────────────────────────────────────────────────────────

  describe('PDF generation options', () => {
    it('sets Content-Type-appropriate pdf options', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(makeOrder());

      await service.generateOrderBreakdown(1001, 1);

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
        }),
      );
    });
  });
});
