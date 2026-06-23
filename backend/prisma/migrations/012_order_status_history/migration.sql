CREATE TABLE "tblOrderStatusHistory" (
  "Id"          SERIAL        PRIMARY KEY,
  "OrderNumber" INTEGER       NOT NULL,
  "OrderBatch"  INTEGER       NOT NULL,
  "Status"      VARCHAR(20)   NOT NULL,
  "ChangedOn"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "fk_status_history_order"
    FOREIGN KEY ("OrderNumber", "OrderBatch")
    REFERENCES "tblOrder"("OrderNumber", "OrderBatch")
    ON DELETE CASCADE
);

CREATE INDEX "idx_status_history_order"
  ON "tblOrderStatusHistory" ("OrderNumber", "OrderBatch");

-- Back-fill one row per existing order using the current status and statusChangedOn
INSERT INTO "tblOrderStatusHistory" ("OrderNumber", "OrderBatch", "Status", "ChangedOn")
SELECT "OrderNumber", "OrderBatch", "Status", COALESCE("StatusChangedOn", "CreatedOn")
FROM   "tblOrder";
