#!/usr/bin/env python3
"""
Re-runnable ETL: SLOMS Access back-end  ->  dockerized Postgres (slomsdb).

Loads the operational data (customers, addresses, orders, ordered items),
plus the bits the operational data depends on (VAT rates, serial-number
sequences), from the split-DB Access back-end into the Prisma/Postgres schema.

It is IDEMPOTENT: every row is upserted on its primary key, so running it
again against the same source yields the same final state. It does NOT delete
Postgres rows that are absent from Access, and it never touches tblUsers,
tblGlobalSettings or the price-list tables (those are managed elsewhere).

Source -> target mapping highlights
-----------------------------------
  tblCustomers        : DateStamp        -> CreatedOn  (rest 1:1, ContactMobille typo kept)
  tblCustomerAddress  : DateStamp        -> CreatedOn
  tblOrder            : DateStamp        -> CreatedOn
                        VAT (rate)       -> VatRateID   (looked up / created in tblVatRates)
                        OrderTotal/ItemCount/AvgPrice : DROPPED (computed at runtime now)
                        Status/StatusChangedOn        : DERIVED (mirrors computeOrderStatus)
                        CustomerAccount / DeliveryAddress : NULLed when they point at a
                                                            non-existent customer/address (FK safety)
  tblOrderedItems     : DateStamp        -> CreatedOn
                        Orientation      -> Side
                        LID              : DROPPED (computed at runtime now)
                        ParentOrder/Batch: NULLed for orphan items (no matching order)
                        rows with NULL/empty SerialNumber are skipped (SerialNumber is the PK)
  tblSequence         : SeqName -> Key, NextVal -> Counter  (into tblSequences)
  tblPriceList (wide) -> tblPriceListType + tblPriceListItem + tblItemPrice + tblPriceListRevision
                        the 41 band columns are unpivoted into one active revision
                        ("Access migration (current)"); duplicate ItemIDs keep the last row

After loading, the Postgres identity sequences for CustomerID / AddressID /
VatRateID are bumped past the migrated max, and tblOrderStatusHistory is
regenerated (one row per order) so the history UI is populated.

Usage
-----
  py -3 migrate_access_to_pg.py                 # full run
  py -3 migrate_access_to_pg.py --only orders items
  py -3 migrate_access_to_pg.py --items-limit 5000   # quick smoke test
  py -3 migrate_access_to_pg.py --dry-run            # roll back instead of commit

Connection defaults come from the env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
and ACCESS_BE_PATH/ACCESS_BE_PWD) and can be overridden with CLI flags.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import pyodbc
import psycopg

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------
ACCESS_BE_PATH = os.environ.get("ACCESS_BE_PATH", os.path.join(HERE, "SLOMS_be.accdb"))
ACCESS_BE_PWD = os.environ.get("ACCESS_BE_PWD", "$0n1c")
ACCESS_DRIVER = os.environ.get("ACCESS_DRIVER", "Microsoft Access Driver (*.mdb, *.accdb)")

PG = dict(
    host=os.environ.get("PGHOST", "localhost"),
    port=int(os.environ.get("PGPORT", "5433")),
    dbname=os.environ.get("PGDATABASE", "slomsdb"),
    user=os.environ.get("PGUSER", "postgres"),
    password=os.environ.get("PGPASSWORD", "postgres"),
)

FETCH = 5000  # rows per fetchmany batch while streaming into COPY

# Order in which tables are loaded (respects FKs).
TABLE_ORDER = ["customers", "addresses", "vatrates", "orders", "items", "sequences", "pricelist"]

# Stable name for the revision the current Access price list is loaded into, so
# re-runs reuse (and overwrite) it instead of piling up new revisions.
REVISION_NAME = "Access migration (current)"

# The 41 price-band columns of the wide Access tblPriceList, in display order.
# These become tblPriceListType."Name" values (matched verbatim by the
# tblPriceList re-pivot view), so the strings must stay exactly as-is.
BANDS = (
    ["Dispensary", "Specsavers", "Specsavers Band 2023", "B1", "B2", "B3", "B4",
     "5%", "6%", "10%", "50%", "Swindon", "HealthScreen&Hear4u", "StAnns&Whittington"]
    + [f"NHS Band {i}" for i in range(1, 25)]
    + ["NHS Band 24 Discount", "New Framework Cost"]
)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Generic stage-and-upsert helper
# ---------------------------------------------------------------------------
def stage_copy(pg_cur, acc_cur, *, stage_name, stage_ddl, copy_cols, select_sql,
               transform=None, limit=None):
    """COPY rows from an Access query into a fresh Postgres temp table.

    Returns the number of rows copied.
    """
    pg_cur.execute(f'DROP TABLE IF EXISTS {stage_name}')
    pg_cur.execute(stage_ddl)

    acc_cur.execute(select_sql)
    cols = ", ".join(f'"{c}"' for c in copy_cols)
    copy_sql = f'COPY {stage_name} ({cols}) FROM STDIN'

    n = 0
    with pg_cur.copy(copy_sql) as cp:
        while True:
            rows = acc_cur.fetchmany(FETCH)
            if not rows:
                break
            for r in rows:
                cp.write_row(transform(r) if transform else tuple(r))
                n += 1
                if limit and n >= limit:
                    break
            if limit and n >= limit:
                break
    return n


def as_bool(v):
    """Access BIT comes back as bool already, but be defensive about ints."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return bool(int(v))


# ---------------------------------------------------------------------------
# Per-table migrations
# ---------------------------------------------------------------------------
def migrate_customers(pg, acc, limit=None):
    select = """
        SELECT [CustomerID],[AccountNumber],[CentreNumber],[CompanyName],
               [InvBuildingName],[InvAddressLn1],[InvAddressLn2],[InvTownOrCity],
               [InvCounty],[InvPostCode],[ContactName],[ContactEmail],[ReportEmail],
               [ContactPhone],[ContactMobille],[ContactFax],[Band],[DateStamp],
               [Suspended],[SuspendedOn]
        FROM tblCustomers
    """
    ddl = """
        CREATE TEMP TABLE stg_customers (
            "CustomerID" int, "AccountNumber" text, "CentreNumber" text,
            "CompanyName" text, "InvBuildingName" text, "InvAddressLn1" text,
            "InvAddressLn2" text, "InvTownOrCity" text, "InvCounty" text,
            "InvPostCode" text, "ContactName" text, "ContactEmail" text,
            "ReportEmail" text, "ContactPhone" text, "ContactMobille" text,
            "ContactFax" text, "Band" text, "CreatedOn" timestamp,
            "Suspended" boolean, "SuspendedOn" timestamp
        )
    """
    copy_cols = ["CustomerID", "AccountNumber", "CentreNumber", "CompanyName",
                 "InvBuildingName", "InvAddressLn1", "InvAddressLn2", "InvTownOrCity",
                 "InvCounty", "InvPostCode", "ContactName", "ContactEmail", "ReportEmail",
                 "ContactPhone", "ContactMobille", "ContactFax", "Band", "CreatedOn",
                 "Suspended", "SuspendedOn"]

    def tf(r):
        r = list(r)
        r[18] = as_bool(r[18])  # Suspended
        return tuple(r)

    n = stage_copy(pg, acc, stage_name="stg_customers", stage_ddl=ddl,
                   copy_cols=copy_cols, select_sql=select, transform=tf, limit=limit)

    cols = ", ".join(f'"{c}"' for c in copy_cols)
    updates = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in copy_cols if c != "CustomerID")
    pg.execute(f"""
        INSERT INTO "Customers" ({cols})
        SELECT {cols} FROM stg_customers
        ON CONFLICT ("CustomerID") DO UPDATE SET {updates}
    """)
    return n


def migrate_addresses(pg, acc, limit=None):
    select = """
        SELECT [AddressID],[CustomerAccount],[SiteCompanyName],[DelBuildingName],
               [DelAddressLn1],[DelAddressLn2],[DelTownOrCity],[DelCounty],[DelPostCode],
               [SiteContactName],[SiteContactEmail],[SiteContactPhone],[SiteContactMobille],
               [SiteContactFax],[DefaultAddress],[Void],[DateStamp]
        FROM tblCustomerAddress
    """
    ddl = """
        CREATE TEMP TABLE stg_addresses (
            "AddressID" int, "CustomerAccount" int, "SiteCompanyName" text,
            "DelBuildingName" text, "DelAddressLn1" text, "DelAddressLn2" text,
            "DelTownOrCity" text, "DelCounty" text, "DelPostCode" text,
            "SiteContactName" text, "SiteContactEmail" text, "SiteContactPhone" text,
            "SiteContactMobille" text, "SiteContactFax" text,
            "DefaultAddress" boolean, "Void" boolean, "CreatedOn" timestamp
        )
    """
    copy_cols = ["AddressID", "CustomerAccount", "SiteCompanyName", "DelBuildingName",
                 "DelAddressLn1", "DelAddressLn2", "DelTownOrCity", "DelCounty", "DelPostCode",
                 "SiteContactName", "SiteContactEmail", "SiteContactPhone", "SiteContactMobille",
                 "SiteContactFax", "DefaultAddress", "Void", "CreatedOn"]

    def tf(r):
        r = list(r)
        r[14] = as_bool(r[14])  # DefaultAddress
        r[15] = as_bool(r[15])  # Void
        return tuple(r)

    n = stage_copy(pg, acc, stage_name="stg_addresses", stage_ddl=ddl,
                   copy_cols=copy_cols, select_sql=select, transform=tf, limit=limit)

    # Drop addresses pointing at a customer that does not exist (FK safety).
    insert_cols = ", ".join(f'"{c}"' for c in copy_cols)
    updates = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in copy_cols if c != "AddressID")
    pg.execute(f"""
        INSERT INTO "CustomerAddress" ({insert_cols})
        SELECT {insert_cols} FROM stg_addresses s
        WHERE s."CustomerAccount" IS NULL
           OR EXISTS (SELECT 1 FROM "Customers" c WHERE c."CustomerID" = s."CustomerAccount")
        ON CONFLICT ("AddressID") DO UPDATE SET {updates}
    """)
    return n


def ensure_vat_rates(pg, acc):
    """Make sure tblVatRates has a row for every distinct order VAT rate.

    Existing rows (e.g. the seeded 20.00) are left untouched; only missing
    rates are inserted, so VatRateID values stay stable across runs.
    """
    acc.execute("SELECT DISTINCT [VAT] FROM tblOrder WHERE [VAT] IS NOT NULL")
    src_rates = sorted({row[0] for row in acc.fetchall()})

    pg.execute('SELECT "Rate" FROM "VatRates"')
    have = {row[0] for row in pg.fetchall()}

    inserted = 0
    for rate in src_rates:
        if rate in have:
            continue
        pg.execute(
            'INSERT INTO "VatRates" ("Rate","Label","ValidFrom","ValidTo") '
            "VALUES (%s, %s, DATE '2000-01-01', NULL)",
            (rate, f"VAT {rate}%"),
        )
        inserted += 1
    return inserted


def migrate_orders(pg, acc, limit=None):
    select = """
        SELECT [OrderNumber],[OrderBatch],[CustomerAccount],[CustomerRef],[OrderContact],
               [DeliveryAddress],[ReceivedOn],[DispatchedOn],[VAT],[PriceBand],[DateStamp],
               [DispatchDateStamp],[Void],[VoidDateStamp]
        FROM tblOrder
    """
    ddl = """
        CREATE TEMP TABLE stg_orders (
            "OrderNumber" int, "OrderBatch" int, "CustomerAccount" int,
            "CustomerRef" text, "OrderContact" text, "DeliveryAddress" int,
            "ReceivedOn" timestamp, "DispatchedOn" timestamp, "VAT" numeric,
            "PriceBand" text, "CreatedOn" timestamp, "DispatchDateStamp" timestamp,
            "Void" boolean, "VoidDateStamp" timestamp
        )
    """
    copy_cols = ["OrderNumber", "OrderBatch", "CustomerAccount", "CustomerRef", "OrderContact",
                 "DeliveryAddress", "ReceivedOn", "DispatchedOn", "VAT", "PriceBand", "CreatedOn",
                 "DispatchDateStamp", "Void", "VoidDateStamp"]

    def tf(r):
        r = list(r)
        r[12] = as_bool(r[12])  # Void
        return tuple(r)

    n = stage_copy(pg, acc, stage_name="stg_orders", stage_ddl=ddl,
                   copy_cols=copy_cols, select_sql=select, transform=tf, limit=limit)

    # FK-safe + derived columns. Status here is provisional (Voided/Dispatched/
    # Received); Ready/InProduction are filled in by recompute_order_status()
    # once items are loaded.
    pg.execute("""
        INSERT INTO "Order" (
            "OrderNumber","OrderBatch","CustomerAccount","CustomerRef","OrderContact",
            "DeliveryAddress","ReceivedOn","DispatchedOn","VatRateID","PriceBand",
            "CreatedOn","DispatchDateStamp","Void","VoidDateStamp","Status","StatusChangedOn")
        SELECT
            s."OrderNumber", s."OrderBatch",
            CASE WHEN EXISTS (SELECT 1 FROM "Customers" c WHERE c."CustomerID" = s."CustomerAccount")
                 THEN s."CustomerAccount" END,
            s."CustomerRef", s."OrderContact",
            CASE WHEN EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."AddressID" = s."DeliveryAddress")
                 THEN s."DeliveryAddress" END,
            s."ReceivedOn", s."DispatchedOn",
            (SELECT v."VatRateID" FROM "VatRates" v WHERE v."Rate" = s."VAT"
             ORDER BY v."VatRateID" LIMIT 1),
            s."PriceBand", s."CreatedOn", s."DispatchDateStamp", s."Void", s."VoidDateStamp",
            CASE WHEN s."Void" THEN 'Voided'
                 WHEN s."DispatchedOn" IS NOT NULL THEN 'Dispatched'
                 ELSE 'Received' END,
            CASE WHEN s."Void" THEN COALESCE(s."VoidDateStamp", s."CreatedOn")
                 WHEN s."DispatchedOn" IS NOT NULL THEN COALESCE(s."DispatchDateStamp", s."DispatchedOn")
                 ELSE s."CreatedOn" END
        FROM stg_orders s
        ON CONFLICT ("OrderNumber","OrderBatch") DO UPDATE SET
            "CustomerAccount"   = EXCLUDED."CustomerAccount",
            "CustomerRef"       = EXCLUDED."CustomerRef",
            "OrderContact"      = EXCLUDED."OrderContact",
            "DeliveryAddress"   = EXCLUDED."DeliveryAddress",
            "ReceivedOn"        = EXCLUDED."ReceivedOn",
            "DispatchedOn"      = EXCLUDED."DispatchedOn",
            "VatRateID"         = EXCLUDED."VatRateID",
            "PriceBand"         = EXCLUDED."PriceBand",
            "CreatedOn"         = EXCLUDED."CreatedOn",
            "DispatchDateStamp" = EXCLUDED."DispatchDateStamp",
            "Void"              = EXCLUDED."Void",
            "VoidDateStamp"     = EXCLUDED."VoidDateStamp",
            "Status"            = EXCLUDED."Status",
            "StatusChangedOn"   = EXCLUDED."StatusChangedOn"
    """)
    return n


def migrate_items(pg, acc, limit=None):
    select = """
        SELECT [SerialNumber],[PatientInitial],[PatientSurname],[ModelCode],[DateStamp],
               [Week],[ParentOrder],[ParentBatch],[CustomerRef],[Orientation],[Description],
               [Category],[Price],[Vent],[Colour],[Tubing],[Options],[CheckedOut],
               [CheckoutDateStamp],[Void],[VoidDateStamp]
        FROM tblOrderedItems
        WHERE [SerialNumber] IS NOT NULL AND [SerialNumber] <> ''
    """
    ddl = """
        CREATE TEMP TABLE stg_items (
            "SerialNumber" text, "PatientInitial" text, "PatientSurname" text,
            "ModelCode" text, "CreatedOn" timestamp, "Week" int, "ParentOrder" int,
            "ParentBatch" int, "CustomerRef" text, "Side" text, "Description" text,
            "Category" text, "Price" double precision, "Vent" real, "Colour" text,
            "Tubing" text, "Options" text, "CheckedOut" boolean,
            "CheckoutDateStamp" timestamp, "Void" boolean, "VoidDateStamp" timestamp
        )
    """
    copy_cols = ["SerialNumber", "PatientInitial", "PatientSurname", "ModelCode", "CreatedOn",
                 "Week", "ParentOrder", "ParentBatch", "CustomerRef", "Side", "Description",
                 "Category", "Price", "Vent", "Colour", "Tubing", "Options", "CheckedOut",
                 "CheckoutDateStamp", "Void", "VoidDateStamp"]

    def tf(r):
        r = list(r)
        r[0] = r[0].strip()[:9] if r[0] else r[0]   # SerialNumber (PK, varchar(9))
        side = r[9]
        r[9] = side if (side not in (None, "")) else None  # Orientation -> Side
        r[17] = as_bool(r[17])  # CheckedOut
        r[19] = as_bool(r[19])  # Void
        return tuple(r)

    n = stage_copy(pg, acc, stage_name="stg_items", stage_ddl=ddl,
                   copy_cols=copy_cols, select_sql=select, transform=tf, limit=limit)

    # DISTINCT ON guards against any duplicate SerialNumber in the source (would
    # otherwise make ON CONFLICT fail with "cannot affect row a second time").
    # Orphan items (no matching order) keep their data but lose the FK link.
    pg.execute("""
        INSERT INTO "OrderedItems" (
            "SerialNumber","PatientInitial","PatientSurname","ModelCode","CreatedOn",
            "Week","ParentOrder","ParentBatch","CustomerRef","Side","Description",
            "Category","Price","Vent","Colour","Tubing","Options","CheckedOut",
            "CheckoutDateStamp","Void","VoidDateStamp")
        SELECT DISTINCT ON (s."SerialNumber")
            s."SerialNumber", s."PatientInitial", s."PatientSurname", s."ModelCode",
            s."CreatedOn", s."Week",
            CASE WHEN EXISTS (SELECT 1 FROM "Order" o
                              WHERE o."OrderNumber" = s."ParentOrder"
                                AND o."OrderBatch"  = s."ParentBatch")
                 THEN s."ParentOrder" END,
            CASE WHEN EXISTS (SELECT 1 FROM "Order" o
                              WHERE o."OrderNumber" = s."ParentOrder"
                                AND o."OrderBatch"  = s."ParentBatch")
                 THEN s."ParentBatch" END,
            s."CustomerRef", s."Side", s."Description", s."Category", s."Price", s."Vent",
            s."Colour", s."Tubing", s."Options", s."CheckedOut", s."CheckoutDateStamp",
            s."Void", s."VoidDateStamp"
        FROM stg_items s
        ORDER BY s."SerialNumber"
        ON CONFLICT ("SerialNumber") DO UPDATE SET
            "PatientInitial"    = EXCLUDED."PatientInitial",
            "PatientSurname"    = EXCLUDED."PatientSurname",
            "ModelCode"         = EXCLUDED."ModelCode",
            "CreatedOn"         = EXCLUDED."CreatedOn",
            "Week"              = EXCLUDED."Week",
            "ParentOrder"       = EXCLUDED."ParentOrder",
            "ParentBatch"       = EXCLUDED."ParentBatch",
            "CustomerRef"       = EXCLUDED."CustomerRef",
            "Side"              = EXCLUDED."Side",
            "Description"       = EXCLUDED."Description",
            "Category"          = EXCLUDED."Category",
            "Price"             = EXCLUDED."Price",
            "Vent"              = EXCLUDED."Vent",
            "Colour"            = EXCLUDED."Colour",
            "Tubing"            = EXCLUDED."Tubing",
            "Options"           = EXCLUDED."Options",
            "CheckedOut"        = EXCLUDED."CheckedOut",
            "CheckoutDateStamp" = EXCLUDED."CheckoutDateStamp",
            "Void"              = EXCLUDED."Void",
            "VoidDateStamp"     = EXCLUDED."VoidDateStamp"
    """)
    return n


def migrate_sequences(pg, acc, limit=None):
    """Carry over the per-week serial-number counters (item-YYYY-WW)."""
    acc.execute("SELECT [SeqName],[NextVal] FROM tblSequence")
    rows = acc.fetchall()
    n = 0
    for name, nextval in rows:
        pg.execute("""
            INSERT INTO "Sequences" ("Key","Counter") VALUES (%s, %s)
            ON CONFLICT ("Key") DO UPDATE SET "Counter" = EXCLUDED."Counter"
        """, (name, int(nextval) if nextval is not None else 0))
        n += 1
    return n


def _num(v):
    """Coerce an Access price cell (Decimal/CURRENCY or VARCHAR) to float|None."""
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def migrate_pricelist(pg, acc, limit=None):
    """Unpivot the wide Access tblPriceList into the normalized PG model as one
    active revision. Idempotent: list types upsert by Name, items upsert by
    ItemID, and the revision's prices are wiped and rebuilt each run."""
    # 1. Upsert the band columns as list types; capture Name -> ListID.
    name_to_id = {}
    for sort_order, name in enumerate(BANDS, start=1):
        pg.execute("""
            INSERT INTO "PriceListType" ("Name","DisplayName","SortOrder","IsActive","Void","CreatedBy")
            VALUES (%s, %s, %s, true, false, 'access-migration')
            ON CONFLICT ("Name") DO UPDATE SET
                "DisplayName" = EXCLUDED."DisplayName",
                "SortOrder"   = EXCLUDED."SortOrder",
                "IsActive"    = true,
                "Void"        = false
            RETURNING "ListID"
        """, (name, name, sort_order))
        name_to_id[name] = pg.fetchone()[0]

    # 2. Resolve the stable migration revision, make it the only active one.
    pg.execute('UPDATE "PriceListRevision" SET "Status" = \'archived\' '
               'WHERE "Status" = \'active\' AND "Name" <> %s', (REVISION_NAME,))
    pg.execute('SELECT "RevisionID" FROM "PriceListRevision" WHERE "Name" = %s '
               'ORDER BY "RevisionID" LIMIT 1', (REVISION_NAME,))
    row = pg.fetchone()
    if row:
        revid = row[0]
        pg.execute('UPDATE "PriceListRevision" SET "Status" = \'active\', "ActivatedAt" = now() '
                   'WHERE "RevisionID" = %s', (revid,))
    else:
        pg.execute("""
            INSERT INTO "PriceListRevision" ("Name","Status","ActivatedAt","Notes","ImportedBy")
            VALUES (%s, 'active', now(), %s, 'access-migration')
            RETURNING "RevisionID"
        """, (REVISION_NAME, "Imported from SLOMS_be.accdb tblPriceList"))
        revid = pg.fetchone()[0]

    # 3. Read the wide list, de-duplicating ItemID (keep the last occurrence).
    band_cols = ", ".join(f"[{b}]" for b in BANDS)
    acc.execute(f"SELECT [ItemID],[Category],[Description],{band_cols} FROM tblPriceList")
    src, order, dups = {}, [], []
    for r in acc.fetchall():
        iid = (r[0] or "").strip()
        if not iid:
            continue
        if iid in src:
            dups.append(iid)
        else:
            order.append(iid)
        src[iid] = r
    if limit:
        order = order[:limit]

    # 4. Upsert the items.
    for iid in order:
        r = src[iid]
        pg.execute("""
            INSERT INTO "PriceListItem" ("ItemID","Category","Description","Void","CreatedBy")
            VALUES (%s, %s, %s, false, 'access-migration')
            ON CONFLICT ("ItemID") DO UPDATE SET
                "Category"    = EXCLUDED."Category",
                "Description" = EXCLUDED."Description"
        """, (iid, (r[1] or None), (r[2] or None)))

    # 5. Replace this revision's prices: stage the unpivoted cells, then swap in.
    pg.execute("DROP TABLE IF EXISTS stg_prices")
    pg.execute('CREATE TEMP TABLE stg_prices ("ItemID" text, "ListID" int, "Price" double precision)')
    n_prices = 0
    with pg.copy('COPY stg_prices ("ItemID","ListID","Price") FROM STDIN') as cp:
        for iid in order:
            r = src[iid]
            for j, name in enumerate(BANDS):
                price = _num(r[3 + j])
                if price is None:
                    continue
                cp.write_row((iid, name_to_id[name], price))
                n_prices += 1
    pg.execute('DELETE FROM "ItemPrice" WHERE "RevisionID" = %s', (revid,))
    pg.execute("""
        INSERT INTO "ItemPrice" ("ItemID","ListID","RevisionID","Price")
        SELECT "ItemID","ListID",%s,"Price" FROM stg_prices
        ON CONFLICT ("ItemID","ListID","RevisionID") DO UPDATE SET "Price" = EXCLUDED."Price"
    """, (revid,))

    if dups:
        log(f"pricelist : NOTE deduped {len(dups)} duplicate ItemID(s): {', '.join(sorted(set(dups)))}")
    log(f"pricelist : revision #{revid} '{REVISION_NAME}' active "
        f"({len(order)} items, {len(BANDS)} bands, {n_prices} prices)")
    return len(order)


# ---------------------------------------------------------------------------
# Post-load fix-ups
# ---------------------------------------------------------------------------
def recompute_order_status(pg):
    """Mirror computeOrderStatus() now that items are present.

    Voided / Dispatched were already set at insert time. This fills in
    Ready (all active items checked out) and InProduction for the rest.
    """
    pg.execute("""
        UPDATE "Order" o SET "Status" = CASE
            WHEN agg.not_checked = 0 THEN 'Ready'
            ELSE 'InProduction' END
        FROM (
            SELECT "ParentOrder", "ParentBatch",
                   SUM(CASE WHEN NOT "CheckedOut" THEN 1 ELSE 0 END) AS not_checked
            FROM "OrderedItems"
            WHERE NOT "Void" AND "ParentOrder" IS NOT NULL
            GROUP BY "ParentOrder", "ParentBatch"
        ) agg
        WHERE agg."ParentOrder" = o."OrderNumber"
          AND agg."ParentBatch" = o."OrderBatch"
          AND NOT o."Void"
          AND o."DispatchedOn" IS NULL
    """)


def regenerate_status_history(pg):
    """One history row per order, reflecting its current status. Derived data,
    so it is safe to wipe and rebuild on every run."""
    pg.execute('TRUNCATE TABLE "OrderStatusHistory" RESTART IDENTITY')
    pg.execute("""
        INSERT INTO "OrderStatusHistory" ("OrderNumber","OrderBatch","Status","ChangedOn")
        SELECT "OrderNumber","OrderBatch","Status",
               COALESCE("StatusChangedOn","CreatedOn", now())
        FROM "Order"
    """)


def reset_identity_sequences(pg):
    """Bump serial sequences past the migrated max so app inserts don't collide."""
    for table, col in [("Customers", "CustomerID"),
                       ("CustomerAddress", "AddressID"),
                       ("VatRates", "VatRateID"),
                       ("PriceListType", "ListID"),
                       ("PriceListRevision", "RevisionID")]:
        pg.execute(f"""
            SELECT setval(
                pg_get_serial_sequence('"{table}"', '{col}'),
                GREATEST((SELECT COALESCE(MAX("{col}"), 0) FROM "{table}"), 1)
            )
        """)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
MIGRATIONS = {
    "customers": migrate_customers,
    "addresses": migrate_addresses,
    "orders": migrate_orders,
    "items": migrate_items,
    "sequences": migrate_sequences,
    "pricelist": migrate_pricelist,
}


def main():
    ap = argparse.ArgumentParser(description="Migrate SLOMS Access data into Postgres.")
    ap.add_argument("--only", nargs="+", choices=TABLE_ORDER,
                    help="Migrate only these (default: all).")
    ap.add_argument("--items-limit", type=int, default=None,
                    help="Cap ordered-items rows (smoke testing).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Roll back at the end instead of committing.")
    args = ap.parse_args()

    selected = args.only or TABLE_ORDER

    if not os.path.exists(ACCESS_BE_PATH):
        sys.exit(f"Access back-end not found: {ACCESS_BE_PATH}")

    log(f"Access source : {ACCESS_BE_PATH}")
    log(f"Postgres target: {PG['user']}@{PG['host']}:{PG['port']}/{PG['dbname']}")
    log(f"Tables         : {', '.join(selected)}"
        + (f"  (items-limit={args.items_limit})" if args.items_limit else "")
        + ("  [DRY RUN]" if args.dry_run else ""))

    acc_cn = pyodbc.connect(
        f"DRIVER={{{ACCESS_DRIVER}}};DBQ={ACCESS_BE_PATH};PWD={ACCESS_BE_PWD};",
        readonly=True,
    )
    acc = acc_cn.cursor()

    pg_cn = psycopg.connect(**PG, autocommit=False)
    pg = pg_cn.cursor()

    counts = {}
    t0 = time.time()
    try:
        # vatrates is implicit dependency of orders; ensure it whenever orders run.
        for name in TABLE_ORDER:
            if name == "vatrates":
                if "orders" in selected or "vatrates" in selected:
                    t = time.time()
                    ins = ensure_vat_rates(pg, acc)
                    log(f"vatrates  : +{ins} new rate(s) ensured ({time.time()-t:.1f}s)")
                continue
            if name not in selected:
                continue
            t = time.time()
            limit = args.items_limit if name == "items" else None
            n = MIGRATIONS[name](pg, acc, limit=limit)
            counts[name] = n
            log(f"{name:<10}: {n:>8,} rows staged+upserted ({time.time()-t:.1f}s)")

        if "orders" in selected or "items" in selected:
            recompute_order_status(pg)
            regenerate_status_history(pg)
            log("orders    : status recomputed + history regenerated")

        reset_identity_sequences(pg)
        log("sequences : identity counters reset")

        if args.dry_run:
            pg_cn.rollback()
            log("DRY RUN -> rolled back, nothing committed.")
        else:
            pg_cn.commit()
            log("COMMITTED.")
    except Exception:
        pg_cn.rollback()
        log("ERROR -> rolled back.")
        raise
    finally:
        pg.close(); pg_cn.close()
        acc.close(); acc_cn.close()

    log(f"Done in {time.time()-t0:.1f}s. " + ", ".join(f"{k}={v:,}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
