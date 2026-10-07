import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";

export type ViewKey = "overview" | "models" | "usage" | "routing" | "catalog" | "settings";

const items: Array<[ViewKey, string]> = [
  ["overview", "nav.overview"],
  ["models", "nav.models"],
  ["usage", "nav.usage"],
  ["routing", "nav.routing"],
  ["catalog", "nav.catalog"],
  ["settings", "nav.settings"],
];

const subtitleKeys: Record<ViewKey, string> = {
  overview: "overview.heroDesc",
  models: "models.desc",
  usage: "usage.desc",
  routing: "routing.desc",
  catalog: "catalog.desc",
  settings: "settings.clientSetupDesc",
};

function NavIcon({ name }: { name: ViewKey }) {
  if (name === "overview") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === "models") return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
  if (name === "usage") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11m5 9V5m5 15v-7m5 7V8" /></svg>;
  if (name === "routing") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M10.7 7.2 6.4 15.7m6.9-8.5 4.3 8.5M7.5 18h9" /></svg>;
  if (name === "catalog") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5c3-1 5.3-.7 7 1.2v14c-1.7-1.9-4-2.2-7-1.2zM19 4.5c-3-1-5.3-.7-7 1.2v14c1.7-1.9 4-2.2 7-1.2z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.1 13.3 1.4 1.1-1.8 3.1-1.8-.7a8 8 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a8 8 0 0 1-1.8-1l-1.8.7-1.8-3.1 1.4-1.1a8 8 0 0 1 0-2.1L5.5 10l1.8-3.1 1.8.7a8 8 0 0 1 1.8-1l.3-2h3.6l.3 2a8 8 0 0 1 1.8 1l1.8-.7 1.8 3.1-1.4 1.1a8 8 0 0 1 0 2.2Z" /></svg>;
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 41 12.8v22.4L24 45 7 35.2V12.8z" />
      <path d="M7 12.8 24 23l17-10.2M24 23v22M13.2 16.6 30.1 6.8M34.8 16.6 17.9 6.8" />
    </svg>
  );
}

export function Shell({
  view,
  onView,
  children,
  online,
  onRefresh,
  token,
  onToken,
}: {
  view: ViewKey;
  onView: (view: ViewKey) => void;
  children: ReactNode;
  online: boolean;
  onRefresh: () => void;
  token: string;
  onToken: (token: string) => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const navTitleKey = items.find(([key]) => key === view)?.[1] ?? "nav.overview";
  const titleKey = view === "usage" ? "usage.title" : view === "routing" ? "routing.title" : navTitleKey;
  const title = t(titleKey);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = `${title} · FreeLLM Gateway`;
  }, [title]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function submitSearch() {
    const query = search.trim().toLowerCase();
    if (!query) return;
    const matches = (keywords: string[]) => keywords.some((keyword) => query.includes(keyword.toLowerCase()));
    if (matches(["model", t("nav.models")])) onView("models");
    else if (matches(["token", "usage", t("nav.usage")])) onView("usage");
    else if (matches(["route", "routing", t("nav.routing")])) onView("routing");
    else if (matches(["catalog", t("nav.catalog")])) onView("catalog");
    else if (matches(["setting", "config", t("nav.settings")])) onView("settings");
    else if (matches(["overview", "home", t("nav.overview")])) onView("overview");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <BrandMark />
          <div className="brand">FreeLLM Gateway<small>{t("shell.localConsole")}</small></div>
        </div>
        <nav aria-label={t("shell.primaryNavigation")}>
          {items.map(([key, labelKey]) => (
            <button key={key} className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined} onClick={() => onView(key)}>
              <span className="nav-icon"><NavIcon name={key} /></span>
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`sidebar-health ${online ? "online" : "offline"}`}><i />{online ? t("shell.online") : t("shell.apiError")}</span>
          <small>v1.0.0 · Local AI Gateway</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="global-search">
            <span className="search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submitSearch(); }}
              placeholder={t("shell.searchPlaceholder")}
              aria-label={t("shell.searchPlaceholder")}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            <span className={`service-pill ${online ? "online" : "offline"}`}><i />{online ? t("shell.online") : t("shell.apiError")}</span>
            <div className="language-switch" role="group" aria-label={t("shell.language")}>
              <button className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>{t("lang.zh")}</button>
              <span>|</span>
              <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>{t("lang.en")}</button>
            </div>
            <details className="account-menu">
              <summary aria-label={t("shell.accountMenu")}><span>A</span><b>admin</b><i>⌄</i></summary>
              <div className="account-popover">
                <label className="token-field">
                  <span>{t("shell.adminToken")}</span>
                  <input type="password" value={token} placeholder={t("shell.tokenPlaceholder")} onChange={(event) => onToken(event.target.value)} />
                </label>
                <div className="account-actions">
                  <button onClick={onRefresh}>{t("common.refresh")}</button>
                  <a className="button-link" href="/admin/legacy">{t("shell.legacy")} ↗</a>
                </div>
              </div>
            </details>
          </div>
        </header>
        <section className="page-title-strip">
          <div className="page-hero-copy"><h1>{title}</h1><p>{t(subtitleKeys[view])}</p></div>
          {view === "overview" && <div className="page-hero-aside"><span>{t("overview.heroAsideLine1")}<br />{t("overview.heroAsideLine2")}</span><i /></div>}
          {view === "routing" && <div className="page-hero-aside"><span>{t("routing.heroAsideLine1")}<br />{t("routing.heroAsideLine2")}</span><i /></div>}
          <div className="page-hero-mountains" aria-hidden="true"><i /><i /><i /></div>
        </section>
        {children}
      </main>
    </div>
  );
}
