import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface Operation {
  method: string;
  /** OpenAPI path template, e.g. "/orders/{orderNumber}/{orderBatch}". */
  template: string;
  /** Declared parameters (path + query) for the operation. */
  parameters: { name: string; in: string }[];
}

/**
 * Generate the OpenAPI document from the running app (same builder as main.ts)
 * and flatten it into the list of operations the API actually exposes. This is
 * the source of truth for "every endpoint and parameter" — the coverage guard
 * diffs exercised routes against it, so a new route shows up here automatically.
 *
 * Note: Nest's SwaggerModule does not prepend the global `/api` prefix to paths,
 * so templates are prefix-less (e.g. "/orders"). Match recorded hits with
 * `stripApiPrefix` first.
 */
export function buildOperations(app: INestApplication): Operation[] {
  const config = new DocumentBuilder()
    .setTitle("SLOMS API")
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer" }, "access-token")
    .build();
  const doc = SwaggerModule.createDocument(app, config);

  const ops: Operation[] = [];
  for (const [template, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (pathItem as any)[method];
      if (!op) continue;
      ops.push({
        method,
        template,
        parameters: (op.parameters ?? []).map((p: any) => ({
          name: p.name,
          in: p.in,
        })),
      });
    }
  }
  return ops;
}

/**
 * Strip the global `/api` prefix so matching works regardless of whether the
 * OpenAPI document includes it (it varies by @nestjs/swagger version). Applied
 * to BOTH the template and the recorded hit before comparing.
 */
export function stripApiPrefix(path: string): string {
  return path.replace(/^\/api(?=\/|$)/, "") || "/";
}

/** Turn an OpenAPI path template into an anchored regex for raw-path matching. */
export function templateToRegex(template: string): RegExp {
  const escaped = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
    .replace(/\\\{[^/]+?\\\}/g, "[^/]+"); // {param} → segment matcher
  return new RegExp(`^${escaped}/?$`);
}

/** True if any recorded hit exercises this operation. */
export function isCovered(
  op: Operation,
  hits: { method: string; path: string }[],
): boolean {
  const rx = templateToRegex(stripApiPrefix(op.template));
  return hits.some(
    (h) =>
      h.method.toLowerCase() === op.method &&
      rx.test(stripApiPrefix(h.path)),
  );
}
