"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CreditCard, LogOut, Plus, RefreshCw, X } from "lucide-react";

type Plan = { subscriptionPlanId:string; name:string; description:string; price:number; durationDays:number; maxBranches:number; maxUsers:number; maxSmsPerMonth:number; isActive:boolean; createdAt:string };
type Form = { name:string; description:string; price:string; durationDays:string; maxBranches:string; maxUsers:string; maxSmsPerMonth:string; isActive:boolean };
const emptyForm:Form = { name:"", description:"", price:"0", durationDays:"30", maxBranches:"1", maxUsers:"5", maxSmsPerMonth:"0", isActive:true };
const money = (value:number) => new Intl.NumberFormat("fa-IR").format(value) + " تومان";
const number = (value:number) => new Intl.NumberFormat("fa-IR").format(value);

export default function PlansPage() {
 const router=useRouter();
 const [token]=useState(()=>typeof window==="undefined"?"":sessionStorage.getItem("repairMasterAccessToken")??"");
 const [plans,setPlans]=useState<Plan[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [showForm,setShowForm]=useState(false);
 const [editing,setEditing]=useState<string|null>(null);
 const [status,setStatus]=useState("all");
 const [form,setForm]=useState<Form>(emptyForm);

 useEffect(()=>{if(!token)router.replace("/login");},[token,router]);

 const loadPlans=useCallback(async(accessToken:string,filter:string)=>{
  setLoading(true);setError("");
  try{
   const response=await fetch(`/api/plans?status=${filter}`,{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
   const result=await response.json();
   if(response.status===401||response.status===403){sessionStorage.removeItem("repairMasterAccessToken");router.replace("/login");return;}
   if(!response.ok){setError(result.error||"دریافت پلن‌ها انجام نشد.");return;}
   setPlans(result.plans);
  }catch{setError("ارتباط با سرور برقرار نشد.");}
  finally{setLoading(false);}
 },[router]);

 useEffect(() => { if (!token) return; let cancelled = false; async function fetchPlans() { setLoading(true); setError(""); try { const response = await fetch(`/api/plans?status=${status}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const result = await response.json(); if (cancelled) return; if (response.status === 401 || response.status === 403) { sessionStorage.removeItem("repairMasterAccessToken"); router.replace("/login"); return; } if (!response.ok) { setError(result.error || "دریافت پلن‌ها انجام نشد."); return; } setPlans(result.plans); } catch { if (!cancelled) { setError("ارتباط با سرور برقرار نشد."); } } finally { if (!cancelled) { setLoading(false); } } } void fetchPlans(); return () => { cancelled = true; }; }, [token, status, router]);

 function openCreate(){setEditing(null);setForm(emptyForm);setError("");setNotice("");setShowForm(true);}
 function openEdit(plan:Plan){setEditing(plan.subscriptionPlanId);setForm({name:plan.name,description:plan.description,price:String(plan.price),durationDays:String(plan.durationDays),maxBranches:String(plan.maxBranches),maxUsers:String(plan.maxUsers),maxSmsPerMonth:String(plan.maxSmsPerMonth),isActive:plan.isActive});setError("");setNotice("");setShowForm(true);}

 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setSaving(true);setError("");setNotice("");
  const payload={...form,price:Number(form.price),durationDays:Number(form.durationDays),maxBranches:Number(form.maxBranches),maxUsers:Number(form.maxUsers),maxSmsPerMonth:Number(form.maxSmsPerMonth)};
  try{
   const response=await fetch(editing?`/api/plans/${editing}`:"/api/plans",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
   const result=await response.json();
   if(response.status===401||response.status===403){sessionStorage.removeItem("repairMasterAccessToken");router.replace("/login");return;}
   if(!response.ok){setError(result.error||"ذخیره پلن انجام نشد.");return;}
   setShowForm(false);setNotice(editing?"تغییرات پلن ذخیره شد.":"پلن جدید ثبت شد.");await loadPlans(token,status);
  }catch{setError("ارتباط با سرور برقرار نشد.");}
  finally{setSaving(false);}
 }

 async function logout(){
  try{await fetch("/api/auth/logout",{method:"POST",headers:{Authorization:`Bearer ${token}`},cache:"no-store"});}catch{}
  finally{sessionStorage.removeItem("repairMasterAccessToken");router.replace("/login");}
 }

 return <main className="tenant-page" dir="rtl">
  <header className="tenant-topbar"><button className="tenant-back" onClick={()=>router.push("/")}><ArrowRight size={17}/> داشبورد</button><div className="tenant-brand"><span>RM</span><strong>مدیریت پلن‌ها</strong></div><button className="tenant-logout" onClick={logout}><LogOut size={16}/> خروج</button></header>
  <section className="tenant-content">
   <div className="tenant-heading"><div className="tenant-title-icon"><CreditCard size={22}/></div><div><h1>پلن‌های اشتراک</h1><p>ایجاد و مدیریت پلن‌های قابل فروش به کسب‌وکارها</p></div><button className="tenant-primary" onClick={openCreate}><Plus size={17}/> پلن جدید</button></div>
   <div className="tenant-toolbar"><label className="tenant-search">وضعیت پلن <select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">همه</option><option value="active">فعال</option><option value="inactive">غیرفعال</option></select></label><button className="tenant-refresh" onClick={()=>{if(token)void loadPlans(token,status)}} disabled={loading}><RefreshCw size={16}/> بروزرسانی</button><span className="tenant-count">{number(plans.length)} پلن</span></div>
   {error&&<div className="tenant-error" role="alert">{error}</div>}{notice&&<div className="tenant-success" role="status">{notice}</div>}
   <section className="tenant-table-wrap">
    {loading?<div className="tenant-state">در حال دریافت اطلاعات...</div>:plans.length===0?<div className="tenant-state"><CreditCard size={28}/><strong>پلنی ثبت نشده است</strong><span>برای شروع، یک پلن جدید ایجاد کنید.</span></div>:<table className="tenant-table"><thead><tr><th>نام پلن</th><th>قیمت</th><th>اعتبار</th><th>شعبه</th><th>کاربر</th><th>پیامک ماهانه</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{plans.map(plan=><tr key={plan.subscriptionPlanId}><td><strong>{plan.name}</strong><small>{plan.description||"بدون توضیحات"}</small></td><td>{money(plan.price)}</td><td>{number(plan.durationDays)} روز</td><td>{number(plan.maxBranches)}</td><td>{number(plan.maxUsers)}</td><td>{number(plan.maxSmsPerMonth)}</td><td><span className={`tenant-status ${plan.isActive?"is-active":"is-suspended"}`}>{plan.isActive?"فعال":"غیرفعال"}</span></td><td><button className="tenant-refresh" onClick={()=>openEdit(plan)}>ویرایش</button></td></tr>)}</tbody></table>}
   </section>
   <p className="tenant-note">غیرفعال‌کردن پلن، فروش جدید آن را متوقف می‌کند؛ اشتراک‌های فعال مشتریان قبلی در این مرحله تغییر نمی‌کنند.</p>
  </section>
  {showForm&&<div className="tenant-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowForm(false);}}><section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="plan-form-title"><div className="tenant-modal-heading"><div><h2 id="plan-form-title">{editing?"ویرایش پلن":"ایجاد پلن جدید"}</h2><p>قیمت و محدودیت‌های پلن را مشخص کنید.</p></div><button aria-label="بستن" onClick={()=>setShowForm(false)}><X size={19}/></button></div><form onSubmit={save}>
   <label>نام پلن *<input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>توضیحات<textarea maxLength={1000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
   <div className="plan-form-grid"><label>قیمت (تومان) *<input required type="number" min="0" step="0.01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label><label>مدت اعتبار (روز) *<input required type="number" min="1" max="36500" step="1" value={form.durationDays} onChange={e=>setForm({...form,durationDays:e.target.value})}/></label><label>حداکثر شعبه *<input required type="number" min="0" step="1" value={form.maxBranches} onChange={e=>setForm({...form,maxBranches:e.target.value})}/></label><label>حداکثر کاربر *<input required type="number" min="0" step="1" value={form.maxUsers} onChange={e=>setForm({...form,maxUsers:e.target.value})}/></label><label>پیامک ماهانه *<input required type="number" min="0" step="1" value={form.maxSmsPerMonth} onChange={e=>setForm({...form,maxSmsPerMonth:e.target.value})}/></label></div>
   <label className="plan-active-toggle"><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/> پلن برای سفارش جدید فعال باشد</label>
   <div className="tenant-modal-actions"><button type="button" className="tenant-cancel" onClick={()=>setShowForm(false)}>انصراف</button><button type="submit" className="tenant-primary" disabled={saving}>{saving?"در حال ذخیره...":"ذخیره پلن"}</button></div>
  </form></section></div>}
 </main>;
}
