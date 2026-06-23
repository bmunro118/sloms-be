import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Boot a Nest application configured identically to the production bootstrap in
 * src/main.ts (global `/api` prefix, the strict ValidationPipe, cookie-parser).
 *
 * Keeping this in one place means every e2e spec exercises the exact same HTTP
 * pipeline as production — if main.ts changes, the tests change with it.
 *
 * Requires the dev Postgres up (docker compose up -d postgres) and seeded, with
 * DATABASE_URL set (loaded from .env by ConfigModule).
 */
export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}
