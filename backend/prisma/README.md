# SLOMS Backend — Prisma Database Schema

This directory contains the Prisma ORM configuration for the SLOMS backend. The schema targets **PostgreSQL** and is managed via raw SQL migrations under `prisma/migrations/`.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (see Environment Variables below)
cp .env.example .env

# 3. Generate Prisma Client
npx prisma generate

# 4. Apply migrations
psql -U <user> -d <database> -f prisma/migrations/001_initial_schema/migration.sql

# 5. Seed test data (development only)
psql -U <user> -d <database> -f prisma/seed.sql
```

---

## Database Tables Overview

| Table | Prisma Model | Primary Key | Description |
|-------|-------------|-------------|-------------|
| `Users` | `User` | `UserID` (auto-increment) | User accounts and authentication |
| `Customers` | `Customer` | `CustomerID` (auto-increment) | Customer accounts |
| `CustomerAddress` | `CustomerAddress` | `AddressID` (auto-increment) | Customer delivery addresses |
| `Order` | `Order` | Composite: `(OrderNumber, OrderBatch)` | Orders |
| `OrderedItems` | `OrderedItem` | `SerialNumber` (9-char string) | Items within orders |
| `VatRates` | `VatRate` | `VatRateID` (auto-increment) | VAT rate history |
| `PriceList` | `PriceList` | `ItemID` (string) | Product pricing by band |
| `GlobalSettings` | `GlobalSetting` | `Key` (string) | Application-wide configuration |
| `UserSettings` | `UserSetting` | Composite: `(UserID, Key)` | Per-user preferences |
| `Sequences` | `Sequence` | `Key` (string) | Serial number counters |
| `UserAuditLog` | `UserAuditLog` | `AuditID` (auto-increment) | Auth event audit trail |

---

## Key Relationships

### User ↔ Customer
- **Type**: Many-to-One (optional)
- **Fields**: `User.linkedCustomerId` → `Customer.customerId`

### User ↔ UserSettings
- **Type**: One-to-Many
- **Fields**: `UserSetting.userId` → `User.userId`

### Customer ↔ Orders
- **Type**: One-to-Many
- **Fields**: `Order.customerAccount` → `Customer.customerId`

### Customer ↔ Addresses
- **Type**: One-to-Many
- **Fields**: `CustomerAddress.customerAccount` → `Customer.customerId`

### Order ↔ OrderedItems
- **Type**: One-to-Many
- **Fields**: `OrderedItem.parentOrder`, `OrderedItem.parentBatch` → `Order.orderNumber`, `Order.orderBatch`

### Order ↔ CustomerAddress (Delivery)
- **Type**: Many-to-One (optional)
- **Fields**: `Order.deliveryAddress` → `CustomerAddress.addressId`

### Order ↔ VatRate
- **Type**: Many-to-One (optional)
- **Fields**: `Order.vatRateId` → `VatRate.vatRateId`
- **Note**: VAT rate is automatically assigned from the active rate at order creation time

---

## VAT Rates

VAT rates are stored in `VatRates` with a validity date range:

- `validFrom` — the date the rate became effective
- `validTo` — the date the rate was superseded (`NULL` = currently active)

The active rate is whichever row has `validFrom <= today` and `validTo IS NULL` (or `validTo >= today`). When a rate changes, close the current row by setting `validTo`, then insert a new row.

---

## Settings

### Global Settings (`GlobalSettings`)
Application-wide key/value configuration. Fields: `Key`, `Val`, `Description`, `Exposed`.  
`Exposed = true` means the setting is readable by all authenticated users; `false` restricts it to Admin.

### User Settings (`UserSettings`)
Per-user key/value preferences. Composite PK of `(UserID, Key)`. No type or exposure concept — values are always strings, accessible only by the owning user.

---

## User Roles

| Role | Description |
|------|-------------|
| `Admin` | Full access including user management and admin-only settings |
| `Manager` | Management-level access |
| `Operative` | Operational staff access |
| `ReadOnly` | Read-only access to all resources |
| `Customer` | Customer portal access (requires a linked customer account) |

---

## Data Types

| Prisma Type | PostgreSQL Equivalent | Usage |
|-------------|----------------------|-------|
| `String` | `VARCHAR(n)` / `TEXT` | Text fields |
| `Int` | `INT` / `SERIAL` | Integer values and IDs |
| `Float` | `DOUBLE PRECISION` | Prices, calculated totals |
| `Decimal(p,s)` | `DECIMAL(p,s)` | VAT rates (precise decimal) |
| `DateTime` | `TIMESTAMP(3)` | Timestamps |
| `Boolean` | `BOOLEAN` | Flags |
| `Date` | `DATE` | VAT rate validity dates |

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/slomsdb` |

---

## Migration Workflow

Migrations are plain SQL files under `prisma/migrations/`. Prisma Client is generated from `schema.prisma`.

```bash
# After modifying schema.prisma, regenerate the client
npx prisma generate

# Apply a new migration manually
psql -U <user> -d <database> -f prisma/migrations/<migration>/migration.sql
```

See `MIGRATION_GUIDE.md` for the full workflow.

---

**Last Updated**: 2026-04-09
