import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { Role } from "../src/users/entities/role.enum";
import { createTestApp } from "./support/app";
import { api, authHeader } from "./support/http";
import { loginAllRoles } from "./support/auth";
import { E2E_MARKER } from "./support/factories";

/**
 * VAT rates — a compact controller whose writes are Admin-only, so it's a clean
 * demonstration of the read-vs-write role split. Same matrix as customers.
 */
describe("VatRates (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<Role, string>;

  const cleanupRates = () =>
    prisma.vatRate.deleteMany({ where: { label: { startsWith: E2E_MARKER } } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupRates();
    tokens = await loginAllRoles(app);
  });

  afterAll(async () => {
    await cleanupRates();
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  describe("read endpoints (any authenticated non-Customer role)", () => {
    it("401 without a token", () => api(app).get("/api/vat-rates").expect(401));

    it("ReadOnly can list rates", () =>
      api(app).get("/api/vat-rates").set(as(Role.ReadOnly)).expect(200));

    it("ReadOnly can read the current rate", () =>
      api(app).get("/api/vat-rates/current").set(as(Role.ReadOnly)).expect(200));

    it("Customer role is denied (403)", () =>
      api(app).get("/api/vat-rates").set(as(Role.Customer)).expect(403));
  });

  describe("writes are Admin-only", () => {
    it("Manager cannot create a rate (403)", () =>
      api(app)
        .post("/api/vat-rates")
        .set(as(Role.Manager))
        .send({ rate: 20, label: `${E2E_MARKER} nope`, validFrom: "2026-01-01" })
        .expect(403));

    it("Admin creates a rate (201) and it appears in the list", async () => {
      const res = await api(app)
        .post("/api/vat-rates")
        .set(as(Role.Admin))
        .send({ rate: 21, label: `${E2E_MARKER} Rate`, validFrom: "2026-01-01" })
        .expect(201);
      const id = res.body.vatRateId;
      expect(id).toBeGreaterThan(0);

      const list = await api(app)
        .get("/api/vat-rates")
        .set(as(Role.Admin))
        .expect(200);
      expect(list.body.some((r: any) => r.vatRateId === id)).toBe(true);
    });

    it("Admin closes a rate (200)", async () => {
      const res = await api(app)
        .post("/api/vat-rates")
        .set(as(Role.Admin))
        .send({ rate: 22, label: `${E2E_MARKER} ToClose`, validFrom: "2026-01-01" })
        .expect(201);
      await api(app)
        .patch(`/api/vat-rates/${res.body.vatRateId}/close`)
        .set(as(Role.Admin))
        .send({ validTo: "2026-12-31" })
        .expect(200);
    });
  });

  describe("validation (POST /vat-rates)", () => {
    const create = (body: any) =>
      api(app).post("/api/vat-rates").set(as(Role.Admin)).send(body);

    it("rejects a negative rate (Min 0)", () =>
      create({ rate: -1, label: `${E2E_MARKER} x`, validFrom: "2026-01-01" }).expect(
        400,
      ));

    it("rejects a missing label", () =>
      create({ rate: 20, validFrom: "2026-01-01" }).expect(400));

    it("rejects a non-ISO validFrom", () =>
      create({ rate: 20, label: `${E2E_MARKER} x`, validFrom: "not-a-date" }).expect(
        400,
      ));

    it("rejects an unknown property", () =>
      create({
        rate: 20,
        label: `${E2E_MARKER} x`,
        validFrom: "2026-01-01",
        bogus: true,
      }).expect(400));
  });
});
