import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Input = { name?: unknown; description?: unknown; price?: unknown; durationDays?: unknown; maxBranches?: unknown; maxUsers?: unknown; maxSmsPerMonth?: unknown; isActive?: unknown };
function fail(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }); }


type ParseResult =
  | { error: string }
  | {
      value: {
        name: string;
        description: string | null;
        price: number;
        durationDays: number;
        maxBranches: number;
        maxUsers: number;
        maxSmsPerMonth: number;
        isActive: boolean;
      };
    };

function parse(input: Input): ParseResult {
 const name = typeof input.name === "string" ? input.name.trim() : "";
 const description = typeof input.description === "string" ? input.description.trim() : "";
 const price = typeof input.price === "number" ? input.price : Number(input.price);
 const durationDays = Number(input.durationDays), maxBranches = Number(input.maxBranches), maxUsers = Number(input.maxUsers), maxSmsPerMonth = Number(input.maxSmsPerMonth);
 const isActive = input.isActive === undefined ? true : input.isActive;
 if (!name || name.length > 120) return { error: "نام پلن الزامی است و حداکثر ۱۲۰ کاراکتر دارد." } as const;
 if (description.length > 1000) return { error: "توضیحات حداکثر ۱۰۰۰ کاراکتر می‌تواند باشد." } as const;
 if (!Number.isFinite(price) || price < 0 || price > 9999999999999999) return { error: "قیمت معتبر نیست." } as const;
 if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 36500) return { error: "مدت اعتبار باید تعداد روز معتبر باشد." } as const;
 for (const [value, label] of [[maxBranches,"شعبه"],[maxUsers,"کاربر"],[maxSmsPerMonth,"پیامک"]] as const) if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) return { error: `محدودیت تعداد ${label} معتبر نیست.` } as const;
 if (typeof isActive !== "boolean") return { error: "وضعیت پلن معتبر نیست." } as const;
 return { value: { name, description: description || null, price, durationDays, maxBranches, maxUsers, maxSmsPerMonth, isActive } } as const;
}
function mapPlan(row: Record<string, unknown>) { return { subscriptionPlanId: String(row.SubscriptionPlanId), name: String(row.Name), description: row.Description == null ? "" : String(row.Description), price: Number(row.Price), durationDays: Number(row.DurationDays), maxBranches: Number(row.MaxBranches), maxUsers: Number(row.MaxUsers), maxSmsPerMonth: Number(row.MaxSmsPerMonth), isActive: Boolean(row.IsActive), createdAt: row.CreatedAt, updatedAt: row.UpdatedAt }; }
export async function GET(request: Request) {
 const auth = await requireSystemAdmin(request); if (!auth.ok) return auth.response;
 const params = new URL(request.url).searchParams, search = (params.get("search") || "").trim().slice(0,100), status = params.get("status");
 try {
  const pool = await getSqlPool();
  const result = await pool.request().input("search",sql.NVarChar(100),`%${search}%`).input("activeOnly",sql.Bit,status==="active"?1:status==="inactive"?0:null).query(`SELECT SubscriptionPlanId,Name,Description,Price,DurationDays,MaxBranches,MaxUsers,MaxSmsPerMonth,IsActive,CreatedAt,UpdatedAt FROM dbo.SubscriptionPlans WHERE (@search='%%' OR Name LIKE @search OR Description LIKE @search) AND (@activeOnly IS NULL OR IsActive=@activeOnly) ORDER BY CreatedAt DESC,SubscriptionPlanId DESC;`);
  return NextResponse.json({ plans: result.recordset.map(row=>mapPlan(row)) },{headers:{"Cache-Control":"no-store"}});
 } catch { return fail("دریافت پلن‌ها ممکن نشد. ابتدا Migration دیتابیس را اجرا کنید.",503); }
}
export async function POST(request: Request) {
 const auth = await requireSystemAdmin(request); if (!auth.ok) return auth.response;
 let body: unknown; try { body=await request.json(); } catch { return fail("بدنه درخواست معتبر نیست.",400); }
 if (!body || typeof body!=="object") return fail("بدنه درخواست معتبر نیست.",400);
 const parsed=parse(body as Input); if ("error" in parsed) return fail(parsed.error,400);
 try {
  const p=parsed.value,pool=await getSqlPool();
  const result=await pool.request().input("name",sql.NVarChar(120),p.name).input("description",sql.NVarChar(1000),p.description).input("price",sql.Decimal(18,2),p.price).input("durationDays",sql.Int,p.durationDays).input("maxBranches",sql.Int,p.maxBranches).input("maxUsers",sql.Int,p.maxUsers).input("maxSmsPerMonth",sql.Int,p.maxSmsPerMonth).input("isActive",sql.Bit,p.isActive).query(`INSERT INTO dbo.SubscriptionPlans(Name,Description,Price,DurationDays,MaxBranches,MaxUsers,MaxSmsPerMonth,IsActive,CreatedAt,UpdatedAt) OUTPUT INSERTED.SubscriptionPlanId,INSERTED.Name,INSERTED.Description,INSERTED.Price,INSERTED.DurationDays,INSERTED.MaxBranches,INSERTED.MaxUsers,INSERTED.MaxSmsPerMonth,INSERTED.IsActive,INSERTED.CreatedAt,INSERTED.UpdatedAt VALUES(@name,@description,@price,@durationDays,@maxBranches,@maxUsers,@maxSmsPerMonth,@isActive,SYSUTCDATETIME(),SYSUTCDATETIME());`);
  return NextResponse.json({plan:mapPlan(result.recordset[0])},{status:201,headers:{"Cache-Control":"no-store"}});
 } catch (cause) { const e=cause as {number?:number}; if(e.number===2627||e.number===2601)return fail("نام این پلن قبلاً ثبت شده است.",409); return fail("ثبت پلن ممکن نشد. اتصال دیتابیس و Migration را بررسی کنید.",503); }
}