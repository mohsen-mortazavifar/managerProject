import { getSqlPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = await getSqlPool();
    await pool.request().query("SELECT 1 AS [ok]");

    return Response.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Do not expose connection details or credentials in public health responses.
    return Response.json(
      {
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
