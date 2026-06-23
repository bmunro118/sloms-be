import { INestApplication } from "@nestjs/common";
import { Role } from "../../src/users/entities/role.enum";
import { api } from "./http";

/**
 * Seed logins, one per role. Passwords are the documented seed credentials
 * (see the "Login summary" header in prisma/seed.sql). The bcrypt hashes in the
 * seed MUST match these — if a login here 401s, fix the seed, not the test.
 */
export const SEED_USERS: Record<Role, { username: string; password: string }> = {
  [Role.Admin]: { username: "admin", password: "admin123" },
  [Role.Manager]: { username: "manager", password: "manager123" },
  [Role.Operative]: { username: "operative", password: "operative123" },
  [Role.ReadOnly]: { username: "readonly", password: "readonly123" },
  [Role.Customer]: { username: "customer1", password: "customer123" },
};

/** Log a single user in (mobile flow → token in the response body). */
export async function login(
  app: INestApplication,
  username: string,
  password: string,
): Promise<string> {
  const res = await api(app)
    .post("/api/auth/login")
    .send({ username, password })
    .expect(200);
  const token = res.body.accessToken;
  if (!token) {
    throw new Error(`login for "${username}" returned no accessToken`);
  }
  return token;
}

/**
 * Log in every seed role once and return a `tokens[role]` map. Cache the result
 * in a spec's beforeAll so authz cases (right role 2xx vs wrong role 403) can be
 * asserted across the whole controller without re-authenticating per test.
 */
export async function loginAllRoles(
  app: INestApplication,
): Promise<Record<Role, string>> {
  const tokens = {} as Record<Role, string>;
  for (const role of Object.values(Role)) {
    const { username, password } = SEED_USERS[role];
    tokens[role] = await login(app, username, password);
  }
  return tokens;
}
