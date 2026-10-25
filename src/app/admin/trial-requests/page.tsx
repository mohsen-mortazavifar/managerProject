"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, RefreshCw, XCircle } from "lucide-react";

type TrialRequest = {
  trialRequestId: string; tenantId: string; tenantName: string; subscriptionPlanId: string;
  planName: string; subscriptionId: string | null; status: string; subscriptionStatus: string | null;
  requestedAt: string; reviewedAt: string | null; reviewNote: string; durationDays: number; price: number;
};
const date = (value: string) => new Date(value).toLocaleString("fa-IR");
const statuses: Record<string, string> = { Pending: "در انتظار بررسی", Approved: "تأییدشده", Rejected: "ردشده" };

export default function AdminTrialRequestsPage() {
  const router = useRouter();
  const [items, setItems] = useState<TrialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/login"); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/trial-requests", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { setError(data.error || "دسترسی مدیر سیستم لازم است."); return; }
      if (!response.ok) { setError(data.error || "دریافت درخواست‌ها انجام نشد."); return; }
      setItems(data.requests);
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { const id = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(id); }, [load]);

  async function review(item: TrialRequest, decision: "Approved" | "Rejected") {
    const label = decision === "Approved" ? "تأیید" : "رد";
    if (!confirm(`درخواست پلن آزمایشی کسب‌وکار «${item.tenantName}» ${label} شود؟`)) return;
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/login"); return; }
    setBusy(item.trialRequestId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/trial-requests", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trialRequestId: item.trialRequestId, decision })
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "ثبت تصمیم انجام نشد."); return; }
      setNotice(decision === "Approved" ? "درخواست تأیید شد؛ اشتراک فعال یا رزرو شد." : "درخواست رد شد.");
      await load();
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(""); }
  }

  return <main className="tenant-page" dir="rtl">
    <header className="tenant-topbar">
      <button className="tenant-back" onClick={() => router.push("/admin")}><ArrowRight size={17} /> پنل مدیریت</button>
      <div className="tenant-brand"><span>RM</span><strong>بررسی پلن‌های آزمایشی</strong></div>
      <button className="tenant-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> بروزرسانی</button>
    </header>
    <section className="tenant-content">
      <div className="tenant-heading"><div className="tenant-title-icon"><CheckCircle size={22} /></div><div><h1>درخواست‌های پلن آزمایشی</h1><p>هر کسب‌وکار فقط یک بار می‌تواند درخواست آزمایشی ثبت کند.</p></div></div>
      {error && <div className="tenant-error" role="alert">{error}</div>}
      {notice && <div className="tenant-success" role="status">{notice}</div>}
      {loading ? <div className="tenant-state">در حال دریافت اطلاعات...</div> : items.length === 0 ? <div className="tenant-state">درخواستی ثبت نشده است.</div> :
        <section className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>کسب‌وکار</th><th>پلن</th><th>مدت</th><th>تاریخ درخواست</th><th>وضعیت</th><th>عملیات</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.trialRequestId}><td>{item.tenantName}</td><td>{item.planName}</td><td>{new Intl.NumberFormat("fa-IR").format(item.durationDays)} روز</td><td>{date(item.requestedAt)}</td><td>{statuses[item.status] || item.status}</td><td>{item.status === "Pending" ? <div className="tenant-row-actions"><button className="tenant-primary" disabled={Boolean(busy)} onClick={() => void review(item, "Approved")}><CheckCircle size={15} /> {busy === item.trialRequestId ? "در حال ثبت..." : "تأیید"}</button><button className="tenant-back" disabled={Boolean(busy)} onClick={() => void review(item, "Rejected")}><XCircle size={15} /> رد</button></div> : item.reviewNote || "—"}</td></tr>)}</tbody>
        </table></section>}
    </section>
  </main>;
}
