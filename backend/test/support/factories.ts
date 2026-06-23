import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Test-data conventions
 * ─────────────────────
 * All e2e fixtures are tagged so they can be created and torn down without
 * touching seed/production rows, and run repeatably against the shared dev DB.
 *
 *  - Customers/addresses created by tests carry the E2E_MARKER in a name field.
 *  - Orders use a reserved high OrderNumber namespace (>= ORDER_NS) that the
 *    seed never allocates.
 *
 * `cleanupE2E()` removes everything matching those tags and is safe to call in
 * both beforeAll and afterAll.
 */
export const E2E_MARKER = "__E2E__";

/** Reserved order-number namespace — well above any seeded/migrated order. */
export const ORDER_NS = 990000;

/** A unique order number in the reserved namespace for an individual spec. */
export function testOrderNumber(offset: number): number {
  return ORDER_NS + offset;
}

export interface CreatedCustomer {
  customerId: number;
  accountNumber: string | null;
}

/** Create a tagged customer directly via Prisma (bypasses the API on purpose). */
export async function createTestCustomer(
  prisma: PrismaService,
  overrides: Record<string, any> = {},
): Promise<CreatedCustomer> {
  const customer = await prisma.customer.create({
    data: {
      companyName: `${E2E_MARKER} Test Customer`,
      band: "Dispensary",
      suspended: false,
      ...overrides,
    },
  });
  return {
    customerId: customer.customerId,
    accountNumber: (customer as any).accountNumber ?? null,
  };
}

/**
 * Delete every fixture this suite may have created. Ordered to respect FKs:
 * order children first, then orders, then customer addresses, then customers.
 */
export async function cleanupE2E(prisma: PrismaService): Promise<void> {
  // Orders in the reserved namespace and their children.
  await prisma.orderStatusHistory.deleteMany({
    where: { orderNumber: { gte: ORDER_NS } },
  });
  await prisma.orderedItem.deleteMany({
    where: { parentOrder: { gte: ORDER_NS } },
  });
  await prisma.order.deleteMany({ where: { orderNumber: { gte: ORDER_NS } } });

  // Tagged customers and their addresses.
  const tagged = await prisma.customer.findMany({
    where: { companyName: { startsWith: E2E_MARKER } },
    select: { customerId: true },
  });
  const ids = tagged.map((c) => c.customerId);
  if (ids.length) {
    await prisma.customerAddress.deleteMany({
      where: { customerAccount: { in: ids } },
    });
    await prisma.customer.deleteMany({ where: { customerId: { in: ids } } });
  }
}
