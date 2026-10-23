"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, KeyRound, LoaderCircle, Phone, ShieldCheck, UserRound } from "lucide-react";

type InvitationInfo = { businessName: string; roleName: string; expiresAt: string };
type ApiResult = { error?: string; message?: string; challengeId?: string; invitation?: InvitationInfo };

export default function JoinWorkspacePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/auth/workspace-invitation/request?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error || "دعوت‌نامه معتبر نیست.");
        if (!cancelled) setInvitation(result.invitation || null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "بررسی دعوت‌نامه انجام نشد."); });
    return () => { cancelled = true; };
  }, [token]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/workspace-invitation/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mobile, fullName })
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.challengeId) throw new Error(result.error || "ارسال کد انجام نشد.");
      setChallengeId(result.challengeId);
      setNotice(result.message || "کد تأیید ارسال شد.");
    } catch (e) { setError(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/workspace-invitation/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, challengeId, mobile, code })
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "تأیید شماره انجام نشد.");
      setNotice(result.message || "عضویت ثبت شد.");
      setChallengeId("");
      setCode("");
      setTimeout(() => router.replace("/owner-login"), 1800);
    } catch (e) { setError(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <a className="auth-back" href="/owner-login"><ArrowRight size={16} /> بازگشت به ورود</a>
        <div className="auth-brand"><span>RM</span><div><strong>Repair Master</strong><small>پیوستن به تیم</small></div></div>
        <div className="auth-icon"><Building2 size={23} /></div>
        <h1>پذیرش دعوت‌نامه</h1>
        {invitation ? (
          <div className="auth-success"><Building2 size={17} /><span>دعوت شده‌اید به «{invitation.businessName}» با نقش {invitation.roleName === "TenantManager" ? "مدیر تعمیرگاه" : "کاربر عادی"}.</span></div>
        ) : !error ? <p className="auth-description">در حال بررسی دعوت‌نامه...</p> : null}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {invitation && !challengeId && (
          <>
            <p className="auth-description">نام و شماره موبایل خود را وارد کنید. پس از تأیید پیامک، عضویت شما در همین کسب‌وکار ثبت می‌شود؛ کسب‌وکار جدیدی ساخته نخواهد شد.</p>
            <form className="auth-form" onSubmit={requestCode}>
              <label htmlFor="fullName"><UserRound size={15} /> نام کامل</label>
              <input id="fullName" autoComplete="name" required maxLength={200} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="نام و نام خانوادگی" />
              <label htmlFor="mobile"><Phone size={15} /> شماره موبایل</label>
              <input id="mobile" type="tel" autoComplete="tel" inputMode="tel" required maxLength={20} value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" dir="ltr" />
              {notice && <p className="auth-success" role="status">{notice}</p>}
              <button className="auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}{busy ? "در حال ارسال..." : "ارسال کد تأیید"}</button>
            </form>
          </>
        )}
        {invitation && challengeId && (
          <form className="auth-form" onSubmit={verifyCode}>
            {notice && <p className="auth-success" role="status"><CheckCircle2 size={17} />{notice}</p>}
            <label htmlFor="code"><KeyRound size={15} /> کد ۶ رقمی پیامک</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" dir="ltr" />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" disabled={busy || code.length !== 6} type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={17} />}{busy ? "در حال بررسی..." : "تأیید شماره و عضویت"}</button>
            <button className="auth-secondary" type="button" onClick={() => { setChallengeId(""); setCode(""); setNotice(""); setError(""); }}>تغییر اطلاعات</button>
          </form>
        )}
        <div className="auth-security"><ShieldCheck size={16} /><span>لینک دعوت ۷ روز اعتبار دارد و پس از پذیرش فقط یک بار قابل استفاده است.</span></div>
      </section>
    </main>
  );
}
