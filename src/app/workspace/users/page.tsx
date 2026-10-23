"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleUserRound, LogOut, Plus, RefreshCw, ShieldCheck, UserRoundX, Users } from "lucide-react";

type Member = {
  tenantUserId: string; userId: string; fullName: string; mobile: string; email: string;
  isOwner: boolean; isActive: boolean; joinedAt: string | null; roles: string[];
};
type Role = { roleId: string; name: string; description: string };
type ResponseData = { error?: string; message?: string; members?: Member[]; roles?: Role[] };

const roleLabels: Record<string, string> = {
  TenantOwner: "مالک کسب‌وکار",
  TenantManager: "مدیر تعمیرگاه",
  TenantUser: "کاربر عادی",
};

export default function WorkspaceUsersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [mobile, setMobile] = useState("");
  const [roleName, setRoleName] = useState("TenantUser");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, roleName }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok) throw new Error(result.error || "افزودن کاربر انجام نشد.");
      setMobile(""); setNotice(result.message || "کاربر اضافه شد.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "افزودن کاربر انجام نشد.");
    } finally { setSaving(false); }
  }

  async function toggleMember(member: Member) {
    if (member.isOwner) return;
    const action = member.isActive ? "غیرفعال" : "فعال";
    if (!window.confirm(`عضویت «${member.fullName}» ${action} شود؟`)) return;
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/owner-login"); return; }
    setChangingId(member.tenantUserId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspace/users", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantUserId: member.tenantUserId, isActive: !member.isActive }),
      });
      const result = await response.json() as ResponseData;
      if (!response.ok) throw new Error(result.error || "تغییر وضعیت عضویت انجام نشد.");
      setNotice(result.message || "وضعیت عضویت تغییر کرد.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تغییر وضعیت عضویت انجام نشد.");
    } finally { setChangingId(""); }
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
          <div className="users-panel-heading"><span><Plus size={19} /></span><div><h2>افزودن عضو</h2><p>فرد باید قبلاً با شماره موبایل خود ثبت‌نام و شماره‌اش را تأیید کرده باشد.</p></div></div>
          <form className="users-add-form" onSubmit={addMember}>
            <label>شماره موبایل
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="مثلاً 09123456789" required />
            </label>
            <label>نقش کاربر
              <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                {roles.map((role) => <option key={role.roleId} value={role.name}>{roleLabels[role.name] || role.name}</option>)}
              </select>
            </label>
            <button className="users-primary" type="submit" disabled={saving}><Plus size={16} />{saving ? "در حال افزودن..." : "افزودن به تیم"}</button>
          </form>
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
                <td>{member.isOwner ? <span className="users-owner-label">غیرقابل تغییر</span> : <button className={`users-toggle ${member.isActive ? "users-toggle-off" : "users-toggle-on"}`} disabled={changingId === member.tenantUserId} onClick={() => void toggleMember(member)}><UserRoundX size={14} />{changingId === member.tenantUserId ? "در حال ثبت..." : member.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}</button>}</td>
              </tr>)}</tbody>
            </table></div>
          )}
          <p className="users-footnote">برای افزودن کاربر جدید، ابتدا باید حساب کاربری او با شماره موبایل تأییدشده وجود داشته باشد. غیرفعال‌کردن عضویت، حساب اصلی او را حذف نمی‌کند.</p>
        </section>
      </section>
    </main>
  );
}
