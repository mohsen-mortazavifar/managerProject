"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, KeyRound, LoaderCircle, Phone, ShieldCheck, UserRound } from "lucide-react";

type OtpRequestResult = { message?: string; challengeId?: string; error?: string };
type OtpVerifyResult = { accessToken?: string; error?: string; tenant?: { status: string }; message?: string };

export default function OwnerRegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [userName, setUserName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/owner-otp/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "register", fullName, mobile, userName, businessName, businessAddress, businessPhone }),
      });
      const result = await response.json() as OtpRequestResult;
      if (!response.ok || !result.challengeId) {
        setError(result.error || "درخواست کد انجام نشد. شماره و تنظیمات پیامک را بررسی کنید.");
        return;
      }
      setChallengeId(result.challengeId);
      setNotice("کد تأیید ارسال شد. کد ۶ رقمی را وارد کنید؛ اعتبار کد ۵ دقیقه است.");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/owner-otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, mobile, userName, code }),
      });
      const result = await response.json() as OtpVerifyResult;
      if (!response.ok || !result.accessToken) { setError(result.error || "کد تأیید نشد."); return; }
      sessionStorage.setItem("repairMasterAccessToken", result.accessToken);
      setNotice("شماره تأیید شد؛ درخواست ایجاد فضای کسب‌وکار ثبت شد.");
      router.replace("/onboarding");
    } catch { setError("ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <a className="auth-back" href="/owner-login"><ArrowRight size={16} /> بازگشت به ورود مالک</a>
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>فضای کاری کسب‌وکار شما</small></div></div>
        <div className="auth-icon"><Building2 size={23} /></div>
        <h1>ثبت‌نام مالک کسب‌وکار</h1>
        <p className="auth-description">برای ساخت فضای کاری، شماره موبایل خود را تأیید کنید. ایمیل و رمز عبور لازم نیست.</p>
        {!challengeId ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="fullName"><UserRound size={15} /> نام کامل</label>
            <input id="fullName" autoComplete="name" required maxLength={200} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="نام و نام خانوادگی" />
            <label htmlFor="userName">نام کاربری (انگلیسی)</label>
            <input id="userName" autoComplete="username" required minLength={3} maxLength={100} pattern="[a-zA-Z0-9._-]{3,100}" value={userName} onChange={e => setUserName(e.target.value.toLowerCase())} placeholder="مثلاً mohsen123" dir="ltr" />
            <small className="auth-footnote">حداقل ۳ کاراکتر؛ فقط حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط.</small>
            <label htmlFor="mobile"><Phone size={15} /> شماره موبایل با کد کشور</label>
            <input id="mobile" type="tel" autoComplete="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
            <small className="auth-footnote">شماره را وارد کنید.</small>
            <label htmlFor="businessName"><Building2 size={15} /> نام کسب‌وکار</label>
            <input id="businessName" required maxLength={200} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="مثلاً تعمیرات مرکزی" />
            <label htmlFor="businessAddress">نشانی کسب‌وکار</label>
            <textarea id="businessAddress" required maxLength={500} rows={3} value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} placeholder="استان، شهر، خیابان، پلاک..." />
            <label htmlFor="businessPhone">شماره تلفن ثابت</label>
            <input id="businessPhone" type="tel" autoComplete="tel" required maxLength={30} value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} placeholder="02112345678" dir="ltr" />
            {error && <p className="auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-success" role="status">{notice}</p>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}{busy ? "در حال ارسال..." : "ارسال کد تأیید"}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className="auth-success"><CheckCircle2 size={17} /> {notice}</div>
            <label htmlFor="code"><KeyRound size={15} /> کد ۶ رقمی پیامک</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="۱۲۳۴۵۶" dir="ltr" />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" disabled={busy || code.length !== 6} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={17} />}{busy ? "در حال تأیید..." : "تأیید موبایل و ثبت‌نام"}</button>
            <button className="auth-secondary" type="button" onClick={() => { setChallengeId(""); setCode(""); setNotice(""); setError(""); }}>تغییر اطلاعات</button>
          </form>
        )}
        <div className="auth-security"><ShieldCheck size={16} /><span>فضای کسب‌وکار فقط پس از تأیید شماره ساخته می‌شود.</span></div>
      </section>
    </main>
  );
}
