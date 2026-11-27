/* V16_20261126_AddDeviceStoreSerial.sql | Canonical tenant migration managed by managerProject. */
/*
  Tenant migration: StoreSerialNumber on repair.Devices.
  Internal workshop serial is distinct from the manufacturer's SerialNumber.
  Apply to every tenant database before deploying the matching Repair code.
*/
SET XACT_ABORT ON;
GO
IF OBJECT_ID(N'repair.Devices', N'U') IS NULL
  THROW 51201, 'repair.Devices does not exist. Apply the tenant initial schema first.', 1;
GO
IF COL_LENGTH(N'repair.Devices', N'StoreSerialNumber') IS NULL
  ALTER TABLE repair.Devices ADD StoreSerialNumber NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'repair.Devices') AND name=N'UX_repair_Devices_StoreSerialNumber')
  CREATE UNIQUE INDEX UX_repair_Devices_StoreSerialNumber ON repair.Devices(StoreSerialNumber)
    WHERE StoreSerialNumber IS NOT NULL AND DeletedAt IS NULL;
GO
