import { describe, expect, it } from "vitest";
import {
  catalogCapabilities,
  catalogModelRegion,
  catalogProviders,
  filterCatalogOffers,
} from "./filter";
import type { CatalogOffer } from "../../types";

const offers: CatalogOffer[] = [
  {
    id: "deepseek",
    provider: "DeepSeek",
    model: "DeepSeek V4",
    model_origin: "CN",
    capabilities: ["chat", "reasoning"],
    pool_status: { state: "enabled", exact: true, route_id: "deepseek", enabled_count: 1, disabled_count: 0 },
  },
  {
    id: "gemini",
    provider: "Google AI Studio",
    model: "Gemini",
    model_origin: "INTL",
    capabilities: ["chat", "vision"],
    pool_status: { state: "not_added", exact: false, route_id: null, enabled_count: 0, disabled_count: 0 },
  },
  {
    id: "legacy",
    provider: "Legacy",
    model: "Unknown",
    capabilities: ["chat"],
    pool_status: { state: "disabled", exact: true, route_id: "legacy", enabled_count: 0, disabled_count: 1 },
  },
];

describe("catalog filters", () => {
  it("classifies domestic, international, and missing origins without provider-name guessing", () => {
    expect(catalogModelRegion(offers[0])).toBe("domestic");
    expect(catalogModelRegion(offers[1])).toBe("international");
    expect(catalogModelRegion(offers[2])).toBe("unknown");
    expect(catalogModelRegion({ originCountry: "China" })).toBe("domestic");
    expect(catalogModelRegion({ originCountry: "Global" })).toBe("international");
  });

  it("filters by origin, provider, capability, pool state, and search together", () => {
    expect(filterCatalogOffers(offers, {
      search: "deep",
      origin: "domestic",
      provider: "DeepSeek",
      capability: "reasoning",
      pool: "enabled",
    }).map((offer) => offer.id)).toEqual(["deepseek"]);

    expect(filterCatalogOffers(offers, {
      search: "",
      origin: "international",
      provider: "all",
      capability: "vision",
      pool: "not_added",
    }).map((offer) => offer.id)).toEqual(["gemini"]);
  });

  it("builds stable provider and capability options", () => {
    expect(catalogProviders(offers)).toEqual(["DeepSeek", "Google AI Studio", "Legacy"]);
    expect(catalogCapabilities(offers)).toEqual(["chat", "reasoning", "vision"]);
  });
});
