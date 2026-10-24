"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Building2, Database, CreditCard, Users, RefreshCw, LogOut } from "lucide-react";

type Tenant = { tenantId:string; name:string; code:string; status:string; contactEmail:string; contactMobile:string; createdAt:string; updatedAt:string|null };
type Member = { tenantUserId:string; userId:string; fullName:string; mobile:string; email:string; isOwner:boolean; isActive:boolean; joinedAt:string; roles:string[] };
type Subscription = { subscriptionId:string; status:string; startsAt:string; endsAt:string; price:number; planName:string; durationDays:number };
type Db = { tenantDatabaseId:string; databaseName:string; serverName:string; schemaVersion:string; isActive:boolean; createdAt:string; updatedAt:string|null; provisioningStatus:string; lastErrorCode:string; correlationId:string; provisioningUpdatedAt:string|null };
type Payment = { paymentTransactionId:string; subscriptionId:string; amount:number; status:string; gateway:string; gatewayTransactionId:string; paidAt:string|null; createdAt:string };
type Overview = { tenant:Tenant; users:Member[]; subscriptions:Subscription[]; databases:Db[]; payments:Payment[] };
const date=(v:string|null|undefined)=>v?new Date(v).toLocaleString("fa-IR"):"—";
const statusLabel:Record<string,string>={Active:"فعال",Suspended:"معلق",Pending:"در انتظار راه‌اندازی",Expired:"منقضی",Reserved:"رزرو",PendingPayment:"در انتظار پرداخت",PendingApproval:"در انتظار تأیید",Cancelled:"لغوشده",Paid:"پرداخت‌شده",Failed:"ناموفق",Refunded:"بازپرداخت‌شده",Unknown:"نامشخص",Succeeded:"موفق",Completed:"تکمیل‌شده"};
const money=(n:number)=>new Intl.NumberFormat("fa-IR").format(n)+" تومان";

export default function TenantDetailPage(){
 const router=useRouter(); const params=useParams<{tenantId:string}>(); const tenantId=params.tenantId;
 const [token,setToken]=useState(""); const [data,setData]=useState<Overview|null>(null);
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
 useEffect(()=>{const accessToken=sessionStorage.getItem("repairMasterAccessToken")??"";if(!accessToken){router.replace("/login");return}setToken(accessToken)},[router]);
 const load=useCallback(async()=>{if(!token||!tenantId)return;setLoading(true);setError("");try{
   const r=await fetch("/api/tenants/"+encodeURIComponent(tenantId)+"/overview",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
   const d=await r.json(); if(r.status===401||r.status===403){sessionStorage.removeItem("repairMasterAccessToken");router.replace("/login");return}
   if(!r.ok)throw new Error(d.error||"دریافت اطلاعات ناموفق بود.");setData(d);
  }catch(e){setError(e instanceof Error?e.message:"ارتباط با سرور برقرار نشد.")}finally{setLoading(false)}},[token,tenantId,router]);
 useEffect(()=>{if(!token){return}void load()},[token,load]);
 async function changeStatus(status:"Active"|"Suspended"){
  if(!data)return;const action=status==="Suspended"?"معلق کردن":"فعال کردن";
  if(!window.confirm("آیا از "+action+" کسب‌وکار «"+data.tenant.name+"» مطمئن هستید؟"))return;
  setBusy(true);setError("");setNotice("");try{
   const r=await fetch("/api/tenants/"+encodeURIComponent(tenantId),{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify({name:data.tenant.name,contactEmail:data.tenant.contactEmail,contactMobile:data.tenant.contactMobile,status})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"تغییر وضعیت انجام نشد.");
   setNotice(status==="Suspended"?"کسب‌وکار معلق شد و دسترسی کاربران آن مسدود می‌شود.":"کسب‌وکار فعال شد.");await load();
  }catch(e){setError(e instanceof Error?e.message:"تغییر وضعیت ناموفق بود.")}finally{setBusy(false)}
 }
 async function logout(){try{await fetch("/api/auth/logout",{method:"POST",headers:{Authorization:"Bearer "+token}})}catch{}finally{sessionStorage.removeItem("repairMasterAccessToken");router.replace("/login")}}
 return <main className="tenant-page" dir="rtl"><header className="tenant-topbar">
  <button className="tenant-back" onClick={()=>router.push("/tenants")}><ArrowRight size={17}/> فهرست کسب‌وکارها</button>
  <div className="tenant-brand"><span>RM</span><strong>پرونده کسب‌وکار</strong></div>
  <button className="tenant-logout" onClick={logout}><LogOut size={16}/> خروج</button>
 </header><section className="tenant-content">
  {loading&&!data?<div className="tenant-state">در حال دریافت پرونده کسب‌وکار...</div>:null}
  {error&&<div className="tenant-error" role="alert">{error}</div>}{notice&&<div className="tenant-success" role="status">{notice}</div>}
  {data&&<><div className="tenant-heading"><div className="tenant-title-icon"><Building2 size={22}/></div><div><h1>{data.tenant.name}</h1><p>کد {data.tenant.code} · شناسه {data.tenant.tenantId} · ثبت {date(data.tenant.createdAt)}</p></div>
   <span className={"tenant-status "+(data.tenant.status==="Active"?"is-active":data.tenant.status==="Suspended"?"is-suspended":"is-pending")}>{statusLabel[data.tenant.status]||data.tenant.status}</span>
   {data.tenant.status==="Active"?<button className="tenant-cancel" disabled={busy} onClick={()=>void changeStatus("Suspended")}>{busy?"در حال ثبت...":"تعلیق کسب‌وکار"}</button>:<button className="tenant-primary" disabled={busy} onClick={()=>void changeStatus("Active")}>{busy?"در حال ثبت...":"فعال‌سازی کسب‌وکار"}</button>}
   <button className="tenant-refresh" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> بروزرسانی</button>
  </div>
  <div className="workspace-summary">
   <article><span className="workspace-summary-icon"><Users size={20}/></span><div><small>کاربران کسب‌وکار</small><strong>{data.users.length} نفر · {data.users.filter(x=>x.isActive).length} فعال</strong></div></article>
   <article><span className="workspace-summary-icon"><CreditCard size={20}/></span><div><small>اشتراک</small><strong>{statusLabel[data.subscriptions[0]?.status||"Unknown"]||data.subscriptions[0]?.status||"بدون اشتراک"}</strong></div></article>
   <article><span className="workspace-summary-icon"><Database size={20}/></span><div><small>پایگاه داده</small><strong>{data.databases.length?data.databases.filter(x=>x.isActive).length+" فعال از "+data.databases.length:"ثبت نشده"}</strong></div></article>
  </div>
  <h2 className="subscription-section-title">اطلاعات شرکت</h2><section className="tenant-table-wrap"><table className="tenant-table"><tbody>
   <tr><th>ایمیل تماس</th><td>{data.tenant.contactEmail||"—"}</td><th>تلفن</th><td>{data.tenant.contactMobile||"—"}</td></tr>
   <tr><th>آخرین بروزرسانی</th><td>{date(data.tenant.updatedAt)}</td><th>وضعیت</th><td>{statusLabel[data.tenant.status]||data.tenant.status}</td></tr>
  </tbody></table></section>
  <h2 className="subscription-section-title">کاربران <span className="users-count">{data.users.length} نفر</span></h2><section className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>نام</th><th>تماس</th><th>نقش</th><th>عضویت</th><th>وضعیت</th></tr></thead><tbody>{data.users.map(u=><tr key={u.tenantUserId}><td><strong>{u.fullName}</strong><small>{u.email||"—"} · شناسه {u.userId}</small></td><td>{u.mobile||"—"}</td><td>{u.isOwner?"مالک":u.roles.map(r=>statusLabel[r]||r).join("، ")||"—"}</td><td>{date(u.joinedAt)}</td><td><span className={"tenant-status "+(u.isActive?"is-active":"is-suspended")}>{u.isActive?"فعال":"غیرفعال"}</span></td></tr>)}</tbody></table>{data.users.length===0&&<div className="tenant-state">کاربری برای این کسب‌وکار ثبت نشده است.</div>}</section>
  <h2 className="subscription-section-title">اشتراک‌ها</h2><section className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>پلن</th><th>وضعیت</th><th>مبلغ</th><th>شروع</th><th>پایان</th></tr></thead><tbody>{data.subscriptions.map(s=><tr key={s.subscriptionId}><td><strong>{s.planName}</strong><small>#{s.subscriptionId} · {s.durationDays} روز</small></td><td>{statusLabel[s.status]||s.status}</td><td>{money(s.price)}</td><td>{date(s.startsAt)}</td><td>{date(s.endsAt)}</td></tr>)}</tbody></table>{data.subscriptions.length===0&&<div className="tenant-state">اشتراکی ثبت نشده است.</div>}</section>
  <h2 className="subscription-section-title">دیتابیس مرتبط</h2><section className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>نام دیتابیس</th><th>سرور</th><th>نسخه Schema</th><th>وضعیت</th><th>Provisioning</th><th>آخرین رویداد</th></tr></thead><tbody>{data.databases.map(d=><tr key={d.tenantDatabaseId}><td dir="ltr">{d.databaseName}</td><td>{d.serverName||"—"}</td><td>{d.schemaVersion||"نامشخص"}</td><td><span className={"tenant-status "+(d.isActive?"is-active":"is-suspended")}>{d.isActive?"فعال":"غیرفعال"}</span></td><td>{statusLabel[d.provisioningStatus]||d.provisioningStatus}{d.lastErrorCode&&<small>{d.lastErrorCode}</small>}</td><td>{date(d.provisioningUpdatedAt)}</td></tr>)}</tbody></table>{data.databases.length===0&&<div className="tenant-state">دیتابیسی برای این کسب‌وکار ثبت نشده است.</div>}</section>
  <h2 className="subscription-section-title">آخرین پرداخت‌ها</h2><section className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>شناسه</th><th>مبلغ</th><th>وضعیت</th><th>درگاه</th><th>تاریخ</th></tr></thead><tbody>{data.payments.map(p=><tr key={p.paymentTransactionId}><td>#{p.paymentTransactionId}</td><td>{money(p.amount)}</td><td>{statusLabel[p.status]||p.status}</td><td>{p.gateway}</td><td>{date(p.paidAt||p.createdAt)}</td></tr>)}</tbody></table>{data.payments.length===0&&<div className="tenant-state">پرداختی ثبت نشده است.</div>}</section>
  <p className="tenant-note">تعلیق کسب‌وکار، وضعیت آن را تغییر می‌دهد و مسیرهای عملیاتی کاربران را مسدود می‌کند؛ اطلاعات، کاربران و سوابق مالی حذف نمی‌شوند.</p>
  </>}
 </section></main>
}
