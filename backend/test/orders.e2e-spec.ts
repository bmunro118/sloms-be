import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { login } from './support/auth';
import { cleanupE2E, testOrderNumber } from './support/factories';

/**
 * End-to-end tests that drive the real HTTP pipeline (routing, guards, the
 * global ValidationPipe, serialization) against the live development Postgres.
 *
 * These exist because the pure-mock unit tests structurally cannot catch the
 * bugs found during manual testing: the orders-list filters being rejected by
 * forbidNonWhitelisted (400), date-only order dates failing at Prisma (500),
 * and the serial-generation column-casing mismatch. Each is pinned below.
 *
 * Requires: the dev Postgres up (docker compose up -d postgres) and seeded, and
 * DATABASE_URL set (loaded from .env by ConfigModule).
 */
describe('Orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  const TEST_ORDER = testOrderNumber(111);
  const TEST_BATCH = 1;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupE2E(prisma);
    token = await login(app, 'admin', 'admin123');
  });

  afterAll(async () => {
    await cleanupE2E(prisma);
    await app.close();
  });

  const auth = () => authHeader(token);

  describe('auth + guards', () => {
    it('rejects a bad password with 401', () =>
      api(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401));

    it('rejects an unauthenticated list with 401', () =>
      api(app).get('/api/orders').expect(401));
  });

  describe('orders list filters (regression: forbidNonWhitelisted 400)', () => {
    it('returns a paged result for the base list', async () => {
      const res = await api(app)
        .get('/api/orders?limit=3')
        .set(auth())
        .expect(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
    });

    it.each(['includeVoided=true', 'customerId=2', 'status=Dispatched'])(
      'accepts the %s filter (was 400 before the FindOrdersQueryDto fix)',
      (q) => api(app).get(`/api/orders?limit=3&${q}`).set(auth()).expect(200),
    );

    it('status filter actually narrows results to that status', async () => {
      const res = await api(app)
        .get('/api/orders?limit=5&status=Dispatched')
        .set(auth())
        .expect(200);
      for (const o of res.body.data) {
        expect(o.status).toBe('Dispatched');
      }
    });

    it('still rejects a genuinely unknown query param with 400', () =>
      api(app).get('/api/orders?foo=bar').set(auth()).expect(400));
  });

  describe('order lifecycle (regression: date-only 500 + serial casing)', () => {
    it('creates an order with a date-only receivedOn', async () => {
      const res = await api(app)
        .post('/api/orders')
        .set(auth())
        .send({
          orderNumber: TEST_ORDER,
          customerAccount: 2,
          receivedOn: '2026-06-23', // date-only previously 500'd at Prisma
        })
        .expect(201);
      expect(res.body.status).toBe('Received');
      expect(res.body.vatRateId).toBeGreaterThan(0); // VAT auto-resolved
    });

    it('adds an item with a valid 9-char serial (regression: Counter casing)', async () => {
      const res = await api(app)
        .post(`/api/orders/${TEST_ORDER}/${TEST_BATCH}/items`)
        .set(auth())
        .send({ patientInitial: 'J', side: 'L', price: 12.5 })
        .expect(201);
      expect(res.body.serialNumber).toMatch(/^S\d{8}$/);
      expect(res.body.serialNumber).toHaveLength(9);
    });

    it('moves the order through InProduction -> Ready -> Dispatched', async () => {
      const detail = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}`)
        .set(auth())
        .expect(200);
      expect(detail.body.status).toBe('InProduction');
      expect(detail.body.itemCount).toBe(1);

      const items = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}/items`)
        .set(auth())
        .expect(200);
      const serial = items.body.data[0].serialNumber;

      await api(app)
        .patch(
          `/api/orders/${TEST_ORDER}/${TEST_BATCH}/items/${serial}/checkout`,
        )
        .set(auth())
        .expect(200);
      const ready = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}`)
        .set(auth())
        .expect(200);
      expect(ready.body.status).toBe('Ready');

      await api(app)
        .patch(`/api/orders/${TEST_ORDER}/${TEST_BATCH}/dispatch`)
        .set(auth())
        .send({ dispatchedOn: '2026-06-23T09:00:00.000Z' })
        .expect(200);
      const dispatched = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}`)
        .set(auth())
        .expect(200);
      expect(dispatched.body.status).toBe('Dispatched');
    });

    it('records the full status history in tracking', async () => {
      const res = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}/tracking`)
        .set(auth())
        .expect(200);
      const statuses = (res.body.history ?? []).map((h: any) => h.status);
      expect(statuses).toEqual([
        'Received',
        'InProduction',
        'Ready',
        'Dispatched',
      ]);
    });

    it('voids the order', async () => {
      await api(app)
        .delete(`/api/orders/${TEST_ORDER}/${TEST_BATCH}`)
        .set(auth())
        .expect(200);
      const res = await api(app)
        .get(`/api/orders/${TEST_ORDER}/${TEST_BATCH}`)
        .set(auth())
        .expect(200);
      expect(res.body.void).toBe(true);
      expect(res.body.status).toBe('Voided');
    });
  });

  // ─── order + item detail endpoints (separate order, not dispatched) ─────────
  describe('order + item detail endpoints', () => {
    const ORDER = testOrderNumber(112);
    const BATCH = 1;
    let serial: string;

    it('creates an order and an item', async () => {
      await api(app)
        .post('/api/orders')
        .set(auth())
        .send({
          orderNumber: ORDER,
          customerAccount: 2,
          receivedOn: '2026-06-23',
        })
        .expect(201);
      const item = await api(app)
        .post(`/api/orders/${ORDER}/${BATCH}/items`)
        .set(auth())
        .send({ patientInitial: 'K', side: 'R', price: 30 })
        .expect(201);
      serial = item.body.serialNumber;
      expect(serial).toMatch(/^S\d{8}$/);
    });

    it('updates the order (PUT) and the change persists', async () => {
      await api(app)
        .put(`/api/orders/${ORDER}/${BATCH}`)
        .set(auth())
        .send({ customerRef: 'PO-E2E-112' })
        .expect(200);
      const res = await api(app)
        .get(`/api/orders/${ORDER}/${BATCH}`)
        .set(auth())
        .expect(200);
      expect(res.body.customerRef).toBe('PO-E2E-112');
    });

    it('looks up the item by serial alone', async () => {
      const res = await api(app)
        .get(`/api/orders/items/${serial}`)
        .set(auth())
        .expect(200);
      expect(res.body.serialNumber).toBe(serial);
    });

    it('gets the item within its order', () =>
      api(app)
        .get(`/api/orders/${ORDER}/${BATCH}/items/${serial}`)
        .set(auth())
        .expect(200));

    it('updates the item (PUT) and the change persists', async () => {
      await api(app)
        .put(`/api/orders/${ORDER}/${BATCH}/items/${serial}`)
        .set(auth())
        .send({ price: 45 })
        .expect(200);
      const res = await api(app)
        .get(`/api/orders/${ORDER}/${BATCH}/items/${serial}`)
        .set(auth())
        .expect(200);
      expect(Number(res.body.price)).toBe(45);
    });

    it('checks out then reverses the checkout (unchecked-out)', async () => {
      await api(app)
        .patch(`/api/orders/${ORDER}/${BATCH}/items/${serial}/checkout`)
        .set(auth())
        .expect(200);
      await api(app)
        .patch(`/api/orders/${ORDER}/${BATCH}/items/${serial}/unchecked-out`)
        .set(auth())
        .expect(200);
    });

    it('downloads the PDF order breakdown', async () => {
      const res = await api(app)
        .get(`/api/orders/${ORDER}/${BATCH}/breakdown`)
        .set(auth())
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('deletes (voids) the item', () =>
      api(app)
        .delete(`/api/orders/${ORDER}/${BATCH}/items/${serial}`)
        .set(auth())
        .expect(200));
  });
});
