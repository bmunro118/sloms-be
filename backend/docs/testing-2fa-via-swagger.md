# Testing 2FA via Swagger

How to exercise the new-device-gated 2FA flows by hand from the Swagger UI.
See [twofa design notes](#design-recap) at the bottom for what each step proves.

- **Local Swagger:** `http://localhost:3000/api/docs`
- **Stage Swagger:** `https://slomsapi-stage.jollydune-b8782950.uksouth.azurecontainerapps.io/api/docs`

## The one trick: use the "mobile" flow

Web clients (`clientType: "web"`) receive tokens in **HttpOnly cookies**, which the
Swagger UI cannot read or replay between calls. For manual testing, **omit
`clientType` (or set `"mobile"`)** so every response returns its token in the JSON
body. Each step hands you the token for the next step:

1. Read `accessToken` from the response body.
2. Click **Authorize** (top-right padlock), paste the token (no `Bearer ` prefix), Authorize.
3. Call the next endpoint.

Login returns a `status` of `ok | password_change | enroll | 2fa`. `enroll` and
`2fa` tokens are **scoped** — using one on a normal endpoint (e.g. `GET /auth/me`)
returns **403** by design.

## Prerequisites (local/dev)

1. `cd backend && npm run start:dev`, then open `http://localhost:3000/api/docs`.
2. DB migrated + seeded:
   ```bash
   docker exec -i sloms-postgres psql -U postgres -d slomsdb -v ON_ERROR_STOP=1 -f - < prisma/seed.sql
   ```
3. **Keep the server console visible.** With no `ACS_CONNECTION_STRING` set locally,
   email OTP codes are logged instead of sent: `[DEV] Email OTP for …: 123456`.

> Swagger never sends a trusted-device token, so every Swagger login looks like a
> "new device" and triggers the challenge — exactly what we want to test.

---

## Path A — Customer email OTP (quickest; no app, no secret)

Seed customer `customer1@example.com` / `customer123` is enrolled on the email channel.

1. **`POST /api/auth/login`**
   ```json
   { "username": "customer1@example.com", "password": "customer123" }
   ```
   → `status: "2fa"`, `twoFactorMethod: "email"`, `accessToken` = `twofa_pending`.
   **A 6-digit code is printed to the server console.**
2. **Authorize** with that `accessToken`.
3. **`POST /api/auth/verify-2fa`**
   ```json
   { "code": "<code from console>", "rememberDevice": true }
   ```
   → `status: "ok"` + full `accessToken` (+ `deviceToken`).
4. Re-**Authorize** with the full token → **`GET /api/auth/me`** → 200. ✅
5. (Optional) **`POST /api/auth/2fa/resend`** with the *pending* token → `429` inside
   the 60s cooldown, otherwise a fresh code in the console.

---

## Path B — Staff TOTP (authenticator app)

Seed staff are enrolled but hold no real TOTP secret, so reset one to "unenrolled"
to demo the full enrollment flow:

```bash
docker exec -i sloms-postgres psql -U postgres -d slomsdb -c \
"UPDATE \"Users\" SET \"TwoFactorEnabled\"=false,\"TotpSecret\"=NULL,\"MustChangePassword\"=false WHERE \"Username\"='operative'; \
 DELETE FROM \"TrustedDevices\" WHERE \"UserID\"=(SELECT \"UserID\" FROM \"Users\" WHERE \"Username\"='operative');"
```

Needs an authenticator app (Google Authenticator, Authy, 1Password, …).

1. **`POST /api/auth/login`** → `{ "username": "operative", "password": "operative123" }`
   → `status: "enroll"`, `accessToken` = `twofa_enroll`.
2. **Authorize** with it.
3. **`POST /api/auth/2fa/setup`** → returns `otpauthUrl` + `qrDataUrl`.
   Add the `otpauthUrl` to your authenticator (or paste `qrDataUrl` into a browser
   address bar to render the QR and scan it).
4. **`POST /api/auth/2fa/enable`** → `{ "code": "<6 digits>", "rememberDevice": true }`
   → `status: "ok"`, full `accessToken`, plus **`recoveryCodes` — save one**.
5. Re-**Authorize** with the full token → **`GET /api/auth/devices`** lists the trusted device.
6. **New-device challenge:** **`POST /api/auth/login`** (operative) again → now `status: "2fa"`.
   Authorize with the pending token → **`POST /api/auth/verify-2fa`** `{ "code": "<current app code>" }` → `status: "ok"`.
7. **Recovery code:** log in again → on the challenge, `verify-2fa` with
   `{ "code": "<a saved recovery code>" }` → `status: "ok"` (single-use).
8. **`POST /api/auth/2fa/disable`** (full token) → `{ "code": "<current app code>" }`
   → 2FA off + all devices revoked.

---

## Expected results at each gate

| Situation | Result |
|---|---|
| Full token on a normal endpoint | 200 |
| `enroll` / `2fa` scoped token on a normal endpoint | 403 |
| Wrong / expired code on `verify-2fa` or `enable` | 401 |
| `2fa/resend` within cooldown | 429 |

## Prod differences

Same flows against the prod Swagger, but:

- **Email OTP is really delivered** via Azure Communication Services (no console
  code) — use a customer whose username is a mailbox you can read.
- TOTP is identical (authenticator app).
- Prod is not locally seeded and you can't reset users via local `psql`; you need a
  real admin to create test users.

## Design recap

- "New device" = a login without a valid trusted-device token (random opaque token,
  stored only as a SHA-256 hash; web cookie `device_id`, mobile header `X-Device-Token`).
  Trust slides forward 30 days on each use.
- Mandatory enrollment is gated by the `twofa_enroll` scope; the second-factor login
  step uses the `twofa_pending` scope. Staff = TOTP, customers = email OTP.
