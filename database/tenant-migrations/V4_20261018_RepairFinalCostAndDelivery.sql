IF SCHEMA_ID(N'repair') IS NULL
  THROW 51000, 'The repair schema is required.', 1;
IF OBJECT_ID(N'repair.RepairOrders', N'U') IS NULL
  THROW 51001, 'repair.RepairOrders table is required.', 1;
IF OBJECT_ID(N'repair.RepairServices', N'U') IS NULL
  THROW 51002, 'repair.RepairServices table is required.', 1;
IF OBJECT_ID(N'repair.RepairParts', N'U') IS NULL
  THROW 51003, 'repair.RepairParts table is required.', 1;
IF OBJECT_ID(N'repair.RepairDeliveries', N'U') IS NULL
  THROW 51004, 'repair.RepairDeliveries table is required.', 1;
IF COL_LENGTH(N'repair.RepairOrders', N'EstimatedCost') IS NULL
  THROW 51005, 'repair.RepairOrders.EstimatedCost is required.', 1;
IF COL_LENGTH(N'repair.RepairOrders', N'FinalCost') IS NULL
  THROW 51006, 'repair.RepairOrders.FinalCost is required.', 1;
GO

IF OBJECT_ID(N'repair.ServiceCatalog', N'U') IS NULL
BEGIN
  CREATE TABLE repair.ServiceCatalog (
    ServiceCatalogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_repair_ServiceCatalog PRIMARY KEY,
    Name NVARCHAR(150) NOT NULL,
    Description NVARCHAR(500) NULL,
    DefaultPrice BIGINT NOT NULL CONSTRAINT DF_repair_ServiceCatalog_DefaultPrice DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_repair_ServiceCatalog_IsActive DEFAULT (1),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_repair_ServiceCatalog_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2(0) NULL,
    CONSTRAINT CK_repair_ServiceCatalog_DefaultPrice CHECK (DefaultPrice >= 0)
  );
  CREATE INDEX IX_repair_ServiceCatalog_ActiveName ON repair.ServiceCatalog(IsActive, Name);
END;
GO

IF COL_LENGTH(N'repair.RepairServices', N'ServiceCatalogId') IS NULL
BEGIN
  ALTER TABLE repair.RepairServices ADD ServiceCatalogId BIGINT NULL;
  ALTER TABLE repair.RepairServices ADD CONSTRAINT FK_repair_RepairServices_ServiceCatalog
    FOREIGN KEY (ServiceCatalogId) REFERENCES repair.ServiceCatalog(ServiceCatalogId);
  CREATE INDEX IX_repair_RepairServices_ServiceCatalogId ON repair.RepairServices(ServiceCatalogId);
END;
GO


