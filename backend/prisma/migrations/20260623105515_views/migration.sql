-- Migration: views
-- Description: Read-only Postgres views consumed by the Access front-end. These are not
--   modelled in schema.prisma (Prisma does not manage views), so they live here as raw SQL
--   and are kept idempotent via CREATE OR REPLACE.
--
--   1. tblPriceList        - re-pivots the normalized price tables back into the legacy
--                            wide one-column-per-band shape for the currently ACTIVE revision.
--   2. vwOrderTotals       - per-(order,batch) non-void SUM/COUNT building block.
--   3. vwStatOrderRevenue  - all orders + totals, windowed to the most recent
--                            STAT_GRAPH_YEARS calendar years (default 5).
--   4. vwStatMonthFigures  - last ~24 months, with customer columns.
--   5. vwStatWeekFigures   - last ~52 weeks, with customer columns.

-- ============================================================================
-- 1. tblPriceList  (legacy wide pivot of the active revision)
--    The 40 band columns must stay byte-for-byte in sync with tblPriceListType."Name".
-- ============================================================================
CREATE OR REPLACE VIEW "PriceList" AS
SELECT
    i."ItemID",
    i."Category",
    i."Description",
    max(CASE WHEN t."Name" = 'Dispensary'           THEN p."Price" END) AS "Dispensary",
    max(CASE WHEN t."Name" = 'Specsavers'           THEN p."Price" END) AS "Specsavers",
    max(CASE WHEN t."Name" = 'Specsavers Band 2023' THEN p."Price" END) AS "Specsavers Band 2023",
    max(CASE WHEN t."Name" = 'B1'                   THEN p."Price" END) AS "B1",
    max(CASE WHEN t."Name" = 'B2'                   THEN p."Price" END) AS "B2",
    max(CASE WHEN t."Name" = 'B3'                   THEN p."Price" END) AS "B3",
    max(CASE WHEN t."Name" = 'B4'                   THEN p."Price" END) AS "B4",
    max(CASE WHEN t."Name" = '5%'                   THEN p."Price" END) AS "5%",
    max(CASE WHEN t."Name" = '6%'                   THEN p."Price" END) AS "6%",
    max(CASE WHEN t."Name" = '10%'                  THEN p."Price" END) AS "10%",
    max(CASE WHEN t."Name" = '50%'                  THEN p."Price" END) AS "50%",
    max(CASE WHEN t."Name" = 'Swindon'              THEN p."Price" END) AS "Swindon",
    max(CASE WHEN t."Name" = 'HealthScreen&Hear4u'  THEN p."Price" END) AS "HealthScreen&Hear4u",
    max(CASE WHEN t."Name" = 'StAnns&Whittington'   THEN p."Price" END) AS "StAnns&Whittington",
    max(CASE WHEN t."Name" = 'NHS Band 1'           THEN p."Price" END) AS "NHS Band 1",
    max(CASE WHEN t."Name" = 'NHS Band 2'           THEN p."Price" END) AS "NHS Band 2",
    max(CASE WHEN t."Name" = 'NHS Band 3'           THEN p."Price" END) AS "NHS Band 3",
    max(CASE WHEN t."Name" = 'NHS Band 4'           THEN p."Price" END) AS "NHS Band 4",
    max(CASE WHEN t."Name" = 'NHS Band 5'           THEN p."Price" END) AS "NHS Band 5",
    max(CASE WHEN t."Name" = 'NHS Band 6'           THEN p."Price" END) AS "NHS Band 6",
    max(CASE WHEN t."Name" = 'NHS Band 7'           THEN p."Price" END) AS "NHS Band 7",
    max(CASE WHEN t."Name" = 'NHS Band 8'           THEN p."Price" END) AS "NHS Band 8",
    max(CASE WHEN t."Name" = 'NHS Band 9'           THEN p."Price" END) AS "NHS Band 9",
    max(CASE WHEN t."Name" = 'NHS Band 10'          THEN p."Price" END) AS "NHS Band 10",
    max(CASE WHEN t."Name" = 'NHS Band 11'          THEN p."Price" END) AS "NHS Band 11",
    max(CASE WHEN t."Name" = 'NHS Band 12'          THEN p."Price" END) AS "NHS Band 12",
    max(CASE WHEN t."Name" = 'NHS Band 13'          THEN p."Price" END) AS "NHS Band 13",
    max(CASE WHEN t."Name" = 'NHS Band 14'          THEN p."Price" END) AS "NHS Band 14",
    max(CASE WHEN t."Name" = 'NHS Band 15'          THEN p."Price" END) AS "NHS Band 15",
    max(CASE WHEN t."Name" = 'NHS Band 16'          THEN p."Price" END) AS "NHS Band 16",
    max(CASE WHEN t."Name" = 'NHS Band 17'          THEN p."Price" END) AS "NHS Band 17",
    max(CASE WHEN t."Name" = 'NHS Band 18'          THEN p."Price" END) AS "NHS Band 18",
    max(CASE WHEN t."Name" = 'NHS Band 19'          THEN p."Price" END) AS "NHS Band 19",
    max(CASE WHEN t."Name" = 'NHS Band 20'          THEN p."Price" END) AS "NHS Band 20",
    max(CASE WHEN t."Name" = 'NHS Band 21'          THEN p."Price" END) AS "NHS Band 21",
    max(CASE WHEN t."Name" = 'NHS Band 22'          THEN p."Price" END) AS "NHS Band 22",
    max(CASE WHEN t."Name" = 'NHS Band 23'          THEN p."Price" END) AS "NHS Band 23",
    max(CASE WHEN t."Name" = 'NHS Band 24'          THEN p."Price" END) AS "NHS Band 24",
    max(CASE WHEN t."Name" = 'NHS Band 24 Discount' THEN p."Price" END) AS "NHS Band 24 Discount",
    max(CASE WHEN t."Name" = 'New Framework Cost'   THEN p."Price" END) AS "New Framework Cost"
FROM "PriceListItem" i
LEFT JOIN "ItemPrice" p
    ON p."ItemID" = i."ItemID"
   AND p."RevisionID" = (
        SELECT r."RevisionID"
        FROM "PriceListRevision" r
        WHERE r."Status" = 'active'
        ORDER BY r."RevisionID" DESC
        LIMIT 1)
LEFT JOIN "PriceListType" t ON t."ListID" = p."ListID"
WHERE i."Void" = false
GROUP BY i."ItemID", i."Category", i."Description";

-- ============================================================================
-- 2. vwOrderTotals  (per-(order,batch) non-void totals; building block)
-- ============================================================================
CREATE OR REPLACE VIEW "vwOrderTotals" AS
SELECT
    "ParentOrder",
    "ParentBatch",
    sum("Price") AS "OrderTotal",
    count(*)     AS "ItemCount"
FROM "OrderedItems"
WHERE "Void" = false
  AND "ParentOrder" IS NOT NULL
  AND "ParentBatch" IS NOT NULL
GROUP BY "ParentOrder", "ParentBatch";

-- ============================================================================
-- 3. vwStatOrderRevenue  (all orders + totals, windowed to most recent N years)
--    N = tblGlobalSettings.STAT_GRAPH_YEARS (default 5). Feeds the Year/Quarter pivots.
-- ============================================================================
CREATE OR REPLACE VIEW "vwStatOrderRevenue" AS
SELECT
    o.*,
    COALESCE(agg."OrderTotal", 0)            AS "OrderTotal",
    COALESCE(agg."ItemCount", 0)             AS "ItemCount",
    CASE WHEN COALESCE(agg."ItemCount", 0) = 0 THEN 0
         ELSE agg."OrderTotal" / agg."ItemCount" END AS "AvgPrice"
FROM "Order" o
LEFT JOIN "vwOrderTotals" agg
    ON agg."ParentOrder" = o."OrderNumber"
   AND agg."ParentBatch" = o."OrderBatch"
WHERE o."DispatchedOn" >= make_date(
        (extract(year FROM CURRENT_DATE)::int
         - (COALESCE((SELECT NULLIF("Val", '')::int
                      FROM "GlobalSettings"
                      WHERE "Key" = 'STAT_GRAPH_YEARS'), 5) - 1)),
        1, 1)
  AND o."DispatchedOn" < (CURRENT_DATE + INTERVAL '1 day');

-- ============================================================================
-- 4. vwStatMonthFigures  (last ~24 months, with customer columns)
-- ============================================================================
CREATE OR REPLACE VIEW "vwStatMonthFigures" AS
SELECT
    c."AccountNumber",
    c."ContactName",
    c."Band",
    o.*,
    COALESCE(agg."OrderTotal", 0)            AS "OrderTotal",
    COALESCE(agg."ItemCount", 0)             AS "ItemCount",
    CASE WHEN COALESCE(agg."ItemCount", 0) = 0 THEN 0
         ELSE agg."OrderTotal" / agg."ItemCount" END AS "AvgPrice"
FROM "Customers" c
JOIN "Order" o ON c."CustomerID" = o."CustomerAccount"
LEFT JOIN "vwOrderTotals" agg
    ON agg."ParentOrder" = o."OrderNumber"
   AND agg."ParentBatch" = o."OrderBatch"
WHERE o."DispatchedOn" >= (CURRENT_DATE - INTERVAL '24 months')
  AND o."DispatchedOn" <  (CURRENT_DATE + INTERVAL '1 day');

-- ============================================================================
-- 5. vwStatWeekFigures  (last ~52 weeks, with customer columns)
-- ============================================================================
CREATE OR REPLACE VIEW "vwStatWeekFigures" AS
SELECT
    c."AccountNumber",
    c."ContactName",
    c."Band",
    o.*,
    COALESCE(agg."OrderTotal", 0)            AS "OrderTotal",
    COALESCE(agg."ItemCount", 0)             AS "ItemCount",
    CASE WHEN COALESCE(agg."ItemCount", 0) = 0 THEN 0
         ELSE agg."OrderTotal" / agg."ItemCount" END AS "AvgPrice"
FROM "Customers" c
JOIN "Order" o ON c."CustomerID" = o."CustomerAccount"
LEFT JOIN "vwOrderTotals" agg
    ON agg."ParentOrder" = o."OrderNumber"
   AND agg."ParentBatch" = o."OrderBatch"
WHERE o."DispatchedOn" >= (CURRENT_DATE - INTERVAL '52 weeks')
  AND o."DispatchedOn" <  (CURRENT_DATE + INTERVAL '1 day');
