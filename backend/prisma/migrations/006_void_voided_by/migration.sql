-- Migration: 006_void_voided_by
-- Description: Add VoidedBy column to all four tables that support soft-delete,
--              storing the username of the user who performed the void action.

ALTER TABLE "tblOrder"
    ADD COLUMN "VoidedBy" VARCHAR(100) NULL;

ALTER TABLE "tblOrderedItems"
    ADD COLUMN "VoidedBy" VARCHAR(100) NULL;

ALTER TABLE "tblPriceListItem"
    ADD COLUMN "VoidedBy" VARCHAR(100) NULL;

ALTER TABLE "tblPriceListType"
    ADD COLUMN "VoidedBy" VARCHAR(100) NULL;
