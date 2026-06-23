import { INestApplication } from "@nestjs/common";
import { Role } from "../src/users/entities/role.enum";
import { createTestApp } from "./support/app";
import { api, authHeader } from "./support/http";
import { loginAllRoles } from "./support/auth";

/**
 * Price list — read endpoints exercised against the seeded active revision;
 * write endpoints (activate / import / void) are exercised via authz (ReadOnly
 * 403) and not-found (Manager → 404 on a missing target) so the suite never
 * mutates the shared seeded price data.
 */
const MISSING_ID = 99999999;
const MISSING_ITEM = "__E2E_NO_SUCH_ITEM__";

const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined) return o[k];
  return undefined;
};

describe("PriceList (e2e)", () => {
  let app: INestApplication;
  let tokens: Record<Role, string>;
  let itemId: string;
  let listName: string;
  let revisionId: number;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    tokens = await loginAllRoles(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  // ─── reads ──────────────────────────────────────────────────────────────────
  describe("reads", () => {
    it("401 without a token", () =>
      api(app).get("/api/price-list").expect(401));

    it("Customer role is denied (403)", () =>
      api(app).get("/api/price-list").set(as(Role.Customer)).expect(403));

    it("lists revisions and captures one", async () => {
      const res = await api(app)
        .get("/api/price-list/revisions")
        .set(as(Role.ReadOnly))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      revisionId = pick(res.body[0], "id", "revisionId", "RevisionID");
      expect(revisionId).toBeGreaterThan(0);
    });

    it("gets a single revision", () =>
      api(app)
        .get(`/api/price-list/revisions/${revisionId}`)
        .set(as(Role.ReadOnly))
        .expect(200));

    it("lists price list types and captures a name", async () => {
      const res = await api(app)
        .get("/api/price-list/lists")
        .set(as(Role.ReadOnly))
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      listName = pick(res.body[0], "name", "Name");
      expect(typeof listName).toBe("string");
    });

    it("exports CSV", async () => {
      const res = await api(app)
        .get("/api/price-list/export")
        .set(as(Role.ReadOnly))
        .expect(200);
      expect(res.headers["content-type"]).toContain("text/csv");
    });

    it("lists items and captures an itemId", async () => {
      const res = await api(app)
        .get("/api/price-list")
        .set(as(Role.ReadOnly))
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      itemId = pick(res.body[0], "itemId", "ItemID", "id");
      expect(typeof itemId).toBe("string");
    });

    it("filters items by category", () =>
      api(app)
        .get("/api/price-list?category=Hearing+Aid")
        .set(as(Role.ReadOnly))
        .expect(200));

    it("gets a single item", () =>
      api(app)
        .get(`/api/price-list/${encodeURIComponent(itemId)}`)
        .set(as(Role.ReadOnly))
        .expect(200));

    it("gets all lists for an item", () =>
      api(app)
        .get(`/api/price-list/${encodeURIComponent(itemId)}/lists`)
        .set(as(Role.ReadOnly))
        .expect(200));

    it("gets the price for an item in a specific list", () =>
      api(app)
        .get(
          `/api/price-list/${encodeURIComponent(itemId)}/lists/${encodeURIComponent(listName)}`,
        )
        .set(as(Role.ReadOnly))
        .expect(200));
  });

  // ─── writes: authz + not-found, no mutation of seed data ────────────────────
  describe("writes (authz + not-found, non-mutating)", () => {
    it("ReadOnly cannot activate a revision (403)", () =>
      api(app)
        .post(`/api/price-list/revisions/${revisionId}/activate`)
        .set(as(Role.ReadOnly))
        .expect(403));

    it("Manager activating a missing revision → 404", () =>
      api(app)
        .post(`/api/price-list/revisions/${MISSING_ID}/activate`)
        .set(as(Role.Manager))
        .expect(404));

    it("ReadOnly cannot import (403)", () =>
      api(app).post("/api/price-list/import").set(as(Role.ReadOnly)).expect(403));

    it("ReadOnly cannot void an item (403)", () =>
      api(app)
        .delete(`/api/price-list/items/${MISSING_ITEM}`)
        .set(as(Role.ReadOnly))
        .expect(403));

    it("Manager voiding a missing item → 404", () =>
      api(app)
        .delete(`/api/price-list/items/${MISSING_ITEM}`)
        .set(as(Role.Manager))
        .expect(404));

    it("ReadOnly cannot void a list type (403)", () =>
      api(app)
        .delete(`/api/price-list/lists/${MISSING_ID}`)
        .set(as(Role.ReadOnly))
        .expect(403));

    it("Manager voiding a missing list type → 404", () =>
      api(app)
        .delete(`/api/price-list/lists/${MISSING_ID}`)
        .set(as(Role.Manager))
        .expect(404));
  });
});
