-- CreateTable
CREATE TABLE "Users" (
    "UserID" SERIAL NOT NULL,
    "Username" VARCHAR(100) NOT NULL,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "FullName" VARCHAR(200),
    "Email" VARCHAR(255),
    "Role" VARCHAR(50) NOT NULL DEFAULT 'ReadOnly',
    "IsActive" BOOLEAN NOT NULL DEFAULT true,
    "LastLoginAt" TIMESTAMP(3),
    "FailedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "LockedUntil" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "CreatedBy" VARCHAR(100),
    "LinkedCustomerID" INTEGER,
    "MustChangePassword" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("UserID")
);

-- CreateTable
CREATE TABLE "Customers" (
    "CustomerID" SERIAL NOT NULL,
    "AccountNumber" VARCHAR(20),
    "CentreNumber" VARCHAR(50),
    "CompanyName" VARCHAR(200),
    "InvBuildingName" VARCHAR(100),
    "InvAddressLn1" VARCHAR(100),
    "InvAddressLn2" VARCHAR(100),
    "InvTownOrCity" VARCHAR(100),
    "InvCounty" VARCHAR(100),
    "InvPostCode" VARCHAR(10),
    "ContactName" VARCHAR(50),
    "ContactEmail" VARCHAR(50),
    "ReportEmail" VARCHAR(255),
    "ContactPhone" VARCHAR(50),
    "ContactMobille" VARCHAR(50),
    "ContactFax" VARCHAR(50),
    "Band" VARCHAR(20),
    "CreatedOn" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "Suspended" BOOLEAN NOT NULL DEFAULT false,
    "SuspendedOn" TIMESTAMP(3),

    CONSTRAINT "Customers_pkey" PRIMARY KEY ("CustomerID")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "AddressID" SERIAL NOT NULL,
    "CustomerAccount" INTEGER,
    "SiteCompanyName" VARCHAR(200),
    "DelBuildingName" VARCHAR(100),
    "DelAddressLn1" VARCHAR(100),
    "DelAddressLn2" VARCHAR(100),
    "DelTownOrCity" VARCHAR(100),
    "DelCounty" VARCHAR(100),
    "DelPostCode" VARCHAR(10),
    "SiteContactName" VARCHAR(50),
    "SiteContactEmail" VARCHAR(50),
    "SiteContactPhone" VARCHAR(50),
    "SiteContactMobille" VARCHAR(50),
    "SiteContactFax" VARCHAR(50),
    "DefaultAddress" BOOLEAN NOT NULL DEFAULT false,
    "Void" BOOLEAN NOT NULL DEFAULT false,
    "CreatedOn" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("AddressID")
);

-- CreateTable
CREATE TABLE "VatRates" (
    "VatRateID" SERIAL NOT NULL,
    "Rate" DECIMAL(5,2) NOT NULL,
    "Label" VARCHAR(50) NOT NULL,
    "ValidFrom" DATE NOT NULL,
    "ValidTo" DATE,

    CONSTRAINT "VatRates_pkey" PRIMARY KEY ("VatRateID")
);

-- CreateTable
CREATE TABLE "Order" (
    "OrderNumber" INTEGER NOT NULL,
    "OrderBatch" INTEGER NOT NULL DEFAULT 1,
    "CustomerAccount" INTEGER,
    "CustomerRef" VARCHAR(50),
    "OrderContact" VARCHAR(100),
    "DeliveryAddress" INTEGER,
    "ReceivedOn" TIMESTAMP(3),
    "DispatchedOn" TIMESTAMP(3),
    "VatRateID" INTEGER,
    "PriceBand" VARCHAR(20),
    "CreatedOn" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "DispatchDateStamp" TIMESTAMP(3),
    "Void" BOOLEAN NOT NULL DEFAULT false,
    "VoidDateStamp" TIMESTAMP(3),
    "VoidedBy" VARCHAR(100),
    "CreatedBy" VARCHAR(100),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'Received',
    "StatusChangedOn" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("OrderNumber","OrderBatch")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "Id" SERIAL NOT NULL,
    "OrderNumber" INTEGER NOT NULL,
    "OrderBatch" INTEGER NOT NULL,
    "Status" VARCHAR(20) NOT NULL,
    "ChangedOn" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "OrderedItems" (
    "SerialNumber" VARCHAR(9) NOT NULL,
    "PatientInitial" VARCHAR(5),
    "PatientSurname" VARCHAR(50),
    "ModelCode" VARCHAR(50),
    "CreatedOn" TIMESTAMP(3),
    "Week" INTEGER DEFAULT 0,
    "ParentOrder" INTEGER,
    "ParentBatch" INTEGER,
    "CustomerRef" VARCHAR(20),
    "Side" VARCHAR(1),
    "Description" VARCHAR(50),
    "Category" VARCHAR(50),
    "Price" DOUBLE PRECISION DEFAULT 0,
    "Vent" REAL DEFAULT 0,
    "Colour" VARCHAR(50),
    "Tubing" VARCHAR(50),
    "Options" VARCHAR(50),
    "CheckedOut" BOOLEAN NOT NULL DEFAULT false,
    "CheckoutDateStamp" TIMESTAMP(3),
    "Void" BOOLEAN NOT NULL DEFAULT false,
    "VoidDateStamp" TIMESTAMP(3),
    "VoidedBy" VARCHAR(100),
    "CreatedBy" VARCHAR(100),
    "PriceListRevisionID" INTEGER,
    "PriceListName" VARCHAR(255),

    CONSTRAINT "OrderedItems_pkey" PRIMARY KEY ("SerialNumber")
);

-- CreateTable
CREATE TABLE "GlobalSettings" (
    "Key" VARCHAR(255) NOT NULL,
    "Val" TEXT,
    "Description" TEXT,
    "Exposed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("Key")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "UserID" INTEGER NOT NULL,
    "Key" VARCHAR(255) NOT NULL,
    "Val" TEXT,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("UserID","Key")
);

-- CreateTable
CREATE TABLE "Sequences" (
    "Key" VARCHAR(50) NOT NULL,
    "Counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequences_pkey" PRIMARY KEY ("Key")
);

-- CreateTable
CREATE TABLE "UserAuditLog" (
    "AuditID" SERIAL NOT NULL,
    "UserID" INTEGER,
    "Username" VARCHAR(100) NOT NULL,
    "Event" VARCHAR(50) NOT NULL,
    "Detail" VARCHAR(500),
    "IPAddress" VARCHAR(45),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAuditLog_pkey" PRIMARY KEY ("AuditID")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "ItemID" VARCHAR(255) NOT NULL,
    "Category" VARCHAR(255),
    "Description" VARCHAR(255),
    "Void" BOOLEAN NOT NULL DEFAULT false,
    "VoidDateStamp" TIMESTAMP(3),
    "VoidedBy" VARCHAR(100),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "CreatedBy" VARCHAR(100),

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("ItemID")
);

-- CreateTable
CREATE TABLE "PriceListType" (
    "ListID" SERIAL NOT NULL,
    "Name" VARCHAR(255) NOT NULL,
    "DisplayName" VARCHAR(255),
    "SortOrder" INTEGER NOT NULL DEFAULT 0,
    "IsActive" BOOLEAN NOT NULL DEFAULT true,
    "Void" BOOLEAN NOT NULL DEFAULT false,
    "VoidDateStamp" TIMESTAMP(3),
    "VoidedBy" VARCHAR(100),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "CreatedBy" VARCHAR(100),

    CONSTRAINT "PriceListType_pkey" PRIMARY KEY ("ListID")
);

-- CreateTable
CREATE TABLE "PriceListRevision" (
    "RevisionID" SERIAL NOT NULL,
    "Name" VARCHAR(255) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "ImportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ActivatedAt" TIMESTAMP(3),
    "Notes" VARCHAR(1000),
    "ImportedBy" VARCHAR(255),

    CONSTRAINT "PriceListRevision_pkey" PRIMARY KEY ("RevisionID")
);

-- CreateTable
CREATE TABLE "ItemPrice" (
    "ItemID" TEXT NOT NULL,
    "ListID" INTEGER NOT NULL,
    "RevisionID" INTEGER NOT NULL,
    "Price" DOUBLE PRECISION,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("ItemID","ListID","RevisionID")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_Username_key" ON "Users"("Username");

-- CreateIndex
CREATE INDEX "Users_LinkedCustomerID_idx" ON "Users"("LinkedCustomerID");

-- CreateIndex
CREATE INDEX "CustomerAddress_CustomerAccount_idx" ON "CustomerAddress"("CustomerAccount");

-- CreateIndex
CREATE INDEX "Order_CustomerAccount_idx" ON "Order"("CustomerAccount");

-- CreateIndex
CREATE INDEX "Order_DeliveryAddress_idx" ON "Order"("DeliveryAddress");

-- CreateIndex
CREATE INDEX "Order_VatRateID_idx" ON "Order"("VatRateID");

-- CreateIndex
CREATE INDEX "Order_CreatedBy_idx" ON "Order"("CreatedBy");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_OrderNumber_OrderBatch_idx" ON "OrderStatusHistory"("OrderNumber", "OrderBatch");

-- CreateIndex
CREATE INDEX "OrderedItems_ParentOrder_ParentBatch_idx" ON "OrderedItems"("ParentOrder", "ParentBatch");

-- CreateIndex
CREATE INDEX "OrderedItems_CreatedBy_idx" ON "OrderedItems"("CreatedBy");

-- CreateIndex
CREATE INDEX "UserSettings_UserID_idx" ON "UserSettings"("UserID");

-- CreateIndex
CREATE INDEX "UserAuditLog_UserID_idx" ON "UserAuditLog"("UserID");

-- CreateIndex
CREATE INDEX "UserAuditLog_Event_idx" ON "UserAuditLog"("Event");

-- CreateIndex
CREATE INDEX "UserAuditLog_CreatedAt_idx" ON "UserAuditLog"("CreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListType_Name_key" ON "PriceListType"("Name");

-- CreateIndex
CREATE INDEX "PriceListRevision_Status_idx" ON "PriceListRevision"("Status");

-- CreateIndex
CREATE INDEX "ItemPrice_RevisionID_idx" ON "ItemPrice"("RevisionID");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_LinkedCustomerID_fkey" FOREIGN KEY ("LinkedCustomerID") REFERENCES "Customers"("CustomerID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_CustomerAccount_fkey" FOREIGN KEY ("CustomerAccount") REFERENCES "Customers"("CustomerID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_CustomerAccount_fkey" FOREIGN KEY ("CustomerAccount") REFERENCES "Customers"("CustomerID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_DeliveryAddress_fkey" FOREIGN KEY ("DeliveryAddress") REFERENCES "CustomerAddress"("AddressID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_VatRateID_fkey" FOREIGN KEY ("VatRateID") REFERENCES "VatRates"("VatRateID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_OrderNumber_OrderBatch_fkey" FOREIGN KEY ("OrderNumber", "OrderBatch") REFERENCES "Order"("OrderNumber", "OrderBatch") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderedItems" ADD CONSTRAINT "OrderedItems_ParentOrder_ParentBatch_fkey" FOREIGN KEY ("ParentOrder", "ParentBatch") REFERENCES "Order"("OrderNumber", "OrderBatch") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderedItems" ADD CONSTRAINT "OrderedItems_PriceListRevisionID_fkey" FOREIGN KEY ("PriceListRevisionID") REFERENCES "PriceListRevision"("RevisionID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "Users"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_ItemID_fkey" FOREIGN KEY ("ItemID") REFERENCES "PriceListItem"("ItemID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_ListID_fkey" FOREIGN KEY ("ListID") REFERENCES "PriceListType"("ListID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_RevisionID_fkey" FOREIGN KEY ("RevisionID") REFERENCES "PriceListRevision"("RevisionID") ON DELETE CASCADE ON UPDATE CASCADE;
