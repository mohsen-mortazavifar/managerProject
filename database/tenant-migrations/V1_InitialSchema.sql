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
    SentAt            DATETIME2(0) NULL,
    Message           NVARCHAR(1000) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_ServiceReminders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_ServiceReminders PRIMARY KEY CLUSTERED (ServiceReminderId),
    CONSTRAINT FK_ServiceReminders_RepairOrders FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT CK_ServiceReminders_Status CHECK (Status IN ('Pending','Sent','Cancelled','Failed'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ServiceReminders_Status' AND object_id = OBJECT_ID(N'repair.ServiceReminders'))
BEGIN
    CREATE INDEX IX_ServiceReminders_Status ON repair.ServiceReminders(Status, ReminderAt) WHERE Status = 'Pending';
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