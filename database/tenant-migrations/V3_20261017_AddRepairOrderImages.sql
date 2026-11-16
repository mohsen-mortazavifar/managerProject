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
