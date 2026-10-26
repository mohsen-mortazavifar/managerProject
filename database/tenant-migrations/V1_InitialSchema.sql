/*
  Tenant migration: V1_InitialSchema
  This script must run against the target tenant database, not Repair_Master.
  The provisioning worker connects to the database first and splits batches on GO.
  Version is recorded only after the schema is successfully applied.
*/
/* =========================================================
   Tenant_Template.sql
   اجرا در دیتابیس هر Tenant (بدون CREATE DATABASE)
   ========================================================= */
SET NOCOUNT ON;
GO

/* ============ Schemas ============ */
IF SCHEMA_ID('core')         IS NULL EXEC('CREATE SCHEMA core');
IF SCHEMA_ID('crm')          IS NULL EXEC('CREATE SCHEMA crm');
IF SCHEMA_ID('repair')       IS NULL EXEC('CREATE SCHEMA repair');
IF SCHEMA_ID('inventory')    IS NULL EXEC('CREATE SCHEMA inventory');
IF SCHEMA_ID('files')        IS NULL EXEC('CREATE SCHEMA files');
IF SCHEMA_ID('notification') IS NULL EXEC('CREATE SCHEMA notification');
IF SCHEMA_ID('audit')        IS NULL EXEC('CREATE SCHEMA audit');
GO

/* ============ __SchemaVersions ============ */
IF OBJECT_ID('dbo.__SchemaVersions','U') IS NULL
CREATE TABLE dbo.__SchemaVersions (
    MigrationId  BIGINT IDENTITY(1,1) NOT NULL,
    Version      NVARCHAR(50) NOT NULL,
    Description  NVARCHAR(500) NULL,
    Checksum     NVARCHAR(128) NULL,
    AppliedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK___SchemaVersions PRIMARY KEY CLUSTERED (MigrationId),
    CONSTRAINT UQ___SchemaVersions_Version UNIQUE (Version)
);
GO

/* ============ core ============ */
IF OBJECT_ID('core.Branches','U') IS NULL
CREATE TABLE core.Branches (
    BranchId   BIGINT IDENTITY(1,1) NOT NULL,
    Code       NVARCHAR(50)  NOT NULL,
    Name       NVARCHAR(200) NOT NULL,
    Phone      NVARCHAR(20)  NULL,
    Address    NVARCHAR(500) NULL,
    IsMain     BIT NOT NULL CONSTRAINT DF_Branches_IsMain DEFAULT (0),
    IsActive   BIT NOT NULL CONSTRAINT DF_Branches_IsActive DEFAULT (1),
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_Branches_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt  DATETIME2(3) NULL,
    DeletedAt  DATETIME2(3) NULL,
    CONSTRAINT PK_Branches PRIMARY KEY CLUSTERED (BranchId),
    CONSTRAINT UQ_Branches_Code UNIQUE (Code)
);
GO

IF OBJECT_ID('core.BranchUsers','U') IS NULL
CREATE TABLE core.BranchUsers (
    BranchUserId BIGINT IDENTITY(1,1) NOT NULL,
    BranchId     BIGINT NOT NULL,
    UserId       BIGINT NOT NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_BranchUsers_IsActive DEFAULT (1),
    AssignedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_BranchUsers_AssignedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_BranchUsers PRIMARY KEY CLUSTERED (BranchUserId),
    CONSTRAINT UQ_BranchUsers_BranchId_UserId UNIQUE (BranchId, UserId),
    CONSTRAINT FK_BranchUsers_Branches FOREIGN KEY (BranchId) REFERENCES core.Branches(BranchId)
);
GO

IF OBJECT_ID('core.Settings','U') IS NULL
CREATE TABLE core.Settings (
    SettingId    BIGINT IDENTITY(1,1) NOT NULL,
    SettingKey   NVARCHAR(100) NOT NULL,
    SettingValue NVARCHAR(MAX) NULL,
    Description  NVARCHAR(500) NULL,
    UpdatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Settings_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_Settings PRIMARY KEY CLUSTERED (SettingId),
    CONSTRAINT UQ_Settings_SettingKey UNIQUE (SettingKey)
);
GO

IF OBJECT_ID('core.DocumentCounters','U') IS NULL
CREATE TABLE core.DocumentCounters (
    CounterId    BIGINT IDENTITY(1,1) NOT NULL,
    CounterType  NVARCHAR(50) NOT NULL,
    PeriodKey    NVARCHAR(10) NOT NULL,
    CurrentValue BIGINT NOT NULL CONSTRAINT DF_DocumentCounters_CurrentValue DEFAULT (0),
    UpdatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_DocumentCounters_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_DocumentCounters PRIMARY KEY CLUSTERED (CounterId),
    CONSTRAINT UQ_DocumentCounters_Type_Period UNIQUE (CounterType, PeriodKey),
    CONSTRAINT CK_DocumentCounters_CurrentValue CHECK (CurrentValue >= 0)
);
GO

/* ============ crm ============ */
IF OBJECT_ID('crm.Customers','U') IS NULL
CREATE TABLE crm.Customers (
    CustomerId   BIGINT IDENTITY(1,1) NOT NULL,
    FirstName    NVARCHAR(100) NOT NULL,
    LastName     NVARCHAR(100) NULL,
    Mobile       NVARCHAR(20)  NOT NULL,
    NationalCode NVARCHAR(10)  NULL,
    Email        NVARCHAR(255) NULL,
    Notes        NVARCHAR(1000) NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_Customers_IsActive DEFAULT (1),
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt    DATETIME2(3) NULL,
    DeletedAt    DATETIME2(3) NULL,
    CONSTRAINT PK_Customers PRIMARY KEY CLUSTERED (CustomerId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Customers_Mobile' AND object_id = OBJECT_ID(N'crm.Customers'))
BEGIN
    CREATE UNIQUE INDEX UQ_Customers_Mobile ON crm.Customers(Mobile) WHERE DeletedAt IS NULL;
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Customers_Name' AND object_id = OBJECT_ID(N'crm.Customers'))
BEGIN
    CREATE INDEX IX_Customers_Name ON crm.Customers(LastName, FirstName);
END;
GO

IF OBJECT_ID('crm.CustomerAddresses','U') IS NULL
CREATE TABLE crm.CustomerAddresses (
    CustomerAddressId BIGINT IDENTITY(1,1) NOT NULL,
    CustomerId        BIGINT NOT NULL,
    Title             NVARCHAR(100) NULL,
    Province          NVARCHAR(100) NULL,
    City              NVARCHAR(100) NULL,
    AddressLine       NVARCHAR(500) NOT NULL,
    PostalCode        NVARCHAR(10)  NULL,
    IsDefault         BIT NOT NULL CONSTRAINT DF_CustomerAddresses_IsDefault DEFAULT (0),
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_CustomerAddresses_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_CustomerAddresses PRIMARY KEY CLUSTERED (CustomerAddressId),
    CONSTRAINT FK_CustomerAddresses_Customers FOREIGN KEY (CustomerId) REFERENCES crm.Customers(CustomerId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CustomerAddresses_CustomerId' AND object_id = OBJECT_ID(N'crm.CustomerAddresses'))
BEGIN
    CREATE INDEX IX_CustomerAddresses_CustomerId ON crm.CustomerAddresses(CustomerId);
END;
GO

IF OBJECT_ID('crm.CustomerContacts','U') IS NULL
CREATE TABLE crm.CustomerContacts (
    CustomerContactId BIGINT IDENTITY(1,1) NOT NULL,
    CustomerId        BIGINT NOT NULL,
    ContactType       NVARCHAR(30) NULL,
    Value             NVARCHAR(255) NOT NULL,
    IsPrimary         BIT NOT NULL CONSTRAINT DF_CustomerContacts_IsPrimary DEFAULT (0),
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_CustomerContacts_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_CustomerContacts PRIMARY KEY CLUSTERED (CustomerContactId),
    CONSTRAINT FK_CustomerContacts_Customers FOREIGN KEY (CustomerId) REFERENCES crm.Customers(CustomerId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CustomerContacts_CustomerId' AND object_id = OBJECT_ID(N'crm.CustomerContacts'))
BEGIN
    CREATE INDEX IX_CustomerContacts_CustomerId ON crm.CustomerContacts(CustomerId);
END;
GO

/* ============ repair ============ */
IF OBJECT_ID('repair.Devices','U') IS NULL
CREATE TABLE repair.Devices (
    DeviceId     BIGINT IDENTITY(1,1) NOT NULL,
    CustomerId   BIGINT NOT NULL,
    DeviceType   NVARCHAR(50)  NOT NULL,
    Brand        NVARCHAR(100) NOT NULL,
    Model        NVARCHAR(100) NULL,
    SerialNumber NVARCHAR(100) NULL,
    Color        NVARCHAR(50)  NULL,
    Notes        NVARCHAR(500) NULL,
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Devices_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt    DATETIME2(3) NULL,
    DeletedAt    DATETIME2(3) NULL,
    CONSTRAINT PK_Devices PRIMARY KEY CLUSTERED (DeviceId),
    CONSTRAINT FK_Devices_Customers FOREIGN KEY (CustomerId) REFERENCES crm.Customers(CustomerId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Devices_CustomerId' AND object_id = OBJECT_ID(N'repair.Devices'))
BEGIN
    CREATE INDEX IX_Devices_CustomerId ON repair.Devices(CustomerId);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Devices_SerialNumber' AND object_id = OBJECT_ID(N'repair.Devices'))
BEGIN
    CREATE INDEX IX_Devices_SerialNumber ON repair.Devices(SerialNumber) WHERE SerialNumber IS NOT NULL;
END;
GO

IF OBJECT_ID('repair.Receipts','U') IS NULL
CREATE TABLE repair.Receipts (
    ReceiptId        BIGINT IDENTITY(1,1) NOT NULL,
    ReceiptNumber    NVARCHAR(30) NOT NULL,
    CustomerId       BIGINT NOT NULL,
    BranchId         BIGINT NOT NULL,
    ReceivedByUserId BIGINT NOT NULL,
    TrackingToken    UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Receipts_TrackingToken DEFAULT (NEWID()),
    Status           NVARCHAR(30) NOT NULL CONSTRAINT DF_Receipts_Status DEFAULT ('Open'),
    ReceivedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_Receipts_ReceivedAt DEFAULT (SYSUTCDATETIME()),
    Notes            NVARCHAR(1000) NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_Receipts_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(3) NULL,
    CONSTRAINT PK_Receipts PRIMARY KEY CLUSTERED (ReceiptId),
    CONSTRAINT UQ_Receipts_ReceiptNumber UNIQUE (ReceiptNumber),
    CONSTRAINT UQ_Receipts_TrackingToken UNIQUE (TrackingToken),
    CONSTRAINT FK_Receipts_Customers FOREIGN KEY (CustomerId) REFERENCES crm.Customers(CustomerId),
    CONSTRAINT FK_Receipts_Branches  FOREIGN KEY (BranchId)   REFERENCES core.Branches(BranchId),
    CONSTRAINT CK_Receipts_Status CHECK (Status IN ('Open','PartiallyDelivered','Delivered','Cancelled'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Receipts_CustomerId' AND object_id = OBJECT_ID(N'repair.Receipts'))
BEGIN
    CREATE INDEX IX_Receipts_CustomerId ON repair.Receipts(CustomerId, ReceivedAt DESC);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Receipts_ReceivedAt' AND object_id = OBJECT_ID(N'repair.Receipts'))
BEGIN
    CREATE INDEX IX_Receipts_ReceivedAt ON repair.Receipts(ReceivedAt DESC);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Receipts_Branch_Date' AND object_id = OBJECT_ID(N'repair.Receipts'))
BEGIN
    CREATE INDEX IX_Receipts_Branch_Date ON repair.Receipts(BranchId, ReceivedAt DESC);
END;
GO

IF OBJECT_ID('repair.RepairOrders','U') IS NULL
CREATE TABLE repair.RepairOrders (
    RepairOrderId        BIGINT IDENTITY(1,1) NOT NULL,
    ReceiptId            BIGINT NOT NULL,
    DeviceId             BIGINT NOT NULL,
    CustomerId           BIGINT NOT NULL,
    BranchId             BIGINT NOT NULL,
    TrackingToken        UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RepairOrders_TrackingToken DEFAULT (NEWID()),
    ProblemDescription   NVARCHAR(2000) NULL,
    TechnicianNotes      NVARCHAR(2000) NULL,
    CurrentStatus        NVARCHAR(30) NOT NULL CONSTRAINT DF_RepairOrders_CurrentStatus DEFAULT ('Received'),
    EstimatedCost        BIGINT NULL,
    FinalCost            BIGINT NULL,
    EstimatedDeliveryAt  DATETIME2(0) NULL,
    DeliveredAt          DATETIME2(0) NULL,
    ReceivedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_RepairOrders_ReceivedAt DEFAULT (SYSUTCDATETIME()),
    BrandSnapshot        NVARCHAR(100) NOT NULL,
    ModelSnapshot        NVARCHAR(100) NULL,
    SerialNumberSnapshot NVARCHAR(100) NULL,
    DeviceTypeSnapshot   NVARCHAR(50)  NOT NULL,
    ColorSnapshot        NVARCHAR(50)  NULL,
    IsActive             BIT NOT NULL CONSTRAINT DF_RepairOrders_IsActive DEFAULT (1),
    CreatedAt            DATETIME2(3) NOT NULL CONSTRAINT DF_RepairOrders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt            DATETIME2(3) NULL,
    DeletedAt            DATETIME2(3) NULL,
    CONSTRAINT PK_RepairOrders PRIMARY KEY CLUSTERED (RepairOrderId),
    CONSTRAINT UQ_RepairOrders_TrackingToken UNIQUE (TrackingToken),
    CONSTRAINT FK_RepairOrders_Receipts   FOREIGN KEY (ReceiptId)   REFERENCES repair.Receipts(ReceiptId),
    CONSTRAINT FK_RepairOrders_Devices    FOREIGN KEY (DeviceId)    REFERENCES repair.Devices(DeviceId),
    CONSTRAINT FK_RepairOrders_Customers  FOREIGN KEY (CustomerId)  REFERENCES crm.Customers(CustomerId),
    CONSTRAINT FK_RepairOrders_Branches   FOREIGN KEY (BranchId)    REFERENCES core.Branches(BranchId),
    CONSTRAINT CK_RepairOrders_Status CHECK (CurrentStatus IN
        ('Received','Diagnosing','WaitingCustomerApproval','WaitingPart',
         'Repairing','Repaired','ReadyForDelivery','Delivered',
         'ReturnedUnderWarranty','Cancelled')),
    CONSTRAINT CK_RepairOrders_Costs CHECK (
        (EstimatedCost IS NULL OR EstimatedCost >= 0) AND
        (FinalCost     IS NULL OR FinalCost     >= 0))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairOrders_DeviceId' AND object_id = OBJECT_ID(N'repair.RepairOrders'))
BEGIN
    CREATE INDEX IX_RepairOrders_DeviceId ON repair.RepairOrders(DeviceId, ReceivedAt DESC);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairOrders_ReceiptId' AND object_id = OBJECT_ID(N'repair.RepairOrders'))
BEGIN
    CREATE INDEX IX_RepairOrders_ReceiptId ON repair.RepairOrders(ReceiptId);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairOrders_Status' AND object_id = OBJECT_ID(N'repair.RepairOrders'))
BEGIN
    CREATE INDEX IX_RepairOrders_Status ON repair.RepairOrders(CurrentStatus, ReceivedAt DESC) WHERE IsActive = 1;
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairOrders_Branch_Status' AND object_id = OBJECT_ID(N'repair.RepairOrders'))
BEGIN
    CREATE INDEX IX_RepairOrders_Branch_Status ON repair.RepairOrders(BranchId, CurrentStatus);
END;
GO

IF OBJECT_ID('repair.RepairOrderStatusHistory','U') IS NULL
CREATE TABLE repair.RepairOrderStatusHistory (
    StatusHistoryId BIGINT IDENTITY(1,1) NOT NULL,
    RepairOrderId   BIGINT NOT NULL,
    FromStatus      NVARCHAR(30) NULL,
    ToStatus        NVARCHAR(30) NOT NULL,
    ChangedByUserId BIGINT NULL,
    Notes           NVARCHAR(1000) NULL,
    ChangedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_ROSH_ChangedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_RepairOrderStatusHistory PRIMARY KEY CLUSTERED (StatusHistoryId),
    CONSTRAINT FK_ROSH_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT CK_ROSH_ToStatus CHECK (ToStatus IN
        ('Received','Diagnosing','WaitingCustomerApproval','WaitingPart',
         'Repairing','Repaired','ReadyForDelivery','Delivered',
         'ReturnedUnderWarranty','Cancelled')),
    CONSTRAINT CK_ROSH_FromStatus CHECK (FromStatus IS NULL OR FromStatus IN
        ('Received','Diagnosing','WaitingCustomerApproval','WaitingPart',
         'Repairing','Repaired','ReadyForDelivery','Delivered',
         'ReturnedUnderWarranty','Cancelled'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ROSH_Order' AND object_id = OBJECT_ID(N'repair.RepairOrderStatusHistory'))
BEGIN
    CREATE INDEX IX_ROSH_Order ON repair.RepairOrderStatusHistory(RepairOrderId, ChangedAt DESC);
END;
GO

IF OBJECT_ID('repair.RepairServices','U') IS NULL
CREATE TABLE repair.RepairServices (
    RepairServiceId BIGINT IDENTITY(1,1) NOT NULL,
    RepairOrderId   BIGINT NOT NULL,
    ServiceTitle    NVARCHAR(200) NOT NULL,
    Description     NVARCHAR(1000) NULL,
    Price           BIGINT NOT NULL,
    Quantity        INT NOT NULL CONSTRAINT DF_RepairServices_Quantity DEFAULT (1),
    IsCompleted     BIT NOT NULL CONSTRAINT DF_RepairServices_IsCompleted DEFAULT (0),
    ServiceCatalogId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_RepairServices_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_RepairServices PRIMARY KEY CLUSTERED (RepairServiceId),
    CONSTRAINT FK_RepairServices_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT CK_RepairServices_Price CHECK (Price >= 0),
    CONSTRAINT CK_RepairServices_Quantity CHECK (Quantity > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairServices_Order' AND object_id = OBJECT_ID(N'repair.RepairServices'))
BEGIN
    CREATE INDEX IX_RepairServices_Order ON repair.RepairServices(RepairOrderId);
END;
GO

/* ============ inventory (Parts) ============ */
IF OBJECT_ID('inventory.Parts','U') IS NULL
CREATE TABLE inventory.Parts (
    PartId       BIGINT IDENTITY(1,1) NOT NULL,
    PartNumber   NVARCHAR(100) NOT NULL,
    Name         NVARCHAR(200) NOT NULL,
    Description  NVARCHAR(500) NULL,
    Category     NVARCHAR(100) NULL,
    CurrentPrice BIGINT NOT NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_Parts_IsActive DEFAULT (1),
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Parts_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt    DATETIME2(3) NULL,
    CONSTRAINT PK_Parts PRIMARY KEY CLUSTERED (PartId),
    CONSTRAINT UQ_Parts_PartNumber UNIQUE (PartNumber),
    CONSTRAINT CK_Parts_CurrentPrice CHECK (CurrentPrice >= 0)
);
GO

IF OBJECT_ID('inventory.PartPriceHistory','U') IS NULL
CREATE TABLE inventory.PartPriceHistory (
    PartPriceHistoryId BIGINT IDENTITY(1,1) NOT NULL,
    PartId             BIGINT NOT NULL,
    Price              BIGINT NOT NULL,
    EffectiveFrom      DATETIME2(3) NOT NULL CONSTRAINT DF_PartPriceHistory_EffectiveFrom DEFAULT (SYSUTCDATETIME()),
    EffectiveTo        DATETIME2(3) NULL,
    ChangedByUserId    BIGINT NULL,
    CreatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_PartPriceHistory_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PartPriceHistory PRIMARY KEY CLUSTERED (PartPriceHistoryId),
    CONSTRAINT FK_PartPriceHistory_Parts FOREIGN KEY (PartId) REFERENCES inventory.Parts(PartId),
    CONSTRAINT CK_PartPriceHistory_Price CHECK (Price >= 0),
    CONSTRAINT CK_PartPriceHistory_Range CHECK (EffectiveTo IS NULL OR EffectiveTo > EffectiveFrom)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PartPriceHistory_Part' AND object_id = OBJECT_ID(N'inventory.PartPriceHistory'))
BEGIN
    CREATE INDEX IX_PartPriceHistory_Part ON inventory.PartPriceHistory(PartId, EffectiveFrom DESC);
END;
GO

IF OBJECT_ID('repair.RepairParts','U') IS NULL
CREATE TABLE repair.RepairParts (
    RepairPartId  BIGINT IDENTITY(1,1) NOT NULL,
    RepairOrderId BIGINT NOT NULL,
    PartId        BIGINT NULL,
    PartName      NVARCHAR(200) NOT NULL,
    PartNumber    NVARCHAR(100) NULL,
    Quantity      INT NOT NULL,
    UnitPrice     BIGINT NOT NULL,
    TotalPrice    AS (CAST(Quantity AS BIGINT) * UnitPrice) PERSISTED,
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_RepairParts_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_RepairParts PRIMARY KEY CLUSTERED (RepairPartId),
    CONSTRAINT FK_RepairParts_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT FK_RepairParts_Parts FOREIGN KEY (PartId) REFERENCES inventory.Parts(PartId),
    CONSTRAINT CK_RepairParts_Quantity CHECK (Quantity > 0),
    CONSTRAINT CK_RepairParts_UnitPrice CHECK (UnitPrice >= 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairParts_Order' AND object_id = OBJECT_ID(N'repair.RepairParts'))
BEGIN
    CREATE INDEX IX_RepairParts_Order ON repair.RepairParts(RepairOrderId);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairParts_Part' AND object_id = OBJECT_ID(N'repair.RepairParts'))
BEGIN
    CREATE INDEX IX_RepairParts_Part ON repair.RepairParts(PartId);
END;
GO

IF OBJECT_ID('repair.RepairDeliveries','U') IS NULL
CREATE TABLE repair.RepairDeliveries (
    RepairDeliveryId  BIGINT IDENTITY(1,1) NOT NULL,
    RepairOrderId     BIGINT NOT NULL,
    DeliveredByUserId BIGINT NULL,
    DeliveredToName   NVARCHAR(200) NULL,
    DeliveredToMobile NVARCHAR(20)  NULL,
    DeliveredAt       DATETIME2(0) NOT NULL,
    Notes             NVARCHAR(1000) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_RepairDeliveries_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_RepairDeliveries PRIMARY KEY CLUSTERED (RepairDeliveryId),
    CONSTRAINT FK_RepairDeliveries_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepairDeliveries_Order' AND object_id = OBJECT_ID(N'repair.RepairDeliveries'))
BEGIN
    CREATE INDEX IX_RepairDeliveries_Order ON repair.RepairDeliveries(RepairOrderId);
END;
GO

IF OBJECT_ID('repair.ServiceReminders','U') IS NULL
CREATE TABLE repair.ServiceReminders (
    ServiceReminderId BIGINT IDENTITY(1,1) NOT NULL,
    RepairOrderId     BIGINT NOT NULL,
    ReminderType      NVARCHAR(50) NULL,
    ReminderAt        DATETIME2(0) NOT NULL,
    Status            NVARCHAR(30) NOT NULL CONSTRAINT DF_ServiceReminders_Status DEFAULT ('Pending'),
    ProcessingAt      DATETIME2(3) NULL,
    SentAt            DATETIME2(0) NULL,
    Message           NVARCHAR(1000) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_ServiceReminders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_ServiceReminders PRIMARY KEY CLUSTERED (ServiceReminderId),
    CONSTRAINT FK_ServiceReminders_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT CK_ServiceReminders_Status CHECK (Status IN ('Pending','Processing','Sent','Cancelled','Failed'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ServiceReminders_Status' AND object_id = OBJECT_ID(N'repair.ServiceReminders'))
BEGIN
    CREATE INDEX IX_ServiceReminders_Status ON repair.ServiceReminders(Status, ReminderAt) WHERE Status = 'Pending';
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ServiceReminders_ProcessingLease' AND object_id = OBJECT_ID(N'repair.ServiceReminders'))
BEGIN
    CREATE INDEX IX_ServiceReminders_ProcessingLease ON repair.ServiceReminders(Status, ProcessingAt, ReminderAt) WHERE Status = 'Processing';
END;
GO

/* ============ files ============ */
IF OBJECT_ID('files.Files','U') IS NULL
CREATE TABLE files.Files (
    FileId           BIGINT IDENTITY(1,1) NOT NULL,
    OriginalName     NVARCHAR(255) NOT NULL,
    StoragePath      NVARCHAR(500) NOT NULL,
    MimeType         NVARCHAR(100) NOT NULL,
    Size             BIGINT NOT NULL,
    Width            INT NULL,
    Height           INT NULL,
    Hash             NVARCHAR(128) NULL,
    CreatedByUserId  BIGINT NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_Files_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_Files PRIMARY KEY CLUSTERED (FileId),
    CONSTRAINT CK_Files_Size CHECK (Size > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Files_Hash' AND object_id = OBJECT_ID(N'files.Files'))
BEGIN
    CREATE INDEX IX_Files_Hash ON files.Files(Hash) WHERE Hash IS NOT NULL;
END;
GO

IF OBJECT_ID('files.EntityFiles','U') IS NULL
CREATE TABLE files.EntityFiles (
    EntityFileId BIGINT IDENTITY(1,1) NOT NULL,
    FileId       BIGINT NOT NULL,
    EntityType   NVARCHAR(50) NOT NULL,
    EntityId     BIGINT NOT NULL,
    Purpose      NVARCHAR(50) NULL,
    SortOrder    INT NOT NULL CONSTRAINT DF_EntityFiles_SortOrder DEFAULT (0),
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_EntityFiles_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_EntityFiles PRIMARY KEY CLUSTERED (EntityFileId),
    CONSTRAINT FK_EntityFiles_Files FOREIGN KEY (FileId) REFERENCES files.Files(FileId),
    CONSTRAINT CK_EntityFiles_EntityType CHECK (EntityType IN ('RepairOrder','Customer','Device','Receipt'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EntityFiles_Entity' AND object_id = OBJECT_ID(N'files.EntityFiles'))
BEGIN
    CREATE INDEX IX_EntityFiles_Entity ON files.EntityFiles(EntityType, EntityId, SortOrder);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EntityFiles_FileId' AND object_id = OBJECT_ID(N'files.EntityFiles'))
BEGIN
    CREATE INDEX IX_EntityFiles_FileId ON files.EntityFiles(FileId);
END;
GO

/* ============ notification ============ */
IF OBJECT_ID('notification.SmsTemplates','U') IS NULL
CREATE TABLE notification.SmsTemplates (
    SmsTemplateId BIGINT IDENTITY(1,1) NOT NULL,
    Code          NVARCHAR(50) NOT NULL,
    Title         NVARCHAR(100) NOT NULL,
    Body          NVARCHAR(2000) NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_SmsTemplates_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_SmsTemplates_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(3) NULL,
    CONSTRAINT PK_SmsTemplates PRIMARY KEY CLUSTERED (SmsTemplateId),
    CONSTRAINT UQ_SmsTemplates_Code UNIQUE (Code)
);
GO

IF OBJECT_ID('notification.SmsLogs','U') IS NULL
CREATE TABLE notification.SmsLogs (
    SmsLogId          BIGINT IDENTITY(1,1) NOT NULL,
    TemplateId        BIGINT NULL,
    Mobile            NVARCHAR(20) NOT NULL,
    Message           NVARCHAR(2000) NOT NULL,
    Status            NVARCHAR(30) NOT NULL CONSTRAINT DF_SmsLogs_Status DEFAULT ('Pending'),
    ProviderMessageId NVARCHAR(100) NULL,
    ErrorMessage      NVARCHAR(1000) NULL,
    SentAt            DATETIME2(0) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_SmsLogs_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_SmsLogs PRIMARY KEY CLUSTERED (SmsLogId),
    CONSTRAINT FK_SmsLogs_SmsTemplates FOREIGN KEY (TemplateId) REFERENCES notification.SmsTemplates(SmsTemplateId),
    CONSTRAINT CK_SmsLogs_Status CHECK (Status IN ('Pending','Sent','Failed','Delivered'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SmsLogs_Status' AND object_id = OBJECT_ID(N'notification.SmsLogs'))
BEGIN
    CREATE INDEX IX_SmsLogs_Status ON notification.SmsLogs(Status, CreatedAt DESC);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SmsLogs_Mobile' AND object_id = OBJECT_ID(N'notification.SmsLogs'))
BEGIN
    CREATE INDEX IX_SmsLogs_Mobile ON notification.SmsLogs(Mobile, CreatedAt DESC);
END;
GO

IF OBJECT_ID('notification.NotificationSettings','U') IS NULL
CREATE TABLE notification.NotificationSettings (
    NotificationSettingId BIGINT IDENTITY(1,1) NOT NULL,
    EventCode             NVARCHAR(50) NOT NULL,
    IsSmsEnabled          BIT NOT NULL CONSTRAINT DF_NotificationSettings_IsSmsEnabled DEFAULT (1),
    TemplateCode          NVARCHAR(50) NULL,
    UpdatedAt             DATETIME2(3) NOT NULL CONSTRAINT DF_NotificationSettings_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_NotificationSettings PRIMARY KEY CLUSTERED (NotificationSettingId),
    CONSTRAINT UQ_NotificationSettings_EventCode UNIQUE (EventCode)
);
GO

/* ============ audit ============ */
IF OBJECT_ID('audit.AuditLogs','U') IS NULL
CREATE TABLE audit.AuditLogs (
    AuditLogId BIGINT IDENTITY(1,1) NOT NULL,
    UserId     BIGINT NULL,
    EntityType NVARCHAR(100) NOT NULL,
    EntityId   BIGINT NULL,
    Action     NVARCHAR(50) NOT NULL,
    OldValues  NVARCHAR(MAX) NULL,
    NewValues  NVARCHAR(MAX) NULL,
    IpAddress  NVARCHAR(45) NULL,
    UserAgent  NVARCHAR(500) NULL,
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_AuditLogs PRIMARY KEY CLUSTERED (AuditLogId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_Entity' AND object_id = OBJECT_ID(N'audit.AuditLogs'))
BEGIN
    CREATE INDEX IX_AuditLogs_Entity ON audit.AuditLogs(EntityType, EntityId, CreatedAt DESC);
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_User' AND object_id = OBJECT_ID(N'audit.AuditLogs'))
BEGIN
    CREATE INDEX IX_AuditLogs_User ON audit.AuditLogs(UserId, CreatedAt DESC);
END;
GO

IF OBJECT_ID('audit.UserActivityLogs','U') IS NULL
CREATE TABLE audit.UserActivityLogs (
    UserActivityLogId BIGINT IDENTITY(1,1) NOT NULL,
    UserId            BIGINT NULL,
    ActivityType      NVARCHAR(50) NOT NULL,
    Description       NVARCHAR(500) NULL,
    IpAddress         NVARCHAR(45) NULL,
    OccurredAt        DATETIME2(3) NOT NULL CONSTRAINT DF_UserActivityLogs_OccurredAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_UserActivityLogs PRIMARY KEY CLUSTERED (UserActivityLogId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserActivityLogs_User' AND object_id = OBJECT_ID(N'audit.UserActivityLogs'))
BEGIN
    CREATE INDEX IX_UserActivityLogs_User ON audit.UserActivityLogs(UserId, OccurredAt DESC);
END;
GO

/* ============ Stored Procedure: Document Number ============ */
IF OBJECT_ID('core.usp_NextDocumentNumber','P') IS NOT NULL
    DROP PROCEDURE core.usp_NextDocumentNumber;
GO
CREATE PROCEDURE core.usp_NextDocumentNumber
    @CounterType NVARCHAR(50),
    @PeriodKey   NVARCHAR(10),
    @NextValue   BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    UPDATE core.DocumentCounters WITH (UPDLOCK, ROWLOCK)
    SET @NextValue = CurrentValue = CurrentValue + 1,
        UpdatedAt  = SYSUTCDATETIME()
    WHERE CounterType = @CounterType AND PeriodKey = @PeriodKey;

    IF @@ROWCOUNT > 0 RETURN;

    BEGIN TRY
        INSERT INTO core.DocumentCounters (CounterType, PeriodKey, CurrentValue, UpdatedAt)
        VALUES (@CounterType, @PeriodKey, 1, SYSUTCDATETIME());
        SET @NextValue = 1;
    END TRY
    BEGIN CATCH
        UPDATE core.DocumentCounters WITH (UPDLOCK, ROWLOCK)
        SET @NextValue = CurrentValue = CurrentValue + 1,
            UpdatedAt  = SYSUTCDATETIME()
        WHERE CounterType = @CounterType AND PeriodKey = @PeriodKey;
    END CATCH
END;
GO

/* ============ Trigger: EntityFiles Integrity ============ */
IF OBJECT_ID('files.TR_EntityFiles_Validate','TR') IS NOT NULL
    DROP TRIGGER files.TR_EntityFiles_Validate;
GO
CREATE TRIGGER files.TR_EntityFiles_Validate
ON files.EntityFiles
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM inserted i
        WHERE
            (i.EntityType = 'RepairOrder' AND NOT EXISTS (SELECT 1 FROM repair.RepairOrders WHERE RepairOrderId = i.EntityId))
         OR (i.EntityType = 'Customer'    AND NOT EXISTS (SELECT 1 FROM crm.Customers        WHERE CustomerId   = i.EntityId))
         OR (i.EntityType = 'Device'      AND NOT EXISTS (SELECT 1 FROM repair.Devices       WHERE DeviceId     = i.EntityId))
         OR (i.EntityType = 'Receipt'     AND NOT EXISTS (SELECT 1 FROM repair.Receipts      WHERE ReceiptId    = i.EntityId))
    )
    BEGIN
        RAISERROR('EntityFiles references a non-existent entity.', 16, 1);
        ROLLBACK TRANSACTION;
    END
END;
GO

/* ============ Seed (Idempotent) ============ */
-- Default Branch
IF NOT EXISTS (SELECT 1 FROM core.Branches WHERE Code = 'MAIN')
    INSERT INTO core.Branches (Code, Name, IsMain, IsActive)
    VALUES ('MAIN', N'شعبه اصلی', 1, 1);

-- Default Settings
MERGE core.Settings AS t
USING (VALUES
    ('DefaultCurrency','Toman',N'واحد پول'),
    ('DefaultLanguage','fa-IR',N'زبان پیش‌فرض'),
    ('Timezone','Asia/Tehran',N'منطقه زمانی')
) AS s(SettingKey, SettingValue, Description)
ON t.SettingKey = s.SettingKey
WHEN NOT MATCHED THEN INSERT(SettingKey, SettingValue, Description)
    VALUES(s.SettingKey, s.SettingValue, s.Description);

-- Document Counter init
IF NOT EXISTS (SELECT 1 FROM core.DocumentCounters WHERE CounterType='Receipt' AND PeriodKey='ALL')
    INSERT INTO core.DocumentCounters (CounterType, PeriodKey, CurrentValue) VALUES ('Receipt','ALL',0);

-- SMS Templates
MERGE notification.SmsTemplates AS t
USING (VALUES
    ('ReceiptCreated',   N'پذیرش دستگاه',  N'{CustomerName} عزیز، دستگاه شما با شماره پذیرش {ReceiptNumber} ثبت شد.'),
    ('StatusChanged',    N'تغییر وضعیت',   N'وضعیت تعمیر دستگاه شما تغییر کرد: {Status}'),
    ('ReadyForDelivery', N'آماده تحویل',   N'دستگاه شما آماده تحویل است. کد رهگیری: {TrackingToken}'),
    ('Delivered',        N'تحویل داده شد', N'دستگاه شما تحویل داده شد. از اعتماد شما سپاسگزاریم.'),
    ('ServiceReminder',  N'یادآوری سرویس', N'{CustomerName} عزیز، وقت سرویس دوره‌ای دستگاه شماست.')
) AS s(Code, Title, Body)
ON t.Code = s.Code
WHEN NOT MATCHED THEN INSERT(Code, Title, Body) VALUES(s.Code, s.Title, s.Body);

-- Notification Settings
MERGE notification.NotificationSettings AS t
USING (VALUES
    ('ReceiptCreated',   1, 'ReceiptCreated'),
    ('StatusChanged',    1, 'StatusChanged'),
    ('ReadyForDelivery', 1, 'ReadyForDelivery'),
    ('Delivered',        1, 'Delivered'),
    ('ServiceReminder',  1, 'ServiceReminder')
) AS s(EventCode, IsSmsEnabled, TemplateCode)
ON t.EventCode = s.EventCode
WHEN NOT MATCHED THEN INSERT(EventCode, IsSmsEnabled, TemplateCode)
    VALUES(s.EventCode, s.IsSmsEnabled, s.TemplateCode);

-- Schema Version
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version = 'V1_InitialSchema')
    INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
    VALUES ('V1_InitialSchema', N'اسکیمای اولیه', NULL);
GO






/* Reminder worker columns, status constraint and lease index are defined in the initial table schema. */





/*
  Repair-order image metadata.
  Run this script against the Repair database before deploying the image API.
  Existing tables are preserved; missing tables are created.
*/
IF SCHEMA_ID(N'files') IS NULL
    EXEC(N'CREATE SCHEMA files AUTHORIZATION dbo;');
GO

IF OBJECT_ID(N'files.Files', N'U') IS NULL
BEGIN
    CREATE TABLE files.Files
    (
        FileId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_files_Files PRIMARY KEY,
        OriginalName NVARCHAR(255) NOT NULL,
        StoragePath NVARCHAR(500) NOT NULL,
        MimeType NVARCHAR(100) NOT NULL,
        Size BIGINT NOT NULL,
        Width INT NULL,
        Height INT NULL,
        Hash NVARCHAR(128) NULL,
        CreatedByUserId BIGINT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_files_Files_CreatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_files_Files_StoragePath ON files.Files(StoragePath);
END;
GO

IF OBJECT_ID(N'files.EntityFiles', N'U') IS NULL
BEGIN
    CREATE TABLE files.EntityFiles
    (
        EntityFileId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_files_EntityFiles PRIMARY KEY,
        FileId BIGINT NOT NULL,
        EntityType NVARCHAR(30) NOT NULL,
        EntityId BIGINT NOT NULL,
        Purpose NVARCHAR(50) NULL,
        SortOrder INT NOT NULL CONSTRAINT DF_files_EntityFiles_SortOrder DEFAULT (0),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_files_EntityFiles_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_files_EntityFiles_Files FOREIGN KEY (FileId) REFERENCES files.Files(FileId)
    );
    CREATE INDEX IX_files_EntityFiles_Entity ON files.EntityFiles(EntityType, EntityId, Purpose, SortOrder);
    CREATE INDEX IX_files_EntityFiles_FileId ON files.EntityFiles(FileId);
END;
GO

/* Fail early if a pre-existing version has an incompatible shape. */
IF COL_LENGTH(N'files.Files', N'FileId') IS NULL
   OR COL_LENGTH(N'files.Files', N'OriginalName') IS NULL
   OR COL_LENGTH(N'files.Files', N'StoragePath') IS NULL
   OR COL_LENGTH(N'files.Files', N'MimeType') IS NULL
   OR COL_LENGTH(N'files.Files', N'Size') IS NULL
   OR COL_LENGTH(N'files.Files', N'Width') IS NULL
   OR COL_LENGTH(N'files.Files', N'Height') IS NULL
   OR COL_LENGTH(N'files.Files', N'Hash') IS NULL
   OR COL_LENGTH(N'files.Files', N'CreatedByUserId') IS NULL
   OR COL_LENGTH(N'files.Files', N'CreatedAt') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'EntityFileId') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'FileId') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'EntityType') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'EntityId') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'Purpose') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'SortOrder') IS NULL
   OR COL_LENGTH(N'files.EntityFiles', N'CreatedAt') IS NULL
BEGIN
    THROW 51000, 'The existing files schema is incompatible with repair image uploads. Review files.Files and files.EntityFiles columns.', 1;
END;
GO






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

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_repair_RepairServices_ServiceCatalog'
    AND parent_object_id = OBJECT_ID(N'repair.RepairServices')
)
  ALTER TABLE repair.RepairServices ADD CONSTRAINT FK_repair_RepairServices_ServiceCatalog
    FOREIGN KEY (ServiceCatalogId) REFERENCES repair.ServiceCatalog(ServiceCatalogId);
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_repair_RepairServices_ServiceCatalogId'
    AND object_id = OBJECT_ID(N'repair.RepairServices')
)
  CREATE INDEX IX_repair_RepairServices_ServiceCatalogId ON repair.RepairServices(ServiceCatalogId);
GO





/*
  Seed the dedicated repair-completed SMS template.
  Safe to run more than once. Existing customized templates are preserved.
*/
IF OBJECT_ID(N'notification.SmsTemplates', N'U') IS NULL
  THROW 51110, 'notification.SmsTemplates must exist before this script is applied.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM notification.SmsTemplates WHERE Code=N'RepairCompleted')
BEGIN
  INSERT INTO notification.SmsTemplates (Code, Title, Body, IsActive)
  VALUES (
    N'RepairCompleted',
    N'تعمیر دستگاه انجام شد',
    N'سلام {{CustomerName}} عزیز، تعمیر دستگاه {{DeviceType}} {{Brand}} {{Model}} انجام شد. کد پیگیری: {{TrackingToken}}',
    1
  );
END;
GO





/*
  User accounts, role-based access control, inventory parts, and auditable price history.
  Apply once to the Repair database before deploying the matching application code.
  Idempotent: existing repair/inventory data is preserved.
*/
SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'security') IS NULL EXEC(N'CREATE SCHEMA security AUTHORIZATION dbo;');
IF SCHEMA_ID(N'inventory') IS NULL EXEC(N'CREATE SCHEMA inventory AUTHORIZATION dbo;');
GO

IF OBJECT_ID(N'security.Users', N'U') IS NULL
BEGIN
  CREATE TABLE security.Users (
    UserId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Users PRIMARY KEY,
    UserName NVARCHAR(100) NOT NULL,
    DisplayName NVARCHAR(150) NOT NULL,
    PasswordHash NVARCHAR(300) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_security_Users_IsActive DEFAULT (1),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2(0) NULL,
    LastLoginAt DATETIME2(0) NULL,
    MasterUserId BIGINT NULL
  );
  CREATE UNIQUE INDEX UX_security_Users_UserName ON security.Users(UserName);
  CREATE UNIQUE INDEX UX_security_Users_MasterUserId ON security.Users(MasterUserId) WHERE MasterUserId IS NOT NULL;
END;
GO
IF OBJECT_ID(N'security.Roles', N'U') IS NULL
BEGIN
  CREATE TABLE security.Roles (
    RoleId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Roles PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Description NVARCHAR(300) NULL,
    IsSystem BIT NOT NULL CONSTRAINT DF_security_Roles_IsSystem DEFAULT (0),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_Roles_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX UX_security_Roles_Name ON security.Roles(Name);
END;
GO
IF OBJECT_ID(N'security.Permissions', N'U') IS NULL
BEGIN
  CREATE TABLE security.Permissions (
    PermissionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Permissions PRIMARY KEY,
    PermissionKey NVARCHAR(100) NOT NULL,
    Name NVARCHAR(150) NOT NULL,
    Module NVARCHAR(80) NOT NULL,
    Description NVARCHAR(300) NULL
  );
  CREATE UNIQUE INDEX UX_security_Permissions_Key ON security.Permissions(PermissionKey);
END;
GO
IF OBJECT_ID(N'security.UserRoles', N'U') IS NULL
BEGIN
  CREATE TABLE security.UserRoles (
    UserId BIGINT NOT NULL,
    RoleId BIGINT NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_UserRoles_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_security_UserRoles PRIMARY KEY (UserId, RoleId),
    CONSTRAINT FK_security_UserRoles_Users FOREIGN KEY (UserId) REFERENCES security.Users(UserId),
    CONSTRAINT FK_security_UserRoles_Roles FOREIGN KEY (RoleId) REFERENCES security.Roles(RoleId)
  );
  CREATE INDEX IX_security_UserRoles_RoleId ON security.UserRoles(RoleId);
END;
GO
IF OBJECT_ID(N'security.RolePermissions', N'U') IS NULL
BEGIN
  CREATE TABLE security.RolePermissions (
    RoleId BIGINT NOT NULL,
    PermissionId BIGINT NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_RolePermissions_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_security_RolePermissions PRIMARY KEY (RoleId, PermissionId),
    CONSTRAINT FK_security_RolePermissions_Roles FOREIGN KEY (RoleId) REFERENCES security.Roles(RoleId),
    CONSTRAINT FK_security_RolePermissions_Permissions FOREIGN KEY (PermissionId) REFERENCES security.Permissions(PermissionId)
  );
  CREATE INDEX IX_security_RolePermissions_PermissionId ON security.RolePermissions(PermissionId);
END;
GO

DECLARE @Permissions TABLE (PermissionKey NVARCHAR(100), Name NVARCHAR(150), Module NVARCHAR(80), Description NVARCHAR(300));
INSERT INTO @Permissions (PermissionKey, Name, Module, Description) VALUES
(N'dashboard.view', N'مشاهده داشبورد', N'dashboard', N'دسترسی به داشبورد اصلی'),
(N'repairs.view', N'مشاهده سفارش‌های تعمیر', N'repairs', N'مشاهده و جست‌وجوی سفارش‌ها'),
(N'repairs.status.change', N'تغییر وضعیت تعمیر', N'repairs', N'تغییر وضعیت سفارش تعمیر'),
(N'repairs.deliver', N'ثبت تحویل دستگاه', N'repairs', N'ثبت تحویل و اطلاعات گیرنده'),
(N'repairs.images.manage', N'مدیریت تصاویر تعمیر', N'repairs', N'بارگذاری تصاویر سفارش'),
(N'costing.view', N'مشاهده هزینه‌ها', N'costing', N'مشاهده خدمات و قطعات سفارش'),
(N'costing.manage', N'ویرایش هزینه‌ها', N'costing', N'ثبت و ویرایش اقلام هزینه'),
(N'costing.finalize', N'نهایی‌سازی هزینه', N'costing', N'تأیید هزینه نهایی'),
(N'services.manage', N'مدیریت فهرست خدمات', N'services', N'تعریف خدمات قابل استفاده مجدد'),
(N'inventory.parts.view', N'مشاهده قطعات', N'inventory', N'مشاهده فهرست قطعات'),
(N'inventory.parts.manage', N'مدیریت قطعات', N'inventory', N'تعریف و ویرایش قطعات'),
(N'inventory.prices.view', N'مشاهده تاریخچه قیمت', N'inventory', N'مشاهده سوابق تغییر قیمت'),
(N'inventory.prices.manage', N'تغییر قیمت قطعات', N'inventory', N'ثبت قیمت جدید و تاریخچه آن'),
(N'users.view', N'مشاهده کاربران', N'access', N'مشاهده حساب‌های کاربری'),
(N'users.manage', N'مدیریت کاربران', N'access', N'تعریف، ویرایش و غیرفعال‌سازی کاربران'),
(N'roles.view', N'مشاهده نقش‌ها و مجوزها', N'access', N'مشاهده نقش‌ها و فهرست مجوزها'),
(N'roles.manage', N'مدیریت نقش‌ها و مجوزها', N'access', N'تعریف نقش و تخصیص مجوزها'),
(N'notifications.manage', N'مدیریت پیامک‌ها', N'notifications', N'مدیریت عملیات پیامک و اعلان‌ها');

INSERT INTO security.Permissions (PermissionKey, Name, Module, Description)
SELECT p.PermissionKey, p.Name, p.Module, p.Description
FROM @Permissions p
WHERE NOT EXISTS (SELECT 1 FROM security.Permissions x WHERE x.PermissionKey = p.PermissionKey);
GO

IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Administrator')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Administrator', N'دسترسی کامل مدیریتی', 1);
IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Technician')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Technician', N'دسترسی عملیاتی تعمیرکار', 1);
IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Reception')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Reception', N'دسترسی پذیرش و پیگیری سفارش', 1);

DECLARE @AdminRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Administrator');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @AdminRoleId, p.PermissionId FROM security.Permissions p
WHERE NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@AdminRoleId AND rp.PermissionId=p.PermissionId);

DECLARE @TechnicianRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Technician');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @TechnicianRoleId, p.PermissionId
FROM security.Permissions p
WHERE p.PermissionKey IN (N'dashboard.view',N'repairs.view',N'repairs.status.change',N'repairs.images.manage',N'costing.view',N'costing.manage',N'inventory.parts.view',N'inventory.prices.view')
AND NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@TechnicianRoleId AND rp.PermissionId=p.PermissionId);

DECLARE @ReceptionRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Reception');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @ReceptionRoleId, p.PermissionId
FROM security.Permissions p
WHERE p.PermissionKey IN (N'dashboard.view',N'repairs.view',N'repairs.status.change',N'repairs.deliver',N'repairs.images.manage',N'costing.view',N'inventory.parts.view',N'inventory.prices.view')
AND NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@ReceptionRoleId AND rp.PermissionId=p.PermissionId);
GO

/* Inventory indexes and initial effective prices for the canonical schema. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'inventory.Parts') AND name=N'IX_inventory_Parts_ActiveName')
  CREATE INDEX IX_inventory_Parts_ActiveName ON inventory.Parts(IsActive, Name);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'inventory.PartPriceHistory') AND name=N'IX_inventory_PartPriceHistory_PartEffective')
  CREATE INDEX IX_inventory_PartPriceHistory_PartEffective ON inventory.PartPriceHistory(PartId, EffectiveFrom DESC, PartPriceHistoryId DESC);
GO

/* Seed only parts without a currently effective price; don't fabricate a price-change event. */
INSERT INTO inventory.PartPriceHistory (PartId, Price, EffectiveFrom, EffectiveTo, ChangedByUserId, CreatedAt)
SELECT p.PartId, p.CurrentPrice, SYSUTCDATETIME(), NULL, NULL, SYSUTCDATETIME()
FROM inventory.Parts p
WHERE NOT EXISTS (
  SELECT 1 FROM inventory.PartPriceHistory h WHERE h.PartId=p.PartId AND h.EffectiveTo IS NULL
);
GO
