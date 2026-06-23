-- Migration: 004_ordered_item_price_audit
-- Description: Add audit columns to tblOrderedItems to record which price list
--              revision and list name were used when an order item was created.
--              These are for auditability only — the copied Price field remains
--              the source of truth.

ALTER TABLE "tblOrderedItems"
    ADD COLUMN "PriceListRevisionID" INTEGER NULL
        REFERENCES "tblPriceListRevision"("RevisionID") ON DELETE SET NULL,
    ADD COLUMN "PriceListName"       VARCHAR(255) NULL;

CREATE INDEX "IX_tblOrderedItems_PriceListRevisionID"
    ON "tblOrderedItems"("PriceListRevisionID")
    WHERE "PriceListRevisionID" IS NOT NULL;
