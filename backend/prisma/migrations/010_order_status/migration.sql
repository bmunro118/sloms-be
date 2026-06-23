-- Migration: 010_order_status
-- Description: Add Status column to tblOrder to track the order/batch lifecycle.
--   Received     - order created, no active items yet
--   InProduction - active items exist, at least one not checked out
--   Ready        - all active items are checked out
--   Dispatched   - batch has been dispatched (DispatchedOn is set)
--   Voided       - order has been voided

ALTER TABLE "tblOrder"
  ADD COLUMN "Status" VARCHAR(20) NOT NULL DEFAULT 'Received';

-- Back-fill: priority order matters — most terminal states first
UPDATE "tblOrder" SET "Status" = 'Voided'
  WHERE "Void" = true;

UPDATE "tblOrder" SET "Status" = 'Dispatched'
  WHERE "Void" = false AND "DispatchedOn" IS NOT NULL;

UPDATE "tblOrder" SET "Status" = 'Ready'
  WHERE "Void" = false
    AND "DispatchedOn" IS NULL
    AND "ItemCount" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "tblOrderedItems" i
      WHERE i."ParentOrder" = "tblOrder"."OrderNumber"
        AND i."ParentBatch" = "tblOrder"."OrderBatch"
        AND i."Void" = false
        AND i."CheckedOut" = false
    );

UPDATE "tblOrder" SET "Status" = 'InProduction'
  WHERE "Void" = false
    AND "DispatchedOn" IS NULL
    AND "ItemCount" > 0
    AND EXISTS (
      SELECT 1 FROM "tblOrderedItems" i
      WHERE i."ParentOrder" = "tblOrder"."OrderNumber"
        AND i."ParentBatch" = "tblOrder"."OrderBatch"
        AND i."Void" = false
        AND i."CheckedOut" = false
    );
