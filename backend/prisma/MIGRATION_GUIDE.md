# SLOMS Backend — Migration Guide

This guide covers the database migration workflow for the SLOMS backend using Prisma ORM with **PostgreSQL**.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration](#configuration)
3. [Running Migrations](#running-migrations)
4. [Schema Overview](#schema-overview)
5. [Development Workflow](#development-workflow)
6. [Production Deployment](#production-deployment)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL connection string

# 3. Generate Prisma Client
npx prisma generate

# 4. Apply the initial schema
psql -U <user> -d <database> -f prisma/migrations/001_initial_schema/migration.sql

# 5. Seed development data
psql -U <user> -d <database> -f prisma/seed.sql
```

---

## Configuration

### Environment Variable

Set `DATABASE_URL` in your `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/slomsdb
```

### Schema datasource

```prisma
datasource db {
  provider = "postgresql"
}
```

The connection URL is read from `DATABASE_URL` at runtime via `database.config.ts`.

---

## Running Migrations

Migrations are plain SQL files. Apply them directly with `psql`:

```bash
psql -U <user> -d <database> -f prisma/migrations/<migration_folder>/migration.sql
```

After applying a migration, regenerate the Prisma Client if `schema.prisma` changed:

```bash
npx prisma generate
```

### Creating a New Migration

1. Write your SQL changes in a new file under `prisma/migrations/<NNN_description>/migration.sql`
2. Update `schema.prisma` to match
3. Run `npx prisma generate`
4. Apply the SQL to your development database
5. Test, then apply to production

---

## Schema Overview

### Tables

| Table | Prisma Model | Primary Key | Description |
|-------|-------------|-------------|-------------|
| `Users` | `User` | `UserID` | User accounts and authentication |
| `Customers` | `Customer` | `CustomerID` | Customer accounts |
| `CustomerAddress` | `CustomerAddress` | `AddressID` | Customer delivery addresses |
| `Order` | `Order` | `(OrderNumber, OrderBatch)` | Orders |
| `OrderedItems` | `OrderedItem` | `SerialNumber` | Items within orders |
| `VatRates` | `VatRate` | `VatRateID` | VAT rate history |
| `PriceList` | `PriceList` | `ItemID` | Product pricing by band |
| `GlobalSettings` | `GlobalSetting` | `Key` | Application-wide configuration |
| `UserSettings` | `UserSetting` | `(UserID, Key)` | Per-user preferences |
| `Sequences` | `Sequence` | `Key` | Serial number counters |
| `UserAuditLog` | `UserAuditLog` | `AuditID` | Auth event audit trail |

### Relationships

```
User ──(optional)──► Customer
 │
 └──► UserSettings

Customer ──► Orders ──► OrderedItems
         └──► CustomerAddresses
                         ▲
                    Order.deliveryAddress

Order ──► VatRate
```

### VAT Rates

Orders reference a `VatRate` row via `vatRateId`. The active rate is determined by:

```sql
SELECT * FROM "VatRates"
WHERE "ValidFrom" <= CURRENT_DATE
  AND ("ValidTo" IS NULL OR "ValidTo" >= CURRENT_DATE)
ORDER BY "ValidFrom" DESC
LIMIT 1;
```

To change the VAT rate: close the current row with a `ValidTo` date and insert a new row.

---

## Development Workflow

### 1. Edit `schema.prisma`

Add, modify, or remove a model.

### 2. Write the SQL migration

Create `prisma/migrations/<NNN_description>/migration.sql` with the corresponding DDL.

### 3. Regenerate Prisma Client

```bash
npx prisma generate
```

### 4. Apply to local database

```bash
psql -U <user> -d <database> -f prisma/migrations/<NNN_description>/migration.sql
```

### 5. Run the application

```bash
npm run start:dev
```

### 6. Run tests

```bash
npm test
```

---

## Production Deployment

### Checklist

1. Back up the production database
2. Test the migration on a staging environment
3. Verify `DATABASE_URL` is set correctly in production

### Apply Migration

```bash
psql "$DATABASE_URL" -f prisma/migrations/<NNN_description>/migration.sql
```

### Regenerate Client (if deploying new build)

```bash
npx prisma generate
```

---

## Troubleshooting

### Cannot connect to database

- Verify PostgreSQL is running: `pg_isready -h localhost`
- Check `DATABASE_URL` is correctly set in `.env`
- Ensure the database exists: `psql -U postgres -c "\l"`

### Prisma schema validation errors

```bash
npx prisma validate
```

### Client out of sync with schema

```bash
npx prisma generate --force
```

### Reseed development data

```bash
psql -U <user> -d <database> -f prisma/seed.sql
```

---

## Best Practices

1. **Never edit the production database directly** — always use migration files
2. **Keep migrations small and focused** — one concern per migration file
3. **Use descriptive names** — `002_add_vat_rates`, `003_remove_options_table`
4. **Always back up** before applying migrations to production
5. **Never commit `.env`** files containing credentials

---

## Migration History

| Migration | Description |
|-----------|-------------|
| `001_initial_schema` | Complete schema: customers, users (with lockout + must-change-password), audit log, customer addresses, VAT rates, orders, ordered items, sequences, global settings, user settings, price list |
| `002_normalize_price_list` | Replace wide `tblPriceList` table with normalized `tblPriceListItem` / `tblPriceListType` / `tblItemPrice` (drops the wide table) |
| `003_price_list_revisions` | Add `tblPriceListRevision` and `RevisionID` to item prices |
| `004`–`012` | Price audit, voiding, void/voidedBy, audit log, DateStamp→CreatedOn, Orientation→Side, order status, runtime totals, order status history |
| `013_create_pricelist_view` | Recreate `tblPriceList` as a read-only re-pivot VIEW over the normalized tables (active revision) for the Access front-end / legacy reads |

---

**Last Updated**: 2026-06-19
