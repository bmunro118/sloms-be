import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderBreakdownData,
  renderOrderBreakdownHtml,
} from './order-breakdown.template';

@Injectable()
export class OrderBreakdownService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.browser = await chromium.launch();
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  async generateOrderBreakdown(
    orderNumber: number,
    orderBatch: number,
  ): Promise<Buffer> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber_orderBatch: { orderNumber, orderBatch } },
      include: {
        customer: true,
        deliveryAddressDetail: true,
        vatRate: true,
        items: { where: { void: false }, orderBy: { serialNumber: 'asc' } },
      },
    });

    if (!order) {
      throw new NotFoundException(
        `Order #${orderNumber} (batch ${orderBatch}) not found`,
      );
    }

    const company = await this.getCompanyDetails();

    const data: OrderBreakdownData = {
      company,
      order: {
        orderNumber: order.orderNumber,
        orderDate: order.receivedOn,
        dispatchDate: order.dispatchedOn,
        customerPo: order.customerRef,
      },
      customerAccount:
        order.customer?.companyName ?? String(order.customerAccount ?? ''),
      invoiceAddress: this.buildInvoiceAddress(order.customer),
      deliveryAddress: this.buildDeliveryAddress(order.deliveryAddressDetail),
      generatedOn: new Date(),
      items: (order.items ?? []).map((item) => ({
        modelCode: item.modelCode,
        description: item.description,
        serialNumber: item.serialNumber,
        patient: this.buildPatientName(
          item.patientSurname,
          item.patientInitial,
        ),
        refNo: item.customerRef,
        side: item.side,
        price: item.price,
      })),
      totals: this.buildTotals(order.items ?? [], order.vatRate?.rate ?? null),
    };

    return this.renderPdf(data);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getCompanyDetails(): Promise<OrderBreakdownData['company']> {
    const keys = [
      'company.name',
      'company.address',
      'company.email',
      'company.registrationNo',
      'company.vatNo',
    ];

    const settings = await this.prisma.globalSetting.findMany({
      where: { key: { in: keys } },
    });

    const get = (key: string) =>
      settings.find((s) => s.key === key)?.val ?? null;

    const rawAddress = get('company.address');
    const addressLines = rawAddress
      ? rawAddress.split('|').map((l) => l.trim())
      : [];

    return {
      name: get('company.name') ?? 'Sonic Labs',
      addressLines,
      email: get('company.email'),
      companyRegNo: get('company.registrationNo'),
      vatRegNo: get('company.vatNo'),
    };
  }

  private buildInvoiceAddress(customer: any): string[] {
    if (!customer) return [];
    return [
      customer.companyName,
      customer.invBuildingName,
      customer.invAddressLn1,
      customer.invAddressLn2,
      customer.invTownOrCity,
      customer.invCounty,
      customer.invPostCode,
    ].filter(Boolean) as string[];
  }

  private buildDeliveryAddress(address: any): string[] {
    if (!address) return [];
    return [
      address.siteCompanyName,
      address.delBuildingName,
      address.delAddressLn1,
      address.delAddressLn2,
      address.delTownOrCity,
      address.delCounty,
      address.delPostCode,
    ].filter(Boolean) as string[];
  }

  private buildPatientName(
    surname: string | null,
    initial: string | null,
  ): string | null {
    const parts = [surname, initial].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  private buildTotals(
    items: { price: number | null }[],
    vatRateDecimal: any,
  ): OrderBreakdownData['totals'] {
    const excVat = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
    const vatRate = vatRateDecimal != null ? Number(vatRateDecimal) : 20;
    const vatAmount = Math.round(excVat * (vatRate / 100) * 100) / 100;
    const incVat = Math.round((excVat + vatAmount) * 100) / 100;
    return { excVat, vatRate, vatAmount, incVat };
  }

  private async renderPdf(data: OrderBreakdownData): Promise<Buffer> {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }

    const page = await this.browser.newPage();
    try {
      const html = renderOrderBreakdownHtml(data);
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="font-family:Arial,sans-serif;font-style:italic;font-size:8pt;
                      width:100%;padding:0 14mm;display:flex;justify-content:space-between;
                      color:#555;border-top:1px solid #bbb;">
            <span>Order Breakdown</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
