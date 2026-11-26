/*
  Tenant migration: optional user-defined internal serial for each repair-order item.
  The value belongs to repair.RepairOrders, not the reusable repair.Devices record.
  It is entered by the operator; no serial is generated or backfilled automatically.
  Duplicate non-empty values are rejected within the tenant database.
  Idempotent and safe for existing tenant databases.
*/
SET XACT_ABORT ON;

IF OBJECT_ID(N'repair.RepairOrders', N'U') IS NULL
  THROW 51201, 'repair.RepairOrders does not exist. Apply V1_InitialSchema first.', 1;

IF COL_LENGTH(N'repair.RepairOrders', N'InternalSerialNumber') IS NULL
  ALTER TABLE repair.RepairOrders ADD InternalSerialNumber NVARCHAR(100) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'repair.RepairOrders')
    AND name = N'UX_RepairOrders_InternalSerialNumber'
)
  CREATE UNIQUE INDEX UX_RepairOrders_InternalSerialNumber
    ON repair.RepairOrders(InternalSerialNumber)
    WHERE InternalSerialNumber IS NOT NULL AND DeletedAt IS NULL;
