"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleUserRound, LogOut, Plus, RefreshCw, ShieldCheck, UserRoundX, Users } from "lucide-react";

type Member = {
  tenantUserId: string; userId: string; fullName: string; mobile: string; email: string;
  isOwner: boolean; isActive: boolean; hasPassword: boolean; joinedAt: string | null; roles: string[];
};
type Role = { roleId: string; name: string; description: string };
type Invitation = { invitationId: string; roleName: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string; isExpired: boolean };
type ResponseData = { error?: string; message?: string; members?: Member[]; roles?: Role[]; invitations?: Invitation[]; inviteUrl?: string };

const roleLabels: Record<string, string> = {
  TenantOwner: "مالک کسب‌وکار",
  TenantManager: "مدیر تعمیرگاه",
  TenantUser: "کاربر عادی",
};

export default function WorkspaceUsersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleName, setRoleName] = useState("TenantUser");
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]); const [inviteUrl, setInviteUrl] = useState("");  const [inviteBusy, setInviteBusy] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<Member | null>(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [confirmInitialPassword, setConfirmInitialPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const load = useCallback(async () => {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/workspace/users", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const result = await response.json() as ResponseData;
      if (response.status === 401) {
        sessionStorage.removeItem("repairMasterAccessToken");
        router.replace("/owner-login");
        return;
      }
      if (!response.ok) throw new Error(result.error || "دریافت فهرست اعضا انجام نشد.");
      setMembers(result.members || []);
      setRoles(result.roles || []);
      const inviteResponse = await fetch("/api/workspace/invitations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const inviteResult = await inviteResponse.json() as ResponseData;
      if (inviteResponse.ok) setInvitations(inviteResult.invitations || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createInvitation() {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    setInviteBusy(true); setError(""); setNotice(""); setInviteUrl("");
    try {
      const response = await fetch("/api/workspace/invitations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ roleName }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok || !result.inviteUrl) throw new Error(result.error || "ایجاد دعوت‌نامه انجام نشد.");
      setInviteUrl(result.inviteUrl);
      setNotice(result.message || "دعوت‌نامه ایجاد شد.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ایجاد دعوت‌نامه انجام نشد."); }
    finally { setInviteBusy(false); }
  }

  async function revokeInvitation(invitationId: string) {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    if (!window.confirm("این دعوت‌نامه لغو شود؟")) return;
    try {
      const response = await fetch("/api/workspace/invitations", {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok) throw new Error(result.error || "لغو دعوت‌نامه انجام نشد.");
      setNotice(result.message || "دعوت‌نامه لغو شد.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "لغو دعوت‌نامه انجام نشد."); }
  }

  async function updateMember(member: Member, change: { isActive?: boolean; roleName?: string }) {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    const actionText = change.roleName ? "نقش عضو تغییر کند؟" : change.isActive ? "عضویت فعال شود؟" : "عضویت غیرفعال شود؟";
    if (!window.confirm(`برای «${member.fullName}» ${actionText}`)) return;
    setChangingId(member.tenantUserId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspace/users", {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantUserId: member.tenantUserId, ...change }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok) throw new Error(result.error || "تغییر عضو انجام نشد.");
      setNotice(result.message || "تغییرات ذخیره شد.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تغییر عضو انجام نشد."); }
    finally { setChangingId(""); }
  }

  async function toggleMember(member: Member) {
    await updateMember(member, { isActive: !member.isActive });
  }

  async function setMemberPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordTarget) return;
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    setPasswordBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspace/users/password", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantUserId: passwordTarget.tenantUserId, password: initialPassword, confirmPassword: confirmInitialPassword }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok) throw new Error(result.error || "تعیین رمز عبور انجام نشد.");
      setNotice(result.message || "رمز اولیه ثبت شد.");
      setPasswordTarget(null); setInitialPassword(""); setConfirmInitialPassword("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعیین رمز عبور انجام نشد."); }
    finally { setPasswordBusy(false); }
  }


  async function logout() {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (token) {
      try { await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }); } catch { /* clear local token */ }
    }
    sessionStorage.removeItem("repairMasterAccessToken");
    router.replace("/owner-login");
  }

  return (
    <main className="workspace-page" dir="rtl">
      <header className="workspace-topbar">
        <div className="workspace-brand"><span>RM</span><div><strong>Repair Master</strong><small>مدیریت کاربران</small></div></div>
        <div className="workspace-top-actions">
          <button onClick={() => router.push("/workspace")}><ArrowRight size={16} /> بازگشت به داشبورد</button>
          <button onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> به‌روزرسانی</button>
          <button onClick={() => void logout()}><LogOut size={16} /> خروج</button>
        </div>
      </header>

      <section className="workspace-content">
        <div className="workspace-welcome">
          <div><span className="workspace-eyebrow">اعضا و دسترسی‌ها</span><h1>کاربران کسب‌وکار</h1><p>اعضای تیم را مدیریت کنید و برای هر نفر نقش مناسب تعیین کنید.</p></div>
          <div className="workspace-ready"><ShieldCheck size={18} /><span>دسترسی مالک</span></div>
        </div>

        {error && <div className="workspace-error" role="alert">{error}</div>}
        {notice && <div className="users-notice" role="status">{notice}</div>}

        <section className="users-panel">
          <div className="users-panel-heading"><span><Plus size={19} /></span><div><h2>دعوت عضو جدید</h2><p>یک لینک اختصاصی بسازید و برای فرد ارسال کنید. عضویت فقط پس از تأیید پیامک فعال می‌شود.</p></div></div>
          <div className="users-add-form">
            <label>نقش کاربر
              <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                {roles.map((role) => <option key={role.roleId} value={role.name}>{roleLabels[role.name] || role.name}</option>)}
              </select>
            </label>
            <button className="users-primary" type="button" onClick={() => void createInvitation()} disabled={inviteBusy}><Plus size={16} />{inviteBusy ? "در حال ساخت..." : "ایجاد لینک دعوت"}</button>
          </div>
          {inviteUrl && <div className="users-invite-link"><label>لینک دعوت (اعتبار ۷ روز)</label><input readOnly value={inviteUrl} dir="ltr" onFocus={(e) => e.currentTarget.select()} /><button type="button" className="users-primary" onClick={() => { void navigator.clipboard.writeText(inviteUrl).then(() => setNotice("لینک دعوت کپی شد.")); }}>کپی لینک</button></div>}
        </section>

        <section className="users-panel">
          <div className="users-list-heading"><div className="users-panel-heading"><span><ShieldCheck size={19} /></span><div><h2>دعوت‌نامه‌ها</h2><p>دعوت‌های ایجادشده و وضعیت آن‌ها</p></div></div><span className="users-count">{invitations.length} دعوت</span></div>
          {invitations.length === 0 ? <div className="users-empty">دعوت‌نامه‌ای ایجاد نشده است.</div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>نقش</th><th>ایجاد</th><th>انقضا</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
            {invitations.map((invite) => {
              const status = invite.acceptedAt ? "پذیرفته‌شده" : invite.revokedAt ? "لغوشده" : invite.isExpired ? "منقضی‌شده" : "در انتظار";
              return <tr key={invite.invitationId}><td>{roleLabels[invite.roleName] || invite.roleName}</td><td>{new Date(invite.createdAt).toLocaleDateString("fa-IR")}</td><td>{new Date(invite.expiresAt).toLocaleDateString("fa-IR")}</td><td>{status}</td><td>{!invite.acceptedAt && !invite.revokedAt && status === "در انتظار" && <button className="users-toggle users-toggle-off" onClick={() => void revokeInvitation(invite.invitationId)}>لغو دعوت</button>}</td></tr>;
            })}
          </tbody></table></div>}
        </section>

        <section className="users-panel">
          <div className="users-list-heading"><div className="users-panel-heading"><span><Users size={19} /></span><div><h2>اعضای تیم</h2><p>وضعیت عضویت و نقش هر عضو</p></div></div><span className="users-count">{members.length} عضو</span></div>
          {loading ? <div className="users-empty">در حال دریافت فهرست اعضا...</div> : members.length === 0 ? <div className="users-empty"><CircleUserRound size={28} /><strong>هنوز عضوی ثبت نشده است</strong><span>از فرم بالا برای افزودن اعضای تیم استفاده کنید.</span></div> : (
            <div className="users-table-wrap"><table className="users-table">
              <thead><tr><th>کاربر</th><th>شماره موبایل</th><th>نقش</th><th>وضعیت</th><th>عملیات</th></tr></thead>
              <tbody>{members.map((member) => <tr key={member.tenantUserId}>
                <td><strong>{member.fullName}</strong>{member.email && <small dir="ltr">{member.email}</small>}{member.isOwner && <small>مالک کسب‌وکار</small>}</td>
                <td dir="ltr" className="users-mobile">{member.mobile || "—"}</td>
                <td>{member.roles.length ? member.roles.map((r) => roleLabels[r] || r).join("، ") : "بدون نقش"}</td>
                <td><span className={`users-status ${member.isActive ? "users-status-active" : "users-status-off"}`}>{member.isActive ? "فعال" : "غیرفعال"}</span></td>
                <td>{member.isOwner ? <span className="users-owner-label">غیرقابل تغییر</span> : <div className="users-member-actions"><select aria-label={`نقش ${member.fullName}`} value={member.roles[0] || "TenantUser"} disabled={changingId === member.tenantUserId || passwordBusy} onChange={(e) => void updateMember(member, { roleName: e.target.value })}>{roles.filter((r) => ["TenantManager", "TenantUser"].includes(r.name)).map((r) => <option key={r.roleId} value={r.name}>{roleLabels[r.name] || r.name}</option>)}</select><button className={`users-toggle ${member.isActive ? "users-toggle-off" : "users-toggle-on"}`} disabled={changingId === member.tenantUserId} onClick={() => void toggleMember(member)}><UserRoundX size={14} />{changingId === member.tenantUserId ? "در حال ثبت..." : member.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}</button>{member.hasPassword ? <span className="users-owner-label">رمز ثبت شده</span> : <button type="button" className="users-primary" onClick={() => { setPasswordTarget(member); setInitialPassword(""); setConfirmInitialPassword(""); }} disabled={!member.isActive || passwordBusy}>تعیین رمز اولیه</button>}{passwordTarget?.tenantUserId === member.tenantUserId && <form className="users-invite-link" onSubmit={(e) => void setMemberPassword(e)}><label>رمز اولیه (حداقل ۱۲ نویسه)</label><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} /><label>تکرار رمز</label><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmInitialPassword} onChange={(e) => setConfirmInitialPassword(e.target.value)} /><button className="users-primary" type="submit" disabled={passwordBusy}>{passwordBusy ? "در حال ذخیره..." : "ذخیره رمز"}</button><button className="users-toggle" type="button" onClick={() => setPasswordTarget(null)}>انصراف</button></form>}</div>}</td>
              </tr>)}</tbody>
            </table></div>
          )}
          <p className="users-footnote">برای افزودن کاربر جدید، ابتدا باید حساب کاربری او با شماره موبایل تأییدشده وجود داشته باشد. غیرفعال‌کردن عضویت، حساب اصلی او را حذف نمی‌کند.</p>
        </section>
      </section>
    </main>
  );
}
