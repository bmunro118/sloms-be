import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { Role } from "../src/users/entities/role.enum";
import { createTestApp } from "./support/app";
import { api, authHeader } from "./support/http";
import { loginAllRoles } from "./support/auth";

/**
 * Settings — global settings (reads for everyone, writes Admin-only) and the
 * per-user settings sub-resource (available to every role, including Customer).
 *
 * Global writes mutate a real seeded key (WARRANTY_WEEKS); the original value is
 * captured up front and restored in afterAll so re-runs stay deterministic.
 */
const GLOBAL_KEY = "WARRANTY_WEEKS";
const USER_KEY = "__e2e_pref";

describe("Settings (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<Role, string>;
  let originalVal: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tokens = await loginAllRoles(app);
    const row = await prisma.globalSetting.findUnique({
      where: { key: GLOBAL_KEY },
    });
    originalVal = row?.val ?? "104";
  });

  afterAll(async () => {
    // Restore the mutated global setting and drop any leftover user setting.
    await prisma.globalSetting
      .update({ where: { key: GLOBAL_KEY }, data: { val: originalVal } })
      .catch(() => undefined);
    await prisma.userSetting
      .deleteMany({ where: { key: USER_KEY } })
      .catch(() => undefined);
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  // ─── global reads ───────────────────────────────────────────────────────────
  describe("global reads", () => {
    it("401 without a token", () => api(app).get("/api/settings").expect(401));

    it("ReadOnly can list settings", () =>
      api(app).get("/api/settings?limit=5").set(as(Role.ReadOnly)).expect(200));

    it("Customer role is denied the global list (403)", () =>
      api(app).get("/api/settings").set(as(Role.Customer)).expect(403));

    it("reads a single setting by key", () =>
      api(app).get(`/api/settings/${GLOBAL_KEY}`).set(as(Role.ReadOnly)).expect(200));

    it("reads the raw value of a setting", () =>
      api(app)
        .get(`/api/settings/${GLOBAL_KEY}/value`)
        .set(as(Role.ReadOnly))
        .expect(200));

    it("a missing key → 404", () =>
      api(app)
        .get("/api/settings/__does_not_exist__")
        .set(as(Role.ReadOnly))
        .expect(404));
  });

  // ─── global writes (Admin only) ─────────────────────────────────────────────
  describe("global writes (Admin only)", () => {
    it("Operative cannot PUT a setting (403)", () =>
      api(app)
        .put(`/api/settings/${GLOBAL_KEY}`)
        .set(as(Role.Operative))
        .send({ val: "999" })
        .expect(403));

    it("Admin PUT updates a setting and the value persists", async () => {
      await api(app)
        .put(`/api/settings/${GLOBAL_KEY}`)
        .set(as(Role.Admin))
        .send({ val: "105" })
        .expect(200);
      // Read the full setting object back (getValue returns a bare string body).
      const res = await api(app)
        .get(`/api/settings/${GLOBAL_KEY}`)
        .set(as(Role.Admin))
        .expect(200);
      expect(res.body.val).toBe("105");
    });

    it("Admin PATCH value sets just the value", () =>
      api(app)
        .patch(`/api/settings/${GLOBAL_KEY}/value`)
        .set(as(Role.Admin))
        .send({ val: originalVal })
        .expect(200));

    it("PUT rejects an unknown property (400)", () =>
      api(app)
        .put(`/api/settings/${GLOBAL_KEY}`)
        .set(as(Role.Admin))
        .send({ bogus: true })
        .expect(400));
  });

  // ─── per-user settings (all roles) ──────────────────────────────────────────
  describe("per-user settings", () => {
    it("upserts a user setting (PUT)", () =>
      api(app)
        .put(`/api/settings/user/${USER_KEY}`)
        .set(as(Role.ReadOnly))
        .send({ val: "dark" })
        .expect(200));

    it("reads the user setting back", async () => {
      const res = await api(app)
        .get(`/api/settings/user/${USER_KEY}`)
        .set(as(Role.ReadOnly))
        .expect(200);
      expect(JSON.stringify(res.body)).toContain("dark");
    });

    // The static `user` route is declared before `:key` in the controller, so
    // `GET /settings/user` resolves to the user-settings handler (not key="user")
    // and the Customer role is permitted.
    it("lists the current user's settings", () =>
      api(app).get("/api/settings/user").set(as(Role.ReadOnly)).expect(200));

    it("Customer can list its own settings", () =>
      api(app).get("/api/settings/user").set(as(Role.Customer)).expect(200));

    it("deletes the user setting", () =>
      api(app)
        .delete(`/api/settings/user/${USER_KEY}`)
        .set(as(Role.ReadOnly))
        .expect((res) => {
          if (![200, 204].includes(res.status)) {
            throw new Error(`unexpected status ${res.status}`);
          }
        }));
  });
});
