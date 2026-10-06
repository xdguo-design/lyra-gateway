import { useState } from "react";
import { useI18n } from "../i18n";
import type { ConnectionRecord, Overview, Provider, Route } from "../types";
import { formatCount } from "../lib/format";

function absoluteUrl(value: string): string {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `${window.location.origin}${value.startsWith("/") ? value : `/${value}`}`;
}

function maskSecret(value: string): string {
  if (!value) return "—";
  if (value.length <= 10) return "••••••••";
  return `${value.slice(0, 6)}••••••${value.slice(-4)}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }
  return <button className="copy-btn" onClick={() => void copy()} disabled={!value}><span aria-hidden="true">{copied ? "✓" : "⧉"}</span>{label}</button>;
}

export function OverviewPage({
  overview,
  routes,
  providers,
  connections,
  onRefresh,
}: {
  overview: Overview | null;
  routes: Route[];
  providers: Provider[];
  connections: ConnectionRecord[];
  onRefresh: () => void;
}) {
  const { t, status, locale } = useI18n();
  const [rangeDays, setRangeDays] = useState(1);
  const attentionRoutes = routes.filter((route) => !route.enabled || route.health !== "healthy");
  const stats = [
    { key: "configured", label: t("overview.configured"), value: overview?.configured ?? routes.length, desc: t("overview.configuredDesc"), icon: "◇", tone: "blue" },
    { key: "enabled", label: t("overview.enabled"), value: overview?.enabled ?? routes.filter((item) => item.enabled).length, desc: t("overview.enabledDesc"), icon: "▶", tone: "green" },
    { key: "healthy", label: t("overview.healthy"), value: overview?.healthy ?? routes.filter((item) => item.health === "healthy").length, desc: t("overview.healthyDesc"), icon: "✓", tone: "blue" },
    { key: "attention", label: t("overview.attentionTitle"), value: attentionRoutes.length, desc: t("overview.attentionDesc"), icon: "!", tone: attentionRoutes.length ? "amber" : "green" },
  ];
  const apiBase = absoluteUrl(overview?.api_base ?? "/v1");
  const modelsUrl = absoluteUrl(overview?.models_url ?? "/v1/models");
  const chatUrl = absoluteUrl(overview?.chat_url ?? "/v1/chat/completions");
  const imagesUrl = absoluteUrl(overview?.images_url ?? "/v1/images/generations");
  const docsUrl = absoluteUrl(overview?.docs_url ?? "/docs");
  const apiToken = overview?.api_token ?? "";
  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const recentConnections = connections.filter((item) => {
    if (!item.timestamp) return true;
    const stamp = new Date(item.timestamp).getTime();
    return Number.isNaN(stamp) || stamp >= cutoff;
  }).slice(0, 12);

  function timeLabel(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" }).format(date);
  }

  return (
    <div className="stack overview-stack">
      <section className="stat-grid overview-stats" data-testid="overview-status">
        {stats.map((item) => (
          <article className="card stat overview-stat" key={item.key}>
            <span className={`metric-icon ${item.tone}`}>{item.icon}</span>
            <div className="metric-copy"><b>{item.value}</b><span>{item.label}</span><small>{item.desc}</small></div>
            <span className="metric-arrow" aria-hidden="true">›</span>
          </article>
        ))}
      </section>

      <section className="card overview-attention" data-testid="model-attention">
        <div className="section-head"><div><h2>{t("overview.attentionTitle")}</h2><p>{t("overview.attentionDesc")}</p></div>
          <a className="button-link" href="#/models">{t("overview.manageModels")}</a>
        </div>
        {attentionRoutes.length ? <div className="attention-list">
          {attentionRoutes.slice(0, 5).map((route) => <div key={route.id}>
            <span className={`badge ${route.enabled ? "warn" : "muted-badge"}`}>{status(route.enabled ? route.health : "disabled")}</span>
            <b>{route.display_name || route.remote_model}</b><small>{route.provider_name} · {route.remote_model}</small>
          </div>)}
        </div> : <p className="empty">{t("overview.noAttention")}</p>}
      </section>

      <section className="card recent-card" data-testid="recent-calls">
        <div className="section-head recent-head">
          <div><h2><span className="section-icon bars" aria-hidden="true">▥</span>{t("overview.recentTitle")}</h2><p>{t("overview.recentDesc")}</p></div>
          <div className="recent-actions">
            <div className="range-switch" role="group" aria-label={t("overview.rangeLabel")}>
              {[1, 7, 30].map((days) => <button key={days} className={rangeDays === days ? "active" : ""} onClick={() => setRangeDays(days)}>{days === 1 ? "24h" : `${days}d`}</button>)}
            </div>
            <button onClick={onRefresh}>↻ {t("common.refresh")}</button>
          </div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>{t("common.model")}</th><th>{t("common.provider")}</th><th>{t("overview.tenantApp")}</th><th>{t("common.result")}</th><th>{t("common.latency")}</th><th>{t("common.token")}</th><th>{t("overview.time")}</th></tr></thead>
          <tbody>{recentConnections.map((item, index) => (
            <tr key={item.request_id ?? index}>
              <td><b>{item.requested_model ?? "—"}</b><small>{item.remote_model ?? ""}</small></td>
              <td>{item.provider_id ?? "—"}</td>
              <td>{item.tenant_id ?? "system"}<small>{item.application_id ?? "legacy-global"}</small></td>
              <td><span className={item.status === "success" ? "badge ok" : "badge bad"}>{status(item.status)}</span></td>
              <td>{item.elapsed_ms == null ? "—" : `${item.elapsed_ms} ms`}</td>
              <td>{formatCount(item.usage?.total_tokens)}</td>
              <td>{timeLabel(item.timestamp)}</td>
            </tr>
          ))}{!recentConnections.length && <tr><td colSpan={7} className="empty">{t("overview.noCalls")}</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="overview-grid overview-secondary">
        <article className="card api-card" data-testid="client-access">
          <div className="section-head compact"><div><h2><span className="section-icon" aria-hidden="true">◎</span>{t("overview.externalTitle")}</h2><p>{t("overview.externalDesc")}</p></div><span className="section-arrow" aria-hidden="true">›</span></div>
          <div className="endpoint-grid">
            <div className="endpoint-item"><div><span>{t("common.apiBase")}</span><code>{apiBase}</code></div><CopyButton value={apiBase} label={t("common.copy")} /></div>
            <div className="endpoint-item"><div><span>{t("overview.unifiedModel")}</span><code>auto</code></div><CopyButton value="auto" label={t("common.copy")} /></div>
            <div className="endpoint-item"><div><span>{t("common.models")}</span><code>{modelsUrl}</code></div><CopyButton value={modelsUrl} label={t("common.copy")} /></div>
            <div className="endpoint-item"><div><span>{t("common.chat")}</span><code>{chatUrl}</code></div><CopyButton value={chatUrl} label={t("common.copy")} /></div>
            <div className="endpoint-item"><div><span>{t("overview.images")}</span><code>{imagesUrl}</code></div><CopyButton value={imagesUrl} label={t("common.copy")} /></div>
          </div>
          <div className="auth-row">
            <div className="auth-copy"><span className="auth-icon" aria-hidden="true">⌕</span><span>{t("overview.auth")}</span><code>X-Free-LLM-Token: {maskSecret(apiToken)}</code></div>
            {apiToken && <CopyButton value={apiToken} label={t("overview.copyToken")} />}
            <a className="docs-link" href={docsUrl} target="_blank" rel="noreferrer">OpenAPI {t("common.docs")} →</a>
          </div>
        </article>

        <article className="card routing-card">
          <div className="section-head compact"><div><h2><span className="section-icon route" aria-hidden="true">⌘</span>{t("overview.autoRoutingTitle")}</h2><p>{t("overview.autoRoutingDesc")}</p></div><span className="section-arrow" aria-hidden="true">›</span></div>
          <div className="auto-routing-flow">
            <div><span>▣</span><b>{t("routing.request")}</b><small>{t("overview.requestDetail")}</small></div><i>→</i>
            <div><span>✦</span><b>{t("common.capability")}</b><small>{t("overview.capabilityDetail")}</small></div><i>→</i>
            <div><span>♡</span><b>{t("overview.health")}</b><small>{t("overview.healthDetail")}</small></div><i>→</i>
            <div><span>☷</span><b>{t("routing.priority")}</b><small>{t("overview.priorityDetail")}</small></div><i>→</i>
            <div><span>➤</span><b>{t("overview.route")}</b><small>{t("overview.routeDetail")}</small></div>
          </div>
          <div className="route-note"><span aria-hidden="true">💡</span>{t("overview.autoRoutingNote")}</div>
        </article>
      </section>
    </div>
  );
}
