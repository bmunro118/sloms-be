import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/users/entities/role.enum';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { loginAllRoles } from './support/auth';
import { cleanupE2E } from './support/factories';

/**
 * Stats — read-only analytics for staff (ReadOnly / Manager / Admin). Two
 * endpoints, exercised across the standard axes:
 *
 *   auth      — no token → 401
 *   authz     — Operative/Customer → 403; ReadOnly → 2xx
 *   happy     — valid request → 2xx and the expected body shape
 *   validation— bad/missing fields and unknown props → 400
 *
 * Both endpoints are read-only (no writes), so there are no fixtures to clean up
 * beyond the shared marker sweep, and no not-found axis (no path params).
 * Queries target seeded customers (ACC001 / CustomerID 1); assertions check
 * shape, not figures, so they hold regardless of seeded order volume.
 */
describe('Stats (e2e)', () => {
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

  // ─── GET /stats/timeseries ──────────────────────────────────────────────────
  describe('GET /stats/timeseries', () => {
    const path = '/api/stats/timeseries';

    // auth
    it('rejects an unauthenticated request with 401', () =>
      api(app).get(`${path}?bucket=year`).expect(401));

    // authz
    it('Operative is denied (403 — staff analytics roles only)', () =>
      api(app).get(`${path}?bucket=year`).set(as(Role.Operative)).expect(403));

    it('Customer is denied (403)', () =>
      api(app).get(`${path}?bucket=year`).set(as(Role.Customer)).expect(403));

    it('ReadOnly is allowed (200)', () =>
      api(app).get(`${path}?bucket=year`).set(as(Role.ReadOnly)).expect(200));

    // happy
    it('returns a bucketed series with all measures', async () => {
      const res = await api(app)
        .get(`${path}?bucket=year`)
        .set(as(Role.Admin))
        .expect(200);
      expect(res.body.bucket).toBe('year');
      expect(res.body.metric).toBe('revenue');
      expect(typeof res.body.from).toBe('string');
      expect(typeof res.body.to).toBe('string');
      expect(Array.isArray(res.body.series)).toBe(true);
      for (const point of res.body.series) {
        expect(point).toEqual(
          expect.objectContaining({
            period: expect.any(String),
            periodStart: expect.any(String),
            revenue: expect.any(Number),
            orders: expect.any(Number),
            items: expect.any(Number),
            avgPrice: expect.any(Number),
          }),
        );
      }
    });

    it('honours an explicit window, metric and customer filter', async () => {
      const res = await api(app)
        .get(
          `${path}?bucket=month&metric=orders&from=2025-01-01&to=2025-12-31&customerId=1`,
        )
        .set(as(Role.Manager))
        .expect(200);
      expect(res.body.bucket).toBe('month');
      expect(res.body.metric).toBe('orders');
      expect(res.body.from).toBe('2025-01-01');
    });

    // validation
    it('rejects a missing bucket (400)', () =>
      api(app).get(path).set(as(Role.Admin)).expect(400));

    it('rejects an invalid bucket (400)', () =>
      api(app).get(`${path}?bucket=decade`).set(as(Role.Admin)).expect(400));

    it('rejects an invalid metric (400)', () =>
      api(app)
        .get(`${path}?bucket=year&metric=profit`)
        .set(as(Role.Admin))
        .expect(400));

    it('rejects a malformed from date (400)', () =>
      api(app)
        .get(`${path}?bucket=year&from=not-a-date`)
        .set(as(Role.Admin))
        .expect(400));

    it('rejects an unknown query property (400 — forbidNonWhitelisted)', () =>
      api(app)
        .get(`${path}?bucket=year&bogus=1`)
        .set(as(Role.Admin))
        .expect(400));
  });

  // ─── POST /stats/builder ────────────────────────────────────────────────────
  describe('POST /stats/builder', () => {
    const path = '/api/stats/builder';
    const window = { from: '2025-01-01', to: '2025-12-31' };

    // auth
    it('rejects an unauthenticated request with 401', () =>
      api(app)
        .post(path)
        .send({ customerIds: [1], ...window })
        .expect(401));

    // authz
    it('Operative is denied (403)', () =>
      api(app)
        .post(path)
        .set(as(Role.Operative))
        .send({ customerIds: [1], ...window })
        .expect(403));

    it('Customer is denied (403)', () =>
      api(app)
        .post(path)
        .set(as(Role.Customer))
        .send({ customerIds: [1], ...window })
        .expect(403));

    // happy
    it('ReadOnly can request a breakdown by customer id (201)', async () => {
      const res = await api(app)
        .post(path)
        .set(as(Role.ReadOnly))
        .send({ customerIds: [1], ...window })
        .expect(201);
      expect(res.body.filters).toEqual(
        expect.objectContaining({
          customerIds: [1],
          from: window.from,
          to: window.to,
          groupBy: 'model',
        }),
      );
      expect(res.body.totals).toEqual(
        expect.objectContaining({
          revenueTotal: expect.any(Number),
          orderCount: expect.any(Number),
          itemCount: expect.any(Number),
          avgPrice: expect.any(Number),
          avgItemsPerOrder: expect.any(Number),
        }),
      );
      expect(Array.isArray(res.body.rows)).toBe(true);
    });

    it('resolves customers by account number and groups by category (201)', async () => {
      const res = await api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ accountNumbers: ['ACC001'], ...window, groupBy: 'category' })
        .expect(201);
      expect(res.body.filters.groupBy).toBe('category');
      // ACC001 → CustomerID 1 was resolved.
      expect(res.body.filters.customerIds).toContain(1);
    });

    // validation
    it('rejects when no customer is identified (400)', () =>
      api(app).post(path).set(as(Role.Admin)).send(window).expect(400));

    it('rejects a missing "to" date (400)', () =>
      api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ customerIds: [1], from: window.from })
        .expect(400));

    it('rejects a malformed date (400)', () =>
      api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ customerIds: [1], from: 'nope', to: window.to })
        .expect(400));

    it('rejects an empty accountNumbers array (400 — ArrayNotEmpty)', () =>
      api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ accountNumbers: [], ...window })
        .expect(400));

    it('rejects an invalid groupBy (400)', () =>
      api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ customerIds: [1], ...window, groupBy: 'supplier' })
        .expect(400));

    it('rejects an unknown property (400 — forbidNonWhitelisted)', () =>
      api(app)
        .post(path)
        .set(as(Role.Admin))
        .send({ customerIds: [1], ...window, bogus: 1 })
        .expect(400));
  });
});
