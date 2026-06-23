import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getDatabaseUrl } from './config/database.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // Global API prefix — all routes will be under /api
  app.setGlobalPrefix('api');

  // Enable automatic request body validation via class-validator decorators
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in the DTO
      forbidNonWhitelisted: true, // Throw if unknown properties are sent
      transform: true, // Auto-transform payloads to DTO class instances
      transformOptions: {
        enableImplicitConversion: true, // Convert primitive types automatically
      },
    }),
  );

  // Enable CORS for frontend access
  app.enableCors();

  // ─── Swagger / OpenAPI ────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SLOMS API')
    .setDescription(
      'REST API for the SLOMS (Sonic Labs Order Management System) backend. ' +
        'All protected endpoints require a Bearer JWT obtained from POST /api/auth/login.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT access token',
        in: 'header',
      },
      'access-token', // <-- this name is referenced by @ApiBearerAuth('access-token')
    )
    .addTag('auth', 'Authentication — login and session info')
    .addTag('users', 'User management and self-service profile')
    .addTag('customers', 'Customer accounts and delivery addresses')
    .addTag('orders', 'Orders and ordered items')
    .addTag('price-list', 'Product price list')
    .addTag('settings', 'Global and user settings')
    .addTag('vat-rates', 'VAT rate history and active rate')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Swagger UI available at /api/docs
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // Keep the token across page refreshes
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
  // ─────────────────────────────────────────────────────────────────────────

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const databaseUrl = getDatabaseUrl();
  // Mask the password in the connection string for security
  const maskedConnectionUrl = databaseUrl.replace(
    /(:\/\/[^:]+:)[^@]+(@)/,
    '$1********$2',
  );

  console.log(`SLOMS API is running on:  http://localhost:${port}/api`);
  console.log(`Swagger UI available at:  http://localhost:${port}/api/docs`);
  console.log(`Connected to: ${maskedConnectionUrl}`);
}
bootstrap();
