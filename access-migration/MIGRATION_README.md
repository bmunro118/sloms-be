# Access → Postgres data migration

`migrate_access_to_pg.py` loads the operational data from the Access back-end
(`SLOMS_be.accdb`) into the dockerized Postgres `slomsdb`. It is **re-runnable
(idempotent)**: every row is upserted on its primary key, so running it again
against the same source yields the same final state.

## What it migrates

| Source (Access)      | Target (Postgres)     | Notes |
|----------------------|-----------------------|-------|
| `tblCustomers`       | `tblCustomers`        | `DateStamp`→`CreatedOn` |
| `tblCustomerAddress` | `tblCustomerAddress`  | `DateStamp`→`CreatedOn`; rows for missing customers dropped |
| `tblOrder`           | `tblOrder`            | `VAT`(rate)→`VatRateID`; `Status`/`StatusChangedOn` derived; `OrderTotal`/`ItemCount`/`AvgPrice` dropped (computed at runtime); orphan `CustomerAccount`/`DeliveryAddress` NULLed |
| `tblOrderedItems`    | `tblOrderedItems`     | `DateStamp`→`CreatedOn`; `Orientation`→`Side`; `LID` dropped; orphan `ParentOrder`/`ParentBatch` NULLed; NULL/empty `SerialNumber` skipped |
| `tblSequence`        | `tblSequences`        | per-week serial counters (`item-YYYY-WW`) |
| `tblPriceList` (wide) | `tblPriceListType` + `tblPriceListItem` + `tblItemPrice` + `tblPriceListRevision` | 40 band columns unpivoted into one **active** revision `"Access migration (current)"`; the front-end `tblPriceList` re-pivot view reads it |

After loading it ensures any missing VAT rates exist, recomputes order
`Status`, regenerates `tblOrderStatusHistory` (one row per order), and bumps
the `CustomerID` / `AddressID` / `VatRateID` identity sequences past the
migrated max.

It **never** touches `tblUsers`, `tblGlobalSettings`, or the price-list tables,
and it does **not** delete Postgres rows that are absent from Access (load is
additive). For an exact mirror, reseed the DB first
(`psql ... -f ../prisma/seed.sql`) and then run this.

## Prerequisites

- Postgres container running: `docker compose up -d postgres` (in `backend/`).
- Python deps (one-off): `py -3 -m pip install pyodbc "psycopg[binary]"`
- 64-bit "Microsoft Access Driver (*.mdb, *.accdb)" ODBC driver installed.

## Run

```powershell
py -3 migrate_access_to_pg.py                  # full run (~90s, ~1M item rows)
py -3 migrate_access_to_pg.py --dry-run        # do everything, then roll back
py -3 migrate_access_to_pg.py --only customers addresses
py -3 migrate_access_to_pg.py --only pricelist     # just the price list
py -3 migrate_access_to_pg.py --items-limit 5000   # quick smoke test
```

Connection details default to the values in `backend/.env` and the Access
back-end password, and can be overridden via env vars: `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD`, `ACCESS_BE_PATH`, `ACCESS_BE_PWD`.

## Known data quirks (handled automatically)

- 1 ordered item has a NULL `SerialNumber` → skipped.
- ~4,100 ordered items reference an order that doesn't exist → kept, parent link NULLed.
- 1 order references a missing customer → kept, `CustomerAccount` NULLed.
- `Orientation`/`Side` contains dirty historical values (`-`, letters, digits) → passed through as-is.
- `tblPriceList` has 2 duplicate ItemIDs (`EM2112S`, `EM7114CL`) → the last row wins.
- Price columns that are stored as text in Access (`Dispensary`, `New Framework Cost`) are coerced to numbers; blank/non-numeric cells become no price row.
