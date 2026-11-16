# Tenant database migrations

The operational tenant database is built from the immutable V1 baseline plus the ordered migrations below.

## Worker behavior

- `scripts/provisioning-worker.mjs` loads `V1_InitialSchema.sql` and every `V2_*.sql` through the highest contiguous version.
- Every migration runs in its own SQL transaction and uses an application lock to prevent concurrent execution against the same tenant database.
- A SHA-256 checksum is written to `dbo.__SchemaVersions` only after the migration succeeds.
- Re-running a migration with the same checksum is safe; a changed checksum, missing checksum, out-of-order ledger, or version gap stops provisioning.
- The worker updates `dbo.TenantDatabases.SchemaVersion` to the latest version.
- Do not edit V1 after provisioning has started. Add new changes as V14, V15, etc.
- Tenant migrations must not contain `USE`, database creation commands, or explicit transaction-control statements; the worker owns transaction boundaries.
- Master and platform-auth migrations must remain in their own master/auth folders and must not be executed against tenant operational databases.

## Version map

| Version | Source script | Purpose |
|---|---|---|
| `V2_20261016_AddReminderClaiming` | `database/scripts/20261016_add_reminder_claiming.sql` | Reminder processing lease and status constraint |
| `V3_20261017_AddRepairOrderImages` | `database/scripts/20261017_add_repair_order_images.sql` | File metadata and entity-file links |
| `V4_20261018_RepairFinalCostAndDelivery` | `database/scripts/20261018_repair_final_cost_and_delivery.sql` | Service catalog and repair-service catalog relation |
| `V5_20261018_RepairSmsWorkflow` | `database/scripts/20261018_repair_sms_workflow.sql` | RepairCompleted SMS template seed |
| `V6_20261018_UsersRolesPermissionsPartsPriceHistory` | `database/scripts/20261018_users_roles_permissions_parts_price_history.sql` | Tenant users, RBAC, inventory and price-history schema |
| `V7_20261024_LinkRepairUsersToMaster` | `database/scripts/20261024_link_repair_users_to_master.sql` | Master identity link for tenant users |
| `V8_20261101_AddCustomerType` | `database/scripts/20261101_add_customer_type.sql` | Customer type field and legacy normalization |
| `V9_20261101_AddReceiptCustomerAddress` | `database/scripts/20261101_add_receipt_customer_address.sql` | Receipt address relation and snapshot |
| `V10_20261102_AddCustomerManagePermission` | `database/scripts/20261102_add_customer_manage_permission.sql` | Customer management permission and role grants |
| `V11_20261106_AddTaskFlowOutbox` | `database/scripts/20261106_add_taskflow_outbox.sql` | Transactional TaskFlow outbox |
| `V12_20261115_AddTenantReminderRules` | `database/scripts/20261115_add_tenant_reminder_rules.sql` | Tenant-configurable reminder rules and default pickup rule |
| `V13_20261115_LinkServiceRemindersToRules` | `database/scripts/20261115_link_service_reminders_to_rules.sql` | Reminder-to-rule, occurrence and source-event links |

## Final SQL reference

`FINAL_TenantSchema.sql` is a SQLCMD-mode wrapper that includes V1–V13 in order and records the same version/checksum ledger. It is for manual review or controlled SQLCMD execution only. Normal tenant creation must use the provisioning worker.
