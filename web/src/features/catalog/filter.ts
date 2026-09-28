import type { CatalogOffer } from "../../types";

export type CatalogOriginFilter = "all" | "domestic" | "international";
export type CatalogPoolFilter = "all" | "enabled" | "disabled" | "not_added";
export type CatalogModelRegion = "domestic" | "international" | "unknown";

export interface CatalogFilters {
  search: string;
  origin: CatalogOriginFilter;
  provider: string;
  capability: string;
  pool: CatalogPoolFilter;
}

const domesticOrigins = new Set(["cn", "china", "mainland china", "prc"]);
const unknownOrigins = new Set(["", "unknown", "n/a", "na", "-"]);

export function catalogModelRegion(offer: CatalogOffer): CatalogModelRegion {
  const value = String(offer.model_origin ?? offer.originCountry ?? "").trim().toLowerCase();
  if (domesticOrigins.has(value)) return "domestic";
  if (unknownOrigins.has(value)) return "unknown";
  return "international";
}

export function catalogProviders(offers: CatalogOffer[]): string[] {
  return [...new Set(offers.map((offer) => String(offer.provider ?? "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function catalogCapabilities(offers: CatalogOffer[]): string[] {
  return [...new Set(offers.flatMap((offer) => offer.capabilities ?? []).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function filterCatalogOffers(offers: CatalogOffer[], filters: CatalogFilters): CatalogOffer[] {
  const needle = filters.search.trim().toLowerCase();
  return offers.filter((offer) => {
    if (needle && !JSON.stringify(offer).toLowerCase().includes(needle)) return false;
    if (filters.origin !== "all" && catalogModelRegion(offer) !== filters.origin) return false;
    if (filters.provider !== "all" && String(offer.provider ?? "") !== filters.provider) return false;
    if (filters.capability !== "all" && !(offer.capabilities ?? []).includes(filters.capability)) return false;
    if (filters.pool !== "all" && offer.pool_status?.state !== filters.pool) return false;
    return true;
  });
}
