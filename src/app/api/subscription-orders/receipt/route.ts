import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isPlatformUser || auth.user.isSystemAdmin) return fail("این بخش مخصوص مالک کسب‌وکار است.", 403);

  let form: FormData;
  try { form = await request.formData(); } catch { return fail("فرم ارسال‌شده معتبر نیست.", 400); }
  const paymentId = form.get("paymentTransactionId");
  const file = form.get("receipt");
  const noteValue = form.get("note");
  const note = typeof noteValue === "string" ? noteValue.trim() : "";
  if (typeof paymentId !== "string" || !/^[1-9]\d{0,18}$/.test(paymentId)) return fail("شناسه پرداخت معتبر نیست.", 400);
  if (!(file instanceof File) || file.size === 0) return fail("فایل رسید را انتخاب کنید.", 400);
  if (file.size > MAX_FILE_SIZE) return fail("حجم رسید باید حداکثر ۵ مگابایت باشد.", 413);
  if (!ALLOWED_TYPES.has(file.type)) return fail("فرمت رسید باید JPG، PNG، WEBP یا PDF باشد.", 415);
  if (note.length > 500) return fail("توضیحات حداکثر ۵۰۰ کاراکتر است.", 400);

  try {
    const pool = await getSqlPool();
    const owner = await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
      SELECT TOP (1) t.TenantId,t.Status
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId=tu.TenantId
      WHERE tu.UserId=@userId AND tu.IsOwner=1 AND tu.IsActive=1 AND t.DeletedAt IS NULL
      ORDER BY tu.JoinedAt DESC;
    `);
    const tenant = owner.recordset[0] as { TenantId: string | number; Status: string } | undefined;
    if (!tenant) return fail("فقط مالک کسب‌وکار می‌تواند رسید ارسال کند.", 403);
    if (tenant.Status === "Suspended") return fail("کسب‌وکار تعلیق شده است.", 403);

    const bytes = Buffer.from(await file.arrayBuffer());
    // Check file signatures so a renamed file cannot bypass the type check.
    const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!(isPdf || isPng || isJpeg || isWebp)) return fail("محتوای فایل با فرمت مجاز مطابقت ندارد.", 415);

    const verifiedContentType = isPdf ? "application/pdf" : isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/webp";
    const result = await pool.request()
      .input("paymentId", sql.BigInt, paymentId)
      .input("tenantId", sql.BigInt, tenant.TenantId)
      .input("data", sql.VarBinary(sql.MAX), bytes)
      .input("fileName", sql.NVarChar(255), file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255))
      .input("contentType", sql.NVarChar(100), verifiedContentType)
      .input("note", sql.NVarChar(500), note || null)
      .query(`
         DECLARE @UpdatedPayments TABLE (
      PaymentTransactionId BIGINT
    );

    UPDATE pt
    SET
      ReceiptData = @data,
      ReceiptFileName = @fileName,
      ReceiptContentType = @contentType,
      ReceiptUploadedAt = SYSUTCDATETIME(),
      ReceiptNote = @note
    OUTPUT INSERTED.PaymentTransactionId
      INTO @UpdatedPayments (PaymentTransactionId)
    FROM dbo.PaymentTransactions AS pt
    WHERE
      pt.PaymentTransactionId = @paymentId
      AND pt.TenantId = @tenantId
      AND pt.Status = N'Pending'
      AND pt.Gateway = N'Manual';

    SELECT PaymentTransactionId
    FROM @UpdatedPayments;
      `);
    if (result.recordset.length === 0) return fail("پرداخت پیدا نشد، قبلاً بررسی شده یا امکان ارسال رسید برای آن وجود ندارد.", 409);
    return NextResponse.json({ message: "رسید با موفقیت ارسال شد.", paymentTransactionId: String(result.recordset[0].PaymentTransactionId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("ثبت رسید انجام نشد. مطمئن شوید Migration رسید پرداخت اجرا شده است.", 503);
  }
}
