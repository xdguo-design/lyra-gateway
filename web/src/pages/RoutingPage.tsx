import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { Route } from "../types";

type StrategyKey = "default" | "quality" | "cost" | "latency" | "image";

export function RoutingPage({ routes }: { routes: Route[] }) {
  const { t, status } = useI18n();
  const [strategy, setStrategy] = useState<StrategyKey>("default");
  const capabilities = useMemo(() => Array.from(new Set(routes.flatMap((route) => route.capabilities))).sort(), [routes]);
  const enabled = routes.filter((route) => route.enabled);
  const healthy = enabled.filter((route) => route.health === "healthy");
  const hitRate = enabled.length ? Math.round((healthy.length / enabled.length) * 1000) / 10 : 0;
  const strategies: Array<{ key: StrategyKey; icon: string; title: string; desc: string; count: number }> = [
    { key: "default", icon: "◈", title: t("routing.defaultStrategy"), desc: t("routing.priorityDesc"), count: enabled.length },
    { key: "quality", icon: "☆", title: t("routing.qualityStrategy"), desc: t("routing.healthFilterDesc"), count: healthy.length },
    { key: "cost", icon: "◉", title: t("routing.costStrategy"), desc: t("usage.estimatedCost"), count: enabled.length },
    { key: "latency", icon: "ϟ", title: t("routing.latencyStrategy"), desc: t("common.latency"), count: enabled.length },
    { key: "image", icon: "▣", title: t("routing.imageStrategy"), desc: "image_generation", count: enabled.filter((route) => route.capabilities.includes("image_generation")).length },
  ];
  const selected = strategies.find((item) => item.key === strategy) ?? strategies[0];
  const orderedCandidates = [...enabled].sort((a, b) => {
    if (strategy === "cost") {
      const ap = a.pricing.input_per_million ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pricing.input_per_million ?? Number.MAX_SAFE_INTEGER;
      return ap - bp || a.priority - b.priority;
    }
    if (strategy === "latency") {
      const al = a.health_detail?.last_total_ms ?? Number.MAX_SAFE_INTEGER;
      const bl = b.health_detail?.last_total_ms ?? Number.MAX_SAFE_INTEGER;
      return al - bl || a.priority - b.priority;
    }
    if (strategy === "image") {
      const ai = a.capabilities.includes("image_generation") ? 0 : 1;
      const bi = b.capabilities.includes("image_generation") ? 0 : 1;
      return ai - bi || a.priority - b.priority;
    }
    if (strategy === "quality") {
      const ah = a.health === "healthy" ? 0 : 1;
      const bh = b.health === "healthy" ? 0 : 1;
      return ah - bh || a.priority - b.priority;
    }
    return a.priority - b.priority;
  });

  return (
    <div className="stack routing-prototype">
      <section className="stat-grid routing-summary">
        <article className="card stat"><span className="metric-icon blue">◇</span><div><small>{t("routing.defaultStrategy")}</small><b>auto</b></div></article>
        <article className="card stat"><span className="metric-icon green">▶</span><div><small>{t("routing.enabledStrategies")}</small><b>5 / 5</b></div></article>
        <article className="card stat"><span className="metric-icon blue">⬡</span><div><small>{t("routing.coverage")}</small><b>{routes.length}</b></div></article>
        <article className="card stat"><span className="metric-icon green">◎</span><div><small>{t("routing.hitRate")}</small><b>{hitRate}%</b></div></article>
      </section>

      <section className="routing-workbench">
        <aside className="card strategy-list">
          <div className="section-head"><div><h2>{t("routing.strategyList")}</h2></div></div>
          {strategies.map((item) => (
            <button key={item.key} className={strategy === item.key ? "active" : ""} onClick={() => setStrategy(item.key)}>
              <span>{item.icon}</span><div><b>{item.title}</b><small>{item.desc}</small></div><em>{item.count}</em>
            </button>
          ))}
        </aside>

        <div className="card strategy-detail">
          <div className="section-head">
            <div><h2>{selected.title} <span className="badge ok">{status("enabled")}</span></h2><p>{selected.desc}</p></div>
            <button>{t("common.edit")}</button>
          </div>

          <div className="route-flow-panel">
            <h3>{t("overview.autoRoutingTitle")}</h3>
            <div className="route-flow">
              <div><span>▤</span><b>1. {t("routing.request")}</b><small>{t("routing.requestDesc")}</small></div><i>→</i>
              <div><span>▦</span><b>2. {t("common.capability")}</b><small>{t("routing.preflightDesc")}</small></div><i>→</i>
              <div><span>♡</span><b>3. {t("routing.healthFilter")}</b><small>{t("routing.healthFilterDesc")}</small></div><i>→</i>
              <div><span>☷</span><b>4. {t("routing.priority")}</b><small>{t("routing.priorityDesc")}</small></div><i>→</i>
              <div><span>➤</span><b>5. {t("overview.route")}</b><small>{orderedCandidates[0]?.remote_model ?? "auto"}</small></div>
            </div>
          </div>

          <div className="strategy-settings">
            <h3>{t("routing.strategySettings")}</h3>
            <div className="weight-grid">
              <label><span>♡ {t("overview.health")}</span><meter min="0" max="100" value="40" /><b>40%</b></label>
              <label><span>ϟ {t("common.latency")}</span><meter min="0" max="100" value="25" /><b>25%</b></label>
              <label><span>◉ {t("usage.estimatedCost")}</span><meter min="0" max="100" value="25" /><b>25%</b></label>
              <label><span>✣ {t("routing.priority")}</span><meter min="0" max="100" value="10" /><b>10%</b></label>
            </div>
          </div>

          <div className="route-test">
            <h3>{t("routing.routeTest")}</h3>
            <div className="route-test-form">
              <select aria-label={t("common.capability")} defaultValue={capabilities[0] ?? ""}>
                {capabilities.map((capability) => <option value={capability} key={capability}>{capability}</option>)}
              </select>
              <input aria-label={t("routing.request")} defaultValue="auto" />
              <button className="primary">▶ {t("common.probe")}</button>
            </div>
            <div className="route-test-result"><span>✓</span><b>{orderedCandidates[0]?.remote_model ?? "—"}</b><small>{orderedCandidates[0]?.provider_name ?? "—"}</small></div>
          </div>
        </div>
      </section>

      <section className="card candidate-order">
        <div className="section-head"><div><h2>{t("routing.candidateOrder")}</h2><p>{t("routing.desc")}</p></div></div>
        <div className="cap-grid">
          {capabilities.map((capability) => {
            const candidates = orderedCandidates.filter((route) => route.capabilities.includes(capability)).slice(0, 3);
            return <article key={capability}><div className="candidate-title"><h3>{capability}</h3><small>{candidates.length}</small></div>{candidates.map((route, index) => <div className="candidate" key={route.id}><b>{index + 1}</b><span>{route.remote_model}</span><small>{route.provider_name}</small><span className={`badge ${route.health === "healthy" ? "ok" : "warn"}`}>{status(route.health)}</span></div>)}</article>;
          })}
          {!capabilities.length && <p className="empty">{t("routing.empty")}</p>}
        </div>
      </section>
    </div>
  );
}
