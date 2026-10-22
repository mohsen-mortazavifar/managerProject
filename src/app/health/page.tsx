"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

type HealthResult = { status: string; database: string; timestamp?: string };

export default function HealthPage() {
  const router = useRouter();
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ status: "degraded", database: "unavailable" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="tenant-page" dir="rtl">
      <header className="tenant-topbar">
        <button className="tenant-back" onClick={() => router.push("/")}><ArrowRight size={17} /> داشبورد</button>
        <div className="tenant-brand"><span>RM</span><strong>سلامت سامانه</strong></div>
        <button className="tenant-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> بررسی مجدد</button>
      </header>
      <section className="tenant-content">
        <div className="tenant-heading">
          <div className="tenant-title-icon"><Activity size={22} /></div>
          <div><h1>سلامت اتصال</h1><p>بررسی اتصال برنامه به دیتابیس مرکزی SQL Server</p></div>
        </div>
        <section className="health-status-card">
          {loading ? <><RefreshCw className="health-spin" size={25} /><strong>در حال بررسی اتصال...</strong></> :
            result?.database === "connected" ? <><CheckCircle2 size={28} /><strong>دیتابیس در دسترس است</strong><span>API سلامت پاسخ موفق دریافت کرده است.</span></> :
            <><XCircle size={28} /><strong>اتصال دیتابیس برقرار نیست</strong><span>مقادیر DB_SERVER، DB_NAME، DB_USER و DB_PASSWORD و دسترسی شبکه SQL Server را بررسی کنید.</span></>}
          {result?.timestamp && <small>آخرین بررسی: {new Date(result.timestamp).toLocaleString("fa-IR")}</small>}
        </section>
        <p className="tenant-note">این بررسی فقط اتصال پایه و اجرای SELECT 1 را آزمایش می‌کند؛ صحت همه جداول، مجوزها یا عملکرد ورود را تضمین نمی‌کند.</p>
      </section>
    </main>
  );
}
