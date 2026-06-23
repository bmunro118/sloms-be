-- Migration: 011_runtime_totals
-- Description: Remove stored aggregate columns (totals are now computed at runtime).
--              Add StatusChangedOn to support "in this state since" tracking.

ALTER TABLE "tblOrder"
  DROP COLUMN IF EXISTS "OrderTotal",
  DROP COLUMN IF EXISTS "ItemCount",
  DROP COLUMN IF EXISTS "AvgPrice",
  ADD COLUMN "StatusChangedOn" TIMESTAMPTZ NULL;

-- Back-fill StatusChangedOn from the most relevant existing timestamp
UPDATE "tblOrder" SET "StatusChangedOn" =
  CASE
    WHEN "Void" = true        THEN "VoidDateStamp"
    WHEN "DispatchedOn" IS NOT NULL THEN "DispatchedOn"
    ELSE "CreatedOn"
  END;
