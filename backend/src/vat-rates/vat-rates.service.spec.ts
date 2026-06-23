import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { VatRatesService } from "./vat-rates.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  vatRate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

function makeRate(overrides = {}) {
  return {
    vatRateId: 1,
    rate: 20.0,
    label: "Standard UK",
    validFrom: new Date("2011-01-04"),
    validTo: null,
    ...overrides,
  };
}

describe("VatRatesService", () => {
  let service: VatRatesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VatRatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<VatRatesService>(VatRatesService);
  });

  describe("findAll", () => {
    it("returns all rates ordered by validFrom desc", async () => {
      mockPrisma.vatRate.findMany.mockResolvedValue([makeRate()]);

      const result = await service.findAll();

      expect(mockPrisma.vatRate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { validFrom: "desc" } }),
      );
      expect(result[0].vatRateId).toBe(1);
    });
  });

  describe("findCurrent", () => {
    it("returns the active rate", async () => {
      mockPrisma.vatRate.findFirst.mockResolvedValue(makeRate());

      const result = await service.findCurrent();
      expect(result.rate).toBe(20);
    });

    it("throws NotFoundException when no active rate exists", async () => {
      mockPrisma.vatRate.findFirst.mockResolvedValue(null);
      await expect(service.findCurrent()).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("creates and returns a new rate", async () => {
      const created = makeRate();
      mockPrisma.vatRate.create.mockResolvedValue(created);

      const result = await service.create({
        rate: 20,
        label: "Standard UK",
        validFrom: "2011-01-04",
      });

      expect(mockPrisma.vatRate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rate: 20, label: "Standard UK", validTo: null }),
        }),
      );
      expect(result.vatRateId).toBe(1);
    });
  });

  describe("close", () => {
    it("throws NotFoundException when rate does not exist", async () => {
      mockPrisma.vatRate.findUnique.mockResolvedValue(null);
      await expect(service.close(99, "2025-12-31")).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when rate is already closed", async () => {
      mockPrisma.vatRate.findUnique.mockResolvedValue(
        makeRate({ validTo: new Date("2024-12-31") }),
      );
      await expect(service.close(1, "2025-12-31")).rejects.toThrow(BadRequestException);
    });

    it("sets validTo and returns the updated rate", async () => {
      const closed = makeRate({ validTo: new Date("2025-12-31") });
      mockPrisma.vatRate.findUnique.mockResolvedValue(makeRate());
      mockPrisma.vatRate.update.mockResolvedValue(closed);

      const result = await service.close(1, "2025-12-31");

      expect(mockPrisma.vatRate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vatRateId: 1 },
          data: { validTo: expect.any(Date) },
        }),
      );
      expect(result.validTo).not.toBeNull();
    });
  });
});
