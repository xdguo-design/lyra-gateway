from fastapi.testclient import TestClient

from freellm_gateway.api import create_app
from freellm_gateway.models import ModelRoute
from freellm_gateway.service import ModelGateway


def _client() -> TestClient:
    route = ModelRoute(
        id="route-vision",
        provider_id="provider",
        remote_model="vision-model",
        priority=1,
        capabilities=frozenset({"chat", "vision", "tools", "stream"}),
        context_window=128000,
        max_output_tokens=8192,
        input_price_per_million=0.2,
        output_price_per_million=0.8,
    )
    gateway = ModelGateway([route], {})
    return TestClient(
        create_app(
            gateway=gateway,
            api_token="api-token",
            admin_token="admin-token",
        )
    )


def test_admin_capability_matrix_exposes_normalized_capabilities_and_limits():
    response = _client().get(
        "/api/admin/models/capability-matrix",
        headers={"X-Free-LLM-Token": "admin-token"},
    )

    assert response.status_code == 200
    item = response.json()["data"][0]
    assert item["id"] == "route-vision"
    assert item["capabilities"]["matrix"]["vision"] is True
    assert item["capabilities"]["matrix"]["function_calling"] is True
    assert item["capabilities"]["matrix"]["streaming"] is True
    assert item["limits"] == {"context_window": 128000, "max_output_tokens": 8192}


def test_public_model_detail_uses_model_name_and_keeps_route_identity():
    response = _client().get(
        "/v1/models/vision-model",
        headers={"X-Free-LLM-Token": "api-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "vision-model"
    assert payload["route_id"] == "route-vision"
    assert payload["capabilities"]["matrix"]["vision"] is True


def test_public_model_capabilities_accept_workbuddy_forwarding_header():
    response = _client().get(
        "/v1/models/vision-model/capabilities",
        headers={
            "Authorization": "Bearer proxy-owned-value",
            "X-Free-LLM-Token": "api-token",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["route_id"] == "route-vision"
    assert payload["limits"]["context_window"] == 128000
