"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, LoaderCircle, Phone, ShieldCheck } from "lucide-react";

type RequestResult = { challengeId?: string; message?: string; error?: string };
type VerifyResult = { accessToken?: string; error?: string };

export default function OwnerLoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/owner-otp/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "login", mobile }),
      });
      const result = await response.json() as RequestResult;
      if (!response.ok || !result.challengeId) { setError(result.error || "اگر شماره واجد شرایط باشد، کد ارسال می‌شود. شماره و تنظیمات پیامک را بررسی کنید."); return; }
      setChallengeId(result.challengeId);
      setNotice("کد تأیید ارسال شد. تا ۵ دقیقه فرصت دارید.");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/owner-otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, mobile, code }),
      });
      const result = await response.json() as VerifyResult;
      if (!response.ok || !result.accessToken) { setError(result.error || "کد معتبر نیست یا منقضی شده است."); return; }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      router.replace("/tenants");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <Link className="auth-back" href="/"><ArrowRight size={16} /> صفحه اصلی</Link>
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>ورود به فضای کسب‌وکار</small></div></div>
        <div className="auth-icon"><Phone size={23} /></div>
        <h1>ورود مالک با موبایل</h1>
        <p className="auth-description">شماره موبایل تأییدشده را وارد کنید تا کد یک‌بارمصرف دریافت کنید.</p>
        {!challengeId ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="mobile"><Phone size={15} /> شماره موبایل</label>
            <input id="mobile" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+989121234567" dir="ltr" />
            {notice && <p className="auth-success" role="status">{notice}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}{busy ? "در حال ارسال..." : "دریافت کد ورود"}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <p className="auth-success" role="status">{notice}</p>
            <label htmlFor="code"><KeyRound size={15} /> کد ۶ رقمی</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="۱۲۳۴۵۶" dir="ltr" />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" disabled={busy || code.length !== 6} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={17} />}{busy ? "در حال بررسی..." : "تأیید و ورود"}</button>
            <button className="auth-secondary" type="button" onClick={() => { setChallengeId(""); setCode(""); setError(""); setNotice(""); }}>تغییر شماره</button>
          </form>
        )}
        <div className="auth-security"><ShieldCheck size={16} /><span>کد یک‌بارمصرف حداکثر ۵ دقیقه اعتبار دارد.</span></div>
        <p className="auth-footnote">مدیر سیستم همچنان از <a href="/login">صفحه ورود مدیر</a> استفاده می‌کند.</p>
        <p className="auth-footnote">حساب ندارید؟ <a href="/register">ثبت‌نام مالک</a></p>
      </section>
    </main>
  );
}
