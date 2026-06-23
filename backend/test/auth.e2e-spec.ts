import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { api } from './support/http';
import { authHeader } from './support/http';

/**
 * Auth — login (mobile token vs web cookie), the /me session echo, and the
 * scoped change-password endpoint. The forced-change flow needs a short-lived
 * password_change token that seed users don't have, so it's covered via its
 * guard rejecting an ordinary/absent token (the route is still exercised).
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('returns a token to a mobile client on valid credentials', async () => {
      const res = await api(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'admin123' })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.role).toBe('Admin');
    });

    it('sets a cookie (not a body token) for a web client', async () => {
      const res = await api(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'admin123', clientType: 'web' })
        .expect(200);
      expect(res.body.accessToken).toBeUndefined();
      const raw = res.headers['set-cookie'] ?? [];
      const cookies = Array.isArray(raw) ? raw : [raw];
      expect(cookies.join(';')).toMatch(/access_token=/);
    });

    it('rejects a wrong password with 401', () =>
      api(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401));

    it('rejects an unknown user with 401', () =>
      api(app)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'whatever' })
        .expect(401));

    it('rejects a missing password with 401 (LocalAuthGuard runs before the body pipe)', () =>
      api(app).post('/api/auth/login').send({ username: 'admin' }).expect(401));

    it('rejects an invalid clientType with 400', () =>
      api(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin123',
          clientType: 'desktop',
        })
        .expect(400));
  });

  describe('GET /auth/me', () => {
    it('401 without a token', () => api(app).get('/api/auth/me').expect(401));

    it('echoes the session for an authenticated user', async () => {
      const login = await api(app)
        .post('/api/auth/login')
        .send({ username: 'manager', password: 'manager123' })
        .expect(200);
      const res = await api(app)
        .get('/api/auth/me')
        .set(authHeader(login.body.accessToken))
        .expect(200);
      expect(res.body.username).toBe('manager');
      expect(res.body.role).toBe('Manager');
    });
  });

  describe('POST /auth/change-password', () => {
    it('401 without the scoped password-change token', () =>
      api(app)
        .post('/api/auth/change-password')
        .send({ newPassword: 'WhateverNew1!' })
        .expect(401));

    it('rejects an ordinary access token (wrong scope) with 401', async () => {
      const login = await api(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'admin123' })
        .expect(200);
      await api(app)
        .post('/api/auth/change-password')
        .set(authHeader(login.body.accessToken))
        .send({ newPassword: 'WhateverNew1!' })
        .expect(401);
    });
  });
});
