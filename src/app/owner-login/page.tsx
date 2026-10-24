"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, LoaderCircle, Phone, ShieldCheck, LockKeyhole } from "lucide-react";

type ApiResult = { challengeId?: string; message?: string; error?: string; accessToken?: string; user?: { isPlatformUser?: boolean } };

export default function OwnerLoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sms" | "password">("sms");
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
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.challengeId) { setError(result.error || "کد ارسال نشد. چند دقیقه دیگر تلاش کنید."); return; }
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
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.accessToken) { setError(result.error || "کد معتبر نیست یا منقضی شده است."); return; }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      router.replace(result.user?.isPlatformUser ? "/" : "/workspace");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/owner-password/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, password }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.accessToken) { setError(result.error || "ورود انجام نشد."); return; }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      router.replace("/workspace");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <Link className="auth-back" href="/"><ArrowRight size={16} /> صفحه اصلی</Link>
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>ورود به فضای کسب‌وکار</small></div></div>
        <div className="auth-icon">{mode === "sms" ? <Phone size={23} /> : <LockKeyhole size={23} />}</div>
        <h1>ورود به کسب‌وکار</h1>
        <p className="auth-description">روش اصلی ورود، تأیید شماره موبایل با پیامک است. رمز عبور فقط روش جایگزین است.</p>
        <div className="auth-methods">
          <div className="auth-switch">
            <button className={mode === "sms" ? "auth-submit" : "auth-secondary"} type="button" onClick={() => { setMode("sms"); setError(""); setNotice(""); setChallengeId(""); }}>ورود با پیامک</button>
            <button className={mode === "password" ? "auth-submit" : "auth-secondary"} type="button" onClick={() => { setMode("password"); setError(""); setNotice(""); setChallengeId(""); }}>ورود با رمز</button>
          </div>
          {mode === "sms" && !challengeId && (
            <form className="auth-form" onSubmit={requestCode}>
              <label htmlFor="mobile"><Phone size={15} /> شماره موبایل</label>
              <input id="mobile" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
              {notice && <p className="auth-success" role="status">{notice}</p>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}{busy ? "در حال ارسال..." : "دریافت کد ورود"}</button>
            </form>
          )}
          {mode === "sms" && !!challengeId && (
            <form className="auth-form" onSubmit={verifyCode}>
              <p className="auth-success" role="status">{notice}</p>
              <label htmlFor="code"><KeyRound size={15} /> کد ۶ رقمی</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" dir="ltr" />
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" disabled={busy || code.length !== 6} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={17} />}{busy ? "در حال بررسی..." : "تأیید و ورود"}</button>
              <button className="auth-secondary" type="button" onClick={() => { setChallengeId(""); setCode(""); setError(""); setNotice(""); }}>تغییر شماره</button>
            </form>
          )}
          {mode === "password" && (
            <form className="auth-form" onSubmit={passwordLogin}>
              <label htmlFor="mobile-password"><Phone size={15} /> شماره موبایل</label>
              <input id="mobile-password" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
              <label htmlFor="password"><LockKeyhole size={15} /> رمز عبور پشتیبان</label>
              <input id="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} />
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" disabled={busy} type="submit">{busy ? "در حال بررسی..." : "ورود با رمز عبور"}</button>
            </form>
          )}
        </div>
        <div className="auth-security"><ShieldCheck size={16} /><span>ورود پیامکی روش اصلی و رمز عبور روش پشتیبان است.</span></div>
        <p className="auth-footnote">مدیر پلتفرم از <a href="/login">صفحه ورود مدیر</a> استفاده می‌کند.</p>
        <p className="auth-footnote">حساب ندارید؟ <a href="/register">ثبت‌نام مالک</a></p>
      </section>
    </main>
  );
}
