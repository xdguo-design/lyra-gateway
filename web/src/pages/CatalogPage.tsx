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

export function CatalogPage() {
  const { t, status, errorText } = useI18n();
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState<CatalogOriginFilter>("all");
  const [provider, setProvider] = useState("all");
  const [capability, setCapability] = useState("all");
  const [pool, setPool] = useState<CatalogPoolFilter>("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingOffer, setPendingOffer] = useState<{ name: string; hasEndpoint: boolean } | null>(null);

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
    setPendingOffer({ name: draft.display_name || draft.remote_model, hasEndpoint: draft.has_endpoint });
  }

  return (
    <div className="stack">
      {message && <div className="notice">{message}</div>}
      {pendingOffer && <div className={`notice catalog-handoff ${pendingOffer.hasEndpoint ? "ok" : "warn"}`} role="status">
        <div><strong>{pendingOffer.hasEndpoint ? t("catalog.prefilled", { name: pendingOffer.name }) : t("catalog.endpointRequired", { name: pendingOffer.name })}</strong>
          <small>{t("catalog.prefilledNotSaved")}</small></div>
        <button className="primary" onClick={() => { window.location.hash = "/models"; }}>{t("catalog.continueConfiguration")}</button>
        <button onClick={() => setPendingOffer(null)}>{t("common.cancel")}</button>
      </div>}
      <section className="card">
        <div className="section-head">
          <div><h2>{t("catalog.title")}</h2><p>{t("catalog.desc")}</p></div>
          <div className="actions">
            <button disabled={loading} onClick={() => void load()}>{t("common.reload")}</button>
            <button onClick={() => void action("export")}>{t("catalog.export")}</button>
            <button className="primary" onClick={() => void action("sync")}>{t("catalog.sync")}</button>
          </div>
        </div>

        <div className="catalog-toolbar">
          <input className="search" placeholder={t("catalog.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="catalog-origin-tabs" role="group" aria-label={t("catalog.origin")}>
            {([
              ["all", t("catalog.originAll")],
              ["domestic", t("catalog.originDomestic")],
              ["international", t("catalog.originInternational")],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={origin === value ? "active" : ""}
                aria-pressed={origin === value}
                onClick={() => setOrigin(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="catalog-filter-grid">
            <label>{t("catalog.providerFilter")}
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="all">{t("catalog.allProviders")}</option>
                {providerOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>{t("catalog.capabilityFilter")}
              <select value={capability} onChange={(event) => setCapability(event.target.value)}>
                <option value="all">{t("catalog.allCapabilities")}</option>
                {capabilityOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>{t("catalog.poolFilter")}
              <select value={pool} onChange={(event) => setPool(event.target.value as CatalogPoolFilter)}>
                <option value="all">{t("catalog.allPoolStates")}</option>
                <option value="not_added">{status("not_added")}</option>
                <option value="enabled">{status("enabled")}</option>
                <option value="disabled">{status("disabled")}</option>
              </select>
            </label>
          </div>
          <div className="catalog-result-count" data-testid={loading ? "catalog-loading" : undefined} role={loading ? "status" : undefined}>
            {loading ? t("catalog.loading") : t("catalog.showing", { shown: filtered.length, total: offers.length })}
          </div>
        </div>

        <div className="catalog-grid" aria-busy={loading}>
          {filtered.map((offer, index) => {
            const region = catalogModelRegion(offer);
            const regionLabel =
              region === "domestic"
                ? t("catalog.originDomestic")
                : region === "international"
                  ? t("catalog.originInternational")
                  : t("catalog.originUnknown");
            return (
              <article className="catalog-card" key={String(offer.id ?? index)}>
                <div className="section-head">
                  <div><h3>{String(offer.name ?? offer.model ?? offer.id ?? "Model")}</h3><p>{String(offer.provider ?? "")}</p></div>
                  <div className="catalog-card-badges">
                    <span className={`badge region-badge region-${region}`}>{regionLabel}</span>
                    <span className={`badge ${offer.pool_status?.state === "enabled" ? "ok" : "muted-badge"}`}>{status(offer.pool_status?.state ?? "catalog")}</span>
                  </div>
                </div>
                <p>{String(offer.freeSummary ?? "")}</p>
                <div>{offer.capabilities?.map((cap) => <span className="tag" key={cap}>{cap}</span>)}</div>
                <div className="catalog-meta">
                  <span>{t("common.model")} <code>{String(offer.model ?? "—")}</code></span>
                  <span>{t("common.endpoint")} <code>{String(offer.apiEndpoint ?? t("catalog.manualEndpoint"))}</code></span>
                </div>
                <div className="actions">
                  <button className="primary" onClick={() => addToPool(offer)}>{t("catalog.addPool")}</button>
                  {offer.register && <a className="button-link" href={offer.register} target="_blank" rel="noreferrer">{t("common.register")} ↗</a>}
                  {offer.docsUrl && <a href={offer.docsUrl} target="_blank" rel="noreferrer">{t("common.docs")} ↗</a>}
                </div>
              </article>
            );
          })}
        </div>
        {!loading && !offers.length && !message && <p className="empty" data-testid="catalog-empty">{t("catalog.noEntries")}</p>}
        {!loading && offers.length > 0 && !filtered.length && <p className="empty" data-testid="catalog-no-matches">{t("catalog.empty")}</p>}
      </section>
    </div>
  );
}
