"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

export default function BackupPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    if (password !== confirm) { setError("رمز عبور و تکرار آن یکسان نیستند."); return; }
    if (password.length < 12) { setError("رمز عبور باید حداقل ۱۲ کاراکتر باشد."); return; }
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/owner-password/set", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) { setError(result.error || "تنظیم رمز عبور انجام نشد."); return; }
      setMessage(result.message || "رمز پشتیبان ذخیره شد.");
      setPassword(""); setConfirm("");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <Link className="auth-back" href="/workspace"><ArrowRight size={16} /> بازگشت به فضای کسب‌وکار</Link>
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>امنیت حساب</small></div></div>
        <div className="auth-icon"><LockKeyhole size={23} /></div>
        <h1>تنظیم رمز عبور پشتیبان</h1>
        <p className="auth-description">ابتدا با پیامک وارد شوید، سپس می‌توانید یک رمز عبور حداقل ۱۲ کاراکتری برای مواقعی که پیامک در دسترس نیست تنظیم کنید.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="password">رمز عبور جدید</label>
          <input id="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={password} onChange={e => setPassword(e.target.value)} />
          <label htmlFor="confirm">تکرار رمز عبور</label>
          <input id="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirm} onChange={e => setConfirm(e.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-success" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "در حال ذخیره..." : "ذخیره رمز پشتیبان"}</button>
        </form>
        <div className="auth-security"><ShieldCheck size={16} /><span>رمز عبور به‌صورت هش ذخیره می‌شود و متن اصلی آن نگهداری نمی‌شود.</span></div>
      </section>
    </main>
  );
}
