import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import { formatCosts, formatCount, quotaTone } from "../lib/format";
import type { QuotaPolicy, QuotaStatus, UsageGroup, UsageSummary } from "../types";

type Filters = { tenant_id: string; application_id: string; provider_id: string; remote_model: string };
const emptyFilters: Filters = { tenant_id: "", application_id: "", provider_id: "", remote_model: "" };

function UsageIcon({ kind }: { kind: "total" | "input" | "output" | "calls" | "cost" | "priced" }) {
  const icons: Record<typeof kind, ReactNode> = {
    total: <><path d="m12 3 7 4-7 4-7-4z"/><path d="m5 11 7 4 7-4M5 15l7 4 7-4"/></>,
    input: <><path d="M7 3h8l3 3v15H7zM15 3v4h4"/><path d="M12 16V9m-3 3 3-3 3 3"/></>,
    output: <><path d="M7 3h8l3 3v15H7zM15 3v4h4"/><path d="M12 9v7m-3-3 3 3 3-3"/></>,
    calls: <><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M10.8 7 6.2 16m7-9 4.6 9M7.2 18h9.6"/></>,
    cost: <><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/></>,
    priced: <><path d="M12 3 19 6v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-5"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[kind]}</svg>;
}

function quotaStatus(row: UsageGroup, t: ReturnType<typeof useI18n>["t"]) {
  const tone = quotaTone(row.quota);
  if (tone === "none") return { tone: "muted-badge", label: t("common.unconfigured") };
  if (tone === "bad") return { tone: "bad", label: t("common.exceeded") };
  if (tone === "warn") return { tone: "warn", label: t("common.warning") };
  return { tone: "ok", label: t("common.normal") };
}

function quotaTokenLimit(quota: QuotaStatus | null | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!quota?.configured) return t("common.unconfigured");
  return quota.token_limit == null ? t("common.unlimited") : formatCount(quota.token_limit);
}

function quotaCostLimit(quota: QuotaStatus | null | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!quota?.configured) return t("common.unconfigured");
  return quota.cost_limit == null ? t("common.unlimited") : `${quota.currency} ${quota.cost_limit.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function costNumber(row: UsageGroup): number {
  return row.estimated_costs.reduce((sum, item) => sum + (item.amount || 0), 0);
}

function UsageBreakdownTable({ title, rows, kind }: { title: string; rows: UsageGroup[]; kind: "tenant" | "application" | "provider" | "model" }) {
  const { t } = useI18n();
  const quotaAware = kind === "tenant" || kind === "application";
  const dimensionTitle = kind === "tenant" ? t("common.tenant") : kind === "application" ? t("common.application") : kind === "provider" ? t("common.provider") : t("common.model");
  return <section className="card usage-breakdown-card">
    <div className="section-head"><div><h2><span className="usage-section-icon" aria-hidden="true">{kind === "tenant" ? "⌘" : kind === "application" ? "◇" : kind === "provider" ? "≋" : "⬡"}</span>{title}</h2></div></div>
    <div className="table-wrap"><table><thead><tr>
      <th>{dimensionTitle}</th><th>Tokens</th><th>{t("usage.costUsd")}</th>
      {quotaAware && <><th>{t("usage.tokenQuota")}</th><th>{t("usage.costQuota")}</th><th>{t("common.status")}</th></>}
    </tr></thead><tbody>
      {rows.map((row, index) => {
        const label = row.tenant_name || row.application_name || row.provider_name || row.remote_model || t("common.unknown");
        const sub = row.tenant_id || row.application_id || row.provider_id || "";
        const q = quotaStatus(row, t);
        return <tr key={`${label}-${sub}-${index}`}>
          <td><b>{label}</b>{sub && sub !== label && <small>{sub}</small>}</td>
          <td>{formatCount(row.total_tokens)}</td><td>{formatCosts(row.estimated_costs)}</td>
          {quotaAware && <><td>{quotaTokenLimit(row.quota, t)}</td><td>{quotaCostLimit(row.quota, t)}</td><td><span className={`badge ${q.tone}`}><i className="usage-status-dot" />{q.label}</span></td></>}
        </tr>;
      })}
      {!rows.length && <tr><td colSpan={quotaAware ? 6 : 3} className="empty">{t("usage.empty")}</td></tr>}
    </tbody></table></div>
  </section>;
}

function UsageTrend({ rows }: { rows: UsageGroup[] }) {
  const { t } = useI18n();
  const values = rows.slice(-7);
  const maxTokens = Math.max(1, ...values.map((row) => row.total_tokens || 0));
  const maxCalls = Math.max(1, ...values.map((row) => row.calls || 0));
  const points = values.map((row, index) => {
    const x = values.length <= 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 86 - ((row.calls || 0) / maxCalls) * 60;
    return `${x},${y}`;
  }).join(" ");
  return <section className="card usage-trend-card">
    <div className="section-head">
      <div><h2><span className="usage-section-icon" aria-hidden="true">▥</span>{t("usage.dailyTrend")}</h2><p>{t("usage.dailyTrendDesc")}</p></div>
    </div>
    <div className="usage-trend-layout">
      <div className="usage-chart" aria-label={t("usage.dailyTrend")}>
        <div className="usage-chart-legend"><span><i className="tokens" />Tokens</span><span><i className="calls" />{t("common.calls")}</span></div>
        <div className="usage-chart-area">
          <div className="usage-y-labels"><span>{formatCount(maxTokens)}</span><span>{formatCount(Math.round(maxTokens / 2))}</span><span>0</span></div>
          <div className="usage-bars">
            {values.map((row, index) => <div className="usage-day-column" key={row.day ?? index}>
              <div className="usage-day-bar" style={{ height: `${Math.max(4, Math.round(((row.total_tokens || 0) / maxTokens) * 100))}%` }} />
              <small>{row.day?.slice(5) ?? String(index + 1)}</small>
            </div>)}
            <svg className="usage-calls-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>
          </div>
        </div>
      </div>
      <div className="table-wrap usage-day-table"><table><thead><tr><th>{t("usage.date")}</th><th>Tokens</th><th>{t("common.calls")}</th><th>{t("usage.costUsd")}</th></tr></thead><tbody>
        {values.map((row, index) => <tr key={row.day ?? index}><td>{row.day ?? "—"}</td><td>{formatCount(row.total_tokens)}</td><td>{formatCount(row.calls)}</td><td>{formatCosts(row.estimated_costs)}</td></tr>)}
        {!values.length && <tr><td colSpan={4} className="empty">{t("usage.empty")}</td></tr>}
      </tbody></table></div>
    </div>
  </section>;
}

export function UsagePage() {
  const { t, errorText } = useI18n();
  const [days, setDays] = useState(7);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [quotas, setQuotas] = useState<QuotaPolicy[]>([]);
  const [error, setError] = useState("");
  const [quotaDraft, setQuotaDraft] = useState({
    scope_type: "tenant" as "tenant" | "application",
    scope_id: "",
    token_limit: "",
    cost_limit: "",
    currency: "USD",
    warning_threshold_percent: "80",
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const [usageResult, quotaResult] = await Promise.all([
        api<{ data: UsageSummary }>(`/api/admin/usage?${params}`),
        api<{ data: QuotaPolicy[] }>("/api/admin/quotas"),
      ]);
      setUsage(usageResult.data);
      setQuotas(quotaResult.data);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    }
  }, [days, filters, errorText]);

  useEffect(() => { void load(); }, [load]);

  const targets = useMemo(() => {
    if (!usage) return [];
    return quotaDraft.scope_type === "tenant"
      ? usage.filter_options.tenants.map((item) => ({ id: item.id, label: item.name }))
      : usage.filter_options.applications.map((item) => ({ id: item.id, label: `${item.name} · ${item.tenant_id}` }));
  }, [usage, quotaDraft.scope_type]);

  useEffect(() => {
    const target = targets.some((item) => item.id === quotaDraft.scope_id) ? quotaDraft.scope_id : targets[0]?.id ?? "";
    const policy = quotas.find((item) => item.scope_type === quotaDraft.scope_type && item.scope_id === target);
    setQuotaDraft((current) => ({
      ...current,
      scope_id: target,
      token_limit: policy?.token_limit?.toString() ?? "",
      cost_limit: policy?.cost_limit?.toString() ?? "",
      currency: policy?.currency ?? "USD",
      warning_threshold_percent: policy?.warning_threshold_percent?.toString() ?? "80",
    }));
  }, [quotaDraft.scope_type, quotas, targets]);

  async function saveQuota(event: FormEvent) {
    event.preventDefault();
    if (!quotaDraft.scope_id) return;
    try {
      await api(`/api/admin/quotas/${quotaDraft.scope_type}/${encodeURIComponent(quotaDraft.scope_id)}`, {
        method: "PUT",
        body: {
          token_limit: quotaDraft.token_limit === "" ? null : Number(quotaDraft.token_limit),
          cost_limit: quotaDraft.cost_limit === "" ? null : Number(quotaDraft.cost_limit),
          currency: quotaDraft.currency.trim().toUpperCase() || "USD",
          warning_threshold_percent: Number(quotaDraft.warning_threshold_percent || 80),
        },
      });
      setError("");
      await load();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  if (!usage) return <section className="card">{error ? <div className="notice bad">{error}</div> : t("usage.loading")}</section>;

  const apps = usage.filter_options.applications.filter((item) => !filters.tenant_id || item.tenant_id === filters.tenant_id);
  const models = usage.filter_options.models.filter((item) => !filters.provider_id || item.provider_id === filters.provider_id);

  const metrics = [
    { kind: "total" as const, value: formatCount(usage.total_tokens), label: t("usage.totalTokens"), tone: "blue" },
    { kind: "input" as const, value: formatCount(usage.prompt_tokens), label: t("usage.inputTokens"), tone: "blue" },
    { kind: "output" as const, value: formatCount(usage.completion_tokens), label: t("usage.outputTokens"), tone: "green" },
    { kind: "calls" as const, value: formatCount(usage.calls), label: t("common.calls"), tone: "blue" },
    { kind: "cost" as const, value: formatCosts(usage.estimated_costs), label: t("usage.estimatedCost"), tone: "violet" },
    { kind: "priced" as const, value: `${formatCount(usage.priced_calls)} / ${formatCount(usage.calls)}`, label: t("usage.pricedCalls"), tone: "green" },
  ];

  return <div className="stack usage-stack">
    {error && <div className="notice bad">{error}</div>}

    <section className="card usage-toolbar">
      <div className="usage-range" role="group" aria-label={t("usage.range")}>{[1, 7, 30].map((value) =>
        <button className={days === value ? "active" : ""} key={value} onClick={() => setDays(value)}>{value === 1 ? "24h" : `${value}d`}</button>)}
      </div>
      <label><span>{t("common.tenant")}</span><select aria-label={t("common.tenant")} value={filters.tenant_id} onChange={(event) => setFilters({ ...filters, tenant_id: event.target.value, application_id: "" })}><option value="">{t("usage.allTenants")}</option>{usage.filter_options.tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{t("common.application")}</span><select aria-label={t("common.application")} value={filters.application_id} onChange={(event) => setFilters({ ...filters, application_id: event.target.value })}><option value="">{t("usage.allApplications")}</option>{apps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{t("common.provider")}</span><select aria-label={t("common.provider")} value={filters.provider_id} onChange={(event) => setFilters({ ...filters, provider_id: event.target.value, remote_model: "" })}><option value="">{t("usage.allProviders")}</option>{usage.filter_options.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{t("common.model")}</span><select aria-label={t("common.model")} value={filters.remote_model} onChange={(event) => setFilters({ ...filters, remote_model: event.target.value })}><option value="">{t("usage.allModels")}</option>{models.map((item) => <option key={item.id + item.provider_id} value={item.id}>{item.id}</option>)}</select></label>
      <button className="usage-reset" onClick={() => setFilters(emptyFilters)}>↻ {t("usage.reset")}</button>
    </section>

    <section className="stat-grid usage-metrics">
      {metrics.map((item) => <article className="card usage-metric" key={item.kind}>
        <span className={`usage-metric-icon ${item.tone}`}><UsageIcon kind={item.kind} /></span>
        <div><span>{item.label}</span><b>{item.value}</b><small>{t("usage.currentRange")}</small></div>
      </article>)}
    </section>

    <section className="card usage-quota-card" data-testid="usage-quota">
      <div className="section-head"><div><h2><span className="usage-section-icon" aria-hidden="true">▱</span>{t("usage.quotaTitle")}</h2><p>{t("usage.quotaShortDesc")}</p></div></div>
      <form className="usage-quota-form" onSubmit={saveQuota}>
        <label>{t("common.scope")}<select value={quotaDraft.scope_type} onChange={(event) => setQuotaDraft({ ...quotaDraft, scope_type: event.target.value as "tenant" | "application", scope_id: "" })}><option value="tenant">{t("common.tenant")}</option><option value="application">{t("common.application")}</option></select></label>
        <label>{t("common.target")}<select value={quotaDraft.scope_id} onChange={(event) => setQuotaDraft({ ...quotaDraft, scope_id: event.target.value })}><option value="">{t("usage.selectTarget")}</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("usage.monthTokenQuota")}<div className="input-suffix"><input type="number" min="0" value={quotaDraft.token_limit} onChange={(event) => setQuotaDraft({ ...quotaDraft, token_limit: event.target.value })} /><span>Tokens</span></div></label>
        <label>{t("usage.monthCostBudget")}<div className="input-suffix"><input type="number" min="0" step="0.000001" value={quotaDraft.cost_limit} onChange={(event) => setQuotaDraft({ ...quotaDraft, cost_limit: event.target.value })} /><select aria-label={t("common.currency")} value={quotaDraft.currency} onChange={(event) => setQuotaDraft({ ...quotaDraft, currency: event.target.value })}><option value="USD">USD</option><option value="CNY">CNY</option></select></div></label>
        <label>{t("usage.warningThreshold")}<div className="input-suffix"><input type="number" min="0" max="100" step="0.1" value={quotaDraft.warning_threshold_percent} onChange={(event) => setQuotaDraft({ ...quotaDraft, warning_threshold_percent: event.target.value })} /><span>%</span></div></label>
        <button className="primary" type="submit">▣ {t("usage.saveQuota")}</button>
      </form>
    </section>

    <section className="grid-two usage-breakdown-row">
      <UsageBreakdownTable title={t("usage.byTenant")} rows={usage.by_tenant} kind="tenant" />
      <UsageBreakdownTable title={t("usage.byApplication")} rows={usage.by_application} kind="application" />
    </section>
    <section className="grid-two usage-breakdown-row">
      <UsageBreakdownTable title={t("usage.byProvider")} rows={usage.by_provider} kind="provider" />
      <UsageBreakdownTable title={t("usage.byModel")} rows={usage.by_model} kind="model" />
    </section>
    <UsageTrend rows={usage.by_day} />
  </div>;
}
