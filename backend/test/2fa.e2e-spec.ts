import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import { createTestApp } from './support/app';
import { api, authHeader } from './support/http';
import { login, e2eDeviceToken } from './support/auth';

/**
 * End-to-end 2FA: a fresh staff user is driven through the full mandatory
 * flow — forced password change → TOTP enrollment → device trust → new-device
 * challenge → recovery code → disable — plus the email-OTP resend path. This
 * exercises every /auth/2fa/* and /auth/devices endpoint.
 */
describe('2FA (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  const USERNAME = 'tfae2e';
  const INIT_PASSWORD = 'InitPass1!';
  const NEW_PASSWORD = 'NewPass1!';

  let totpSecret: string;
  let fullToken: string;
  let recoveryCodes: string[];

  const secretFromOtpauth = (url: string) =>
    new URL(url).searchParams.get('secret') as string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    adminToken = await login(app, 'admin', 'admin123');

    await api(app)
      .post('/api/users')
      .set(authHeader(adminToken))
      .send({
        username: USERNAME,
        password: INIT_PASSWORD,
        role: 'Operative',
        fullName: 'TFA E2E',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('forces a password change on first login', async () => {
    const res = await api(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: INIT_PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('password_change');

    const changed = await api(app)
      .post('/api/auth/change-password')
      .set(authHeader(res.body.accessToken))
      .send({ newPassword: NEW_PASSWORD })
      .expect(200);
    // mustChangePassword cleared, but 2FA still not enrolled → enroll gate
    expect(changed.body.status).toBe('enroll');
    expect(changed.body.twoFactorMethod).toBe('totp');
  });

  it('enrolls via TOTP and issues a full token + recovery codes', async () => {
    const login1 = await api(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: NEW_PASSWORD })
      .expect(200);
    expect(login1.body.status).toBe('enroll');
    const enrollToken = login1.body.accessToken;

    const setup = await api(app)
      .post('/api/auth/2fa/setup')
      .set(authHeader(enrollToken))
      .expect(201);
    expect(setup.body.method).toBe('totp');
    expect(setup.body.qrDataUrl).toContain('data:image');
    totpSecret = secretFromOtpauth(setup.body.otpauthUrl);

    const enable = await api(app)
      .post('/api/auth/2fa/enable')
      .set(authHeader(enrollToken))
      .send({ code: authenticator.generate(totpSecret), rememberDevice: true })
      .expect(200);
    expect(enable.body.status).toBe('ok');
    expect(enable.body.recoveryCodes).toHaveLength(8);
    fullToken = enable.body.accessToken;
    recoveryCodes = enable.body.recoveryCodes;
  });

  it('lists the trusted device created during enrollment', async () => {
    const res = await api(app)
      .get('/api/auth/devices')
      .set(authHeader(fullToken))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('challenges 2FA on a new device and verifies a TOTP code', async () => {
    const challenge = await api(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: NEW_PASSWORD })
      .expect(200);
    expect(challenge.body.status).toBe('2fa');

    const verified = await api(app)
      .post('/api/auth/verify-2fa')
      .set(authHeader(challenge.body.accessToken))
      .send({ code: authenticator.generate(totpSecret) })
      .expect(200);
    expect(verified.body.status).toBe('ok');
    expect(verified.body.accessToken).toBeDefined();
  });

  it('accepts a recovery code at the challenge', async () => {
    const challenge = await api(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: NEW_PASSWORD })
      .expect(200);

    const verified = await api(app)
      .post('/api/auth/verify-2fa')
      .set(authHeader(challenge.body.accessToken))
      .send({ code: recoveryCodes[0] })
      .expect(200);
    expect(verified.body.status).toBe('ok');
  });

  it('revokes a single device and then all devices', async () => {
    const list = await api(app)
      .get('/api/auth/devices')
      .set(authHeader(fullToken))
      .expect(200);
    const deviceId = list.body[0].id;

    await api(app)
      .delete(`/api/auth/devices/${deviceId}`)
      .set(authHeader(fullToken))
      .expect(200);

    const all = await api(app)
      .delete('/api/auth/devices')
      .set(authHeader(fullToken))
      .expect(200);
    expect(all.body).toHaveProperty('revoked');
  });

  it('disables 2FA with a valid code', async () => {
    await api(app)
      .post('/api/auth/2fa/disable')
      .set(authHeader(fullToken))
      .send({ code: authenticator.generate(totpSecret) })
      .expect(200);
  });

  it('rate-limits an email-OTP resend during the customer challenge', async () => {
    // Customer uses email 2FA; logging in from a new device sends a code, so an
    // immediate resend is within the cooldown window → 429.
    const challenge = await api(app)
      .post('/api/auth/login')
      .send({ username: 'customer1@example.com', password: 'customer123' })
      .expect(200);
    expect(challenge.body.status).toBe('2fa');
    expect(challenge.body.twoFactorMethod).toBe('email');

    await api(app)
      .post('/api/auth/2fa/resend')
      .set(authHeader(challenge.body.accessToken))
      .expect(429);
  });

  it('still trusts the seeded device (sanity)', async () => {
    const res = await api(app)
      .post('/api/auth/login')
      .set('x-device-token', e2eDeviceToken('admin'))
      .send({ username: 'admin', password: 'admin123' })
      .expect(200);
    expect(res.body.status).toBe('ok');
  });
});
