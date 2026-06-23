-- Migration: 003_price_list_revisions
-- Description: Add PriceListRevision table and link ItemPrice to a revision.
--              Existing prices are migrated into an initial 'active' revision.

-- ============================================
-- REVISION TABLE
-- ============================================

CREATE TABLE "tblPriceListRevision" (
    "RevisionID"   SERIAL        PRIMARY KEY,
    "Name"         VARCHAR(255)  NOT NULL,
    "Status"       VARCHAR(20)   NOT NULL DEFAULT 'draft',
    "ImportedAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ActivatedAt"  TIMESTAMP(3)  NULL,
    "Notes"        VARCHAR(1000) NULL,
    "ImportedBy"   VARCHAR(255)  NULL
);

CREATE INDEX "IX_tblPriceListRevision_Status" ON "tblPriceListRevision"("Status");

-- ============================================
-- SEED: initial active revision for existing data
-- ============================================

INSERT INTO "tblPriceListRevision" ("Name", "Status", "ImportedAt", "ActivatedAt", "Notes")
VALUES ('Initial Import', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migrated from legacy flat price list');

-- ============================================
-- ADD revisionId TO ItemPrice
-- ============================================

ALTER TABLE "tblItemPrice"
    ADD COLUMN "RevisionID" INTEGER NOT NULL DEFAULT 1
        REFERENCES "tblPriceListRevision"("RevisionID") ON DELETE CASCADE;

-- Drop the old two-column PK and replace with three-column PK
ALTER TABLE "tblItemPrice" DROP CONSTRAINT "tblItemPrice_pkey";
ALTER TABLE "tblItemPrice" ADD PRIMARY KEY ("ItemID", "ListID", "RevisionID");

-- Remove the default now that data is migrated
ALTER TABLE "tblItemPrice" ALTER COLUMN "RevisionID" DROP DEFAULT;

CREATE INDEX "IX_tblItemPrice_RevisionID" ON "tblItemPrice"("RevisionID");
