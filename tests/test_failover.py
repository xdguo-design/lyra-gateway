import pytest

from freellm_gateway.health import RoutePolicy
from freellm_gateway.models import HealthStatus, ModelRoute
from freellm_gateway.service import ModelGateway, ProviderError


class FakeAdapter:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = 0

    async def complete(self, payload):
        self.calls += 1
        if self.error:
            raise self.error
        return self.response


class SequenceAdapter:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    async def complete(self, payload):
        self.calls.append(payload)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class StreamAdapter(FakeAdapter):
    def __init__(self, chunks=()):
        super().__init__()
        self.chunks = chunks

    async def stream(self, payload):
        for chunk in self.chunks:
            yield chunk


class SequenceStreamAdapter:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    async def stream(self, payload):
        self.calls.append(payload)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        for chunk in outcome:
            yield chunk


@pytest.mark.asyncio
async def test_auto_fails_over_on_rate_limit_and_promotes_successful_fallback():
    routes = [
        ModelRoute(id="groq", provider_id="groq", remote_model="openai/gpt-oss-120b", priority=1),
        ModelRoute(id="qwen", provider_id="alibaba", remote_model="Qwen/Qwen3.8-27B", priority=2),
    ]
    successful_completion = {"id": "qwen-result", "choices": [{"message": {"content": "pong"}}]}
    persisted = []
    gateway = ModelGateway(
        routes,
        {
            "groq": SequenceAdapter(ProviderError("rate_limit", 429, safe_to_retry=True)),
            "qwen": SequenceAdapter(successful_completion),
        },
        on_route_changed=persisted.append,
    )

    result = await gateway.complete({"model": "auto", "messages": [{"role": "user", "content": "hello"}]})

    assert result["id"] == "qwen-result"
    assert len(gateway.adapters["groq"].calls) == 1
    assert len(gateway.adapters["qwen"].calls) == 1
    assert [(route.id, route.priority) for route in gateway.routes] == [("qwen", 1), ("groq", 2)]
    assert {route.id: route.priority for route in persisted} == {"qwen": 1, "groq": 2}


@pytest.mark.asyncio
async def test_auto_does_not_retry_after_an_empty_completion():
    routes = [
        ModelRoute(id="empty", provider_id="provider-a", remote_model="empty-model", priority=1),
        ModelRoute(id="usable", provider_id="provider-b", remote_model="usable-model", priority=2),
    ]
    empty_response = {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}
    empty_adapter = SequenceAdapter(empty_response)
    usable_adapter = SequenceAdapter({"id": "usable-result", "choices": [{"message": {"content": "draft text"}}]})
    connection_log = []
    gateway = ModelGateway(
        routes,
        {"empty": empty_adapter, "usable": usable_adapter},
        on_connection_logged=connection_log.append,
    )

    with pytest.raises(ProviderError) as error:
        await gateway.complete({"model": "auto", "messages": [{"role": "user", "content": "write a paragraph"}]})

    assert error.value.kind == "empty_output"
    assert len(empty_adapter.calls) == 1
    assert empty_adapter.calls[0]["messages"][0]["content"] == "write a paragraph"
    assert len(usable_adapter.calls) == 0
    assert gateway.route("empty").health == HealthStatus.FAILED
    assert [(entry["route_id"], entry["status"], entry.get("error_kind")) for entry in connection_log] == [
        ("empty", "failed", "empty_output"),
    ]


@pytest.mark.asyncio
async def test_auto_stream_safely_retries_a_rate_limit_without_probe():
    routes = [
        ModelRoute(id="groq", provider_id="groq", remote_model="openai/gpt-oss-120b", priority=1),
        ModelRoute(id="qwen", provider_id="alibaba", remote_model="Qwen/Qwen3.8-27B", priority=2),
    ]
    persisted = []
    gateway = ModelGateway(
        routes,
        {
            "groq": SequenceStreamAdapter(ProviderError("rate_limit", 429, safe_to_retry=True)),
            "qwen": SequenceStreamAdapter([b"data: result\n\n"]),
        },
        on_route_changed=persisted.append,
    )

    chunks = [chunk async for chunk in gateway.stream({"model": "auto", "messages": [{"role": "user", "content": "hello"}]})]

    assert chunks == [b"data: result\n\n"]
    assert len(gateway.adapters["groq"].calls) == 1
    assert len(gateway.adapters["qwen"].calls) == 1
    assert [(route.id, route.priority) for route in gateway.routes] == [("qwen", 1), ("groq", 2)]
    assert {route.id: route.priority for route in persisted} == {"qwen": 1, "groq": 2}


@pytest.mark.asyncio
async def test_auto_request_preserves_gpt_oss_model_and_reasoning_parameters():
    route = ModelRoute(
        id="groq",
        provider_id="groq",
        remote_model="openai/gpt-oss-120b",
        priority=1,
        reasoning_effort="medium",
    )
    adapter = SequenceAdapter({"id": "result", "choices": [{"message": {"content": "pong"}}]})
    gateway = ModelGateway([route], {route.id: adapter})

    result = await gateway.complete({
        "model": "auto",
        "messages": [{"role": "user", "content": "hello"}],
        "reasoning_effort": "high",
    })

    assert result["id"] == "result"
    assert [payload["model"] for payload in adapter.calls] == ["openai/gpt-oss-120b"]
    assert adapter.calls[0]["reasoning_effort"] == "high"


@pytest.mark.asyncio
async def test_auto_sends_user_request_without_a_separate_probe():
    route = ModelRoute(id="primary", provider_id="p", remote_model="m", priority=1)
    adapter = SequenceAdapter({
        "id": "result",
        "choices": [{"message": {"content": "answer"}}],
    })
    gateway = ModelGateway([route], {route.id: adapter})

    result = await gateway.complete({
        "model": "auto",
        "messages": [{"role": "user", "content": "answer this"}],
    })

    assert result["id"] == "result"
    assert len(adapter.calls) == 1
    assert adapter.calls[0]["messages"][0]["content"] == "answer this"


@pytest.mark.asyncio
async def test_auto_does_not_replay_a_rejected_user_request_on_another_route():
    routes = [
        ModelRoute(id="first", provider_id="p1", remote_model="m1", priority=1),
        ModelRoute(id="second", provider_id="p2", remote_model="m2", priority=2),
    ]
    first = FakeAdapter(error=ProviderError("invalid_request", 400, retriable=False))
    second = FakeAdapter(response={"id": "fallback", "choices": [{"message": {"content": "ok"}}]})
    gateway = ModelGateway(routes, {"first": first, "second": second})

    with pytest.raises(ProviderError) as error:
        await gateway.complete({"model": "auto", "messages": []})

    assert error.value.kind == "invalid_request"
    assert first.calls == 1
    assert second.calls == 0
    assert gateway.route("first").health == HealthStatus.HEALTHY


@pytest.mark.asyncio
async def test_gateway_fails_over_in_priority_order():
    routes = [
        ModelRoute(id="first", provider_id="p1", remote_model="m1", priority=1),
        ModelRoute(id="second", provider_id="p2", remote_model="m2", priority=2),
    ]
    adapters = {
        "first": FakeAdapter(error=ProviderError("rate_limit", 429, safe_to_retry=True)),
        "second": FakeAdapter(response={"id": "fallback", "choices": [{"message": {"content": "ok"}}]}),
    }
    gateway = ModelGateway(routes, adapters)

    result = await gateway.complete({"model": "auto", "messages": []})

    assert result["id"] == "fallback"
    assert adapters["first"].calls == 1
    assert adapters["second"].calls == 1


@pytest.mark.asyncio
async def test_gateway_returns_503_error_when_all_candidates_fail():
    routes = [ModelRoute(id="only", provider_id="p1", remote_model="m1", priority=1)]
    gateway = ModelGateway(
        routes,
        {"only": FakeAdapter(error=ProviderError("rate_limit", 429, safe_to_retry=True))},
    )

    with pytest.raises(ProviderError) as error:
        await gateway.complete({"model": "auto", "messages": []})

    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_gateway_marks_failed_route_and_skips_it_on_next_request():
    routes = [
        ModelRoute(id="first", provider_id="p1", remote_model="m1", priority=1),
        ModelRoute(id="second", provider_id="p2", remote_model="m2", priority=2),
    ]
    adapters = {
        "first": FakeAdapter(error=ProviderError("rate_limit", 429, safe_to_retry=True)),
        "second": FakeAdapter(response={"id": "fallback", "choices": [{"message": {"content": "ok"}}]}),
    }
    gateway = ModelGateway(routes, adapters, policies={"first": RoutePolicy(backoff_schedule=(60, 300))})

    await gateway.complete({"model": "auto", "messages": []})
    await gateway.complete({"model": "auto", "messages": []})

    assert adapters["first"].calls == 1
    assert gateway.route("first").health == HealthStatus.RATE_LIMITED


@pytest.mark.asyncio
async def test_new_route_added_after_start_can_be_selected():
    gateway = ModelGateway([], {})
    adapter = FakeAdapter(response={"id": "new", "choices": [{"message": {"content": "ok"}}]})
    gateway.add_route(ModelRoute(id="new", provider_id="p", remote_model="new", priority=1), adapter)

    result = await gateway.complete({"model": "auto", "messages": []})

    assert result["id"] == "new"


@pytest.mark.asyncio
async def test_authentication_error_disables_route_persists_and_fails_over():
    routes = [
        ModelRoute(id="bad", provider_id="p", remote_model="bad-model", priority=1),
        ModelRoute(id="good", provider_id="p", remote_model="good-model", priority=2),
    ]
    persisted = []
    gateway = ModelGateway(
        routes,
        {
            "bad": FakeAdapter(error=ProviderError("authentication_error", 401, retriable=False, safe_to_retry=True)),
            "good": FakeAdapter(response={"id": "fallback", "choices": [{"message": {"content": "ok"}}]}),
        },
        on_route_changed=persisted.append,
    )

    result = await gateway.complete({"model": "auto", "messages": []})

    assert result["id"] == "fallback"
    assert gateway.route("bad").enabled is False
    assert gateway.route("bad").health == HealthStatus.DISABLED
    assert persisted[0].id == "bad"
    assert persisted[0].enabled is False
    assert persisted[0].health == HealthStatus.DISABLED
    assert {route.id: route.priority for route in persisted} == {"bad": 2, "good": 1}
    assert gateway._candidates("auto", "chat") == [gateway.route("good")]


@pytest.mark.asyncio
async def test_authentication_error_during_probe_disables_route_but_network_error_does_not():
    auth_route = ModelRoute(id="auth", provider_id="p", remote_model="auth-model", priority=1)
    network_route = ModelRoute(id="network", provider_id="p", remote_model="network-model", priority=2)
    persisted = []
    gateway = ModelGateway(
        [auth_route, network_route],
        {
            "auth": FakeAdapter(error=ProviderError("authentication_error", 401, retriable=False, safe_to_retry=True)),
            "network": FakeAdapter(error=ProviderError("network_error", 502, retriable=True)),
        },
        on_route_changed=persisted.append,
    )

    with pytest.raises(ProviderError):
        await gateway.probe("auth")
    with pytest.raises(ProviderError):
        await gateway.probe("network")

    assert gateway.route("auth").enabled is False
    assert gateway.route("auth").health == HealthStatus.DISABLED
    assert gateway.route("network").enabled is True
    assert gateway.route("network").health != HealthStatus.DISABLED
    assert [route.id for route in persisted] == ["auth"]


@pytest.mark.asyncio
async def test_gateway_does_not_retry_after_an_empty_completion():
    routes = [
        ModelRoute(id="unstable", provider_id="p1", remote_model="unstable", priority=1),
        ModelRoute(id="alibaba", provider_id="p2", remote_model="Qwen/Qwen3.8-27B", priority=2),
    ]
    adapters = {
        "unstable": FakeAdapter(response={"id": "empty", "choices": []}),
        "alibaba": FakeAdapter(response={
            "id": "good", "model": "Qwen/Qwen3.8-27B",
            "choices": [{"message": {"content": "pong"}}],
        }),
    }
    gateway = ModelGateway(routes, adapters)

    with pytest.raises(ProviderError) as error:
        await gateway.complete({"model": "auto", "messages": []})

    assert error.value.kind == "empty_output"
    assert adapters["unstable"].calls == 1
    assert adapters["alibaba"].calls == 0


@pytest.mark.asyncio
async def test_gateway_does_not_retry_after_an_empty_stream():
    routes = [
        ModelRoute(id="unstable", provider_id="p1", remote_model="unstable", priority=1),
        ModelRoute(id="alibaba", provider_id="p2", remote_model="Qwen/Qwen3.8-27B", priority=2),
    ]
    gateway = ModelGateway(routes, {
        "unstable": StreamAdapter(),
        "alibaba": StreamAdapter([b"data: pong\n\n"]),
    })

    with pytest.raises(ProviderError) as error:
        [chunk async for chunk in gateway.stream({"model": "auto", "messages": []})]

    assert error.value.kind == "empty_output"


@pytest.mark.asyncio
async def test_gateway_does_not_retry_after_an_unclassified_protocol_error():
    routes = [
        ModelRoute(id="broken", provider_id="p1", remote_model="broken", priority=1),
        ModelRoute(id="alibaba", provider_id="p2", remote_model="Qwen/Qwen3.8-27B", priority=2),
    ]
    gateway = ModelGateway(routes, {
        "broken": FakeAdapter(error=ValueError("invalid JSON from provider")),
        "alibaba": FakeAdapter(response={"id": "good", "choices": [{"message": {"content": "pong"}}]}),
    })

    with pytest.raises(ProviderError) as error:
        await gateway.complete({"model": "auto", "messages": []})

    assert error.value.kind == "provider_protocol_error"
    assert gateway.adapters["alibaba"].calls == 0


@pytest.mark.asyncio
async def test_gateway_logs_selected_route_and_token_usage():
    logged = []
    route = ModelRoute(id="qwen", provider_id="alibaba", remote_model="Qwen/Qwen3.8-27B", priority=1)
    gateway = ModelGateway(
        [route],
        {"qwen": FakeAdapter(response={
            "id": "good",
            "model": "Qwen/Qwen3.8-27B",
            "choices": [{"message": {"content": "pong"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16},
        })},
        on_connection_logged=logged.append,
    )

    await gateway.complete({"model": "auto", "messages": [{"role": "user", "content": "hi"}]})

    assert logged[0]["provider_id"] == "alibaba"
    assert logged[0]["remote_model"] == "Qwen/Qwen3.8-27B"
    assert logged[0]["status"] == "success"
    assert logged[0]["usage"] == {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16}
