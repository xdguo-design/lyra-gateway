import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import type { Application, Overview, Tenant } from "../types";

async function copyText(value: string): Promise<void> {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function CopyRow({ label, value, copyValue }: { label: string; value: string | null | undefined; copyValue?: string | null }) {
  const { t } = useI18n();
  const text = value || "—";
  const toCopy = copyValue ?? value ?? "";
  return <div className="runtime-row"><span>{label}</span><code>{text}</code>{toCopy && <button type="button" aria-label={t("common.copy")} onClick={() => void copyText(toCopy)}>⧉</button>}</div>;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function serviceOrigin(value: string | null | undefined) {
  if (!value) return "http://localhost:8000";
  try {
    return new URL(value, window.location.origin).origin;
  } catch {
    return value;
  }
}

export function SettingsPage({
  overview,
  tenants,
  applications,
  onRefresh,
}: {
  overview: Overview | null;
  tenants: Tenant[];
  applications: Application[];
  onRefresh: () => Promise<void>;
}) {
  const { t, errorText } = useI18n();
  const [tenantDraft, setTenantDraft] = useState({ id: "", name: "" });
  const [appDraft, setAppDraft] = useState({ id: "", tenant_id: tenants[0]?.id ?? "", name: "" });
  const [issuedKey, setIssuedKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [message, setMessage] = useState("");

  const applicationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of applications) counts.set(app.tenant_id, (counts.get(app.tenant_id) ?? 0) + 1);
    return counts;
  }, [applications]);

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/tenants", { method: "POST", body: tenantDraft });
      setTenantDraft({ id: "", name: "" });
      setMessage("");
      await onRefresh();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function createApplication(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ api_key: string }>("/api/admin/applications", { method: "POST", body: appDraft });
      setIssuedKey(result.api_key);
      setCopiedKey(false);
      setAppDraft({ id: "", tenant_id: appDraft.tenant_id, name: "" });
      setMessage("");
      await onRefresh();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function copyIssuedKey() {
    await copyText(issuedKey);
    setCopiedKey(true);
  }

  const runtimeRows = [
    { label: t("settings.apiToken"), value: t("settings.bearerTokenCompatible"), copyValue: overview?.api_token },
    { label: t("settings.defaultModel"), value: "auto" },
    { label: t("settings.chatEndpoint"), value: overview?.chat_url },
    { label: t("settings.imagesEndpoint"), value: overview?.images_url },
    { label: t("settings.modelsEndpoint"), value: overview?.models_url },
    { label: t("settings.healthEndpoint"), value: overview?.health_url },
    { label: t("settings.databasePath"), value: overview?.database_path },
    { label: t("settings.connectionLog"), value: overview?.connection_log_path },
    { label: t("settings.catalogOutput"), value: overview?.catalog_output_path },
    { label: t("settings.gatewayLog"), value: overview?.logs_path },
    { label: t("settings.docs"), value: overview?.docs_url },
  ];

  return <div className="stack settings-stack">
    {message && <div className="notice bad">{message}</div>}

    <section className="settings-client-grid" data-testid="settings-client-setup">
      <form className="card settings-entity-card tenant-card" onSubmit={createTenant}>
        <div className="settings-card-title"><span className="settings-title-icon">♙</span><div><h2>{t("settings.tenantManagement")}</h2><p>{t("settings.tenantManagementDesc")}</p></div></div>
        <div className="settings-inline-form tenant-form">
          <label>{t("settings.tenantId")}<input required placeholder={t("settings.tenantIdPlaceholder")} value={tenantDraft.id} onChange={(event) => setTenantDraft({ ...tenantDraft, id: event.target.value })} /></label>
          <label>{t("common.name")}<input required placeholder={t("settings.tenantNamePlaceholder")} value={tenantDraft.name} onChange={(event) => setTenantDraft({ ...tenantDraft, name: event.target.value })} /></label>
          <button className="primary" type="submit">{t("settings.createTenant")}</button>
        </div>
        <p className="settings-field-hint">{t("settings.idHint")}</p>
        <div className="table-wrap settings-table"><table><thead><tr><th>{t("settings.tenantId")}</th><th>{t("common.name")}</th><th>{t("settings.applicationCount")}</th><th>{t("settings.createdAt")}</th><th>{t("common.actions")}</th></tr></thead><tbody>
          {tenants.map((item) => <tr key={item.id}><td><b>{item.id}</b></td><td>{item.name}</td><td>{applicationCounts.get(item.id) ?? 0}</td><td>{formatDate(item.created_at)}</td><td><button type="button" className="settings-row-menu">···</button></td></tr>)}
          {!tenants.length && <tr><td colSpan={5} className="empty">{t("settings.noTenants")}</td></tr>}
        </tbody></table></div>
      </form>

      <form className="card settings-entity-card app-card" onSubmit={createApplication}>
        <div className="settings-card-title"><span className="settings-title-icon layers">◇</span><div><h2>{t("settings.applicationManagement")}</h2><p>{t("settings.applicationManagementDesc")}</p></div></div>
        <div className="settings-inline-form app-form">
          <label>{t("settings.applicationId")}<input required placeholder={t("settings.applicationIdPlaceholder")} value={appDraft.id} onChange={(event) => setAppDraft({ ...appDraft, id: event.target.value })} /></label>
          <label>{t("settings.belongsTenant")}<select required value={appDraft.tenant_id} onChange={(event) => setAppDraft({ ...appDraft, tenant_id: event.target.value })}><option value="">{t("common.select")}</option>{tenants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>{t("common.name")}<input required placeholder={t("settings.applicationNamePlaceholder")} value={appDraft.name} onChange={(event) => setAppDraft({ ...appDraft, name: event.target.value })} /></label>
          <button className="primary" type="submit">{t("settings.createApp")}</button>
        </div>
        <p className="settings-field-hint">{t("settings.idHint")}</p>
        <div className="table-wrap settings-table"><table><thead><tr><th>{t("settings.applicationId")}</th><th>{t("common.name")}</th><th>{t("settings.belongsTenant")}</th><th>{t("settings.apiKeyPrefix")}</th><th>{t("settings.createdAt")}</th><th>{t("common.actions")}</th></tr></thead><tbody>
          {applications.map((item) => <tr key={item.id}><td><b>{item.id}</b></td><td>{item.name}</td><td>{item.tenant_id}</td><td><span className="key-prefix"><code>{item.key_prefix}…</code><button type="button" aria-label={t("common.copy")} onClick={() => void copyText(item.key_prefix)}>⧉</button></span></td><td>{formatDate(item.created_at)}</td><td><button type="button" className="settings-row-menu">···</button></td></tr>)}
          {!applications.length && <tr><td colSpan={6} className="empty">{t("settings.noApplications")}</td></tr>}
        </tbody></table></div>
      </form>
    </section>

    {issuedKey && <section className="settings-key-banner">
      <span className="key-banner-icon">▣</span>
      <div><h3>{t("settings.keyOnceTitle")}</h3><p>{t("settings.keyOnceDesc")}</p></div>
      <code>{issuedKey}</code>
      <button type="button" aria-label={t("settings.copyKey")} onClick={() => void copyIssuedKey()}>{copiedKey ? "✓" : "⧉"}</button>
      <button type="button" className="key-banner-close" aria-label={t("common.close")} onClick={() => setIssuedKey("")}>×</button>
    </section>}

    <section className="settings-runtime-grid">
      <section className="card settings-runtime-card" data-testid="settings-runtime-access">
        <div className="settings-card-title runtime-title"><span className="settings-title-icon">▧</span><div><h2>{t("settings.runtimeTitle")}</h2><p>{t("settings.runtimeInfoDesc")}</p></div></div>
        <div className="runtime-list">
          {runtimeRows.slice(0, 6).map((row) => <CopyRow key={row.label} label={row.label} value={row.value} copyValue={row.copyValue} />)}
          <div data-testid="settings-diagnostics">
            {runtimeRows.slice(6).map((row) => <CopyRow key={row.label} label={row.label} value={row.value} copyValue={row.copyValue} />)}
          </div>
        </div>
      </section>

      <section className="card service-status-card">
        <div className="settings-card-title"><span className="settings-title-icon pulse">∿</span><div><h2>{t("settings.serviceStatus")}</h2></div></div>
        <div className="status-list">
          <div><i>↗</i><div><span>{t("settings.currentService")}</span><b className="status-copy">{serviceOrigin(overview?.api_base)}<button aria-label={t("common.copy")} onClick={() => void copyText(serviceOrigin(overview?.api_base))}>⧉</button></b></div></div>
          <div><i>◇</i><div><span>{t("settings.version")}</span><b className="status-copy">v1.0.0<button aria-label={t("common.copy")} onClick={() => void copyText("v1.0.0")}>⧉</button></b></div></div>
          <div><i className="shield">♢</i><div><span>{t("settings.adminStatus")}</span><b><span className="status-ok-dot" />{t("settings.loggedIn")}<small>{t("settings.currentUser")}: admin</small></b></div></div>
          <div><i className="heart">♡</i><div><span>{t("settings.configHealth")}</span><b><span className="status-ok-dot" />{overview ? t("common.healthy") : t("common.warning")}<small>{t("settings.configHealthDesc")}</small></b></div></div>
        </div>
      </section>
    </section>
  </div>;
}
