/*
  Adds a dedicated permission for editing customer profiles.
  Apply once to the Repair database before deploying the matching application code.
  Idempotent: existing users, roles and permission assignments are preserved.
*/
IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey = N'customers.manage')
BEGIN
  INSERT INTO security.Permissions (PermissionKey, Name, Module, Description)
  VALUES (N'customers.manage', N'مدیریت اطلاعات مشتریان', N'customers', N'ویرایش اطلاعات اصلی پرونده مشتری');
END;
GO

DECLARE @PermissionId BIGINT = (SELECT PermissionId FROM security.Permissions WHERE PermissionKey = N'customers.manage');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT r.RoleId, @PermissionId
FROM security.Roles r
WHERE r.Name IN (N'Administrator', N'Reception')
  AND NOT EXISTS (
    SELECT 1 FROM security.RolePermissions rp
    WHERE rp.RoleId = r.RoleId AND rp.PermissionId = @PermissionId
  );
GO
