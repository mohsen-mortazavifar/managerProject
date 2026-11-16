/*
  FINAL TENANT SCHEMA INSTALLER (SQLCMD MODE)
  Connect to the target tenant database and run from the repository root.
  Enable SQLCMD Mode in SSMS. :r includes the immutable, versioned source files.
  The provisioning worker does not execute this wrapper; it applies V1..V13
  separately with one transaction and checksum validation per migration.
*/
:ON ERROR EXIT
SET NOCOUNT ON;
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V1_InitialSchema.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V1_InitialSchema'
           AND Checksum IS NOT NULL AND Checksum<>N'b890f3e3d82a459dc72db5a1de1d19c1285f971583e80abe6c124afb9d4484d1')
  THROW 52010, 'MIGRATION_CHECKSUM_MISMATCH: V1_InitialSchema', 1;
UPDATE dbo.__SchemaVersions
SET Description=N'Initial tenant schema', Checksum=N'b890f3e3d82a459dc72db5a1de1d19c1285f971583e80abe6c124afb9d4484d1'
WHERE Version=N'V1_InitialSchema';
IF @@ROWCOUNT <> 1 THROW 52011, 'INITIAL_SCHEMA_VERSION_MARKER_MISSING', 1;
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V2_20261016_AddReminderClaiming.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V2_20261016_AddReminderClaiming'
           AND (Checksum IS NULL OR Checksum<>N'ac049bee6b7b843b4030260e786a121242d69083351ff6ccb34204c6141d7d45'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V2_20261016_AddReminderClaiming', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V2_20261016_AddReminderClaiming')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V2_20261016_AddReminderClaiming', N'Tenant database migration V2_20261016_AddReminderClaiming', N'ac049bee6b7b843b4030260e786a121242d69083351ff6ccb34204c6141d7d45');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V3_20261017_AddRepairOrderImages.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V3_20261017_AddRepairOrderImages'
           AND (Checksum IS NULL OR Checksum<>N'9c83a5b7ddb81613b93610a5c42a8f2d976da881d0aaa891aa79e307a54bb39a'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V3_20261017_AddRepairOrderImages', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V3_20261017_AddRepairOrderImages')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V3_20261017_AddRepairOrderImages', N'Tenant database migration V3_20261017_AddRepairOrderImages', N'9c83a5b7ddb81613b93610a5c42a8f2d976da881d0aaa891aa79e307a54bb39a');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V4_20261018_RepairFinalCostAndDelivery.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V4_20261018_RepairFinalCostAndDelivery'
           AND (Checksum IS NULL OR Checksum<>N'3be4610057ea3264d72c301c1c05a5755a784dfd87a11314b1d3637580fad1be'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V4_20261018_RepairFinalCostAndDelivery', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V4_20261018_RepairFinalCostAndDelivery')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V4_20261018_RepairFinalCostAndDelivery', N'Tenant database migration V4_20261018_RepairFinalCostAndDelivery', N'3be4610057ea3264d72c301c1c05a5755a784dfd87a11314b1d3637580fad1be');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V5_20261018_RepairSmsWorkflow.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V5_20261018_RepairSmsWorkflow'
           AND (Checksum IS NULL OR Checksum<>N'8fe24271cf52eef3e75d829d1051153b3cfbbca6de4c69cb097293f4c46ae63b'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V5_20261018_RepairSmsWorkflow', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V5_20261018_RepairSmsWorkflow')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V5_20261018_RepairSmsWorkflow', N'Tenant database migration V5_20261018_RepairSmsWorkflow', N'8fe24271cf52eef3e75d829d1051153b3cfbbca6de4c69cb097293f4c46ae63b');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V6_20261018_UsersRolesPermissionsPartsPriceHistory.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V6_20261018_UsersRolesPermissionsPartsPriceHistory'
           AND (Checksum IS NULL OR Checksum<>N'83fa62cef5399f0c7cc5d5389a138527df6bf2ad711ab97c5012b9f4f1bcf58e'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V6_20261018_UsersRolesPermissionsPartsPriceHistory', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V6_20261018_UsersRolesPermissionsPartsPriceHistory')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V6_20261018_UsersRolesPermissionsPartsPriceHistory', N'Tenant database migration V6_20261018_UsersRolesPermissionsPartsPriceHistory', N'83fa62cef5399f0c7cc5d5389a138527df6bf2ad711ab97c5012b9f4f1bcf58e');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V7_20261024_LinkRepairUsersToMaster.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V7_20261024_LinkRepairUsersToMaster'
           AND (Checksum IS NULL OR Checksum<>N'5019e21d4393ff7abb7144fa81c3d0291f92a2f9ded1229244eed0d6f5119fe2'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V7_20261024_LinkRepairUsersToMaster', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V7_20261024_LinkRepairUsersToMaster')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V7_20261024_LinkRepairUsersToMaster', N'Tenant database migration V7_20261024_LinkRepairUsersToMaster', N'5019e21d4393ff7abb7144fa81c3d0291f92a2f9ded1229244eed0d6f5119fe2');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V8_20261101_AddCustomerType.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V8_20261101_AddCustomerType'
           AND (Checksum IS NULL OR Checksum<>N'dafc70bbaa2d2542cd55e44b42095bdd187bb779645260d31ceab3f98abecf18'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V8_20261101_AddCustomerType', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V8_20261101_AddCustomerType')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V8_20261101_AddCustomerType', N'Tenant database migration V8_20261101_AddCustomerType', N'dafc70bbaa2d2542cd55e44b42095bdd187bb779645260d31ceab3f98abecf18');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V9_20261101_AddReceiptCustomerAddress.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V9_20261101_AddReceiptCustomerAddress'
           AND (Checksum IS NULL OR Checksum<>N'71be11f387271189a2b498b95c33848be5a21bee60da78e317cce4544ab6df2d'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V9_20261101_AddReceiptCustomerAddress', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V9_20261101_AddReceiptCustomerAddress')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V9_20261101_AddReceiptCustomerAddress', N'Tenant database migration V9_20261101_AddReceiptCustomerAddress', N'71be11f387271189a2b498b95c33848be5a21bee60da78e317cce4544ab6df2d');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V10_20261102_AddCustomerManagePermission.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V10_20261102_AddCustomerManagePermission'
           AND (Checksum IS NULL OR Checksum<>N'90cb2ac68cc904aeb361da8d5aeae1e4e6eb26f3974853781e8af18143ad7188'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V10_20261102_AddCustomerManagePermission', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V10_20261102_AddCustomerManagePermission')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V10_20261102_AddCustomerManagePermission', N'Tenant database migration V10_20261102_AddCustomerManagePermission', N'90cb2ac68cc904aeb361da8d5aeae1e4e6eb26f3974853781e8af18143ad7188');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V11_20261106_AddTaskFlowOutbox.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V11_20261106_AddTaskFlowOutbox'
           AND (Checksum IS NULL OR Checksum<>N'1cb00a87465f342709eaab5264aefaf55922a562a2bcc201c5183c04237f7d14'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V11_20261106_AddTaskFlowOutbox', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V11_20261106_AddTaskFlowOutbox')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V11_20261106_AddTaskFlowOutbox', N'Tenant database migration V11_20261106_AddTaskFlowOutbox', N'1cb00a87465f342709eaab5264aefaf55922a562a2bcc201c5183c04237f7d14');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V12_20261115_AddTenantReminderRules.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V12_20261115_AddTenantReminderRules'
           AND (Checksum IS NULL OR Checksum<>N'17a6140149797e9c817c824b0fbc59cdf1196f93aa47c0f5ff2ab9d29edbfe21'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V12_20261115_AddTenantReminderRules', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V12_20261115_AddTenantReminderRules')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V12_20261115_AddTenantReminderRules', N'Tenant database migration V12_20261115_AddTenantReminderRules', N'17a6140149797e9c817c824b0fbc59cdf1196f93aa47c0f5ff2ab9d29edbfe21');
COMMIT TRANSACTION;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
:r database/tenant-migrations/V13_20261115_LinkServiceRemindersToRules.sql
IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V13_20261115_LinkServiceRemindersToRules'
           AND (Checksum IS NULL OR Checksum<>N'479e1a387543884a9a47d69a1d9da08ee642ea0d4af3b7a5e4fd7edb827633ad'))
  THROW 52012, 'MIGRATION_CHECKSUM_MISMATCH: V13_20261115_LinkServiceRemindersToRules', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=N'V13_20261115_LinkServiceRemindersToRules')
  INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
  VALUES (N'V13_20261115_LinkServiceRemindersToRules', N'Tenant database migration V13_20261115_LinkServiceRemindersToRules', N'479e1a387543884a9a47d69a1d9da08ee642ea0d4af3b7a5e4fd7edb827633ad');
COMMIT TRANSACTION;
GO

PRINT N'Tenant schema is now at V13_20261115_LinkServiceRemindersToRules.';
GO
