-- Migration: 007_create_audit
-- Description: Add CreatedAt and CreatedBy audit columns to PriceListItem and PriceListType.
--              Wire CreatedBy for Order and OrderedItem (column already exists, just not populated).

ALTER TABLE "tblPriceListItem"
    ADD COLUMN "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "CreatedBy" VARCHAR(100) NULL;

ALTER TABLE "tblPriceListType"
    ADD COLUMN "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "CreatedBy" VARCHAR(100) NULL;
