import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/users/entities/role.enum';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { loginAllRoles } from './support/auth';
import { cleanupE2E, E2E_MARKER } from './support/factories';

/**
 * Reference template for a full per-controller e2e matrix. Each endpoint is
 * exercised across the standard axes:
 *
 *   auth      — no token → 401
 *   authz     — a role without the required @Roles → 403; an allowed role → 2xx
 *   happy     — a valid request → 2xx and the expected body shape
 *   validation— per-field bad input and unknown props → 400
 *   not-found — a bad path param → 404
 *   effects   — a follow-up GET confirms the write
 *
 * Stamp this shape out for the remaining controllers. A non-existent id far
 * above any seeded row is used for not-found cases.
 */
const MISSING_ID = 99999999;

describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<Role, string>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupE2E(prisma);
    tokens = await loginAllRoles(app);
  });

  afterAll(async () => {
    await cleanupE2E(prisma);
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  // ─── auth ─────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('rejects an unauthenticated list with 401', () =>
      api(app).get('/api/customers').expect(401));

    it('rejects a garbage token with 401', () =>
      api(app).get('/api/customers').set(authHeader('not-a-jwt')).expect(401));
  });

  // ─── authz (role matrix) ────────────────────────────────────────────────────
  describe('authorization', () => {
    it('ReadOnly can list customers (200)', () =>
      api(app)
        .get('/api/customers?limit=1')
        .set(as(Role.ReadOnly))
        .expect(200));

    it('Customer role is denied entirely (403)', () =>
      api(app).get('/api/customers').set(as(Role.Customer)).expect(403));

    it('ReadOnly cannot create a customer (403 — needs Operative+)', () =>
      api(app)
        .post('/api/customers')
        .set(as(Role.ReadOnly))
        .send({ companyName: `${E2E_MARKER} nope` })
        .expect(403));

    it('Operative can create a customer (201)', async () => {
      const res = await api(app)
        .post('/api/customers')
        .set(as(Role.Operative))
        .send({ companyName: `${E2E_MARKER} Operative Co` })
        .expect(201);
      expect(res.body.customerId).toBeGreaterThan(0);
    });

    it('Operative cannot suspend a customer (403 — needs Manager+)', async () => {
      const created = await api(app)
        .post('/api/customers')
        .set(as(Role.Operative))
        .send({ companyName: `${E2E_MARKER} ToSuspend` })
        .expect(201);
      await api(app)
        .patch(`/api/customers/${created.body.customerId}/suspend`)
        .set(as(Role.Operative))
        .expect(403);
    });

    it('Manager can suspend then reinstate a customer (200)', async () => {
      const created = await api(app)
        .post('/api/customers')
        .set(as(Role.Manager))
        .send({ companyName: `${E2E_MARKER} ManagerCo` })
        .expect(201);
      const id = created.body.customerId;
      await api(app)
        .patch(`/api/customers/${id}/suspend`)
        .set(as(Role.Manager))
        .expect(200);
      const suspended = await api(app)
        .get(`/api/customers/${id}`)
        .set(as(Role.Manager))
        .expect(200);
      expect(suspended.body.suspended).toBe(true);
      await api(app)
        .patch(`/api/customers/${id}/reinstate`)
        .set(as(Role.Manager))
        .expect(200);
    });
  });

  // ─── validation ─────────────────────────────────────────────────────────────
  describe('validation (POST /customers)', () => {
    const create = (body: any) =>
      api(app).post('/api/customers').set(as(Role.Admin)).send(body);

    it('rejects an unknown property (forbidNonWhitelisted)', () =>
      create({ companyName: `${E2E_MARKER} x`, bogus: 1 }).expect(400));

    it('rejects an invalid email', () =>
      create({
        companyName: `${E2E_MARKER} x`,
        contactEmail: 'not-an-email',
      }).expect(400));

    it('rejects companyName over MaxLength(200)', () =>
      create({ companyName: `${E2E_MARKER}` + 'a'.repeat(201) }).expect(400));

    it('rejects accountNumber over MaxLength(20)', () =>
      create({
        companyName: `${E2E_MARKER} x`,
        accountNumber: 'a'.repeat(21),
      }).expect(400));

    it('accepts a minimal valid body (only companyName)', () =>
      create({ companyName: `${E2E_MARKER} Minimal` }).expect(201));
  });

  // ─── not found ──────────────────────────────────────────────────────────────
  describe('not found', () => {
    it('GET a missing customer → 404', () =>
      api(app)
        .get(`/api/customers/${MISSING_ID}`)
        .set(as(Role.Admin))
        .expect(404));

    it('GET a non-numeric id → 400 (ParseIntPipe)', () =>
      api(app).get('/api/customers/abc').set(as(Role.Admin)).expect(400));

    it('GET addresses for a missing customer → 404', () =>
      api(app)
        .get(`/api/customers/${MISSING_ID}/addresses/1`)
        .set(as(Role.Admin))
        .expect(404));
  });

  // ─── happy-path lifecycle + side effects ────────────────────────────────────
  describe('customer + address lifecycle', () => {
    let customerId: number;
    let addressId: number;

    it('creates a customer', async () => {
      const res = await api(app)
        .post('/api/customers')
        .set(as(Role.Admin))
        .send({
          companyName: `${E2E_MARKER} Lifecycle Co`,
          contactEmail: 'contact@example.com',
          band: 'Dispensary',
        })
        .expect(201);
      customerId = res.body.customerId;
      expect(customerId).toBeGreaterThan(0);
    });

    it('updates the customer and the change is persisted', async () => {
      await api(app)
        .put(`/api/customers/${customerId}`)
        .set(as(Role.Admin))
        .send({ contactName: 'Updated Name' })
        .expect(200);
      const res = await api(app)
        .get(`/api/customers/${customerId}`)
        .set(as(Role.Admin))
        .expect(200);
      expect(res.body.contactName).toBe('Updated Name');
    });

    it('adds an address and lists it back', async () => {
      const res = await api(app)
        .post(`/api/customers/${customerId}/addresses`)
        .set(as(Role.Admin))
        .send({
          delAddressLn1: '1 Test Street',
          delTownOrCity: 'Testville',
          delPostCode: 'TE1 1ST',
          defaultAddress: true,
        })
        .expect(201);
      addressId = res.body.addressId ?? res.body.AddressID ?? res.body.id;
      expect(addressId).toBeGreaterThan(0);

      const list = await api(app)
        .get(`/api/customers/${customerId}/addresses`)
        .set(as(Role.Admin))
        .expect(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('fetches a single address', () =>
      api(app)
        .get(`/api/customers/${customerId}/addresses/${addressId}`)
        .set(as(Role.Admin))
        .expect(200));

    it('updates the address', () =>
      api(app)
        .put(`/api/customers/${customerId}/addresses/${addressId}`)
        .set(as(Role.Admin))
        .send({ delPostCode: 'TE2 2ND' })
        .expect(200));

    it('sets the address as default', () =>
      api(app)
        .patch(
          `/api/customers/${customerId}/addresses/${addressId}/set-default`,
        )
        .set(as(Role.Admin))
        .expect(200));

    it('soft-deletes the address (Manager+)', () =>
      api(app)
        .delete(`/api/customers/${customerId}/addresses/${addressId}`)
        .set(as(Role.Manager))
        .expect(200));
  });
});
