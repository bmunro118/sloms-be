import { registerAs } from "@nestjs/config";

export type DatabaseConfig = {
  url: string;
};

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
}

export default registerAs("database", (): DatabaseConfig => ({
  url: getDatabaseUrl(),
}));
