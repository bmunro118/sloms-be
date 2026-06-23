import { defineConfig } from "prisma/config";

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const username = process.env.DB_USERNAME ?? "postgres";
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const database = process.env.DB_DATABASE ?? "slomsdb";

  return `postgresql://${username}:${password}@${host}:${port}/${database}`;
}

export default defineConfig({
  datasource: {
    url: buildDatabaseUrl(),
  },
});
