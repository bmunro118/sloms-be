import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { serializePrisma } from "../prisma/prisma-serializer";
import { VatRate } from "./entities/vat-rate.entity";
import { CreateVatRateDto } from "./dto/create-vat-rate.dto";

@Injectable()
export class VatRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<VatRate[]> {
    const rates = await this.prisma.vatRate.findMany({
      orderBy: { validFrom: "desc" },
    });
    return serializePrisma<VatRate[]>(rates);
  }

  async findCurrent(): Promise<VatRate> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rate = await this.prisma.vatRate.findFirst({
      where: {
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
      },
      orderBy: { validFrom: "desc" },
    });

    if (!rate) {
      throw new NotFoundException("No active VAT rate found");
    }

    return serializePrisma<VatRate>(rate);
  }

  async create(dto: CreateVatRateDto): Promise<VatRate> {
    const rate = await this.prisma.vatRate.create({
      data: {
        rate: dto.rate,
        label: dto.label,
        validFrom: new Date(dto.validFrom),
        validTo: null,
      },
    });
    return serializePrisma<VatRate>(rate);
  }

  async close(vatRateId: number, validTo: string): Promise<VatRate> {
    const existing = await this.prisma.vatRate.findUnique({ where: { vatRateId } });

    if (!existing) {
      throw new NotFoundException(`VAT rate #${vatRateId} not found`);
    }

    if (existing.validTo !== null) {
      throw new BadRequestException(`VAT rate #${vatRateId} is already closed`);
    }

    const rate = await this.prisma.vatRate.update({
      where: { vatRateId },
      data: { validTo: new Date(validTo) },
    });

    return serializePrisma<VatRate>(rate);
  }
}
