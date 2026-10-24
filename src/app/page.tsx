"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpLeft,
  Building2,
  ChevronLeft,
  CircleHelp,
  CreditCard,
  Database,
  FileClock,
  Gift,
  LayoutDashboard,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";

const navigation = [
  { label: "نمای کلی", icon: LayoutDashboard, active: true },
  { label: "کسب‌وکارها", icon: Building2 },
  { label: "کاربران و نقش‌ها", icon: Users },
  { label: "پلن‌ها و اشتراک‌ها", icon: CreditCard },
  { label: "درخواست‌های آزمایشی", icon: Gift },
  { label: "بررسی پرداخت‌ها", icon: CheckCircle2 },
  { label: "سفارش پلن", icon: ShoppingCart },
  { label: "پایگاه‌های داده", icon: Database },
  { label: "گزارش رویدادها", icon: FileClock },
  { label: "گزارش قیمت‌گذاری", icon: CreditCard },
  { label: "سلامت سامانه", icon: Activity },
];

const workItems = [
  {
    title: "مدیریت کسب‌وکارها",
    description: "بررسی وضعیت Tenantها و دسترسی به جزئیات هر کسب‌وکار",
    icon: Building2,
    tag: "Tenant Registry",
  },
  {
    title: "اشتراک‌ها و پلن‌ها",
    description: "مدیریت پلن‌ها، دوره اشتراک و وضعیت پرداخت",
    icon: CreditCard,
    tag: "Billing",
  },
  {
    title: "بررسی پرداخت‌ها",
    description: "تأیید پرداخت مشتری و فعال‌سازی یا تمدید اشتراک",
    icon: CheckCircle2,
    tag: "Payments",
  },
  {
    title: "پایگاه‌های داده",
    description: "مشاهده وضعیت دیتابیس‌های اختصاصی و نسخه Schema",
    icon: Database,
    tag: "Infrastructure",
    href: "/databases",
  },
  {
    title: "گزارش عملیات",
    description: "پیگیری رخدادهای مدیریتی و تلاش‌های Provisioning",
    icon: ShieldCheck,
    tag: "Audit & Provisioning",
    href: "/event-logs",
  },
  {
    title: "گزارش قیمت‌گذاری",
    description: "بررسی بازه‌های اعتبار قیمت پایه و تخفیف پلن‌ها در طول زمان",
    icon: FileClock,
    tag: "Pricing History",
    href: "/pricing-history",
  },
];

export default function Home() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("repairMasterAccessToken");
    if (!token) { router.replace("/login"); return; }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        if (response.status === 401) {
          sessionStorage.removeItem("repairMasterAccessToken");
          router.replace("/login");
          return;
        }
        if (!response.ok || !data.user?.isSystemAdmin) {
          router.replace("/workspace");
          return;
        }
        setCheckingAccess(false);
      } catch {
        if (!cancelled) { setCheckingAccess(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const filteredItems = workItems.filter((item) =>
    `${item.title} ${item.description} ${item.tag}`.includes(search.trim()),
  );

  if (checkingAccess) return <main className="tenant-page" dir="rtl"><section className="tenant-content"><div className="tenant-state">در حال بررسی دسترسی مدیر سیستم...</div></section></main>;

  return (
    <div className="app-shell" dir="rtl">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">RM</div>
          <div>
            <strong>Repair Master</strong>
            <span>پنل مدیریت پلتفرم</span>
          </div>
          <button
            className="icon-button mobile-close"
            aria-label="بستن منو"
            onClick={() => setMenuOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="workspace-label">فضای کاری</div>
        <nav className="nav-list" aria-label="منوی اصلی">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${item.active ? "nav-item-active" : ""}`}
                key={item.label}
                onClick={() => {
                  if (item.label === "کسب‌وکارها") { router.push("/tenants"); setMenuOpen(false); return; }
                  if (item.label === "پلن‌ها و اشتراک‌ها") { router.push("/plans"); setMenuOpen(false); return; }
                  if (item.label === "درخواست‌های آزمایشی") { router.push("/admin/trial-requests"); setMenuOpen(false); return; }
                  if (item.label === "پایگاه‌های داده") { router.push("/databases"); setMenuOpen(false); return; }
                  if (item.label === "گزارش رویدادها") { router.push("/event-logs"); setMenuOpen(false); return; }
                  if (item.label === "گزارش قیمت‌گذاری") { router.push("/pricing-history"); setMenuOpen(false); return; }
                  if (item.label === "بررسی پرداخت‌ها") { router.push("/payments"); setMenuOpen(false); return; }
                  if (item.label === "سفارش پلن") { router.push("/subscription"); setMenuOpen(false); return; }
                  if (item.label === "سلامت سامانه") { router.push("/health"); setMenuOpen(false); return; }
                  if (!item.active) { setSearch(item.label); } else { setSearch(""); }
                  setMenuOpen(false);
                }}
                type="button"
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.active && <span className="active-dot" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="support-card">
            <div className="support-icon"><CircleHelp size={18} /></div>
            <strong>به راهنمایی نیاز دارید؟</strong>
            <p>راهنمای راه‌اندازی و مدیریت سامانه</p>
            <a href="https://nextjs.org/docs" target="_blank" rel="noreferrer">
              مشاهده راهنما <ChevronLeft size={15} />
            </a>
          </div>
          <div className="sidebar-footnote">نسخه اولیه پنل مدیریت</div>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="sidebar-overlay"
          aria-label="بستن منو"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button
              className="icon-button mobile-menu"
              aria-label="باز کردن منو"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumb">مدیریت پلتفرم <ChevronLeft size={15} /> <strong>نمای کلی</strong></div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جستجو در بخش‌ها..."
                aria-label="جستجو در بخش‌ها"
              />
              <kbd>/</kbd>
            </label>
            <button className="admin-avatar" title="ورود مدیر سامانه" aria-label="ورود مدیر سامانه" onClick={() => router.push("/login")}>م</button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> مرکز کنترل Repair Master</div>
              <h1>نمای کلی سامانه</h1>
              <p>از این بخش، کسب‌وکارها، اشتراک‌ها و زیرساخت پلتفرم را مدیریت کنید.</p>
            </div>
            <div className="date-chip">
              <Activity size={16} />
              <span>نسخه پایه مدیریتی</span>
            </div>
          </section>

          <section className="notice-panel" aria-label="وضعیت راه‌اندازی">
            <div className="notice-icon"><Settings2 size={21} /></div>
            <div className="notice-copy">
              <strong>مدیریت متمرکز پلتفرم</strong>
              <p>از بخش‌های زیر برای مدیریت کسب‌وکارها، اشتراک‌ها، دیتابیس‌های مستأجران و گزارش‌های عملیاتی استفاده کنید. داده‌ها از API و دیتابیس خوانده می‌شوند.</p>
            </div>
            <span className="status-pill status-pending"><span /> نیازمند پیکربندی</span>
          </section>

          <section className="section-heading">
            <div>
              <h2>بخش‌های مدیریتی</h2>
              <p>برای شروع، یکی از حوزه‌های زیر را انتخاب کنید.</p>
            </div>
            <span className="section-count">{filteredItems.length} بخش</span>
          </section>

          {filteredItems.length > 0 ? (
            <section className="module-grid">
              {filteredItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <article className="module-card" key={item.title} onClick={() => router.push(item.title === "مدیریت کسب‌وکارها" ? "/tenants" : item.title === "اشتراک‌ها و پلن‌ها" ? "/plans" : item.title === "بررسی پرداخت‌ها" ? "/payments" : item.title === "پایگاه‌های داده" ? "/databases" : item.title === "گزارش عملیات" ? "/event-logs" : item.title === "گزارش قیمت‌گذاری" ? "/pricing-history" : "/admin/trial-requests")} role="link" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") router.push(item.title === "مدیریت کسب‌وکارها" ? "/tenants" : item.title === "اشتراک‌ها و پلن‌ها" ? "/plans" : item.title === "بررسی پرداخت‌ها" ? "/payments" : item.title === "پایگاه‌های داده" ? "/databases" : item.title === "گزارش عملیات" ? "/event-logs" : item.title === "گزارش قیمت‌گذاری" ? "/pricing-history" : "/admin/trial-requests"); }}>
                    <div className="module-card-top">
                      <div className={`module-icon module-icon-${index % 4}`}><Icon size={21} strokeWidth={1.8} /></div>
                      <span className="module-arrow"><ArrowUpLeft size={17} /></span>
                    </div>
                    <span className="module-tag">{item.tag}</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <div className="module-card-footer">
                      <span>ورود به بخش</span>
                      <ArrowDownLeft size={15} />
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <div className="empty-state">
              <Search size={23} />
              <strong>بخشی پیدا نشد</strong>
              <p>عبارت دیگری را جستجو کنید.</p>
              <button onClick={() => setSearch("")}>پاک کردن جستجو</button>
            </div>
          )}

          <section className="bottom-grid">
            <article className="info-panel">
              <div className="panel-title-row">
                <div className="panel-title-icon"><Database size={18} /></div>
                <div><h2>معماری سامانه</h2><p>اجزای اصلی در نظر گرفته‌شده</p></div>
              </div>
              <div className="architecture-list">
                <div><span className="architecture-dot dot-blue" /><span>Master Web</span><small>Next.js · TypeScript</small></div>
                <div><span className="architecture-dot dot-purple" /><span>دیتابیس مرکزی</span><small>SQL Server · Repair_Master</small></div>
                <div><span className="architecture-dot dot-orange" /><span>Provisioning Worker</span><small>فرایند مستقل و قابل بازیابی</small></div>
                <div><span className="architecture-dot dot-green" /><span>دیتابیس هر کسب‌وکار</span><small>Database per Tenant</small></div>
              </div>
            </article>
            <article className="info-panel next-steps-panel">
              <div className="panel-title-row">
                <div className="panel-title-icon panel-title-icon-green"><ShieldCheck size={18} /></div>
                <div><h2>گام‌های بعدی</h2><p>ترتیب پیشنهادی توسعه</p></div>
              </div>
              <ol className="steps-list">
                <li><span>۱</span><div><strong>تأیید قرارداد دیتابیس</strong><p>هماهنگ‌سازی مستندات و جداول موجود</p></div></li>
                <li><span>۲</span><div><strong>احراز هویت JWT</strong><p>ورود، خروج و کنترل دسترسی سمت سرور</p></div></li>
                <li><span>۳</span><div><strong>ثبت‌نام و Provisioning</strong><p>صف پایدار و Worker مستقل</p></div></li>
              </ol>
            </article>
          </section>

          <footer className="page-footer">
            <span>Repair Master <span className="footer-separator">•</span> پنل کنترل پلتفرم</span>
            <span>آمار نمای کلی هنوز از API تجمیعی دریافت نمی‌شود؛ جداول هر بخش از داده‌های واقعی استفاده می‌کنند.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
