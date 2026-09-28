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

function NavIcon({ name }: { name: ViewKey }) {
  if (name === "overview") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === "models") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zm0 0v9m8-4.5-8 4.5-8-4.5" /></svg>;
  if (name === "usage") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11m5 9V5m5 15v-7m5 7V8" /></svg>;
  if (name === "routing") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M10.7 7.2 6.4 15.7m6.9-8.5 4.3 8.5M7.5 18h9" /></svg>;
  if (name === "catalog") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5zM16 3v4h4M8 11h8M8 15h8M8 19h5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.1 13.3 1.4 1.1-1.8 3.1-1.8-.7a8 8 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a8 8 0 0 1-1.8-1l-1.8.7-1.8-3.1 1.4-1.1a8 8 0 0 1 0-2.1L5.5 10l1.8-3.1 1.8.7a8 8 0 0 1 1.8-1l.3-2h3.6l.3 2a8 8 0 0 1 1.8 1l1.8-.7 1.8 3.1-1.4 1.1a8 8 0 0 1 0 2.2Z" /></svg>;
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 42 13v22L24 45 6 35V13z" />
      <path d="M24 3v21m18-11L24 24 6 13m18 11v21" />
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
  const titleKey = items.find(([key]) => key === view)?.[1] ?? "nav.overview";
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
        <nav>
          {items.map(([key, labelKey]) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => onView(key)}>
              <span className="nav-icon"><NavIcon name={key} /></span>
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-art" aria-hidden="true"><span className="mountain mountain-one" /><span className="mountain mountain-two" /></div>
        <div className="sidebar-foot">
          <p>{t("shell.sloganLine1")}<br />{t("shell.sloganLine2")}</p>
          <span className="slogan-rule" />
          <strong>FreeLLM Gateway</strong>
          <small>v1.0.0</small>
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
            <kbd>Ctrl K</kbd>
          </div>
          <div className="top-actions">
            <span className={online ? "service ok" : "service bad"}><i />{online ? t("shell.online") : t("shell.apiError")}</span>
            <button className="language-button" onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>{language === "zh" ? t("lang.en") : t("lang.zh")}</button>
            <button className="primary top-action-button" onClick={() => onView("models")}>＋ {t("shell.addModel")}</button>
            <button className="top-action-button" onClick={() => onView("models")}><span aria-hidden="true">↗</span> {t("shell.multiConnection")}</button>
            <details className="account-menu">
              <summary aria-label={t("shell.accountMenu")}>A</summary>
              <div className="account-popover">
                <label className="token-field">
                  <span>{t("shell.adminToken")}</span>
                  <input
                    type="password"
                    value={token}
                    placeholder={t("shell.tokenPlaceholder")}
                    onChange={(event) => onToken(event.target.value)}
                  />
                </label>
                <div className="account-actions">
                  <button onClick={onRefresh}>{t("common.refresh")}</button>
                  <a className="button-link" href="/admin/legacy">{t("shell.legacy")} ↗</a>
                </div>
              </div>
            </details>
          </div>
        </header>
        {view !== "overview" && <div className="page-title-strip"><h1>{title}</h1></div>}
        {children}
      </main>
    </div>
  );
}
