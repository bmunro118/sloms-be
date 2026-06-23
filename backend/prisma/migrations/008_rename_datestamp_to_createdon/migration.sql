-- Migration: 008_rename_datestamp_to_createdon
-- Description: Rename DateStamp to CreatedOn across all four tables for naming consistency.

ALTER TABLE "tblCustomers"        RENAME COLUMN "DateStamp" TO "CreatedOn";
ALTER TABLE "tblCustomerAddress"  RENAME COLUMN "DateStamp" TO "CreatedOn";
ALTER TABLE "tblOrder"            RENAME COLUMN "DateStamp" TO "CreatedOn";
ALTER TABLE "tblOrderedItems"     RENAME COLUMN "DateStamp" TO "CreatedOn";
