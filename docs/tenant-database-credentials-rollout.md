# Tenant-specific SQL credentials rollout

## Required configuration

- `TENANT_CONNECTION_ENCRYPTION_KEY`: stable 32-byte key represented by exactly 64 hexadecimal characters. Keep it in the deployment secret store; never commit the real value.
- `REPAIR_INTEGRATION_SECRET`: shared service-to-service secret of at least 32 bytes, configured identically in Master and Repair.
- `DB_SERVER`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD`: the Master/provisioning SQL Server connection. The provisioning identity needs permission to create/alter SQL logins, create users in tenant databases, and grant the scoped database roles used by the application.

## Deployment order

1. Back up the Master database.
2. Apply `database/master-migrations/20261025_tenant_sql_credentials.sql` to the Master database.
3. Configure the encryption key in the Master environment and restart the service/worker.
4. Deploy Master and Repair together so Repair requests the new tenant-specific credential response.
5. Run a controlled provisioning job and verify `SqlLoginName` and `SqlPasswordEncrypted` are populated for the tenant database.

Do not rotate or replace the encryption key without a planned re-encryption process; existing encrypted credentials will not decrypt with a different key.

## Required verification before production

- Tenant A credentials can connect only to Tenant A's database; attempts to connect to Tenant B's database fail.
- Inactive tenant memberships, inactive databases, deleted tenants, and platform/system users cannot resolve tenant credentials.
- Owner OTP login and owner backup-password login work; workspace-member password login remains separate.
- Provisioning retry does not unnecessarily rotate a previously stored SQL password.
- Review the GitHub Actions build result and test against a non-production SQL Server before merging/deploying.

The code change has not been live-tested against SQL Server in this session.
