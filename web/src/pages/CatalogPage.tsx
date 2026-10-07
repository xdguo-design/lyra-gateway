import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  catalogCapabilities,
  catalogModelRegion,
  catalogProviders,
  filterCatalogOffers,
  type CatalogOriginFilter,
  type CatalogPoolFilter,
} from "../features/catalog/filter";
import { CATALOG_DRAFT_KEY, catalogRouteDraft } from "../features/models/connection";
import { useI18n } from "../i18n";
import type { CatalogOffer } from "../types";

function ProviderGlyph({ provider }: { provider: string }) {
  const value = provider.trim().toLowerCase();
  const text = value.includes("anthropic") ? "AI"
    : value.includes("google") || value.includes("gemini") ? "G"
      : value.includes("deepseek") ? "◆"
        : value.includes("qwen") || value.includes("alibaba") ? "◇"
          : value.includes("meta") ? "∞"
            : value.includes("mistral") ? "M"
              : value.includes("openai") ? "◎"
                : provider.trim().slice(0, 1).toUpperCase() || "M";
  return <span className={`catalog-provider-glyph catalog-provider-${value.replace(/[^a-z0-9]+/g, "-")}`}>{text}</span>;
}

async function copyText(value: string) {
  if (!value) return;
  await navigator.clipboard?.writeText(value);
}

export function CatalogPage() {
  const { t, status, errorText, language } = useI18n();
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState<CatalogOriginFilter>("all");
  const [provider, setProvider] = useState("all");
  const [capability, setCapability] = useState("all");
  const [pool, setPool] = useState<CatalogPoolFilter>("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api<{ data: CatalogOffer[] }>("/api/admin/catalog/source?scope=models");
      setOffers(result.data ?? []);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const providerOptions = useMemo(() => catalogProviders(offers), [offers]);
  const capabilityOptions = useMemo(() => catalogCapabilities(offers), [offers]);
  const filtered = useMemo(
    () => filterCatalogOffers(offers, { search, origin, provider, capability, pool }),
    [offers, search, origin, provider, capability, pool],
  );
  const selectedOffer = useMemo(() => filtered.find((offer, index) => String(offer.id ?? index) === selectedId) ?? null, [filtered, selectedId]);
  const originCounts = useMemo(() => ({
    all: offers.length,
    domestic: offers.filter((offer) => catalogModelRegion(offer) === "domestic").length,
    international: offers.filter((offer) => catalogModelRegion(offer) === "international").length,
  }), [offers]);

  async function action(kind: "export" | "sync") {
    try {
      const result = await api<{ path?: string; data?: unknown }>(`/api/admin/catalog/${kind}`, { method: "POST" });
      setMessage(kind === "export" ? t("catalog.exported", { path: result.path ?? "catalog" }) : t("catalog.synced"));
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function addToPool(offer: CatalogOffer) {
    const draft = catalogRouteDraft(offer);
    sessionStorage.setItem(CATALOG_DRAFT_KEY, JSON.stringify(draft));
    window.location.hash = "/models";
  }

  return <div className="stack catalog-stack">
    <div className="catalog-page-actions">
      <button disabled={loading} onClick={() => void load()}>↻ {t("common.reload")}</button>
      <button onClick={() => void action("export")}>▧ {t("catalog.export")}</button>
      <button className="primary" onClick={() => void action("sync")}>↻ {t("catalog.sync")}</button>
    </div>
    {message && <div className="notice">{message}</div>}

    <section className="catalog-main">
      <div className="catalog-toolbar card">
        <label className="catalog-search"><span aria-hidden="true">⌕</span><input placeholder={t("catalog.search")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="catalog-origin-tabs" role="group" aria-label={t("catalog.origin")}>
          {([
            ["all", t("catalog.originAll"), originCounts.all],
            ["domestic", t("catalog.originDomestic"), originCounts.domestic],
            ["international", t("catalog.originInternational"), originCounts.international],
          ] as const).map(([value, label, count]) => <button key={value} type="button" className={origin === value ? "active" : ""} aria-pressed={origin === value} onClick={() => setOrigin(value)}>{label} <span>({count})</span></button>)}
        </div>
        <div className="catalog-filter-grid">
          <label><span>{t("catalog.providerFilter")}</span><select aria-label={t("catalog.providerFilter")} value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">{t("catalog.allProviders")}</option>{providerOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label><span>{t("catalog.capabilityFilter")}</span><select aria-label={t("catalog.capabilityFilter")} value={capability} onChange={(event) => setCapability(event.target.value)}>
            <option value="all">{t("catalog.allCapabilities")}</option>{capabilityOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label><span>{t("catalog.poolFilter")}</span><select aria-label={t("catalog.poolFilter")} value={pool} onChange={(event) => setPool(event.target.value as CatalogPoolFilter)}>
            <option value="all">{t("catalog.allPoolStates")}</option>
            <option value="not_added">{status("not_added")}</option><option value="enabled">{status("enabled")}</option><option value="disabled">{status("disabled")}</option>
          </select></label>
        </div>
        <div className="catalog-result-count" data-testid={loading ? "catalog-loading" : undefined} role={loading ? "status" : undefined}>
          {loading ? t("catalog.loading") : t("catalog.showing", { shown: filtered.length, total: offers.length })}
        </div>
      </div>

      <div className="catalog-layout">
        <div className="catalog-grid" aria-busy={loading}>
          {filtered.map((offer, index) => {
            const id = String(offer.id ?? index);
            const region = catalogModelRegion(offer);
            const guide = offer.usageGuide;
            const localizedSteps = language === "en" && guide?.stepsEn?.length ? guide.stepsEn : guide?.steps ?? [];
            const showGuide = Boolean(guide?.prerequisites?.length || localizedSteps.length);
            const regionLabel = region === "domestic" ? t("catalog.originDomestic") : region === "international" ? t("catalog.originInternational") : t("catalog.originUnknown");
            const modelName = String(offer.name ?? offer.model ?? offer.id ?? "Model");
            const providerName = String(offer.provider ?? "");
            const modelId = String(offer.model ?? "—");
            const endpoint = String(offer.apiEndpoint ?? t("catalog.manualEndpoint"));
            const description = String(offer.freeSummary ?? offer.modelMeta ?? offer.validitySummary ?? "");
            return <article className={`catalog-card ${selectedId === id ? "selected" : ""}`} key={id} onClick={() => setSelectedId(id)}>
              <header className="catalog-card-head">
                <ProviderGlyph provider={providerName} />
                <div className="catalog-card-name"><h3>{modelName}</h3><p>{providerName}</p></div>
                <div className="catalog-card-badges">
                  <span className={`badge region-badge region-${region}`}>{regionLabel}</span>
                  <span className={`badge ${offer.pool_status?.state === "enabled" ? "ok" : offer.pool_status?.state === "disabled" ? "bad" : "warn"}`}>{status(offer.pool_status?.state ?? "not_added")}</span>
                </div>
              </header>
              <p className="catalog-description">{description}</p>
              <div className="catalog-capabilities">{offer.capabilities?.slice(0, 5).map((cap) => <span className="tag" key={cap}>{cap}</span>)}</div>
              {showGuide && <details className="catalog-guide">
                <summary>{t("catalog.registrationSteps")}</summary>
                {guide?.prerequisites?.length ? <div className="catalog-guide-prerequisites"><strong>{t("catalog.prerequisites")}</strong><ul>{guide.prerequisites.map((item, stepIndex) => <li key={`${stepIndex}-${item}`}>{item}</li>)}</ul></div> : null}
                {localizedSteps.length ? <ol className="catalog-guide-steps">{localizedSteps.map((item, stepIndex) => <li key={`${stepIndex}-${item}`}>{item}</li>)}</ol> : null}
              </details>}
              <div className="catalog-meta">
                <div><span>{t("catalog.modelId")}</span><code>{modelId}</code><button aria-label={t("common.copy")} onClick={(event) => { event.stopPropagation(); void copyText(modelId); }}>⧉</button></div>
                <div><span>{t("catalog.apiEntry")}</span><code>{endpoint}</code><button aria-label={t("common.copy")} onClick={(event) => { event.stopPropagation(); void copyText(endpoint); }}>⧉</button></div>
              </div>
              <div className="catalog-actions">
                <button className="primary" onClick={(event) => { event.stopPropagation(); addToPool(offer); }}>{t("catalog.configureAndAdd")}</button>
                {offer.register && <a className="button-link" href={offer.register} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{(language === "zh" ? offer.registerLabel : offer.registerLabelEn) || t("common.register")}</a>}
                {offer.docsUrl && <a href={offer.docsUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{t("common.docs")} ↗</a>}
              </div>
            </article>;
          })}
          {!loading && !offers.length && !message && <p className="empty" data-testid="catalog-empty">{t("catalog.noEntries")}</p>}
          {!loading && offers.length > 0 && !filtered.length && <p className="empty" data-testid="catalog-no-matches">{t("catalog.empty")}</p>}
        </div>

        <aside className="card catalog-draft">
          <div className="catalog-draft-head"><span className="draft-icon">▧</span><div><h2>{t("catalog.draftTitle")}</h2><p>{t("catalog.draftDesc")}</p></div></div>
          {selectedOffer ? <div className="catalog-draft-preview">
            <div className="draft-model"><ProviderGlyph provider={String(selectedOffer.provider ?? "")} /><div><b>{String(selectedOffer.name ?? selectedOffer.model ?? selectedOffer.id ?? "Model")}</b><small>{String(selectedOffer.provider ?? "")}</small></div></div>
            <p>{String(selectedOffer.freeSummary ?? selectedOffer.modelMeta ?? "")}</p>
            <div className="catalog-capabilities">{selectedOffer.capabilities?.map((cap) => <span className="tag" key={cap}>{cap}</span>)}</div>
            <div className="catalog-meta">
              <div><span>{t("catalog.modelId")}</span><code>{String(selectedOffer.model ?? "—")}</code></div>
              <div><span>{t("catalog.apiEntry")}</span><code>{String(selectedOffer.apiEndpoint ?? t("catalog.manualEndpoint"))}</code></div>
            </div>
            <button className="primary" onClick={() => addToPool(selectedOffer)}>{t("catalog.configureAndAdd")}</button>
          </div> : <div className="catalog-draft-empty">
            <div className="draft-empty-graphic"><span>▤</span><i /><i /><i /></div>
            <h3>{t("catalog.draftEmptyTitle")}</h3>
            <p>{t("catalog.draftEmptyDesc")}</p>
          </div>}
        </aside>
      </div>
    </section>
  </div>;
}
