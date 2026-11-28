/*
  Master database catalog for appliance types, brands, models and colors.
  Apply once to the Master database (Repair_Master). The read API is intentionally public.
*/
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.RepairDeviceTypes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RepairDeviceTypes (
    DeviceTypeId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairDeviceTypes PRIMARY KEY,
    Code NVARCHAR(50) NOT NULL,
    Name NVARCHAR(100) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_RepairDeviceTypes_SortOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_RepairDeviceTypes_IsActive DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairDeviceTypes_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT UQ_RepairDeviceTypes_Code UNIQUE (Code),
    CONSTRAINT UQ_RepairDeviceTypes_Name UNIQUE (Name)
  );
END;
GO

IF OBJECT_ID(N'dbo.RepairDeviceBrands', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RepairDeviceBrands (
    BrandId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairDeviceBrands PRIMARY KEY,
    Code NVARCHAR(50) NOT NULL,
    Name NVARCHAR(100) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_RepairDeviceBrands_SortOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_RepairDeviceBrands_IsActive DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairDeviceBrands_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT UQ_RepairDeviceBrands_Code UNIQUE (Code),
    CONSTRAINT UQ_RepairDeviceBrands_Name UNIQUE (Name)
  );
END;
GO

IF OBJECT_ID(N'dbo.RepairDeviceColors', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RepairDeviceColors (
    ColorId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairDeviceColors PRIMARY KEY,
    Code NVARCHAR(50) NOT NULL,
    Name NVARCHAR(100) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_RepairDeviceColors_SortOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_RepairDeviceColors_IsActive DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairDeviceColors_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT UQ_RepairDeviceColors_Code UNIQUE (Code),
    CONSTRAINT UQ_RepairDeviceColors_Name UNIQUE (Name)
  );
END;
GO

IF OBJECT_ID(N'dbo.RepairDeviceModels', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RepairDeviceModels (
    ModelId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairDeviceModels PRIMARY KEY,
    DeviceTypeId INT NOT NULL,
    BrandId INT NOT NULL,
    Name NVARCHAR(120) NOT NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_RepairDeviceModels_SortOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_RepairDeviceModels_IsActive DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairDeviceModels_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT FK_RepairDeviceModels_DeviceTypes FOREIGN KEY (DeviceTypeId) REFERENCES dbo.RepairDeviceTypes(DeviceTypeId),
    CONSTRAINT FK_RepairDeviceModels_Brands FOREIGN KEY (BrandId) REFERENCES dbo.RepairDeviceBrands(BrandId),
    CONSTRAINT UQ_RepairDeviceModels_TypeBrandName UNIQUE (DeviceTypeId, BrandId, Name)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.RepairDeviceModels') AND name=N'IX_RepairDeviceModels_Lookup')
  CREATE INDEX IX_RepairDeviceModels_Lookup ON dbo.RepairDeviceModels(DeviceTypeId, BrandId, IsActive, SortOrder, Name);
GO

INSERT INTO dbo.RepairDeviceTypes (Code, Name, SortOrder)
SELECT v.Code, v.Name, v.SortOrder
FROM (VALUES
  (N'vacuum-cleaner', N'جاروبرقی', 10),
  (N'washing-machine', N'ماشین لباسشویی', 20),
  (N'dishwasher', N'ماشین ظرفشویی', 30),
  (N'refrigerator', N'یخچال', 40),
  (N'freezer', N'فریزر', 50),
  (N'television', N'تلویزیون', 60),
  (N'air-conditioner', N'کولر گازی', 70),
  (N'microwave', N'مایکروویو', 80),
  (N'iron', N'اتو', 90),
  (N'other', N'سایر', 999)
) v(Code, Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.RepairDeviceTypes x WHERE x.Code=v.Code);
GO

INSERT INTO dbo.RepairDeviceBrands (Code, Name, SortOrder)
SELECT v.Code, v.Name, v.SortOrder
FROM (VALUES
  (N'bosch', N'بوش', 10),
  (N'samsung', N'سامسونگ', 20),
  (N'lg', N'ال‌جی', 30),
  (N'philips', N'فیلیپس', 40),
  (N'panasonic', N'پاناسونیک', 50),
  (N'whirlpool', N'ویرپول', 60),
  (N'electrolux', N'الکترولوکس', 70),
  (N'miele', N'میله', 80),
  (N'dyson', N'دایسون', 90),
  (N'snowa', N'اسنوا', 100),
  (N'pakshoma', N'پاکشوما', 110),
  (N'daewoo', N'دوو', 120),
  (N'other', N'متفرقه', 999)
) v(Code, Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.RepairDeviceBrands x WHERE x.Code=v.Code);
GO

INSERT INTO dbo.RepairDeviceColors (Code, Name, SortOrder)
SELECT v.Code, v.Name, v.SortOrder
FROM (VALUES
  (N'white', N'سفید', 10),
  (N'black', N'مشکی', 20),
  (N'silver', N'نقره‌ای', 30),
  (N'gray', N'خاکستری', 40),
  (N'red', N'قرمز', 50),
  (N'blue', N'آبی', 60),
  (N'cream', N'کرم', 70),
  (N'beige', N'بژ', 80),
  (N'other', N'سایر', 999)
) v(Code, Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.RepairDeviceColors x WHERE x.Code=v.Code);
GO
