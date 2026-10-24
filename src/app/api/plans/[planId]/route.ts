import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Ctx={params:Promise<{planId:string}>};
type Input={name?:unknown;description?:unknown;price?:unknown;discountPercent?:unknown;isTrial?:unknown;durationDays?:unknown;maxBranches?:unknown;maxUsers?:unknown;maxSmsPerMonth?:unknown;isActive?:unknown};
function fail(message:string,status:number){return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}
async function id(ctx:Ctx){const {planId}=await ctx.params;return /^[1-9]\d{0,18}$/.test(planId)?planId:null;}

type ParseResult =
  | { error: string }
  | {
      value: {
        name: string;
        description: string | null;
        price: number;
        discountPercent: number;
        isTrial: boolean;
        durationDays: number;
        maxBranches: number;
        maxUsers: number;
        maxSmsPerMonth: number;
        isActive: boolean;
      };
    };
function parse(i:Input):ParseResult{const name=typeof i.name==="string"?i.name.trim():"",description=typeof i.description==="string"?i.description.trim():"",price=typeof i.price==="number"?i.price:Number(i.price),discountPercent=i.discountPercent===undefined?0:Number(i.discountPercent),isTrial=i.isTrial===undefined?false:i.isTrial,durationDays=Number(i.durationDays),maxBranches=Number(i.maxBranches),maxUsers=Number(i.maxUsers),maxSmsPerMonth=Number(i.maxSmsPerMonth),isActive=i.isActive;
if(!name||name.length>120)return {error:"نام پلن الزامی است و حداکثر ۱۲۰ کاراکتر دارد."} as const;
if(description.length>1000)return {error:"توضیحات حداکثر ۱۰۰۰ کاراکتر می‌تواند باشد."} as const;
if(!Number.isFinite(price)||price<0||price>9999999999999999)return {error:"قیمت معتبر نیست."} as const;
if(!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>=100)return {error:"درصد تخفیف باید از صفر تا کمتر از ۱۰۰ باشد."} as const;
if(typeof isTrial!=="boolean")return {error:"نوع پلن معتبر نیست."} as const;
if(isTrial&&(price!==0||discountPercent!==0))return {error:"پلن آزمایشی باید رایگان باشد و تخفیف جداگانه ندارد."} as const;
if(!Number.isInteger(durationDays)||durationDays<1||durationDays>36500)return {error:"مدت اعتبار باید تعداد روز معتبر باشد."} as const;
for(const [v,l] of [[maxBranches,"شعبه"],[maxUsers,"کاربر"],[maxSmsPerMonth,"پیامک"]] as const)if(!Number.isSafeInteger(v)||v<0||v>1000000000)return {error:`محدودیت تعداد ${l} معتبر نیست.`} as const;
if(typeof isActive!=="boolean")return {error:"وضعیت پلن معتبر نیست."} as const;
return {value:{name,description:description||null,price,discountPercent,isTrial,durationDays,maxBranches,maxUsers,maxSmsPerMonth,isActive}} as const;}
function mapPlan(r:Record<string,unknown>){const price=Number(r.Price),discountPercent=Number(r.DiscountPercent??0),isTrial=Boolean(r.IsTrial);return {subscriptionPlanId:String(r.SubscriptionPlanId),name:String(r.Name),description:r.Description==null?"":String(r.Description),price,discountPercent,effectivePrice:isTrial?0:Math.round(price*(1-discountPercent/100)*100)/100,isTrial,durationDays:Number(r.DurationDays),maxBranches:Number(r.MaxBranches),maxUsers:Number(r.MaxUsers),maxSmsPerMonth:Number(r.MaxSmsPerMonth),isActive:Boolean(r.IsActive),createdAt:r.CreatedAt,updatedAt:r.UpdatedAt};}
export async function GET(request:Request,ctx:Ctx){const auth=await requireSystemAdmin(request);if(!auth.ok)return auth.response;const planId=await id(ctx);if(!planId)return fail("شناسه پلن معتبر نیست.",400);try{const pool=await getSqlPool(),r=await pool.request().input("planId",sql.BigInt,planId).query("SELECT SubscriptionPlanId,Name,Description,Price,DiscountPercent,IsTrial,DurationDays,MaxBranches,MaxUsers,MaxSmsPerMonth,IsActive,CreatedAt,UpdatedAt FROM dbo.SubscriptionPlans WHERE SubscriptionPlanId=@planId;");if(!r.recordset[0])return fail("پلن پیدا نشد.",404);return NextResponse.json({plan:mapPlan(r.recordset[0])},{headers:{"Cache-Control":"no-store"}});}catch{return fail("دریافت پلن ممکن نشد.",503);}}
export async function PATCH(request:Request,ctx:Ctx){const auth=await requireSystemAdmin(request);if(!auth.ok)return auth.response;const planId=await id(ctx);if(!planId)return fail("شناسه پلن معتبر نیست.",400);let body:unknown;try{body=await request.json();}catch{return fail("بدنه درخواست معتبر نیست.",400);}if(!body||typeof body!=="object")return fail("بدنه درخواست معتبر نیست.",400);const parsed=parse(body as Input);if("error"in parsed)return fail(parsed.error,400);try{const p=parsed.value,pool=await getSqlPool(),r=await pool.request().input("planId",sql.BigInt,planId).input("name",sql.NVarChar(120),p.name).input("description",sql.NVarChar(1000),p.description).input("price",sql.Decimal(18,2),p.price).input("discountPercent",sql.Decimal(5,2),p.discountPercent).input("isTrial",sql.Bit,p.isTrial).input("durationDays",sql.Int,p.durationDays).input("maxBranches",sql.Int,p.maxBranches).input("maxUsers",sql.Int,p.maxUsers).input("maxSmsPerMonth",sql.Int,p.maxSmsPerMonth).input("isActive",sql.Bit,p.isActive).query(`UPDATE dbo.SubscriptionPlans SET Name=@name,Description=@description,Price=@price,DiscountPercent=@discountPercent,IsTrial=@isTrial,DurationDays=@durationDays,MaxBranches=@maxBranches,MaxUsers=@maxUsers,MaxSmsPerMonth=@maxSmsPerMonth,IsActive=@isActive,UpdatedAt=SYSUTCDATETIME() OUTPUT INSERTED.SubscriptionPlanId,INSERTED.Name,INSERTED.Description,INSERTED.Price,INSERTED.DiscountPercent,INSERTED.IsTrial,INSERTED.DurationDays,INSERTED.MaxBranches,INSERTED.MaxUsers,INSERTED.MaxSmsPerMonth,INSERTED.IsActive,INSERTED.CreatedAt,INSERTED.UpdatedAt WHERE SubscriptionPlanId=@planId;`);if(!r.recordset[0])return fail("پلن پیدا نشد.",404);return NextResponse.json({plan:mapPlan(r.recordset[0])},{headers:{"Cache-Control":"no-store"}});}catch(cause){const e=cause as {number?:number};if(e.number===2627||e.number===2601)return fail("نام این پلن قبلاً ثبت شده است.",409);return fail("ویرایش پلن ممکن نشد.",503);}}