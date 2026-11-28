/*
  Repair Master schema constraints audit
  --------------------------------------
  Read-only SQL Server metadata audit.
  Run against the intended central database after docs/validate-schema.sql.
  No schema or data changes are performed.
*/
SET NOCOUNT ON;

DECLARE @SchemaName sysname = N'dbo';

DECLARE @ExpectedPrimaryKeys TABLE (TableName sysname PRIMARY KEY);
INSERT INTO @ExpectedPrimaryKeys (TableName)
VALUES
  (N'PaymentTransactions'), (N'Roles'), (N'SubscriptionPlans'),
  (N'Subscriptions'), (N'SystemAuditLogs'), (N'TenantDatabases'),
  (N'TenantProvisioningLogs'), (N'Tenants'), (N'TenantUsers'),
  (N'UserRoles'), (N'Users');

-- Result set 1: expected primary keys missing from existing tables.
SELECT e.TableName AS TableMissingPrimaryKey
FROM @ExpectedPrimaryKeys e
INNER JOIN sys.tables t ON t.name = e.TableName
INNER JOIN sys.schemas s ON s.schema_id = t.schema_id AND s.name = @SchemaName
WHERE NOT EXISTS (
  SELECT 1 FROM sys.key_constraints kc
  WHERE kc.parent_object_id = t.object_id AND kc.type = 'PK'
)
ORDER BY e.TableName;

DECLARE @ExpectedForeignKeys TABLE (
  ChildTable sysname NOT NULL,
  ChildColumn sysname NOT NULL,
  ParentTable sysname NOT NULL,
  ParentColumn sysname NOT NULL,
  PRIMARY KEY (ChildTable, ChildColumn, ParentTable, ParentColumn)
);
INSERT INTO @ExpectedForeignKeys (ChildTable, ChildColumn, ParentTable, ParentColumn)
VALUES
  (N'PaymentTransactions', N'TenantId', N'Tenants', N'TenantId'),
  (N'PaymentTransactions', N'SubscriptionId', N'Subscriptions', N'SubscriptionId'),
  (N'Subscriptions', N'TenantId', N'Tenants', N'TenantId'),
  (N'Subscriptions', N'SubscriptionPlanId', N'SubscriptionPlans', N'SubscriptionPlanId'),
  (N'SystemAuditLogs', N'UserId', N'Users', N'UserId'),
  (N'SystemAuditLogs', N'TenantId', N'Tenants', N'TenantId'),
  (N'TenantDatabases', N'TenantId', N'Tenants', N'TenantId'),
  (N'TenantProvisioningLogs', N'TenantId', N'Tenants', N'TenantId'),
  (N'TenantUsers', N'TenantId', N'Tenants', N'TenantId'),
  (N'TenantUsers', N'UserId', N'Users', N'UserId'),
  (N'UserRoles', N'TenantUserId', N'TenantUsers', N'TenantUserId'),
  (N'UserRoles', N'RoleId', N'Roles', N'RoleId');

-- Result set 2: expected foreign-key relationships that are not present.
SELECT
  e.ChildTable,
  e.ChildColumn,
  e.ParentTable,
  e.ParentColumn,
  N'Missing or differently defined foreign key' AS Finding
FROM @ExpectedForeignKeys e
INNER JOIN sys.tables ct ON ct.name = e.ChildTable
INNER JOIN sys.schemas cs ON cs.schema_id = ct.schema_id AND cs.name = @SchemaName
INNER JOIN sys.columns cc ON cc.object_id = ct.object_id AND cc.name = e.ChildColumn
INNER JOIN sys.tables pt ON pt.name = e.ParentTable
INNER JOIN sys.schemas ps ON ps.schema_id = pt.schema_id AND ps.name = @SchemaName
INNER JOIN sys.columns pc ON pc.object_id = pt.object_id AND pc.name = e.ParentColumn
WHERE NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys fk
  INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  WHERE fk.parent_object_id = ct.object_id
    AND fk.referenced_object_id = pt.object_id
    AND fkc.parent_column_id = cc.column_id
    AND fkc.referenced_column_id = pc.column_id
)
ORDER BY e.ChildTable, e.ChildColumn;

-- Result set 3: required uniqueness checks for user/tenant identifiers.
-- These are recommendations based on common identity constraints; review results
-- before adding any index, because existing data may contain duplicates.
SELECT
  v.TableName,
  v.ColumnName,
  CASE WHEN EXISTS (
    SELECT 1
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(QUOTENAME(@SchemaName) + N'.' + QUOTENAME(v.TableName))
      AND i.is_unique = 1
      AND i.is_disabled = 0
      AND ic.key_ordinal = 1
      AND c.name = v.ColumnName
  ) THEN N'Unique index found'
    ELSE N'No single-column unique index found; review before auth implementation'
  END AS Finding
FROM (VALUES
  (N'Users', N'Email'),
  (N'Tenants', N'Code')
) v(TableName, ColumnName)
ORDER BY v.TableName, v.ColumnName;
