-- Migration: 005_price_list_void
-- Description: Add soft-delete (void + voidDateStamp) to PriceListItem and PriceListType,
--              consistent with the pattern used on tblOrder and tblOrderedItems.

ALTER TABLE "tblPriceListItem"
    ADD COLUMN "Void"          BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN "VoidDateStamp" TIMESTAMP(3) NULL;

ALTER TABLE "tblPriceListType"
    ADD COLUMN "Void"          BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN "VoidDateStamp" TIMESTAMP(3) NULL;
