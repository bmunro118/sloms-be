-- Migration: 002_normalize_price_list
-- Description: Replace wide tblPriceList with normalized PriceListItem / PriceListType / ItemPrice tables.
--              Dispensary is treated as a price list (was incorrectly typed as VARCHAR).

-- ============================================
-- NEW TABLES
-- ============================================

CREATE TABLE "tblPriceListItem" (
    "ItemID"       VARCHAR(255) NOT NULL PRIMARY KEY,
    "Category"     VARCHAR(255) NULL,
    "Description"  VARCHAR(255) NULL
);

CREATE TABLE "tblPriceListType" (
    "ListID"       SERIAL PRIMARY KEY,
    "Name"         VARCHAR(255) NOT NULL UNIQUE,
    "DisplayName"  VARCHAR(255) NULL,
    "SortOrder"    INTEGER      NOT NULL DEFAULT 0,
    "IsActive"     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE "tblItemPrice" (
    "ItemID"  VARCHAR(255)     NOT NULL REFERENCES "tblPriceListItem"("ItemID") ON DELETE CASCADE,
    "ListID"  INTEGER          NOT NULL REFERENCES "tblPriceListType"("ListID") ON DELETE CASCADE,
    "Price"   DOUBLE PRECISION NULL,
    PRIMARY KEY ("ItemID", "ListID")
);

CREATE INDEX "IX_tblItemPrice_ListID" ON "tblItemPrice"("ListID");

-- ============================================
-- SEED PRICE LIST TYPES (preserving original order)
-- ============================================

INSERT INTO "tblPriceListType" ("Name", "DisplayName", "SortOrder") VALUES
    ('Dispensary',             'Dispensary',              1),
    ('Specsavers',             'Specsavers',              2),
    ('Specsavers Band 2023',   'Specsavers Band 2023',    3),
    ('B1',                     'B1',                      4),
    ('B2',                     'B2',                      5),
    ('B3',                     'B3',                      6),
    ('B4',                     'B4',                      7),
    ('5%',                     '5%',                      8),
    ('6%',                     '6%',                      9),
    ('10%',                    '10%',                    10),
    ('50%',                    '50%',                    11),
    ('Swindon',                'Swindon',                12),
    ('HealthScreen&Hear4u',    'HealthScreen & Hear4u',  13),
    ('StAnns&Whittington',     'St Anns & Whittington',  14),
    ('NHS Band 1',             'NHS Band 1',             15),
    ('NHS Band 2',             'NHS Band 2',             16),
    ('NHS Band 3',             'NHS Band 3',             17),
    ('NHS Band 4',             'NHS Band 4',             18),
    ('NHS Band 5',             'NHS Band 5',             19),
    ('NHS Band 6',             'NHS Band 6',             20),
    ('NHS Band 7',             'NHS Band 7',             21),
    ('NHS Band 8',             'NHS Band 8',             22),
    ('NHS Band 9',             'NHS Band 9',             23),
    ('NHS Band 10',            'NHS Band 10',            24),
    ('NHS Band 11',            'NHS Band 11',            25),
    ('NHS Band 12',            'NHS Band 12',            26),
    ('NHS Band 13',            'NHS Band 13',            27),
    ('NHS Band 14',            'NHS Band 14',            28),
    ('NHS Band 15',            'NHS Band 15',            29),
    ('NHS Band 16',            'NHS Band 16',            30),
    ('NHS Band 17',            'NHS Band 17',            31),
    ('NHS Band 18',            'NHS Band 18',            32),
    ('NHS Band 19',            'NHS Band 19',            33),
    ('NHS Band 20',            'NHS Band 20',            34),
    ('NHS Band 21',            'NHS Band 21',            35),
    ('NHS Band 22',            'NHS Band 22',            36),
    ('NHS Band 23',            'NHS Band 23',            37),
    ('NHS Band 24',            'NHS Band 24',            38),
    ('NHS Band 24 Discount',   'NHS Band 24 Discount',   39),
    ('New Framework Cost',     'New Framework Cost',     40);

-- ============================================
-- MIGRATE DATA FROM OLD TABLE
-- ============================================

INSERT INTO "tblPriceListItem" ("ItemID", "Category", "Description")
SELECT "ItemID", "Category", "Description"
FROM "tblPriceList";

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."Dispensary"::DOUBLE PRECISION
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'Dispensary'
  AND p."Dispensary" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."Specsavers"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'Specsavers' AND p."Specsavers" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."Specsavers Band 2023"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'Specsavers Band 2023' AND p."Specsavers Band 2023" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."B1"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'B1' AND p."B1" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."B2"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'B2' AND p."B2" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."B3"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'B3' AND p."B3" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."B4"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'B4' AND p."B4" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."5%"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = '5%' AND p."5%" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."6%"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = '6%' AND p."6%" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."10%"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = '10%' AND p."10%" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."50%"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = '50%' AND p."50%" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."Swindon"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'Swindon' AND p."Swindon" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."HealthScreen&Hear4u"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'HealthScreen&Hear4u' AND p."HealthScreen&Hear4u" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."StAnns&Whittington"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'StAnns&Whittington' AND p."StAnns&Whittington" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 1"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 1' AND p."NHS Band 1" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 2"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 2' AND p."NHS Band 2" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 3"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 3' AND p."NHS Band 3" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 4"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 4' AND p."NHS Band 4" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 5"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 5' AND p."NHS Band 5" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 6"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 6' AND p."NHS Band 6" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 7"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 7' AND p."NHS Band 7" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 8"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 8' AND p."NHS Band 8" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 9"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 9' AND p."NHS Band 9" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 10"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 10' AND p."NHS Band 10" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 11"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 11' AND p."NHS Band 11" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 12"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 12' AND p."NHS Band 12" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 13"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 13' AND p."NHS Band 13" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 14"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 14' AND p."NHS Band 14" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 15"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 15' AND p."NHS Band 15" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 16"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 16' AND p."NHS Band 16" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 17"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 17' AND p."NHS Band 17" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 18"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 18' AND p."NHS Band 18" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 19"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 19' AND p."NHS Band 19" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 20"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 20' AND p."NHS Band 20" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 21"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 21' AND p."NHS Band 21" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 22"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 22' AND p."NHS Band 22" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 23"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 23' AND p."NHS Band 23" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 24"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 24' AND p."NHS Band 24" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."NHS Band 24 Discount"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'NHS Band 24 Discount' AND p."NHS Band 24 Discount" IS NOT NULL;

INSERT INTO "tblItemPrice" ("ItemID", "ListID", "Price")
SELECT p."ItemID", t."ListID", p."New Framework Cost"
FROM "tblPriceList" p
CROSS JOIN "tblPriceListType" t
WHERE t."Name" = 'New Framework Cost' AND p."New Framework Cost" IS NOT NULL;

-- ============================================
-- DROP OLD TABLE
-- ============================================

DROP TABLE "tblPriceList";
