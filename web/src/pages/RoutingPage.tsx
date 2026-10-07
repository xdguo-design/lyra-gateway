import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { Route } from "../types";

type StrategyKey = "default" | "quality" | "cost" | "latency" | "image";

function SummaryIcon({ kind }: { kind: "default" | "enabled" | "coverage" | "hit" }) {
  const paths: Record<typeof kind, ReactNode> = {
    default: <><path d="m12 3 7 4-7 4-7-4z"/><path d="m5 11 7 4 7-4M5 15l7 4 7-4"/></>,
    enabled: <path d="m9 6 9 6-9 6z"/>,
    coverage: <><path d="m12 3 7 4-7 4-7-4z"/><path d="m5 11 7 4 7-4M5 15l7 4 7-4"/></>,
    hit: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

function StepIcon({ step }: { step: number }) {
  if (step === 1) return <svg viewBox="0 0 24 24"><path d="M7 3h8l3 3v15H7zM15 3v4h4M10 11h5M10 15h5"/></svg>;
  if (step === 2) return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
  if (step === 3) return <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>;
  if (step === 4) return <svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></svg>;
  return <svg viewBox="0 0 24 24"><path d="m4 12 16-7-5 14-3-5zM12 14l8-9"/></svg>;
}

function inputPrice(route: Route): number {
  return route.pricing.input_per_million ?? Number.MAX_SAFE_INTEGER;
}

function latency(route: Route): number {
  return route.health_detail?.last_total_ms ?? Number.MAX_SAFE_INTEGER;
}

function strategyCandidates(routes: Route[], strategy: StrategyKey) {
  return [...routes].sort((a, b) => {
    if (strategy === "cost") return inputPrice(a) - inputPrice(b) || a.priority - b.priority;
    if (strategy === "latency") return latency(a) - latency(b) || a.priority - b.priority;
    if (strategy === "image") {
      const ai = a.capabilities.includes("image_generation") || a.capabilities.includes("image") ? 0 : 1;
      const bi = b.capabilities.includes("image_generation") || b.capabilities.includes("image") ? 0 : 1;
      return ai - bi || a.priority - b.priority;
    }
    if (strategy === "quality") {
      const ah = a.enabled && a.health === "healthy" ? 0 : a.enabled ? 1 : 2;
      const bh = b.enabled && b.health === "healthy" ? 0 : b.enabled ? 1 : 2;
      return ah - bh || a.priority - b.priority;
    }
    return a.priority - b.priority;
  });
}

export function RoutingPage({ routes }: { routes: Route[] }) {
  const { t, status } = useI18n();
  const [strategy, setStrategy] = useState<StrategyKey>("default");
  const capabilities = useMemo(() => Array.from(new Set(routes.flatMap((route) => route.capabilities))).sort(), [routes]);
  const [testCapability, setTestCapability] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testRan, setTestRan] = useState(false);

  const enabled = routes.filter((route) => route.enabled);
  const healthy = enabled.filter((route) => route.health === "healthy");
  const hitRate = enabled.length ? Math.round((healthy.length / enabled.length) * 1000) / 10 : 0;

  const strategies: Array<{ key: StrategyKey; icon: string; title: string; desc: string; count: number; tone: string }> = [
    { key: "default", icon: "◇", title: t("routing.defaultStrategy"), desc: t("routing.defaultStrategyDesc"), count: enabled.length, tone: "blue" },
    { key: "quality", icon: "☆", title: t("routing.qualityStrategy"), desc: t("routing.qualityStrategyDesc"), count: healthy.length, tone: "orange" },
    { key: "cost", icon: "≋", title: t("routing.costStrategy"), desc: t("routing.costStrategyDesc"), count: enabled.length, tone: "orange" },
    { key: "latency", icon: "ϟ", title: t("routing.latencyStrategy"), desc: t("routing.latencyStrategyDesc"), count: enabled.length, tone: "violet" },
    { key: "image", icon: "▧", title: t("routing.imageStrategy"), desc: t("routing.imageStrategyDesc"), count: enabled.filter((route) => route.capabilities.some((cap) => cap.includes("image"))).length, tone: "green" },
  ];
  const selected = strategies.find((item) => item.key === strategy) ?? strategies[0];
  const allOrdered = strategyCandidates(routes, strategy);
  const activeOrdered = allOrdered.filter((route) => route.enabled);
  const routed = activeOrdered.find((route) => {
    const requested = testCapability || capabilities[0] || "";
    return !requested || route.capabilities.includes(requested);
  }) ?? activeOrdered[0] ?? null;

  const visibleCapabilities = [
    ...["chat", "image_generation", "embeddings", "rerank"].filter((cap) => capabilities.includes(cap)),
    ...capabilities.filter((cap) => !["chat", "image_generation", "embeddings", "rerank"].includes(cap)),
  ].slice(0, 4);

  function capabilityTitle(capability: string) {
    if (capability === "chat") return t("routing.capChat");
    if (capability === "image_generation" || capability === "image") return t("routing.capImage");
    if (capability === "embeddings" || capability === "embedding") return t("routing.capEmbedding");
    if (capability === "rerank") return t("routing.capRerank");
    return capability;
  }

  const steps = [
    { title: t("routing.request"), desc: t("routing.requestStepDesc"), tone: "blue" },
    { title: t("routing.capabilityMatch"), desc: t("routing.capabilityStepDesc"), tone: "violet" },
    { title: t("routing.healthFilter"), desc: t("routing.healthStepDesc"), tone: "green" },
    { title: t("routing.prioritySort"), desc: t("routing.priorityStepDesc"), tone: "orange" },
    { title: t("routing.result"), desc: t("routing.resultStepDesc"), tone: "blue" },
  ];

  return <div className="stack routing-prototype">
    <section className="stat-grid routing-summary">
      <article className="card routing-stat"><span className="routing-stat-icon blue"><SummaryIcon kind="default" /></span><div><small>{t("routing.defaultStrategyLabel")}</small><b>{t("routing.autoRouting")}</b><em>{t("routing.defaultStrategySub")}</em></div><i>›</i></article>
      <article className="card routing-stat"><span className="routing-stat-icon green"><SummaryIcon kind="enabled" /></span><div><small>{t("routing.enabledStrategies")}</small><b>{strategies.length} / {strategies.length}</b><em>{t("routing.activeStrategies")}</em></div><i>›</i></article>
      <article className="card routing-stat"><span className="routing-stat-icon blue"><SummaryIcon kind="coverage" /></span><div><small>{t("routing.coverage")}</small><b>{routes.length}</b><em>{t("routing.coverageSub")}</em></div><i>›</i></article>
      <article className="card routing-stat"><span className="routing-stat-icon green"><SummaryIcon kind="hit" /></span><div><small>{t("routing.hitRate")}</small><b>{hitRate}%</b><em>{t("routing.hitRateSub")}</em></div><i>›</i></article>
    </section>

    <section className="routing-workbench">
      <aside className="card strategy-list">
        <div className="section-head"><div><h2>{t("routing.strategyList")}</h2></div><button className="primary">＋ {t("routing.newStrategy")}</button></div>
        {strategies.map((item) => <button key={item.key} className={strategy === item.key ? "active" : ""} onClick={() => setStrategy(item.key)}>
          <span className={`strategy-icon ${item.tone}`}>{item.icon}</span>
          <div><b>{item.title}</b><small>{item.desc}</small><em>{t("routing.modelsCount", { count: item.count })}</em></div>
          <strong className="strategy-enabled"><i />{t("common.enabled")}</strong>
          <span className="strategy-edit">{t("common.edit")}</span><span className="strategy-menu">···</span>
        </button>)}
      </aside>

      <div className="card strategy-detail">
        <div className="strategy-detail-head">
          <div><h2><span className="strategy-title-icon">◇</span>{selected.title}<span className="badge ok"><i className="routing-dot" />{t("common.enabled")}</span></h2><p>{selected.desc}</p></div>
          <button>✎ {t("routing.editStrategy")}</button>
        </div>

        <section className="route-flow-panel">
          <div className="routing-section-heading"><h3><span>⌘</span>{t("routing.flowTitle")}</h3><p>{t("routing.flowDesc")}</p></div>
          <div className="route-flow">
            {steps.map((step, index) => <div className="route-flow-wrap" key={step.title}>
              <div className="route-flow-step"><span className={step.tone}><StepIcon step={index + 1} /></span><b>{index + 1}. {step.title}</b><small>{step.desc}</small></div>
              {index < steps.length - 1 && <i>→</i>}
            </div>)}
          </div>
        </section>

        <section className="strategy-settings">
          <div className="routing-section-heading"><h3><span>≋</span>{t("routing.strategySettings")}</h3><p>{t("routing.strategySettingsDesc")}</p></div>
          <div className="weight-grid">
            <label><span><i className="setting-icon green">♡</i><b>{t("overview.health")}</b><small>{t("routing.healthWeightDesc")}</small></span><meter min="0" max="100" value="40" /><strong>40%</strong></label>
            <label><span><i className="setting-icon orange">ϟ</i><b>{t("common.latency")}</b><small>{t("routing.latencyWeightDesc")}</small></span><meter min="0" max="100" value="25" /><strong>25%</strong></label>
            <label><span><i className="setting-icon orange">≋</i><b>{t("usage.estimatedCost")}</b><small>{t("routing.costWeightDesc")}</small></span><meter min="0" max="100" value="25" /><strong>25%</strong></label>
            <label><span><i className="setting-icon blue">✣</i><b>{t("routing.weight")}</b><small>{t("routing.priorityWeightDesc")}</small></span><meter min="0" max="100" value="10" /><strong>10%</strong></label>
          </div>
        </section>

        <section className="route-test">
          <div className="routing-section-heading"><h3><span>▶</span>{t("routing.routeTest")}</h3><p>{t("routing.routeTestDesc")}</p></div>
          <div className="route-test-form">
            <label>{t("routing.requestType")}<select><option>{t("routing.chatRequest")}</option></select></label>
            <label>{t("routing.targetCapability")}<select aria-label={t("common.capability")} value={testCapability || capabilities[0] || ""} onChange={(event) => setTestCapability(event.target.value)}>{capabilities.map((capability) => <option value={capability} key={capability}>{capabilityTitle(capability)}</option>)}</select></label>
            <label className="route-test-prompt">{t("routing.sampleRequest")}<input value={testPrompt} placeholder={t("routing.sampleRequestPlaceholder")} onChange={(event) => setTestPrompt(event.target.value)} /></label>
            <button className="primary" onClick={() => setTestRan(true)}>▶ {t("routing.startTest")}</button>
          </div>
          {(routed || testRan) && <div className="route-test-result">
            <span className="result-check">✓</span><div className="route-result-model"><small>{t("routing.routeResult")}</small><b>{routed?.remote_model ?? "—"}</b></div>
            <div><small>{t("routing.score")}</small><b>{routed ? (routed.health === "healthy" ? "0.892" : "0.721") : "—"}</b></div>
            <div><small>{t("routing.estimatedLatency")}</small><b>{routed?.health_detail?.last_total_ms == null ? "—" : `${routed.health_detail.last_total_ms} ms`}</b></div>
            <div><small>{t("routing.estimatedCost")}</small><b>{routed?.pricing.input_per_million == null ? "—" : `${routed.pricing.currency} ${routed.pricing.input_per_million} / 1M`}</b></div>
            <div><small>{t("routing.healthStatus")}</small><b className={routed?.health === "healthy" ? "health-ok" : ""}><i className="routing-dot" />{routed ? status(routed.enabled ? routed.health : "disabled") : "—"}</b></div>
          </div>}
        </section>
      </div>
    </section>

    <section className="card candidate-order">
      <div className="section-head"><div><h2><span className="candidate-order-icon">▥</span>{t("routing.candidateOrder")}</h2><p>{t("routing.candidateOrderDesc")}</p></div><small>{t("routing.refreshHint")}</small></div>
      <div className="cap-grid">
        {visibleCapabilities.map((capability) => {
          const candidates = allOrdered.filter((route) => route.capabilities.includes(capability)).slice(0, 3);
          return <article key={capability}>
            <div className="candidate-card-head"><h3>{capabilityTitle(capability)} <span>({capability})</span></h3><small>{t("routing.candidatesCount", { count: candidates.length })}</small></div>
            {candidates.map((route, index) => <div className="candidate" key={route.id}>
              <b>{index + 1}</b><span>{route.remote_model}</span>
              <span className={`candidate-score ${route.enabled && route.health === "healthy" ? "good" : ""}`}><i />{route.enabled ? (route.health === "healthy" ? "0.892" : "0.721") : "—"}</span>
              <span className={`badge ${!route.enabled ? "muted-badge" : route.health === "healthy" ? "ok" : "warn"}`}>{status(route.enabled ? route.health : "disabled")}</span>
            </div>)}
            {!candidates.length && <p className="empty">{t("routing.empty")}</p>}
          </article>;
        })}
        {!visibleCapabilities.length && <p className="empty">{t("routing.empty")}</p>}
      </div>
    </section>
  </div>;
}
