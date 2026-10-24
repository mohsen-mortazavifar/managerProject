SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.Users',N'IsPlatformUser') IS NULL
 ALTER TABLE dbo.Users ADD IsPlatformUser BIT NOT NULL CONSTRAINT DF_Users_IsPlatformUser DEFAULT(0);
UPDATE dbo.Users SET IsPlatformUser=1 WHERE IsSystemAdmin=1;
IF OBJECT_ID(N'dbo.SystemUserRoles',N'U') IS NOT NULL
 UPDATE u SET IsPlatformUser=1 FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.SystemUserRoles ur WHERE ur.UserId=u.UserId);
COMMIT TRANSACTION;
