from collections.abc import Iterable
from typing import Any
from urllib.parse import urlparse

import httpx


PUBLIC_FIELDS = (
    "id", "order", "date", "name", "providerMark", "provider", "model", "modelMeta",
    "productType", "capabilities", "usageGuide", "register", "registerLabel", "registerLabelEn", "docsUrl",
    "apiEndpoint", "freeSummary", "validitySummary", "accessSummary", "badges",
    "originCountry", "availability", "freeMechanism", "quota", "renewal", "lastVerifiedAt",
)
MODEL_PRODUCT_TYPES = {"api", "open_weights", "payg", "free_model", "model_api"}

_CHINA_ORIGINS = {"cn", "china", "mainland china", "prc", "中国", "中国大陆"}
_INTERNATIONAL_ORIGINS = {"intl", "international", "global", "worldwide", "overseas"}
_UNKNOWN_ORIGINS = {"", "unknown", "n/a", "na", "-", "未知"}


def _normalize_region(value: object) -> str:
    if not isinstance(value, str):
        return "UNKNOWN"
    raw = value.strip()
    normalized = raw.casefold()
    if normalized in _CHINA_ORIGINS:
        return "CN"
    if normalized in _INTERNATIONAL_ORIGINS:
        return "INTL"
    if normalized in _UNKNOWN_ORIGINS:
        return "UNKNOWN"
    if len(raw) == 2 and raw.isalpha():
        return raw.upper()
    # freellm.top currently distinguishes China from international/global origins.
    # Any other explicit origin is kept on the international side of that coarse split.
    return "INTL"


async def fetch_public_catalog(
    source_url: str,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    parsed = urlparse(source_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("catalog source must be an https URL")
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    try:
        response = await client.get(source_url)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError:
        raise
    finally:
        if owns_client:
            await client.aclose()
    offers = payload.get("offers", payload) if isinstance(payload, dict) else payload
    if not isinstance(offers, list):
        raise ValueError("catalog response must contain an offers list")
    return [item for item in offers if isinstance(item, dict)]


def model_offers(offers: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for offer in offers:
        product_type = offer.get("productType")
        capabilities = set(offer.get("capabilities") or [])
        if product_type not in MODEL_PRODUCT_TYPES and not capabilities.intersection({"model_api", "open_weights"}):
            continue
        item = {field: offer[field] for field in PUBLIC_FIELDS if field in offer}
        item["model_origin"] = _normalize_region(
            offer.get("model_origin") or offer.get("originCountry")
        )
        item["provider_region"] = _normalize_region(
            offer.get("provider_region") or offer.get("providerRegion")
        )
        result.append(item)
    return sorted(result, key=lambda item: (item.get("order", 10**9), item.get("id", "")))
