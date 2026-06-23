# SLOMS Backend — Change Log

## 2026-04-09

### Schema changes
- Migrated database from SQL Server to **PostgreSQL** — all connection strings, types and migration SQL updated accordingly
- Removed `tblTerms` / `Term` model and all associated API endpoints (`/api/terms`)
- Removed `tblOptions` / `Option` model and all associated API endpoints (`/api/options`)
- Removed `LID` column from `tblOrderedItems`
- Renamed `tblSettings` → `tblGlobalSettings`, Prisma model `Setting` → `GlobalSetting`; removed `Type` column
- Added `tblUserSettings` — per-user key/value preferences with composite PK `(UserID, Key)`
- Replaced `tblOrder.VAT DECIMAL` column with `tblOrder.VatRateID INT FK → tblVatRates`
- Added `tblVatRates` table: `VatRateID`, `Rate`, `Label`, `ValidFrom`, `ValidTo`

### API changes
- Removed `/api/terms` endpoints
- Removed `/api/options` endpoints
- Added `/api/vat-rates` endpoints: `GET /`, `GET /current`, `POST /`, `PATCH /:id/close`
- Added `/api/settings/user` endpoints: `GET /user`, `GET /user/:key`, `PUT /user/:key`, `DELETE /user/:key`
- `POST /api/orders` no longer accepts a `vat` field — VAT rate is resolved automatically from the active entry in `tblVatRates`
- `GET /api/orders/:orderNumber/:orderBatch` now includes the `vatRate` object in the response
- Removed `type` field from global settings DTO and entity
- Removed `GET /api/settings?type=` query parameter
