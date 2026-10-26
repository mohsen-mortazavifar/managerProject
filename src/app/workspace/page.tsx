"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleUserRound, ClipboardList, CreditCard, LogOut, RefreshCw, Settings, ShieldCheck, Wrench, LockKeyhole } from "lucide-react";

type StatusResponse = {
  error?: string;
  tenant?: { tenantId: string; name: string; code: string; status: string };
  database?: { ready: boolean; name: string | null; schemaVersion: string | null };
  provisioning?: { status: string; attemptCount: number; maxAttempts: number; lastErrorCode: string | null; correlationId: string | null; updatedAt: string | null };
};

export default function WorkspacePage() {
  const router = useRouter();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) {
      router.replace("/owner-login");
      return;
    }
    setRefreshing(true);
    try {
      const meResponse = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const meData = await meResponse.json() as { user?: { isPlatformUser?: boolean } };
      if (meResponse.status === 401) {
        sessionStorage.removeItem("repairMasterAccessToken");
        router.replace("/owner-login");
        return;
      }
      if (meResponse.ok && meData.user?.isPlatformUser) {
        router.replace("/");
        return;
      }
      const response = await fetch("/api/tenants/current-status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json() as StatusResponse;
      if (response.status === 401) {
        sessionStorage.removeItem("repairMasterAccessToken");
        router.replace("/owner-login");
        return;
      }
      if (!response.ok) {
        setError(result.error || "دریافت اطلاعات فضای کاری ممکن نشد.");
        return;
      }
      if (result.tenant?.status !== "Active" || !result.database?.ready) {
        router.replace("/onboarding");
        return;
      }
      const subscriptionResponse = await fetch("/api/subscription-orders", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!subscriptionResponse.ok) {
        setError("وضعیت اشتراک بررسی نشد. دوباره تلاش کنید.");
        return;
      }
      const subscriptionData = await subscriptionResponse.json() as { orders?: Array<{ status: string; endsAt: string }> };
      const hasActivePlan = (subscriptionData.orders || []).some((order) =>
        order.status === "Active" && new Date(order.endsAt).getTime() > Date.now()
      );
      if (!hasActivePlan) {
        router.replace("/workspace/subscription2");
        return;
      }
      setData(result);
      setError("");
    } catch {
      setError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function logout() {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch { /* clear local token even when offline */ }
    }
    sessionStorage.removeItem("repairMasterAccessToken");
    router.replace("/owner-login");
  }

  return (
    <main className="workspace-page" dir="rtl">
      <header className="workspace-topbar">
        <div className="workspace-brand"><span>RM</span><div><strong>Repair Master</strong><small>پنل کسب‌وکار</small></div></div>
        <div className="workspace-top-actions">
          <button className="workspace-refresh" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} /> به‌روزرسانی</button>
          <button className="workspace-logout" onClick={() => void logout()}><LogOut size={16} /> خروج</button>
        </div>
      </header>
      <section className="workspace-content">
        <div className="workspace-welcome">
          <div>
            <span className="workspace-eyebrow">فضای کاری شما</span>
            <h1>{loading ? "در حال بارگذاری..." : `خوش آمدید، ${data?.tenant?.name || "صاحب کسب‌وکار"}`}</h1>
            <p>فضای کسب‌وکار شما آماده است. از این صفحه می‌توانید بخش‌های اصلی را دنبال کنید.</p>
          </div>
          <div className="workspace-ready"><ShieldCheck size={18} /><span>دیتابیس آماده است</span></div>
        </div>

        {error && <div className="workspace-error" role="alert">{error}</div>}

        <section className="workspace-summary">
          <article><span className="workspace-summary-icon"><Building2 size={19} /></span><div><small>نام کسب‌وکار</small><strong>{data?.tenant?.name || "—"}</strong></div></article>
          <article><span className="workspace-summary-icon"><ShieldCheck size={19} /></span><div><small>وضعیت</small><strong>{data?.tenant?.status === "Active" ? "فعال" : data?.tenant?.status || "در حال بررسی"}</strong></div></article>
          <article><span className="workspace-summary-icon"><CircleUserRound size={19} /></span><div><small>کد فضای کاری</small><strong dir="ltr">{data?.tenant?.code || "—"}</strong></div></article>
        </section>

        <div className="workspace-section-heading"><div><h2>مدیریت کسب‌وکار</h2><p>ماژول‌ها به‌تدریج در همین فضای کاری اضافه می‌شوند.</p></div></div>
        <section className="workspace-module-grid">
          <article className="workspace-module-card workspace-module-card-active">
            <span><Building2 size={21} /></span><div><h3>اطلاعات کسب‌وکار</h3><p>وضعیت و مشخصات فضای کاری فعلی</p></div><small>آماده</small>
          </article>
          <button type="button" className="workspace-module-card workspace-module-card-link" onClick={() => router.push("/workspace/users")} aria-label="مدیریت کاربران و دسترسی‌ها">
            <span><CircleUserRound size={21} /></span><div><h3>کاربران و دسترسی‌ها</h3><p>مدیریت اعضا و نقش‌های دسترسی</p></div><small>ورود به بخش</small>
          </button>
          <article className="workspace-module-card">
            <span><Wrench size={21} /></span><div><h3>خدمات و تعمیرات</h3><p>ثبت و پیگیری سفارش‌های تعمیر</p></div><small>در نقشه راه</small>
          </article>
          <article className="workspace-module-card">
            <span><ClipboardList size={21} /></span><div><h3>مشتریان و سفارش‌ها</h3><p>مدیریت مشتریان، دستگاه‌ها و سوابق</p></div><small>در نقشه راه</small>
          </article>
          <button type="button" className="workspace-module-card workspace-module-card-link" onClick={() => router.push("/workspace/subscription2")} aria-label="ورود به بخش مالی و اشتراک">
            <span><CreditCard size={21} /></span><div><h3>مالی و اشتراک</h3><p>مدیریت هزینه‌ها و پلن کسب‌وکار</p></div><small>ورود به بخش</small>
          </button>
          <article className="workspace-module-card">
            <span><Settings size={21} /></span><div><h3>تنظیمات فضای کاری</h3><p>تنظیمات پایه و دسترسی اعضا</p></div><small>در نقشه راه</small>
          </article>
        </section>
        <button type="button" className="workspace-module-card workspace-module-card-link" onClick={() => router.push("/workspace/security/password")} aria-label="تنظیم رمز عبور پشتیبان">
          <span><LockKeyhole size={21} /></span><div><h3>رمز عبور پشتیبان</h3><p>ورود جایگزین در صورت در دسترس نبودن پیامک</p></div><small>تنظیم رمز</small>
        </button>
        <footer className="workspace-footer">این نسخه اولیه پنل مالک است؛ ماژول‌های عملیاتی هنوز به‌صورت کامل فعال نشده‌اند.</footer>
      </section>
    </main>
  );
}
