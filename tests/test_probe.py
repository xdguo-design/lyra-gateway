import time

import pytest
from fastapi.testclient import TestClient

from freellm_gateway.adapters.base import ProviderError
from freellm_gateway.api import create_app
from freellm_gateway.health import is_eligible
from freellm_gateway.models import HealthStatus, ModelRoute
from freellm_gateway.service import ModelGateway, build_probe_prompt, extract_output_text


class StaticAdapter:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    async def complete(self, payload):
        self.calls.append(payload)
        if self.error:
            raise self.error
        return self.response


def make_gateway(adapter):
    route = ModelRoute(id="r", provider_id="p", remote_model="m", priority=1)
    return ModelGateway([route], {"r": adapter})


@pytest.mark.asyncio
async def test_manual_probe_does_not_change_route_priority():
    routes = [
        ModelRoute(id="first", provider_id="p", remote_model="m1", priority=1),
        ModelRoute(id="second", provider_id="p", remote_model="m2", priority=2),
    ]
    adapter = StaticAdapter(response={"choices": [{"message": {"content": "ok"}}]})
    gateway = ModelGateway(routes, {"first": adapter, "second": adapter})

    await gateway.probe("second")

    assert [(route.id, route.priority) for route in gateway.routes] == [("first", 1), ("second", 2)]


@pytest.mark.asyncio
async def test_probe_sends_randomized_arithmetic_with_token_budget():
    adapter = StaticAdapter(response={"choices": [{"message": {"content": "164821"}}]})
    gateway = make_gateway(adapter)

    await gateway.probe("r")

    payload = adapter.calls[0]
    assert payload["max_tokens"] == 64
    content = payload["messages"][0]["content"]
    assert content.startswith("Calculate ")
    assert content.endswith(", and reply with the result only.")
    # prompts are randomized so upstreams cannot serve a cached completion
    await gateway.probe("r")
    assert adapter.calls[0]["messages"][0]["content"] != adapter.calls[1]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_probe_without_completion_choices_raises_protocol_error_and_stays_isolated():
    adapter = StaticAdapter(response={"choices": [{}]})
    gateway = make_gateway(adapter)

    with pytest.raises(ProviderError) as error:
        await gateway.probe("r")

    assert error.value.kind == "provider_protocol_error"
    assert gateway.route("r").health == HealthStatus.HEALTHY
    assert gateway.health_states["r"].last_error_kind == "provider_protocol_error"
    assert is_eligible(gateway.health_states["r"], time.monotonic())


@pytest.mark.asyncio
async def test_probe_rejects_empty_visible_text_and_records_safe_diagnostic():
    adapter = StaticAdapter(
        response={
            "choices": [{
                "message": {"content": "", "reasoning_content": "private reasoning text"},
                "finish_reason": "stop",
            }],
            "usage": {"completion_tokens": 7},
        }
    )
    gateway = make_gateway(adapter)

    with pytest.raises(ProviderError) as error:
        await gateway.probe("r")

    assert error.value.kind == "empty_output"
    assert gateway.route("r").health == HealthStatus.HEALTHY
    state = gateway.health_states["r"]
    assert state.last_error_kind == "empty_output"
    assert "content_chars=0" in state.last_error_detail
    assert "reasoning_chars=22" in state.last_error_detail
    assert "private reasoning text" not in state.last_error_detail
    assert "completion_tokens=7" in state.last_error_detail


def test_admin_routes_expose_redacted_completion_shape_diagnostic():
    adapter = StaticAdapter(
        response={
            "choices": [{
                "message": {"content": "", "reasoning_content": "secret diagnostic fixture"},
                "finish_reason": "stop",
            }]
        }
    )
    gateway = make_gateway(adapter)
    client = TestClient(create_app(gateway=gateway, api_token="api-token", admin_token="admin-token"))

    response = client.post(
        "/api/admin/routes/r/probe",
        headers={"Authorization": "Bearer admin-token"},
    )
    routes = client.get("/api/admin/routes", headers={"Authorization": "Bearer admin-token"})

    assert response.status_code == 502
    assert response.json()["detail"] == "empty_output"
    detail = routes.json()["data"][0]["health_detail"]["last_error_detail"]
    assert "content_chars=0" in detail
    assert "reasoning_chars=25" in detail
    assert "secret diagnostic fixture" not in detail


@pytest.mark.asyncio
async def test_probe_rate_limit_is_recorded_without_cooling_down():
    adapter = StaticAdapter(error=ProviderError("rate_limit", 429, "slow down", retry_after=90))
    gateway = make_gateway(adapter)

    with pytest.raises(ProviderError):
        await gateway.probe("r")

    state = gateway.health_states["r"]
    assert state.status == HealthStatus.HEALTHY
    assert state.last_error_kind == "rate_limit"
    assert state.last_retry_after == 90
    assert is_eligible(state, time.monotonic())


def test_extract_output_text_handles_common_shapes():
    assert extract_output_text({"choices": [{"message": {"content": "hello"}}]}) == "hello"
    assert extract_output_text({"choices": [{"text": "legacy"}]}) == "legacy"
    assert (
        extract_output_text({"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}}]})
        == "ab"
    )
    assert extract_output_text({"choices": []}) == ""
    assert extract_output_text({}) == ""
