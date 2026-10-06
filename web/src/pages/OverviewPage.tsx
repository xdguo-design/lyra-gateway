import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { ConnectionRecord, Overview, Route } from "../types";
import { formatCount } from "../lib/format";

function absoluteUrl(value: string): string {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `${window.location.origin}${value.startsWith("/") ? value : `/${value}`}`;
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
  return <button className="copy-btn" onClick={() => void copy()} disabled={!value} aria-label={label}><span aria-hidden="true">{copied ? "✓" : "⧉"}</span>{label}</button>;
}

function MetricIcon({ kind }: { kind: "configured" | "enabled" | "healthy" | "capability" }) {
  const paths: Record<typeof kind, ReactNode> = {
    configured: <><path d="m12 3 7.2 4.1v9.8L12 21l-7.2-4.1V7.1z" /><path d="m4.8 7.1 7.2 4.2 7.2-4.2M12 11.3V21" /></>,
    enabled: <path d="m9 7 8 5-8 5z" />,
    healthy: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
    capability: <><path d="m12 3 7 4-7 4-7-4z" /><path d="m5 11 7 4 7-4M5 15l7 4 7-4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

function RoutingStepIcon({ step }: { step: number }) {
  if (step === 1) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h8l3 3v15H7zM15 3v4h4M10 11h5M10 15h5" /></svg>;
  if (step === 2) return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
  if (step === 3) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
  if (step === 4) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-7-5 14-3-5zM12 14l8-9" /></svg>;
}

export function OverviewPage({
  overview,
  routes,
  connections,
}: {
  overview: Overview | null;
  routes: Route[];
  connections: ConnectionRecord[];
}) {
  const { t, status, locale } = useI18n();
  const [rangeDays, setRangeDays] = useState(1);
  const capabilities = Array.from(new Set((overview?.capabilities?.length ? overview.capabilities : routes.flatMap((route) => route.capabilities)) ?? []));
  const capabilityCount = capabilities.length;

  function capabilityLabel(value: string) {
    const normalized = value.toLowerCase().replace(/[- ]/g, "_");
    if (normalized === "chat") return t("overview.capChat");
    if (["image", "image_generation", "images"].includes(normalized)) return t("overview.capImage");
    if (["embedding", "embeddings"].includes(normalized)) return t("overview.capEmbedding");
    if (["rerank", "reranking"].includes(normalized)) return t("overview.capRerank");
    if (["long_context", "longcontext"].includes(normalized)) return t("overview.capLong");
    if (normalized === "vision") return t("overview.capVision");
    return value.replaceAll("_", " ");
  }

  const stats = [
    { key: "configured" as const, label: t("overview.configured"), value: overview?.configured ?? routes.length, tone: "blue" },
    { key: "enabled" as const, label: t("overview.enabled"), value: overview?.enabled ?? routes.filter((item) => item.enabled).length, tone: "green" },
    { key: "healthy" as const, label: t("overview.healthy"), value: overview?.healthy ?? routes.filter((item) => item.health === "healthy").length, tone: "green" },
    { key: "capability" as const, label: t("overview.capabilityCount"), value: capabilityCount, tone: "blue" },
  ];

  const apiBase = absoluteUrl(overview?.api_base ?? "/v1");
  const modelsUrl = absoluteUrl(overview?.models_url ?? "/v1/models");
  const chatUrl = absoluteUrl(overview?.chat_url ?? "/v1/chat/completions");
  const imagesUrl = absoluteUrl(overview?.images_url ?? "/v1/images/generations");
  const apiToken = overview?.api_token ?? "";
  const endpointRows = [
    { label: t("common.apiBase"), value: apiBase, copy: apiBase },
    { label: t("overview.modelsEndpoint"), value: modelsUrl, copy: modelsUrl },
    { label: t("overview.chatEndpoint"), value: chatUrl, copy: chatUrl },
    { label: t("overview.imagesEndpoint"), value: imagesUrl, copy: imagesUrl },
    { label: t("overview.defaultModel"), value: "auto", copy: "auto" },
    {
      label: t("overview.authMode"),
      value: t("overview.bearerCompatible"),
      copy: apiToken ? `Authorization: Bearer ${apiToken}` : "Authorization: Bearer <TOKEN>",
    },
  ];

  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const recentConnections = connections.filter((item) => {
    if (!item.timestamp) return true;
    const stamp = new Date(item.timestamp).getTime();
    return Number.isNaN(stamp) || stamp >= cutoff;
  }).slice(0, 5);

  function timeLabel(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(date);
  }

  const routingSteps = [
    { label: t("routing.request"), detail: t("overview.requestDetail"), tone: "blue" },
    { label: t("common.capability"), detail: t("overview.capabilityDetail"), tone: "violet" },
    { label: t("overview.health"), detail: t("overview.healthDetail"), tone: "green" },
    { label: t("routing.priority"), detail: t("overview.priorityDetail"), tone: "orange" },
    { label: t("overview.route"), detail: t("overview.routeDetail"), tone: "blue" },
  ];

  return (
    <div className="stack overview-stack">
      <section className="stat-grid overview-stats" data-testid="overview-status">
        {stats.map((item) => (
          <article className="card stat overview-stat" key={item.key}>
            <span className={`metric-icon ${item.tone}`}><MetricIcon kind={item.key} /></span>
            <div className="metric-copy">
              <span>{item.label}</span>
              <b>{item.value}</b>
              {item.key === "capability" && <div className="metric-tags">{capabilities.slice(0, 4).map((capability) => <em key={capability}>{capabilityLabel(capability)}</em>)}</div>}
            </div>
            <span className="metric-arrow" aria-hidden="true">›</span>
          </article>
        ))}
      </section>

      <section className="overview-grid overview-secondary">
        <article className="card api-card" data-testid="client-access">
          <div className="section-head compact">
            <div><h2><span className="section-icon" aria-hidden="true">↗</span>{t("overview.externalTitle")}</h2><p>{t("overview.externalDesc")}</p></div>
          </div>
          <div className="endpoint-list">
            {endpointRows.map((row) => (
              <div className="endpoint-row" key={row.label}>
                <span>{row.label}</span>
                <code>{row.value}</code>
                <CopyButton value={row.copy} label={t("common.copy")} />
              </div>
            ))}
          </div>
        </article>

        <article className="card routing-card">
          <div className="section-head compact">
            <div><h2><span className="section-icon route" aria-hidden="true">⌘</span>{t("overview.autoRoutingTitle")}</h2><p>{t("overview.autoRoutingDesc")}</p></div>
          </div>
          <div className="auto-routing-flow">
            {routingSteps.map((item, index) => (
              <div className="routing-step-wrap" key={item.label}>
                <div className="routing-step">
                  <span className={`routing-step-icon ${item.tone}`}><RoutingStepIcon step={index + 1} /></span>
                  <b>{index + 1}. {item.label}</b>
                  <small>{item.detail}</small>
                </div>
                {index < routingSteps.length - 1 && <i aria-hidden="true">→</i>}
              </div>
            ))}
          </div>
          <div className="route-note">
            <span className="route-note-icon" aria-hidden="true">⚙</span>
            <div><b>{t("overview.autoRoutingTitle")}</b><small>{t("overview.autoRoutingNote")}</small></div>
            <a className="button-link" href="#/routing">{t("overview.routeSettings")} →</a>
          </div>
        </article>
      </section>

      <section className="card recent-card" data-testid="recent-calls">
        <div className="section-head recent-head">
          <div className="recent-title-line"><h2><span className="section-icon bars" aria-hidden="true">◷</span>{t("overview.recentTitle")}</h2><p>{t("overview.recentDesc")}</p></div>
          <div className="recent-actions">
            <div className="range-switch" role="group" aria-label={t("overview.rangeLabel")}>
              {[1, 7, 30].map((days) => <button key={days} className={rangeDays === days ? "active" : ""} onClick={() => setRangeDays(days)}>{days === 1 ? "24h" : `${days}d`}</button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>{t("common.model")}</th><th>{t("common.provider")}</th><th>{t("overview.tenantApp")}</th><th>{t("common.result")}</th><th>{t("common.latency")}</th><th>Tokens</th><th>{t("overview.time")}</th><th aria-label={t("common.actions")} /></tr></thead>
          <tbody>{recentConnections.map((item, index) => (
            <tr key={item.request_id ?? index}>
              <td><b>{item.requested_model ?? "—"}</b><small>{item.remote_model ?? ""}</small></td>
              <td>{item.provider_id ?? "—"}</td>
              <td>{item.tenant_id ?? "default"}<small>{item.application_id ?? "legacy-global"}</small></td>
              <td><span className={item.status === "success" ? "badge ok" : "badge bad"}><i className="status-dot" />{status(item.status)}</span></td>
              <td>{item.elapsed_ms == null ? "—" : `${item.elapsed_ms} ms`}</td>
              <td>{formatCount(item.usage?.total_tokens)}</td>
              <td>{timeLabel(item.timestamp)}</td>
              <td><button className="row-menu" aria-label={t("common.actions")}>···</button></td>
            </tr>
          ))}{!recentConnections.length && <tr><td colSpan={8} className="empty">{t("overview.noCalls")}</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
