import sql from "mssql";
import { randomUUID } from "node:crypto";

const workerId = `subscription-worker-${randomUUID()}`;
const pollMs = positiveInt(process.env.SUBSCRIPTION_WORKER_POLL_MS, 60000);
const once = process.argv.includes("--once");

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function config() {
  const server = process.env.DB_SERVER;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!server || !user || !password) {
    throw new Error("DB_SERVER, DB_USER and DB_PASSWORD must be configured.");
  }
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT is invalid.");
  return {
    server, port, user, password,
    database: process.env.DB_NAME || "Repair_Master",
    connectionTimeout: 10000,
    requestTimeout: 30000,
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

async function reconcileSubscriptions(pool) {
  const result = await pool.request()
    .input("workerId", sql.NVarChar(200), workerId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @LockResult INT;
      EXEC @LockResult = sys.sp_getapplock
        @Resource = N'managerProject:SubscriptionStatusWorker',
        @LockMode = N'Exclusive',
        @LockOwner = N'Transaction',
        @LockTimeout = 0;
      IF @LockResult < 0
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS int) AS ExpiredActive,
               CAST(0 AS int) AS ExpiredReserved,
               CAST(0 AS int) AS ActivatedReserved,
               CAST(1 AS bit) AS Skipped;
        RETURN;
      END;

      DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();
      DECLARE @ExpiredActive INT = 0, @ExpiredReserved INT = 0, @ActivatedReserved INT = 0;

      UPDATE dbo.Subscriptions WITH (UPDLOCK, ROWLOCK)
      SET Status = N'Expired', UpdatedAt = @Now
      WHERE Status = N'Active' AND EndsAt <= @Now;
      SET @ExpiredActive = @@ROWCOUNT;

      UPDATE dbo.Subscriptions WITH (UPDLOCK, ROWLOCK)
      SET Status = N'Expired', UpdatedAt = @Now
      WHERE Status = N'Reserved' AND EndsAt <= @Now;
      SET @ExpiredReserved = @@ROWCOUNT;

      ;WITH EligibleReservations AS (
        SELECT s.SubscriptionId,
               ROW_NUMBER() OVER (
                 PARTITION BY s.TenantId
                 ORDER BY s.StartsAt, s.CreatedAt, s.SubscriptionId
               ) AS ReservationNumber
        FROM dbo.Subscriptions s WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId = s.SubscriptionPlanId
        WHERE s.Status = N'Reserved'
          AND s.StartsAt <= @Now
          AND s.EndsAt > @Now
          AND (
            EXISTS (
              SELECT 1
              FROM dbo.PaymentTransactions pt
              WHERE pt.SubscriptionId = s.SubscriptionId
                AND pt.TenantId = s.TenantId
                AND pt.Status = N'Paid'
            )
            OR (
              s.PriceAtSubscription = 0
              AND p.IsTrial = 1
              AND EXISTS (
                SELECT 1
                FROM dbo.TenantTrialRequests tr
                WHERE tr.SubscriptionId = s.SubscriptionId
                  AND tr.TenantId = s.TenantId
                  AND tr.Status = N'Approved'
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.Subscriptions activeSub WITH (UPDLOCK, HOLDLOCK)
            WHERE activeSub.TenantId = s.TenantId
              AND activeSub.Status = N'Active'
              AND activeSub.StartsAt <= @Now
              AND activeSub.EndsAt > @Now
          )
      )
      UPDATE s
      SET Status = N'Active', UpdatedAt = @Now
      FROM dbo.Subscriptions s
      INNER JOIN EligibleReservations eligible ON eligible.SubscriptionId = s.SubscriptionId
      WHERE eligible.ReservationNumber = 1
        AND s.Status = N'Reserved'
        AND s.StartsAt <= @Now
        AND s.EndsAt > @Now;
      SET @ActivatedReserved = @@ROWCOUNT;

      COMMIT TRANSACTION;
      SELECT @ExpiredActive AS ExpiredActive,
             @ExpiredReserved AS ExpiredReserved,
             @ActivatedReserved AS ActivatedReserved,
             CAST(0 AS bit) AS Skipped;
    `);

  const row = result.recordset?.[0] || {};
  return {
    expiredActive: Number(row.ExpiredActive || 0),
    expiredReserved: Number(row.ExpiredReserved || 0),
    activatedReserved: Number(row.ActivatedReserved || 0),
    skipped: Boolean(row.Skipped),
  };
}

async function main() {
  const pool = await new sql.ConnectionPool(config()).connect();
  try {
    do {
      const counts = await reconcileSubscriptions(pool);
      if (counts.skipped) {
        console.log(`[${workerId}] another worker owns the reconciliation lock; skipped this cycle.`);
      } else if (counts.expiredActive || counts.expiredReserved || counts.activatedReserved) {
        console.log(`[${workerId}] subscription state changes: ${JSON.stringify(counts)}`);
      }
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (!once);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("Subscription worker stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
