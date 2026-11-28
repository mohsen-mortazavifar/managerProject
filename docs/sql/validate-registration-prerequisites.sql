USE Repair_Master;
GO

SET NOCOUNT ON;

PRINT '1. UserRoles identity/default metadata';
SELECT
    c.name AS ColumnName,
    TYPE_NAME(c.user_type_id) AS DataType,
    c.is_nullable AS IsNullable,
    c.is_identity AS IsIdentity,
    dc.definition AS DefaultDefinition
FROM sys.columns AS c
LEFT JOIN sys.default_constraints AS dc
    ON dc.parent_object_id = c.object_id
   AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID(N'dbo.UserRoles')
ORDER BY c.column_id;

PRINT '2. UserRoles primary key and indexes';
SELECT
    i.name AS IndexName,
    i.is_primary_key AS IsPrimaryKey,
    i.is_unique AS IsUnique,
    c.name AS ColumnName,
    ic.key_ordinal AS KeyOrdinal
FROM sys.indexes AS i
JOIN sys.index_columns AS ic
    ON ic.object_id = i.object_id
   AND ic.index_id = i.index_id
JOIN sys.columns AS c
    ON c.object_id = ic.object_id
   AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(N'dbo.UserRoles')
ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal;

PRINT '3. Users mobile unique-index filter';
SELECT
    i.name AS IndexName,
    i.is_unique AS IsUnique,
    i.has_filter AS HasFilter,
    i.filter_definition AS FilterDefinition,
    c.name AS ColumnName
FROM sys.indexes AS i
JOIN sys.index_columns AS ic
    ON ic.object_id = i.object_id
   AND ic.index_id = i.index_id
JOIN sys.columns AS c
    ON c.object_id = ic.object_id
   AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(N'dbo.Users')
  AND i.name = N'UQ_Users_Mobile';

PRINT '4. Required role exists';
SELECT RoleId, Name, IsSystemRole
FROM dbo.Roles
WHERE Name = N'TenantOwner'
  AND IsSystemRole = 1;

PRINT '5. Required provisioning tables and registration throttling table';
SELECT
    name AS TableName,
    CASE WHEN OBJECT_ID(N'dbo.' + name, N'U') IS NULL THEN 0 ELSE 1 END AS ExistsInDatabase
FROM (VALUES
    (N'AuthRegistrationAttempts'),
    (N'TenantUsers'),
    (N'UserRoles'),
    (N'TenantDatabases'),
    (N'ProvisioningJobs'),
    (N'TenantProvisioningLogs')
) AS required(name);
GO
