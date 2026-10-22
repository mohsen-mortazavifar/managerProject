"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "ورود انجام نشد.");
        return;
      }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      router.replace("/tenants");
    } catch {
      setError("ارتباط با سرور برقرار نشد. اجرای برنامه و تنظیمات دیتابیس را بررسی کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>پنل مدیریت پلتفرم</small></div></div>
        <div className="auth-icon"><LockKeyhole size={23} /></div>
        <h1>ورود مدیر سامانه</h1>
        <p className="auth-description">برای مدیریت کسب‌وکارها با حساب کاربری مدیر سیستم وارد شوید.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">ایمیل</label>
          <input id="email" type="email" autoComplete="username" required maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
          <label htmlFor="password">رمز عبور</label>
          <input id="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز عبور حساب" />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy} type="submit"><LogIn size={17} />{busy ? "در حال بررسی..." : "ورود به پنل"}</button>
        </form>
        <div className="auth-security"><ShieldCheck size={16} /><span>اتصال امن با توکن دسترسی کوتاه‌مدت</span></div>
        <p className="auth-footnote">برای ورود موفق، حساب باید در جدول Users فعال و دارای دسترسی مدیر سیستم باشد.</p>
      </section>
    </main>
  );
}
