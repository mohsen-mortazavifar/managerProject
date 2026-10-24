"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, LogOut, Plus, RefreshCw, Search, X } from "lucide-react";

type Tenant = {
  tenantId: string; name: string; code: string; status: string;
  contactEmail: string; contactMobile: string; createdAt: string;
};
const statusLabels: Record<string, string> = {
  Pending: "در انتظار راه‌اندازی", Active: "فعال", Suspended: "تعلیق‌شده",
};

export default function TenantsPage() {
  const router = useRouter();
  const [token] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("repairMasterAccessToken") ?? "");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", contactEmail: "", contactMobile: "" });

  useEffect(() => {
    if (!token) router.replace("/login");
  }, [router, token]);

  const loadTenants = useCallback(async (accessToken: string, query: string) => {
    try {
      const response = await fetch(`/api/tenants?search=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
      });
      const result = await response.json();
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem("repairMasterAccessToken");
        router.replace("/login");
        return;
      }
      if (!response.ok) { setError(result.error || "دریافت فهرست ناموفق بود."); return; }
      setTenants(result.tenants);
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const controller = new AbortController();

    async function fetchTenants() {
      try {
        const response = await fetch(`/api/tenants?search=${encodeURIComponent(search)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (cancelled) return;

        if (response.status === 401 || response.status === 403) {
          sessionStorage.removeItem("repairMasterAccessToken");
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setError(result.error || "دریافت فهرست ناموفق بود.");
          setLoading(false);
          return;
        }

        setTenants(result.tenants);
        setError("");
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("ارتباط با سرور برقرار نشد.");
          setLoading(false);
        }
      }
    }

    void fetchTenants();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, search, router]);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem("repairMasterAccessToken");
        router.replace("/login");
        return;
      }
      if (!response.ok) { setError(result.error || "ثبت کسب‌وکار انجام نشد."); return; }
      setShowCreate(false);
      setForm({ name: "", code: "", contactEmail: "", contactMobile: "" });
      await loadTenants(token, search);
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setSaving(false); }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      // Local logout must still complete when the server cannot be reached.
    } finally {
      // Clear local credentials even if the network or server is unavailable.
      sessionStorage.removeItem("repairMasterAccessToken");
      router.replace("/login");
    }
  }

  return (
    <main className="tenant-page" dir="rtl">
      <header className="tenant-topbar">
        <button className="tenant-back" onClick={() => router.push("/")}><ArrowRight size={17} /> داشبورد</button>
        <div className="tenant-brand"><span>RM</span><strong>مدیریت کسب‌وکارها</strong></div>
        <button className="tenant-logout" onClick={logout}><LogOut size={16} /> خروج</button>
      </header>
      <section className="tenant-content">
        <div className="tenant-heading">
          <div className="tenant-title-icon"><Building2 size={22} /></div>
          <div><h1>کسب‌وکارها (Tenants)</h1><p>فهرست و ثبت کسب‌وکارهای ثبت‌شده در سامانه</p></div>
          <button className="tenant-primary" onClick={() => { setError(""); setShowCreate(true); }}><Plus size={17} /> کسب‌وکار جدید</button>
        </div>

        <div className="tenant-toolbar">
          <label className="tenant-search"><Search size={17} /><input value={search} onChange={(e) => { setLoading(true); setSearch(e.target.value); }} placeholder="جستجو بر اساس نام، کد یا ایمیل" /></label>
          <button className="tenant-refresh" onClick={() => { if (token) { setLoading(true); void loadTenants(token, search); } }} disabled={loading}><RefreshCw size={16} /> بروزرسانی</button>
          <span className="tenant-count">{tenants.length} مورد</span>
        </div>

        {error && <div className="tenant-error" role="alert">{error}</div>}

        <section className="tenant-table-wrap">
          {loading ? <div className="tenant-state">در حال دریافت اطلاعات...</div> : tenants.length === 0 ? (
            <div className="tenant-state"><Building2 size={28} /><strong>کسب‌وکاری پیدا نشد</strong><span>اگر دیتابیس خالی است، از «کسب‌وکار جدید» شروع کنید.</span></div>
          ) : (
            <table className="tenant-table">
              <thead><tr><th>نام کسب‌وکار</th><th>کد</th><th>ایمیل تماس</th><th>شماره تماس</th><th>وضعیت</th></tr></thead>
              <tbody>{tenants.map((tenant) => <tr key={tenant.tenantId} onClick={() => router.push("/tenants/" + encodeURIComponent(tenant.tenantId))} style={{ cursor: "pointer" }} title="مشاهده پرونده کسب‌وکار">
                <td><strong>{tenant.name}</strong><small>شناسه: {tenant.tenantId} · مشاهده جزئیات ←</small></td>
                <td><code>{tenant.code}</code></td><td>{tenant.contactEmail || "—"}</td><td>{tenant.contactMobile || "—"}</td>
                <td><span className={`tenant-status ${tenant.status === "Active" ? "is-active" : tenant.status === "Suspended" ? "is-suspended" : "is-pending"}`}>{statusLabels[tenant.status] || tenant.status}</span></td>
              </tr>)}</tbody>
            </table>
          )}
        </section>
        <p className="tenant-note">برای مشاهده این فهرست، توکن معتبر و نقش مدیر سیستم لازم است. این صفحه اطلاعات را از SQL Server دریافت می‌کند و داده نمونه نمایش نمی‌دهد.</p>
      </section>

      {showCreate && <div className="tenant-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
        <section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="create-tenant-title">
          <div className="tenant-modal-heading"><div><h2 id="create-tenant-title">ثبت کسب‌وکار جدید</h2><p>اطلاعات اولیه را وارد کنید.</p></div><button aria-label="بستن" onClick={() => setShowCreate(false)}><X size={19} /></button></div>
          <form onSubmit={createTenant}>
            <label>نام کسب‌وکار *<input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>کد یکتا *<input required minLength={2} maxLength={50} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ACME_01" /></label>
            <label>ایمیل تماس<input type="email" maxLength={255} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></label>
            <label>شماره تماس<input maxLength={20} value={form.contactMobile} onChange={(e) => setForm({ ...form, contactMobile: e.target.value })} /></label>
            <div className="tenant-modal-actions"><button type="button" className="tenant-cancel" onClick={() => setShowCreate(false)}>انصراف</button><button type="submit" className="tenant-primary" disabled={saving}>{saving ? "در حال ثبت..." : "ثبت کسب‌وکار"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
