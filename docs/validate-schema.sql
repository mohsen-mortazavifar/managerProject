/*
  Repair Master schema preflight
  --------------------------------
  Read-only SQL Server script. It does not create, alter, or delete objects.
  Run against the central database after selecting the correct database.
  Expected schema is based on the table/column definitions supplied for this project.
*/

SET NOCOUNT ON;

DECLARE @SchemaName sysname = N'dbo';

DECLARE @Expected TABLE (
  TableName sysname NOT NULL,
  ColumnName sysname NOT NULL,
  PRIMARY KEY (TableName, ColumnName)
);

INSERT INTO @Expected (TableName, ColumnName)
VALUES
  (N'PaymentTransactions', N'PaymentTransactionId'),
  (N'PaymentTransactions', N'TenantId'),
  (N'PaymentTransactions', N'SubscriptionId'),
  (N'PaymentTransactions', N'Amount'),
  (N'PaymentTransactions', N'Status'),
  (N'PaymentTransactions', N'Gateway'),
  (N'PaymentTransactions', N'GatewayTransactionId'),
  (N'PaymentTransactions', N'PaidAt'),
  (N'PaymentTransactions', N'CreatedAt'),

  (N'Roles', N'RoleId'),
  (N'Roles', N'Name'),
  (N'Roles', N'Description'),
  (N'Roles', N'IsSystemRole'),
  (N'Roles', N'CreatedAt'),

  (N'SubscriptionPlans', N'SubscriptionPlanId'),
  (N'SubscriptionPlans', N'Name'),
  (N'SubscriptionPlans', N'Description'),
  (N'SubscriptionPlans', N'Price'),
  (N'SubscriptionPlans', N'MaxBranches'),
  (N'SubscriptionPlans', N'MaxUsers'),
  (N'SubscriptionPlans', N'MaxSmsPerMonth'),
  (N'SubscriptionPlans', N'IsActive'),
  (N'SubscriptionPlans', N'CreatedAt'),

  (N'Subscriptions', N'SubscriptionId'),
  (N'Subscriptions', N'TenantId'),
  (N'Subscriptions', N'SubscriptionPlanId'),
  (N'Subscriptions', N'Status'),
  (N'Subscriptions', N'StartsAt'),
  (N'Subscriptions', N'EndsAt'),
  (N'Subscriptions', N'PriceAtSubscription'),
  (N'Subscriptions', N'CreatedAt'),
  (N'Subscriptions', N'UpdatedAt'),

  (N'SystemAuditLogs', N'SystemAuditLogId'),
  (N'SystemAuditLogs', N'UserId'),
  (N'SystemAuditLogs', N'TenantId'),
  (N'SystemAuditLogs', N'EntityType'),
  (N'SystemAuditLogs', N'EntityId'),
  (N'SystemAuditLogs', N'Action'),
  (N'SystemAuditLogs', N'OldValues'),
  (N'SystemAuditLogs', N'NewValues'),
  (N'SystemAuditLogs', N'IpAddress'),
  (N'SystemAuditLogs', N'UserAgent'),
  (N'SystemAuditLogs', N'CreatedAt'),

  (N'TenantDatabases', N'TenantDatabaseId'),
  (N'TenantDatabases', N'TenantId'),
  (N'TenantDatabases', N'DatabaseName'),
  (N'TenantDatabases', N'ServerName'),
  (N'TenantDatabases', N'ConnectionStringEncrypted'),
  (N'TenantDatabases', N'SchemaVersion'),
  (N'TenantDatabases', N'IsActive'),
  (N'TenantDatabases', N'CreatedAt'),
  (N'TenantDatabases', N'UpdatedAt'),

  (N'TenantProvisioningLogs', N'ProvisioningLogId'),
  (N'TenantProvisioningLogs', N'TenantId'),
  (N'TenantProvisioningLogs', N'Status'),
  (N'TenantProvisioningLogs', N'Step'),
  (N'TenantProvisioningLogs', N'Message'),
  (N'TenantProvisioningLogs', N'ErrorDetails'),
  (N'TenantProvisioningLogs', N'AttemptNumber'),
  (N'TenantProvisioningLogs', N'StartedAt'),
  (N'TenantProvisioningLogs', N'CompletedAt'),
  (N'TenantProvisioningLogs', N'CreatedAt'),

  (N'Tenants', N'TenantId'),
  (N'Tenants', N'Name'),
  (N'Tenants', N'Code'),
  (N'Tenants', N'Status'),
  (N'Tenants', N'ContactEmail'),
  (N'Tenants', N'ContactMobile'),
  (N'Tenants', N'CreatedAt'),
  (N'Tenants', N'UpdatedAt'),
  (N'Tenants', N'DeletedAt'),

  (N'TenantUsers', N'TenantUserId'),
  (N'TenantUsers', N'TenantId'),
  (N'TenantUsers', N'UserId'),
  (N'TenantUsers', N'IsOwner'),
  (N'TenantUsers', N'IsActive'),
  (N'TenantUsers', N'JoinedAt'),

  (N'UserRoles', N'UserRoleId'),
  (N'UserRoles', N'TenantUserId'),
  (N'UserRoles', N'RoleId'),
  (N'UserRoles', N'AssignedAt'),

  (N'Users', N'UserId'),
  (N'Users', N'Email'),
  (N'Users', N'Mobile'),
  (N'Users', N'PasswordHash'),
  (N'Users', N'FullName'),
  (N'Users', N'IsActive'),
  (N'Users', N'IsSystemAdmin'),
  (N'Users', N'LastLoginAt'),
  (N'Users', N'CreatedAt'),
  (N'Users', N'UpdatedAt'),
  (N'Users', N'DeletedAt');

-- Result set 1: expected tables that are missing.
SELECT DISTINCT
  e.TableName AS MissingTable,
  @SchemaName AS ExpectedSchema
FROM @Expected AS e
WHERE NOT EXISTS (
  SELECT 1
  FROM sys.tables AS t
  INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
  WHERE s.name = @SchemaName
    AND t.name = e.TableName
)
ORDER BY e.TableName;

-- Result set 2: expected columns that are missing from existing tables.
SELECT
  e.TableName,
  e.ColumnName AS MissingColumn,
  @SchemaName AS ExpectedSchema
FROM @Expected AS e
INNER JOIN sys.tables AS t ON t.name = e.TableName
INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id AND s.name = @SchemaName
WHERE NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  WHERE c.object_id = t.object_id
    AND c.name = e.ColumnName
)
ORDER BY e.TableName, e.ColumnName;

-- Result set 3: concise totals. Zero missing counts means all expected names exist.
SELECT
  (SELECT COUNT(DISTINCT TableName) FROM @Expected) AS ExpectedTableCount,
  (SELECT COUNT(DISTINCT e.TableName)
   FROM @Expected AS e
   WHERE EXISTS (
     SELECT 1 FROM sys.tables AS t
     INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
     WHERE s.name = @SchemaName AND t.name = e.TableName
   )) AS FoundTableCount,
  (SELECT COUNT(*)
   FROM @Expected AS e
   INNER JOIN sys.tables AS t ON t.name = e.TableName
   INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id AND s.name = @SchemaName
   INNER JOIN sys.columns AS c ON c.object_id = t.object_id AND c.name = e.ColumnName) AS FoundExpectedColumnCount,
  (SELECT COUNT(*) FROM @Expected) AS ExpectedColumnCount;
