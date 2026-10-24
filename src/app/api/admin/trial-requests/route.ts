import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const pool = await getSqlPool();
    const result = await pool.request().query(`
      SELECT r.TrialRequestId,r.TenantId,t.Name AS TenantName,r.SubscriptionPlanId,p.Name AS PlanName,
        r.SubscriptionId,r.Status,r.RequestedAt,r.ReviewedAt,r.ReviewNote,s.Status AS SubscriptionStatus,
        p.DurationDays,p.Price
      FROM dbo.TenantTrialRequests r
      INNER JOIN dbo.Tenants t ON t.TenantId=r.TenantId
      INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=r.SubscriptionPlanId
      LEFT JOIN dbo.Subscriptions s ON s.SubscriptionId=r.SubscriptionId
      ORDER BY CASE WHEN r.Status=N'Pending' THEN 0 ELSE 1 END,r.RequestedAt DESC;
    `);
    return NextResponse.json({ requests: result.recordset.map((r) => ({
      trialRequestId: String(r.TrialRequestId), tenantId: String(r.TenantId), tenantName: String(r.TenantName),
      subscriptionPlanId: String(r.SubscriptionPlanId), planName: String(r.PlanName),
      subscriptionId: r.SubscriptionId == null ? null : String(r.SubscriptionId), status: String(r.Status),
      subscriptionStatus: r.SubscriptionStatus == null ? null : String(r.SubscriptionStatus),
      requestedAt: r.RequestedAt, reviewedAt: r.ReviewedAt, reviewNote: r.ReviewNote == null ? "" : String(r.ReviewNote),
      durationDays: Number(r.DurationDays), price: Number(r.Price)
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("دریافت درخواست‌های آزمایشی ممکن نشد. ابتدا migration اشتراک را اجرا کنید.", 503);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return fail("بدنه درخواست معتبر نیست.", 400); }
  const input = body as { trialRequestId?: unknown; decision?: unknown; note?: unknown } | null;
  if (!input || typeof input.trialRequestId !== "string" || !/^[1-9]\\d{0,18}$/.test(input.trialRequestId))
    return fail("شناسه درخواست معتبر نیست.", 400);
  if (input.decision !== "Approved" && input.decision !== "Rejected")
    return fail("تصمیم باید تأیید یا رد باشد.", 400);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 500) return fail("توضیحات حداکثر ۵۰۰ کاراکتر است.", 400);

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("requestId", sql.BigInt, input.trialRequestId)
      .input("decision", sql.NVarChar(20), input.decision)
      .input("reviewerId", sql.BigInt, auth.user.userId)
      .input("note", sql.NVarChar(500), note || null)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @TenantId BIGINT,@SubscriptionId BIGINT,@RequestStatus NVARCHAR(20),@DurationDays INT,
          @ActiveSubscriptionId BIGINT,@ActiveEndsAt DATETIME2(3),@StartAt DATETIME2(3),@EndAt DATETIME2(3);
        SELECT @TenantId=r.TenantId,@SubscriptionId=r.SubscriptionId,@RequestStatus=r.Status,@DurationDays=p.DurationDays
        FROM dbo.TenantTrialRequests r WITH (UPDLOCK,HOLDLOCK)
        INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=r.SubscriptionPlanId
        WHERE r.TrialRequestId=@requestId;
        IF @RequestStatus IS NULL THROW 51101,'TRIAL_REQUEST_NOT_FOUND',1;
        IF @RequestStatus<>N'Pending' THROW 51102,'TRIAL_REQUEST_ALREADY_REVIEWED',1;
        IF @decision=N'Approved'
        BEGIN
          UPDATE dbo.Subscriptions SET Status=N'Expired',UpdatedAt=SYSUTCDATETIME()
          WHERE TenantId=@TenantId AND Status=N'Active' AND EndsAt<=SYSUTCDATETIME();
          IF EXISTS(SELECT 1 FROM dbo.Subscriptions WHERE TenantId=@TenantId AND Status=N'Reserved')
            THROW 51103,'RESERVED_SUBSCRIPTION_EXISTS',1;
          SELECT TOP(1) @ActiveSubscriptionId=SubscriptionId,@ActiveEndsAt=EndsAt
          FROM dbo.Subscriptions WITH (UPDLOCK,HOLDLOCK)
          WHERE TenantId=@TenantId AND Status=N'Active' AND EndsAt>SYSUTCDATETIME()
          ORDER BY EndsAt DESC;
          IF @ActiveSubscriptionId IS NULL
          BEGIN
            SET @StartAt=SYSUTCDATETIME();
            SET @EndAt=DATEADD(day,@DurationDays,@StartAt);
            UPDATE dbo.Subscriptions SET Status=N'Active',StartsAt=@StartAt,EndsAt=@EndAt,UpdatedAt=SYSUTCDATETIME()
            WHERE SubscriptionId=@SubscriptionId AND Status=N'PendingApproval';
          END
          ELSE
          BEGIN
            SET @StartAt=@ActiveEndsAt;
            SET @EndAt=DATEADD(day,@DurationDays,@StartAt);
            UPDATE dbo.Subscriptions SET Status=N'Reserved',StartsAt=@StartAt,EndsAt=@EndAt,UpdatedAt=SYSUTCDATETIME()
            WHERE SubscriptionId=@SubscriptionId AND Status=N'PendingApproval';
          END
          IF @@ROWCOUNT=0 THROW 51104,'TRIAL_SUBSCRIPTION_NOT_PENDING',1;
        END
        ELSE
          UPDATE dbo.Subscriptions SET Status=N'Cancelled',UpdatedAt=SYSUTCDATETIME()
          WHERE SubscriptionId=@SubscriptionId AND Status=N'PendingApproval';

        UPDATE dbo.TenantTrialRequests
        SET Status=@decision,ReviewedAt=SYSUTCDATETIME(),ReviewedByUserId=@reviewerId,ReviewNote=@note
        WHERE TrialRequestId=@requestId;
        COMMIT TRANSACTION;
        SELECT @TenantId AS TenantId,@SubscriptionId AS SubscriptionId,@decision AS Status;
      `);
    return NextResponse.json({ request: {
      tenantId: String(result.recordset[0].TenantId),
      subscriptionId: String(result.recordset[0].SubscriptionId),
      status: String(result.recordset[0].Status)
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const e = cause as { number?: number };
    if (e.number === 51101) return fail("درخواست آزمایشی پیدا نشد.", 404);
    if (e.number === 51102) return fail("این درخواست قبلاً بررسی شده است.", 409);
    if (e.number === 51103) return fail("این کسب‌وکار از قبل اشتراک رزرو دارد.", 409);
    if (e.number === 51104) return fail("وضعیت اشتراک برای فعال‌سازی معتبر نیست.", 409);
    return fail("بررسی درخواست آزمایشی انجام نشد.", 503);
  }
}
