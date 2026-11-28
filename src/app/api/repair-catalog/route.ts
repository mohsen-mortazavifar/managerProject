import { NextRequest, NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogKind = "types" | "brands" | "models" | "colors";

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

/**
 * Public, read-only lookup API used by Repair intake autocomplete controls.
 * Catalog writes are intentionally kept out of this unauthenticated endpoint.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") as CatalogKind | null;
  const search = (params.get("q") ?? "").trim().slice(0, 100);
  if (!kind || !["types", "brands", "models", "colors"].includes(kind)) {
    return json({ error: "پارامتر kind نامعتبر است." }, 400);
  }

  const deviceTypeId = params.get("deviceTypeId");
  const brandId = params.get("brandId");
  const parseId = (value: string | null) => value && /^\d{1,10}$/.test(value) && Number(value) > 0 ? Number(value) : null;

  if (kind === "models" && (!parseId(deviceTypeId) || !parseId(brandId))) {
    return json({ error: "برای دریافت مدل، نوع دستگاه و برند باید مشخص شوند." }, 400);
  }

  try {
    const pool = await getSqlPool();
    const query = pool.request().input("Search", sql.NVarChar(100), search ? `%${search}%` : null);
    let result;
    switch (kind) {
      case "types":
        result = await query.query(`
          SELECT TOP (100) DeviceTypeId AS Id, Name
          FROM dbo.RepairDeviceTypes
          WHERE IsActive=1 AND (@Search IS NULL OR Name LIKE @Search)
          ORDER BY SortOrder, Name;
        `);
        break;
      case "brands":
        result = await query.query(`
          SELECT TOP (100) BrandId AS Id, Name
          FROM dbo.RepairDeviceBrands
          WHERE IsActive=1 AND (@Search IS NULL OR Name LIKE @Search)
          ORDER BY SortOrder, Name;
        `);
        break;
      case "colors":
        result = await query.query(`
          SELECT TOP (100) ColorId AS Id, Name
          FROM dbo.RepairDeviceColors
          WHERE IsActive=1 AND (@Search IS NULL OR Name LIKE @Search)
          ORDER BY SortOrder, Name;
        `);
        break;
      case "models":
        result = await query
          .input("DeviceTypeId", sql.Int, parseId(deviceTypeId))
          .input("BrandId", sql.Int, parseId(brandId))
          .query(`
            SELECT TOP (100) ModelId AS Id, Name
            FROM dbo.RepairDeviceModels
            WHERE IsActive=1 AND DeviceTypeId=@DeviceTypeId AND BrandId=@BrandId
              AND (@Search IS NULL OR Name LIKE @Search)
            ORDER BY SortOrder, Name;
          `);
        break;
    }
    return json({ items: result.recordset.map((row) => ({ id: Number(row.Id), name: String(row.Name) })) });
  } catch (error) {
    console.error("GET /api/repair-catalog failed", error);
    return json({ error: "دریافت فهرست مشخصات کالا ممکن نشد." }, 503);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
