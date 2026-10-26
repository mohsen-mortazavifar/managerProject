"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, Phone, ShieldCheck } from "lucide-react";

type RequestResult = { challengeId?: string; message?: string; error?: string };
type VerifyResult = { accessToken?: string; error?: string; user?: { isPlatformUser?: boolean } };
type PasswordLoginResult = { accessToken?: string; error?: string; user?: { isPlatformUser?: boolean } };

export default function OwnerLoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [mode, setMode] = useState<"otp" | "password">("password");
  const [password, setPassword] = useState("");
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
      if (!response.ok || !result.challengeId) {  setError(result.error ||   "کد ارسال نشد. چند دقیقه دیگر مجدد تلاش نمائید."); return; }
      setChallengeId(result.challengeId);
      setNotice("کد تأیید ارسال شد. تا ۵ دقیقه فرصت دارید.");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/owner-password/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, password }),
      });
      const result = await response.json() as PasswordLoginResult;
      if (!response.ok || !result.accessToken) { setError(result.error || "شماره موبایل یا رمز عبور صحیح نیست."); return; }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      router.replace("/workspace");
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
      router.replace(result.user?.isPlatformUser ? "/" : "/onboarding");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>ورود به فضای کسب‌وکار</small></div></div>
        <div className="auth-icon"><Phone size={23} /></div>
        <h1>ورود مالک با موبایل</h1>
        <p className="auth-description">شماره موبایل و رمز عبور خود را وارد کنید تا به پنل کسب‌وکار بروید.</p>
        {mode === "password" ? (
          <form className="auth-form" onSubmit={loginWithPassword}>
            <label htmlFor="mobile"><Phone size={15} /> شماره موبایل</label>
            <input id="mobile" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
            <label htmlFor="password"><KeyRound size={15} /> رمز عبور</label>
            <input id="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} />
            {error && <p className="auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-success" role="status">{notice}</p>}
            <button className="auth-submit" disabled={busy || !mobile.trim() || !password} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <KeyRound size={17} />}{busy ? "در حال ورود..." : "ورود"}</button>
            <button className="auth-secondary" type="button" onClick={() => { setMode("otp"); setChallengeId(""); setCode(""); setPassword(""); setError(""); setNotice(""); }}>ورود با رمز یکبار مصرف</button>
          </form>
        ) : !challengeId ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="otp-mobile"><Phone size={15} /> شماره موبایل</label>
            <input id="otp-mobile" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
            {notice && <p className="auth-success" role="status">{notice}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" disabled={busy || !mobile.trim()} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}{busy ? "در حال ارسال..." : "ارسال کد ورود"}</button>
            <button className="auth-secondary" type="button" onClick={() => { setMode("password"); setError(""); setNotice(""); }}>بازگشت به ورود با رمز عبور</button>
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
        <div className="auth-security"><ShieldCheck size={16} /><span>{mode === "otp" ? "کد یک‌بارمصرف حداکثر ۵ دقیقه اعتبار دارد." : "ورود امن به پنل کسب‌وکار"}</span></div>
        <p className="auth-footnote">حساب ندارید؟ <a href="/register">ثبت‌نام مالک</a></p>
      </section>
    </main>
  );
}
