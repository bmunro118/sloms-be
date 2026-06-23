-- Migration: 001_initial_schema
-- Description: Create all tables and constraints for SLOMS Backend (PostgreSQL)

-- ============================================
-- CUSTOMERS TABLE
-- ============================================
CREATE TABLE "tblCustomers" (
    "CustomerID"      SERIAL PRIMARY KEY,
    "AccountNumber"   VARCHAR(20)  NULL,
    "CentreNumber"    VARCHAR(50)  NULL,
    "CompanyName"     VARCHAR(200) NULL,
    "InvBuildingName" VARCHAR(100) NULL,
    "InvAddressLn1"   VARCHAR(100) NULL,
    "InvAddressLn2"   VARCHAR(100) NULL,
    "InvTownOrCity"   VARCHAR(100) NULL,
    "InvCounty"       VARCHAR(100) NULL,
    "InvPostCode"     VARCHAR(10)  NULL,
    "ContactName"     VARCHAR(50)  NULL,
    "ContactEmail"    VARCHAR(50)  NULL,
    "ReportEmail"     VARCHAR(255) NULL,
    "ContactPhone"    VARCHAR(50)  NULL,
    "ContactMobille"  VARCHAR(50)  NULL,
    "ContactFax"      VARCHAR(50)  NULL,
    "Band"            VARCHAR(20)  NULL,
    "DateStamp"       TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "Suspended"       BOOLEAN      NOT NULL DEFAULT FALSE,
    "SuspendedOn"     TIMESTAMP(3) NULL
);

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE "tblUsers" (
    "UserID"              SERIAL PRIMARY KEY,
    "Username"            VARCHAR(100) NOT NULL UNIQUE,
    "PasswordHash"        VARCHAR(255) NOT NULL,
    "FullName"            VARCHAR(200) NULL,
    "Email"               VARCHAR(255) NULL,
    "Role"                VARCHAR(50)  NOT NULL DEFAULT 'ReadOnly',
    "IsActive"            BOOLEAN      NOT NULL DEFAULT TRUE,
    "LastLoginAt"         TIMESTAMP(3) NULL,
    "FailedLoginCount"    INTEGER      NOT NULL DEFAULT 0,
    "LockedUntil"         TIMESTAMP(3) NULL,
    "MustChangePassword"  BOOLEAN      NOT NULL DEFAULT FALSE,
    "CreatedAt"           TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "CreatedBy"           VARCHAR(100) NULL,
    "LinkedCustomerID"    INT          NULL REFERENCES "tblCustomers"("CustomerID")
);

CREATE INDEX "IX_tblUsers_LinkedCustomerID" ON "tblUsers"("LinkedCustomerID");

-- ============================================
-- USER AUDIT LOG TABLE
-- ============================================
CREATE TABLE "tblUserAuditLog" (
    "AuditID"   SERIAL PRIMARY KEY,
    "UserID"    INTEGER      NULL,
    "Username"  VARCHAR(100) NOT NULL,
    "Event"     VARCHAR(50)  NOT NULL,
    "Detail"    VARCHAR(500) NULL,
    "IPAddress" VARCHAR(45)  NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "IX_tblUserAuditLog_UserID"    ON "tblUserAuditLog"("UserID");
CREATE INDEX "IX_tblUserAuditLog_Event"     ON "tblUserAuditLog"("Event");
CREATE INDEX "IX_tblUserAuditLog_CreatedAt" ON "tblUserAuditLog"("CreatedAt");

-- ============================================
-- CUSTOMER ADDRESSES TABLE
-- ============================================
CREATE TABLE "tblCustomerAddress" (
    "AddressID"          SERIAL PRIMARY KEY,
    "CustomerAccount"    INT          NULL REFERENCES "tblCustomers"("CustomerID"),
    "SiteCompanyName"    VARCHAR(200) NULL,
    "DelBuildingName"    VARCHAR(100) NULL,
    "DelAddressLn1"      VARCHAR(100) NULL,
    "DelAddressLn2"      VARCHAR(100) NULL,
    "DelTownOrCity"      VARCHAR(100) NULL,
    "DelCounty"          VARCHAR(100) NULL,
    "DelPostCode"        VARCHAR(10)  NULL,
    "SiteContactName"    VARCHAR(50)  NULL,
    "SiteContactEmail"   VARCHAR(50)  NULL,
    "SiteContactPhone"   VARCHAR(50)  NULL,
    "SiteContactMobille" VARCHAR(50)  NULL,
    "SiteContactFax"     VARCHAR(50)  NULL,
    "DefaultAddress"     BOOLEAN      NOT NULL DEFAULT FALSE,
    "Void"               BOOLEAN      NOT NULL DEFAULT FALSE,
    "DateStamp"          TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "IX_tblCustomerAddress_CustomerAccount" ON "tblCustomerAddress"("CustomerAccount");

-- ============================================
-- VAT RATES TABLE
-- ============================================
CREATE TABLE "tblVatRates" (
    "VatRateID" SERIAL PRIMARY KEY,
    "Rate"      DECIMAL(5,2) NOT NULL,
    "Label"     VARCHAR(50)  NOT NULL,
    "ValidFrom" DATE         NOT NULL,
    "ValidTo"   DATE         NULL
);

-- ============================================
-- ORDERS TABLE (Composite Primary Key)
-- ============================================
CREATE TABLE "tblOrder" (
    "OrderNumber"       INT              NOT NULL,
    "OrderBatch"        INT              NOT NULL DEFAULT 1,
    "CustomerAccount"   INT              NULL REFERENCES "tblCustomers"("CustomerID"),
    "CustomerRef"       VARCHAR(50)      NULL,
    "OrderContact"      VARCHAR(100)     NULL,
    "DeliveryAddress"   INT              NULL REFERENCES "tblCustomerAddress"("AddressID"),
    "ReceivedOn"        TIMESTAMP(3)     NULL,
    "DispatchedOn"      TIMESTAMP(3)     NULL,
    "OrderTotal"        DOUBLE PRECISION DEFAULT 0,
    "ItemCount"         INT              DEFAULT 0,
    "AvgPrice"          DOUBLE PRECISION DEFAULT 0,
    "VatRateID"         INT              NULL REFERENCES "tblVatRates"("VatRateID"),
    "PriceBand"         VARCHAR(20)      NULL,
    "DateStamp"         TIMESTAMP(3)     DEFAULT CURRENT_TIMESTAMP,
    "DispatchDateStamp" TIMESTAMP(3)     NULL,
    "Void"              BOOLEAN          NOT NULL DEFAULT FALSE,
    "VoidDateStamp"     TIMESTAMP(3)     NULL,
    "CreatedBy"         VARCHAR(100)     NULL,
    PRIMARY KEY ("OrderNumber", "OrderBatch")
);

CREATE INDEX "IX_tblOrder_CustomerAccount" ON "tblOrder"("CustomerAccount");
CREATE INDEX "IX_tblOrder_DeliveryAddress" ON "tblOrder"("DeliveryAddress");
CREATE INDEX "IX_tblOrder_VatRateID"       ON "tblOrder"("VatRateID");
CREATE INDEX "IX_tblOrder_CreatedBy"       ON "tblOrder"("CreatedBy") WHERE "CreatedBy" IS NOT NULL;

-- ============================================
-- ORDERED ITEMS TABLE
-- ============================================
CREATE TABLE "tblOrderedItems" (
    "SerialNumber"      VARCHAR(9)       NOT NULL PRIMARY KEY,
    "PatientInitial"    VARCHAR(5)       NULL,
    "PatientSurname"    VARCHAR(50)      NULL,
    "ModelCode"         VARCHAR(50)      NULL,
    "DateStamp"         TIMESTAMP(3)     NULL,
    "Week"              INT              DEFAULT 0,
    "ParentOrder"       INT              NULL,
    "ParentBatch"       INT              NULL,
    "CustomerRef"       VARCHAR(20)      NULL,
    "Orientation"       VARCHAR(1)       NULL,
    "Description"       VARCHAR(50)      NULL,
    "Category"          VARCHAR(50)      NULL,
    "Price"             DOUBLE PRECISION DEFAULT 0,
    "Vent"              REAL             DEFAULT 0,
    "Colour"            VARCHAR(50)      NULL,
    "Tubing"            VARCHAR(50)      NULL,
    "Options"           VARCHAR(50)      NULL,
    "CheckedOut"        BOOLEAN          NOT NULL DEFAULT FALSE,
    "CheckoutDateStamp" TIMESTAMP(3)     NULL,
    "Void"              BOOLEAN          NOT NULL DEFAULT FALSE,
    "VoidDateStamp"     TIMESTAMP(3)     NULL,
    "CreatedBy"         VARCHAR(100)     NULL,
    FOREIGN KEY ("ParentOrder", "ParentBatch") REFERENCES "tblOrder"("OrderNumber", "OrderBatch")
);

CREATE INDEX "IX_tblOrderedItems_ParentOrder_Batch" ON "tblOrderedItems"("ParentOrder", "ParentBatch");
CREATE INDEX "IX_tblOrderedItems_CreatedBy"         ON "tblOrderedItems"("CreatedBy") WHERE "CreatedBy" IS NOT NULL;

-- ============================================
-- SEQUENCES TABLE
-- ============================================
CREATE TABLE "tblSequences" (
    "Key"     VARCHAR(50) NOT NULL,
    "Counter" INTEGER     NOT NULL DEFAULT 0,
    CONSTRAINT "tblSequences_pkey" PRIMARY KEY ("Key")
);

-- ============================================
-- GLOBAL SETTINGS TABLE
-- ============================================
CREATE TABLE "tblGlobalSettings" (
    "Key"         VARCHAR(255) NOT NULL PRIMARY KEY,
    "Val"         TEXT         NULL,
    "Description" TEXT         NULL,
    "Exposed"     BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ============================================
-- USER SETTINGS TABLE
-- ============================================
CREATE TABLE "tblUserSettings" (
    "UserID" INT          NOT NULL REFERENCES "tblUsers"("UserID"),
    "Key"    VARCHAR(255) NOT NULL,
    "Val"    TEXT         NULL,
    PRIMARY KEY ("UserID", "Key")
);

CREATE INDEX "IX_tblUserSettings_UserID" ON "tblUserSettings"("UserID");

-- ============================================
-- PRICE LIST TABLE
-- ============================================
CREATE TABLE "tblPriceList" (
    "ItemID"                VARCHAR(255)     NOT NULL PRIMARY KEY,
    "Category"              VARCHAR(255)     NULL,
    "Description"           VARCHAR(255)     NULL,
    "Dispensary"            VARCHAR(255)     NULL,
    "Specsavers"            DOUBLE PRECISION NULL,
    "Specsavers Band 2023"  DOUBLE PRECISION NULL,
    "B1"                    DOUBLE PRECISION NULL,
    "B2"                    DOUBLE PRECISION NULL,
    "B3"                    DOUBLE PRECISION NULL,
    "B4"                    DOUBLE PRECISION NULL,
    "5%"                    DOUBLE PRECISION NULL,
    "6%"                    DOUBLE PRECISION NULL,
    "10%"                   DOUBLE PRECISION NULL,
    "50%"                   DOUBLE PRECISION NULL,
    "Swindon"               DOUBLE PRECISION NULL,
    "HealthScreen&Hear4u"   DOUBLE PRECISION NULL,
    "StAnns&Whittington"    DOUBLE PRECISION NULL,
    "NHS Band 1"            DOUBLE PRECISION NULL,
    "NHS Band 2"            DOUBLE PRECISION NULL,
    "NHS Band 3"            DOUBLE PRECISION NULL,
    "NHS Band 4"            DOUBLE PRECISION NULL,
    "NHS Band 5"            DOUBLE PRECISION NULL,
    "NHS Band 6"            DOUBLE PRECISION NULL,
    "NHS Band 7"            DOUBLE PRECISION NULL,
    "NHS Band 8"            DOUBLE PRECISION NULL,
    "NHS Band 9"            DOUBLE PRECISION NULL,
    "NHS Band 10"           DOUBLE PRECISION NULL,
    "NHS Band 11"           DOUBLE PRECISION NULL,
    "NHS Band 12"           DOUBLE PRECISION NULL,
    "NHS Band 13"           DOUBLE PRECISION NULL,
    "NHS Band 14"           DOUBLE PRECISION NULL,
    "NHS Band 15"           DOUBLE PRECISION NULL,
    "NHS Band 16"           DOUBLE PRECISION NULL,
    "NHS Band 17"           DOUBLE PRECISION NULL,
    "NHS Band 18"           DOUBLE PRECISION NULL,
    "NHS Band 19"           DOUBLE PRECISION NULL,
    "NHS Band 20"           DOUBLE PRECISION NULL,
    "NHS Band 21"           DOUBLE PRECISION NULL,
    "NHS Band 22"           DOUBLE PRECISION NULL,
    "NHS Band 23"           DOUBLE PRECISION NULL,
    "NHS Band 24"           DOUBLE PRECISION NULL,
    "NHS Band 24 Discount"  DOUBLE PRECISION NULL,
    "New Framework Cost"    DOUBLE PRECISION NULL
);
