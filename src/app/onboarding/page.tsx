"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, CircleAlert, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from "lucide-react";

type StatusResponse = {
  error?: string;
  tenant?: { tenantId: string; name: string; code: string; status: string };
  database?: { ready: boolean; name: string | null; schemaVersion: string | null };
  provisioning?: {
    status: string; attemptCount: number; maxAttempts: number;
    lastErrorCode: string | null; correlationId: string | null; updatedAt: string | null;
  };
};

function statusLabel(status: string) {
  switch (status) {
    case "Pending": return "در انتظار آماده‌سازی";
    case "Running": return "در حال آماده‌سازی";
    case "CreatingDatabase": return "در حال ساخت دیتابیس";
    case "Migrating": return "در حال نصب ساختار اولیه";
    case "RetryScheduled": return "تلاش مجدد زمان‌بندی شده";
    case "Succeeded": return "با موفقیت آماده شد";
    case "Failed": return "آماده‌سازی ناموفق بود";
    case "Active": return "فعال";
    case "Suspended": return "غیرفعال شده";
    case "Queued": return "در صف پردازش";
    default: return status || "در حال بررسی";
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [planActive, setPlanActive] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) {
      router.replace("/owner-login");
      return;
    }
    if (!quiet) setRefreshing(true);
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
        setError(result.error || "دریافت وضعیت امکان‌پذیر نیست.");
        return;
      }
      setData(result);
      setError("");
      if (result.tenant?.status === "Active" && result.database?.ready) {
        const subscriptionResponse = await fetch("/api/subscription-orders", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json() as { orders?: Array<{ status: string; endsAt: string }> };
          const hasActivePlan = (subscriptionData.orders || []).some((order) =>
            order.status === "Active" && new Date(order.endsAt).getTime() > Date.now()
          );
          setPlanActive(hasActivePlan);
          if (hasActivePlan) {
            router.replace("/workspace");
          }
        } else {
          setPlanActive(false);
        }
      } else {
        setPlanActive(false);
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await refresh(true);
    };
    void run();
    const timer = window.setInterval(() => { if (active) void refresh(true); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  async function logout() {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* local session is cleared even if network is unavailable */ }
    }
    sessionStorage.removeItem("repairMasterAccessToken");
    router.replace("/owner-login");
  }

  const tenantStatus = data?.tenant?.status ?? "";
  const jobStatus = data?.provisioning?.status ?? "";
  const failed = tenantStatus === "Failed" || jobStatus === "Failed";
  const databaseReady = tenantStatus === "Active" && Boolean(data?.database?.ready);
  const active = databaseReady && planActive;
  const waitingForPlan = databaseReady && !planActive && !failed;

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card onboarding-card">
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>راه‌اندازی فضای کسب‌وکار</small></div></div>
        <div className="auth-icon">{active ? <CheckCircle2 size={23} /> : failed ? <CircleAlert size={23} /> : <Building2 size={23} />}</div>
        <h1>{loading ? "در حال دریافت وضعیت..." : active ? "فضای کسب‌وکار فعال است" : waitingForPlan ? "فضای شما آماده است؛ پلن را فعال کنید" : failed ? "آماده‌سازی کامل نشد" : "در حال آماده‌سازی فضای شما"}</h1>
        <p className="auth-description">
          {active
            ? "دیتابیس و ساختار اولیه آماده است و اشتراک فعال شما امکان ورود به پنل را فراهم می‌کند."
            : waitingForPlan
              ? "برای جلوگیری از سردرگمی، ورود به پنل اصلی پس از فعال شدن اشتراک نمایش داده می‌شود. پلن آزمایشی را درخواست کنید یا یک پلن انتخاب و سفارش را تکمیل کنید."
              : failed
                ? "فرایند خودکار پس از چند تلاش ناموفق متوقف شده است. شناسه پیگیری را برای پشتیبانی نگه دارید."
                : "در حال ایجاد دیتابیس اختصاصی و نصب ساختار اولیه هستیم. این صفحه هر ۵ ثانیه وضعیت را بررسی می‌کند."}
        </p>

        {loading && <div className="onboarding-loading"><LoaderCircle className="animate-spin" size={22} /> لطفاً چند لحظه صبر کنید.</div>}

        {data?.tenant && (
          <div className="onboarding-details">
            <div><span>نام کسب‌وکار</span><strong>{data.tenant.name}</strong></div>
            <div><span>وضعیت کسب‌وکار</span><strong>{statusLabel(tenantStatus)}</strong></div>
            <div><span>وضعیت پردازش</span><strong>{statusLabel(jobStatus)}</strong></div>
            <div><span>دیتابیس اختصاصی</span><strong>{data.database?.ready ? "آماده" : "در حال آماده‌سازی"}</strong></div>
            {failed && data.provisioning?.correlationId && <div><span>شناسه پیگیری</span><strong dir="ltr">{data.provisioning.correlationId}</strong></div>}
          </div>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}
        {failed && <p className="auth-error" role="status">در صورت نیاز، مدیر سیستم باید لاگ پردازش را با شناسه پیگیری بررسی کند.</p>}

        <div className="onboarding-actions">
          {waitingForPlan && <button className="auth-submit" type="button" onClick={() => router.push("/workspace/subscription2")}><ShieldCheck size={17} /> انتخاب و فعال‌سازی پلن</button>}
          {active && <button className="auth-submit" type="button" onClick={() => router.push("/workspace")}><CheckCircle2 size={17} /> ورود به پنل کسب‌وکار</button>}
          <button className="auth-submit" type="button" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
            بررسی دوباره وضعیت
          </button>
          <button className="auth-secondary" type="button" onClick={() => void logout()}><LogOut size={16} /> خروج از حساب</button>
        </div>
        {!active && !failed && <div className="auth-security"><ShieldCheck size={16} /><span>می‌توانید این صفحه را باز نگه دارید؛ وضعیت به‌صورت خودکار به‌روزرسانی می‌شود.</span></div>}
      </section>
    </main>
  );
}
