import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { recordHit } from "./coverage";

type Method = "get" | "post" | "put" | "patch" | "delete";

/**
 * supertest wrapped so every call records the route it hits for the
 * coverage guard. Use exactly like supertest:
 *
 *   await api(app).get("/api/orders").set(authHeader(token)).expect(200);
 *
 * `path` should always start with the `/api` global prefix.
 */
export function api(app: INestApplication) {
  const server = app.getHttpServer();
  const wrap =
    (method: Method) =>
    (path: string): request.Test => {
      recordHit(method, path);
      return request(server)[method](path);
    };
  return {
    get: wrap("get"),
    post: wrap("post"),
    put: wrap("put"),
    patch: wrap("patch"),
    delete: wrap("delete"),
  };
}

/** Bearer auth header helper. */
export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
