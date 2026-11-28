/*
  Store the address selected for each receipt.
  Run this script against the Repair database before deploying the intake changes.
  Existing receipts remain valid and keep a NULL CustomerAddressId.
*/
IF OBJECT_ID(N'repair.Receipts', N'U') IS NULL
    THROW 51000, 'repair.Receipts table is required.', 1;
IF OBJECT_ID(N'crm.CustomerAddresses', N'U') IS NULL
    THROW 51001, 'crm.CustomerAddresses table is required.', 1;
GO

IF COL_LENGTH(N'repair.Receipts', N'CustomerAddressId') IS NULL
BEGIN
    ALTER TABLE repair.Receipts ADD CustomerAddressId BIGINT NULL;
END;
IF COL_LENGTH(N'repair.Receipts', N'AddressSnapshot') IS NULL
BEGIN
    ALTER TABLE repair.Receipts ADD AddressSnapshot NVARCHAR(1000) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_repair_Receipts_CustomerAddresses'
      AND parent_object_id = OBJECT_ID(N'repair.Receipts')
)
BEGIN
    ALTER TABLE repair.Receipts
      ADD CONSTRAINT FK_repair_Receipts_CustomerAddresses
      FOREIGN KEY (CustomerAddressId)
      REFERENCES crm.CustomerAddresses(CustomerAddressId);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_repair_Receipts_CustomerAddressId'
      AND object_id = OBJECT_ID(N'repair.Receipts')
)
BEGIN
    CREATE INDEX IX_repair_Receipts_CustomerAddressId
      ON repair.Receipts(CustomerAddressId)
      WHERE CustomerAddressId IS NOT NULL;
END;
GO
