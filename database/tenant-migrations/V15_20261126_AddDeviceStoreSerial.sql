/*
  Tenant migration: add the workshop's internal device serial number.
  Manufacturer serial (SerialNumber) remains unchanged and independent.
  Idempotent and safe for both new and existing tenant databases.
*/
SET XACT_ABORT ON;

IF OBJECT_ID(N'repair.Devices', N'U') IS NULL
  THROW 51201, 'repair.Devices does not exist. Apply V1_InitialSchema first.', 1;

IF COL_LENGTH(N'repair.Devices', N'StoreSerialNumber') IS NULL
  ALTER TABLE repair.Devices ADD StoreSerialNumber NVARCHAR(100) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'repair.Devices')
    AND name = N'UX_repair_Devices_StoreSerialNumber'
)
  CREATE UNIQUE INDEX UX_repair_Devices_StoreSerialNumber
    ON repair.Devices(StoreSerialNumber)
    WHERE StoreSerialNumber IS NOT NULL AND DeletedAt IS NULL;
