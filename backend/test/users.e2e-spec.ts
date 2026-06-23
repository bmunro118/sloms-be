import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/users/entities/role.enum';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { loginAllRoles } from './support/auth';
import { E2E_MARKER } from './support/factories';

/**
 * Users — self-service routes (any authenticated role) plus the Admin-only
 * management surface. Test users are tagged with the E2E marker in their
 * username and removed in cleanup.
 */
const MISSING_ID = 99999999;

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<Role, string>;

  const cleanupUsers = async () => {
    const tagged = await prisma.user.findMany({
      where: { username: { startsWith: E2E_MARKER } },
      select: { userId: true },
    });
    const ids = tagged.map((u) => u.userId);
    if (!ids.length) return;
    // Best-effort: clear dependent rows before the users themselves.
    await prisma.userSetting
      .deleteMany({ where: { userId: { in: ids } } })
      .catch(() => undefined);
    await prisma.userAuditLog
      .deleteMany({ where: { userId: { in: ids } } })
      .catch(() => undefined);
    await prisma.user.deleteMany({ where: { userId: { in: ids } } });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupUsers();
    tokens = await loginAllRoles(app);
  });

  afterAll(async () => {
    await cleanupUsers();
    await app.close();
  });

  const as = (role: Role) => authHeader(tokens[role]);

  // ─── self-service (every authenticated role) ───────────────────────────────
  describe('self-service', () => {
    it('401 without a token on /users/me', () =>
      api(app).get('/api/users/me').expect(401));

    it.each([
      Role.Admin,
      Role.Manager,
      Role.Operative,
      Role.ReadOnly,
      Role.Customer,
    ])('%s can read own profile (passwordHash excluded)', async (role) => {
      const res = await api(app).get('/api/users/me').set(as(role)).expect(200);
      expect(res.body.userId).toBeGreaterThan(0);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects a self password change with too-short newPassword (400)', () =>
      api(app)
        .patch('/api/users/me/password')
        .set(as(Role.ReadOnly))
        .send({ currentPassword: 'whatever', newPassword: 'short' })
        .expect(400));
  });

  // ─── authz: management is Admin-only ────────────────────────────────────────
  describe('authorization (Admin-only management)', () => {
    it.each([
      ['GET', '/api/users'],
      ['GET', '/api/users/audit-log'],
    ])('Manager is denied %s %s (403)', (method, path) =>
      (api(app) as any)
        [method.toLowerCase()](path)
        .set(as(Role.Manager))
        .expect(403),
    );

    it('Admin can list users', () =>
      api(app).get('/api/users?limit=2').set(as(Role.Admin)).expect(200));

    it('Admin can read the audit log with filters', () =>
      api(app)
        .get('/api/users/audit-log?event=LOGIN_SUCCESS&limit=2')
        .set(as(Role.Admin))
        .expect(200));
  });

  // ─── validation (POST /users) ───────────────────────────────────────────────
  describe('validation (POST /users)', () => {
    const create = (body: any) =>
      api(app).post('/api/users').set(as(Role.Admin)).send(body);

    it('rejects a missing username', () =>
      create({ password: 'Password1!' }).expect(400));

    it('rejects a password under MinLength(8)', () =>
      create({ username: `${E2E_MARKER}short`, password: 'short' }).expect(
        400,
      ));

    it('rejects an invalid email', () =>
      create({
        username: `${E2E_MARKER}bademail`,
        password: 'Password1!',
        email: 'not-an-email',
      }).expect(400));

    it('rejects an invalid role enum', () =>
      create({
        username: `${E2E_MARKER}badrole`,
        password: 'Password1!',
        role: 'Wizard',
      }).expect(400));

    it('rejects an unknown property', () =>
      create({
        username: `${E2E_MARKER}x`,
        password: 'Password1!',
        bogus: 1,
      }).expect(400));
  });

  // ─── not found ──────────────────────────────────────────────────────────────
  describe('not found', () => {
    it('GET a missing user → 404', () =>
      api(app).get(`/api/users/${MISSING_ID}`).set(as(Role.Admin)).expect(404));

    it('GET a non-numeric id → 400 (ParseIntPipe)', () =>
      api(app).get('/api/users/abc').set(as(Role.Admin)).expect(400));
  });

  // ─── full lifecycle ─────────────────────────────────────────────────────────
  describe('user management lifecycle', () => {
    let userId: number;
    const username = `${E2E_MARKER}lifecycle`;

    it('creates a user', async () => {
      const res = await api(app)
        .post('/api/users')
        .set(as(Role.Admin))
        .send({
          username,
          password: 'Password1!',
          fullName: 'E2E Lifecycle',
          email: 'e2e.lifecycle@example.com',
          role: 'Operative',
        })
        .expect(201);
      userId = res.body.userId;
      expect(userId).toBeGreaterThan(0);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('fetches the created user by id', () =>
      api(app).get(`/api/users/${userId}`).set(as(Role.Admin)).expect(200));

    it("updates the user's role and the change persists", async () => {
      await api(app)
        .put(`/api/users/${userId}`)
        .set(as(Role.Admin))
        .send({ role: 'Manager' })
        .expect(200);
      const res = await api(app)
        .get(`/api/users/${userId}`)
        .set(as(Role.Admin))
        .expect(200);
      expect(res.body.role).toBe('Manager');
    });

    it('deactivates then reactivates', async () => {
      await api(app)
        .patch(`/api/users/${userId}/deactivate`)
        .set(as(Role.Admin))
        .expect(200);
      await api(app)
        .patch(`/api/users/${userId}/reactivate`)
        .set(as(Role.Admin))
        .expect(200);
    });

    it('unlocks the account', () =>
      api(app)
        .patch(`/api/users/${userId}/unlock`)
        .set(as(Role.Admin))
        .expect(200));

    it('resets the password (Admin, no current password)', () =>
      api(app)
        .patch(`/api/users/${userId}/reset-password`)
        .set(as(Role.Admin))
        .send({ newPassword: 'BrandNew1!' })
        .expect(200));

    it('deletes the user', () =>
      api(app).delete(`/api/users/${userId}`).set(as(Role.Admin)).expect(200));
  });
});
