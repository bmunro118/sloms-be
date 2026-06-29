import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/users/entities/role.enum';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { loginAllRoles } from './support/auth';
import { cleanupE2E, E2E_MARKER } from './support/factories';

/**
 * POST /customers/:id/onboard — creates a Customer-role login linked to the
 * customer account and (in dev/e2e, where ACS is unset) logs the welcome email
 * instead of sending it. Exercised across the standard axes:
 *
 *   auth      — no token → 401
 *   authz     — ReadOnly/Operative/Customer → 403; Manager/Admin → 2xx
 *   happy     — 201 with a linked Customer user; passwordHash never returned
 *   effects   — a follow-up GET /users/:id confirms the link
 *   validation— bad email / unknown prop → 400
 *   guards    — suspended customer, no-email customer → 400; duplicate → 409
 *   not-found — a bad :id → 404
 *
 * Onboarded logins are tagged with E2E_MARKER in the email local-part so the
 * cleanup below can remove them BEFORE the tagged customers — the User →
 * Customer FK (linkedCustomerId) would otherwise block the customer delete.
 */
const MISSING_ID = 99999999;

describe('Customer onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<Role, string>;

  // Unique per run so leftover rows from a crashed run can't cause a 409.
  const unique = Date.now();
  const email = (slug: string) => `${E2E_MARKER}${slug}.${unique}@example.com`;

  /** Remove onboarded users first, then the tagged customers they linked. */
  const cleanup = async () => {
    const taggedUsers = await prisma.user.findMany({
      where: { username: { startsWith: E2E_MARKER } },
      select: { userId: true },
    });
    const userIds = taggedUsers.map((u) => u.userId);
    if (userIds.length) {
      // EmailOtp/TrustedDevice/RecoveryCode cascade on user delete; clear the
      // non-cascading dependents best-effort before removing the users.
      await prisma.userSetting
        .deleteMany({ where: { userId: { in: userIds } } })
        .catch(() => undefined);
      await prisma.userAuditLog
        .deleteMany({ where: { userId: { in: userIds } } })
        .catch(() => undefined);
      await prisma.user.deleteMany({ where: { userId: { in: userIds } } });
    }
    await cleanupE2E(prisma);
  };

  /** Create a tagged customer via the API and return its id. */
  const makeCustomer = async (overrides: Record<string, any> = {}) => {
    const res = await api(app)
      .post('/api/customers')
      .set(as(Role.Admin))
      .send({
        companyName: `${E2E_MARKER} Onboarding Co`,
        contactEmail: email('contact'),
        contactName: 'Contact Person',
        ...overrides,
      })
      .expect(201);
    return res.body.customerId as number;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanup();
    tokens = await loginAllRoles(app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  // ─── auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('rejects an unauthenticated onboard with 401', async () => {
      const id = await makeCustomer();
      await api(app).post(`/api/customers/${id}/onboard`).send({}).expect(401);
    });
  });

  // ─── authz (role matrix) ────────────────────────────────────────────────────
  describe('authorization', () => {
    it.each([Role.ReadOnly, Role.Operative, Role.Customer])(
      '%s cannot onboard (403 — needs Manager+)',
      async (role) => {
        const id = await makeCustomer();
        await api(app)
          .post(`/api/customers/${id}/onboard`)
          .set(as(role))
          .send({ email: email('authz') })
          .expect(403);
      },
    );

    it('Manager can onboard (201)', async () => {
      const id = await makeCustomer();
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Manager))
        .send({ email: email('manager') })
        .expect(201);
    });
  });

  // ─── happy path + effect ─────────────────────────────────────────────────────
  describe('happy path', () => {
    it('creates a linked Customer login and never returns the password hash', async () => {
      const customerId = await makeCustomer();
      const loginEmail = email('happy');

      const res = await api(app)
        .post(`/api/customers/${customerId}/onboard`)
        .set(as(Role.Admin))
        .send({ email: loginEmail, fullName: 'Portal User' })
        .expect(201);

      expect(res.body.customerId).toBe(customerId);
      expect(res.body.loginEmail).toBe(loginEmail);
      expect(res.body.user.username).toBe(loginEmail);
      expect(res.body.user.role).toBe(Role.Customer);
      expect(res.body.user.linkedCustomerId).toBe(customerId);
      expect(res.body.user.mustChangePassword).toBe(true);
      expect(res.body.user.passwordHash).toBeUndefined();

      // Effect: the user persists, linked to the customer (verified via Admin).
      const fetched = await api(app)
        .get(`/api/users/${res.body.user.userId}`)
        .set(as(Role.Admin))
        .expect(200);
      expect(fetched.body.linkedCustomerId).toBe(customerId);
      expect(fetched.body.role).toBe(Role.Customer);
    });

    it("defaults the login email to the customer's contactEmail when omitted", async () => {
      const contactEmail = email('default-contact');
      const customerId = await makeCustomer({ contactEmail });

      const res = await api(app)
        .post(`/api/customers/${customerId}/onboard`)
        .set(as(Role.Admin))
        .send({})
        .expect(201);

      expect(res.body.loginEmail).toBe(contactEmail);
      expect(res.body.user.username).toBe(contactEmail);
    });
  });

  // ─── validation ─────────────────────────────────────────────────────────────
  describe('validation', () => {
    it('rejects an invalid email (400)', async () => {
      const id = await makeCustomer();
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('rejects an unknown property (400 — forbidNonWhitelisted)', async () => {
      const id = await makeCustomer();
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({ email: email('unknown'), bogus: 1 })
        .expect(400);
    });
  });

  // ─── guards ───────────────────────────────────────────────────────────────
  describe('guards', () => {
    it('rejects onboarding a suspended customer (400)', async () => {
      const id = await makeCustomer();
      await api(app)
        .patch(`/api/customers/${id}/suspend`)
        .set(as(Role.Manager))
        .expect(200);
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({ email: email('suspended') })
        .expect(400);
    });

    it('rejects when no email is available (400)', async () => {
      const id = await makeCustomer({ contactEmail: null });
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({})
        .expect(400);
    });

    it('rejects re-onboarding the same login (409 Conflict)', async () => {
      const id = await makeCustomer();
      const loginEmail = email('dup');
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({ email: loginEmail })
        .expect(201);
      await api(app)
        .post(`/api/customers/${id}/onboard`)
        .set(as(Role.Admin))
        .send({ email: loginEmail })
        .expect(409);
    });
  });

  // ─── not found ──────────────────────────────────────────────────────────────
  describe('not found', () => {
    it('onboard a missing customer → 404', () =>
      api(app)
        .post(`/api/customers/${MISSING_ID}/onboard`)
        .set(as(Role.Admin))
        .send({ email: email('missing') })
        .expect(404));

    it('onboard a non-numeric id → 400 (ParseIntPipe)', () =>
      api(app)
        .post('/api/customers/abc/onboard')
        .set(as(Role.Admin))
        .send({ email: email('nan') })
        .expect(400));
  });
});
