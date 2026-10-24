import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ paymentTransactionId: string }> }) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;
  const { paymentTransactionId } = await context.params;
  if (!/^[1-9]\d{0,18}$/.test(paymentTransactionId)) return NextResponse.json({ error: "شناسه پرداخت معتبر نیست." }, { status: 400 });
  try {
    const pool = await getSqlPool();
    const result = await pool.request().input("paymentId", sql.BigInt, paymentTransactionId).query(`
      SELECT ReceiptData,ReceiptFileName,ReceiptContentType
      FROM dbo.PaymentTransactions WHERE PaymentTransactionId=@paymentId AND ReceiptData IS NOT NULL;
    `);
    const row = result.recordset[0] as { ReceiptData: Buffer; ReceiptFileName: string; ReceiptContentType: string } | undefined;
    if (!row) return NextResponse.json({ error: "فایل رسید پیدا نشد." }, { status: 404 });
    const safeName = String(row.ReceiptFileName || "receipt").replace(/["\\\r\n]/g, "_");
    const contentType = ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(row.ReceiptContentType) ? row.ReceiptContentType : "application/octet-stream";
    return new NextResponse(new Uint8Array(row.ReceiptData), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "دریافت رسید ممکن نشد. Migration رسید پرداخت را بررسی کنید." }, { status: 503 });
  }
}
