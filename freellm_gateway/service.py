import random
import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import replace
from uuid import uuid4

from .adapters.base import ProviderError
from .health import HealthState, ProbeResult, RoutePolicy, effective_status, is_eligible, record_probe
from .models import HealthStatus, ModelRoute
from .routing import select_candidates


def build_probe_prompt() -> str:
    """Randomized arithmetic keeps providers from answering the health check
    from a cached completion, and forces the model to actually reason."""
    left = random.randrange(10000, 100000)
    right = random.randrange(10000, 100000)
    return f"Calculate {left}+{right}, and reply with the result only."


def extract_output_text(response: dict) -> str:
    """Pull text out of an OpenAI-style chat completion response."""
    choices = response.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", choices[0].get("text"))
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    return ""


class ModelGateway:
    def __init__(
        self,
        routes: Sequence[ModelRoute],
        adapters: Mapping[str, object],
        policies: Mapping[str, RoutePolicy] | None = None,
        on_route_changed: Callable[[ModelRoute], None] | None = None,
        on_connection_logged: Callable[[dict], None] | None = None,
    ):
        self.routes = list(routes)
        self.adapters = adapters
        self.policies = dict(policies or {})
        self.on_route_changed = on_route_changed
        self.on_connection_logged = on_connection_logged
        self.health_states = {
            route.id: HealthState(status=route.health) for route in self.routes
        }

    def route(self, route_id: str) -> ModelRoute:
        for route in self.routes:
            if route.id == route_id:
                return route
        # KeyError, not StopIteration: inside a coroutine the event loop turns
        # StopIteration into RuntimeError and 404 handling never sees it.
        raise KeyError(route_id)

    def add_route(self, route: ModelRoute, adapter=None) -> None:
        if any(existing.id == route.id for existing in self.routes):
            raise ValueError(f"route already exists: {route.id}")
        self.routes.append(route)
        self.health_states[route.id] = HealthState(status=route.health)
        if adapter is not None:
            self.adapters[route.id] = adapter

    def replace_route(self, route: ModelRoute, adapter=None) -> None:
        current = next((existing for existing in self.routes if existing.id == route.id), None)
        if current is None:
            raise KeyError(route.id)
        if route.enabled and not current.enabled:
            self.health_states[route.id] = HealthState(status=HealthStatus.HEALTHY)
            route = replace(route, health=HealthStatus.HEALTHY)
        self.routes = [route if existing.id == route.id else existing for existing in self.routes]
        self.health_states.setdefault(route.id, HealthState(status=route.health))
        if adapter is not None:
            self.adapters[route.id] = adapter

    def remove_route(self, route_id: str) -> None:
        if not any(route.id == route_id for route in self.routes):
            raise KeyError(route_id)
        self.routes = [route for route in self.routes if route.id != route_id]
        self.adapters.pop(route_id, None)
        self.health_states.pop(route_id, None)

    async def probe(self, route_id: str, *, enforce_routing: bool = False) -> dict:
        source = "traffic" if enforce_routing else "probe"
        route = self.route(route_id)
        adapter = self.adapters.get(route.id)
        if adapter is None:
            error = ProviderError("missing_adapter", 503, route.id, retriable=False)
            self._record_error(route, error, source=source)
            if enforce_routing:
                self._demote_route(route.id)
            raise error
        started = time.monotonic()
        try:
            probe_request = {
                "model": route.remote_model,
                "messages": [{"role": "user", "content": build_probe_prompt()}],
                "max_tokens": 64,
            }
            if route.reasoning_effort is not None:
                probe_request["reasoning_effort"] = route.reasoning_effort
            result = await adapter.complete(probe_request)
        except ProviderError as error:
            self._record_error(route, error, source=source)
            if enforce_routing:
                self._demote_route(route.id)
            raise
        except Exception as error:
            protocol_error = ProviderError("provider_protocol_error", 502, str(error), retriable=False)
            self._record_error(route, protocol_error, source=source)
            if enforce_routing:
                self._demote_route(route.id)
            raise protocol_error from error
        elapsed = int((time.monotonic() - started) * 1000)
        if not is_probe_completion(result):
            error = ProviderError(
                "provider_protocol_error",
                502,
                completion_shape_diagnostic(result),
                retriable=False,
            )
            self._record_error(route, error, source=source)
            if enforce_routing:
                self._demote_route(route.id)
            raise error
        if not is_usable_completion(result, "chat"):
            error = ProviderError(
                "empty_output",
                502,
                completion_shape_diagnostic(result),
                retriable=False,
            )
            self._record_error(route, error, source=source)
            if enforce_routing:
                self._demote_route(route.id)
            raise error
        self._record_success(route, elapsed, source=source)
        return result

    async def complete(
        self,
        payload: dict,
        capability: str | None = None,
        usage_context: Mapping[str, str] | None = None,
    ) -> dict:
        usage_context = dict(usage_context or {})
        requested_model = payload.get("model", "auto")
        capability = capability or infer_capability(payload)
        request_id = str(usage_context.pop("request_id", "") or uuid4().hex)
        candidates = self._candidates(requested_model, capability)
        if not candidates:
            self._log_connection(
                    usage_context=usage_context,
                request_id=request_id, requested_model=requested_model, capability=capability,
                stream=False, attempt=0, route=None, status="failed", elapsed_ms=0,
                error_kind="no_available_model",
            )
            raise ProviderError("no_available_model", 503, "no eligible model route", retriable=False)

        errors: list[ProviderError] = []
        for attempt, route in enumerate(candidates, 1):
            adapter = self.adapters.get(route.id)
            if adapter is None:
                error = ProviderError("missing_adapter", 503, route.id, retriable=False, safe_to_retry=True)
                errors.append(error)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=False, attempt=attempt, route=route, status="failed", elapsed_ms=0,
                    error_kind=error.kind,
                )
                continue
            request = request_for_route(payload, route)
            started = time.monotonic()
            try:
                response = await adapter.complete(request)
                if not is_usable_completion(response, capability):
                    raise ProviderError(
                        "empty_output",
                        502,
                        completion_shape_diagnostic(response),
                        retriable=False,
                    )
                self._record_success(route, (time.monotonic() - started) * 1000)
                if requested_model == "auto":
                    self._promote_route(route.id)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=False, attempt=attempt, route=route, status="success",
                    elapsed_ms=int((time.monotonic() - started) * 1000), usage=extract_usage(response),
                )
                return response
            except ProviderError as error:
                self._record_error(route, error)
                if error.safe_to_retry and requested_model == "auto":
                    self._demote_route(route.id)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=False, attempt=attempt, route=route, status="failed",
                    elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=error.kind,
                )
                if not (error.safe_to_retry and requested_model == "auto"):
                    raise
                errors.append(error)
            except Exception as error:
                protocol_error = ProviderError("provider_protocol_error", 502, str(error), retriable=False)
                self._record_error(route, protocol_error)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=False, attempt=attempt, route=route, status="failed",
                    elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=protocol_error.kind,
                )
                raise protocol_error from error
        raise ProviderError("all_providers_failed", 503, "; ".join(str(error) for error in errors), retriable=False)

    async def stream(
        self,
        payload: dict,
        usage_context: Mapping[str, str] | None = None,
    ) -> AsyncIterator[bytes]:
        usage_context = dict(usage_context or {})
        requested_model = payload.get("model", "auto")
        capability = infer_capability(payload)
        request_id = str(usage_context.pop("request_id", "") or uuid4().hex)
        candidates = self._candidates(requested_model, capability)
        if not candidates:
            self._log_connection(
                    usage_context=usage_context,
                request_id=request_id, requested_model=requested_model, capability=capability,
                stream=True, attempt=0, route=None, status="failed", elapsed_ms=0,
                error_kind="no_available_model",
            )
            raise ProviderError("no_available_model", 503, "no eligible model route", retriable=False)
        errors: list[ProviderError] = []
        for attempt, route in enumerate(candidates, 1):
            adapter = self.adapters.get(route.id)
            if adapter is None or not hasattr(adapter, "stream"):
                error = ProviderError("stream_not_supported", 501, route.id, retriable=False, safe_to_retry=True)
                errors.append(error)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=True, attempt=attempt, route=route, status="failed", elapsed_ms=0,
                    error_kind=error.kind,
                )
                continue
            request = request_for_route(payload, route)
            emitted = False
            usage = None
            started = time.monotonic()
            try:
                async for chunk in adapter.stream(request):
                    emitted = True
                    usage = extract_stream_usage(chunk) or usage
                    yield chunk
                if not emitted:
                    raise ProviderError(
                        "empty_output",
                        502,
                        "provider returned an empty stream",
                        retriable=False,
                    )
                elapsed_ms = int((time.monotonic() - started) * 1000)
                self._record_success(route, elapsed_ms)
                if requested_model == "auto":
                    self._promote_route(route.id)
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=True, attempt=attempt, route=route, status="success",
                    elapsed_ms=elapsed_ms, usage=usage,
                )
                return
            except ProviderError as error:
                self._record_error(route, error)
                if error.safe_to_retry and requested_model == "auto":
                    self._demote_route(route.id)
                if emitted:
                    self._log_connection(
                    usage_context=usage_context,
                        request_id=request_id, requested_model=requested_model, capability=capability,
                        stream=True, attempt=attempt, route=route, status="failed",
                        elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=error.kind,
                        usage=usage,
                    )
                    raise
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=True, attempt=attempt, route=route, status="failed",
                    elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=error.kind,
                    usage=usage,
                )
                if not (error.safe_to_retry and requested_model == "auto"):
                    raise
                errors.append(error)
            except Exception as error:
                protocol_error = ProviderError("provider_protocol_error", 502, str(error), retriable=False)
                self._record_error(route, protocol_error)
                if emitted:
                    self._log_connection(
                    usage_context=usage_context,
                        request_id=request_id, requested_model=requested_model, capability=capability,
                        stream=True, attempt=attempt, route=route, status="failed",
                        elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=protocol_error.kind,
                        usage=usage,
                    )
                    raise protocol_error from error
                self._log_connection(
                    usage_context=usage_context,
                    request_id=request_id, requested_model=requested_model, capability=capability,
                    stream=True, attempt=attempt, route=route, status="failed",
                    elapsed_ms=int((time.monotonic() - started) * 1000), error_kind=protocol_error.kind,
                    usage=usage,
                )
                raise protocol_error from error
        raise ProviderError("all_providers_failed", 503, "; ".join(str(error) for error in errors), retriable=False)

    def candidates(self, requested_model: str, capability: str) -> list[ModelRoute]:
        return self._candidates(requested_model, capability)

    def _candidates(self, requested_model: str, capability: str) -> list[ModelRoute]:
        now = time.monotonic()
        eligible = [
            replace(route, health=effective_status(self.health_states[route.id], now))
            for route in self.routes
            if is_eligible(self.health_states[route.id], now)
        ]
        return select_candidates(eligible, requested_model, capability)

    def _record_success(self, route: ModelRoute, total_ms: float, source: str = "traffic") -> None:
        state = self.health_states[route.id]
        self.health_states[route.id] = record_probe(
            state,
            ProbeResult(ok=True, total_ms=int(total_ms), probe=source == "probe"),
            time.monotonic(), self.policies.get(route.id, RoutePolicy()),
        )
        self._sync_route_health(route.id)

    def _record_error(self, route: ModelRoute, error: ProviderError, source: str = "traffic") -> None:
        state = self.health_states[route.id]
        self.health_states[route.id] = record_probe(
            state,
            ProbeResult(
                ok=False,
                error_kind=error.kind,
                error_detail=(
                    error.detail
                    if error.kind in {"empty_output", "provider_protocol_error"}
                    and error.detail.startswith("completion_shape:")
                    else None
                ),
                error_retryable=error.retriable,
                rate_limited=error.kind == "rate_limit",
                is_quota=error.kind == "quota_exhausted",
                is_transient=error.retriable,
                retry_after=error.retry_after,
                probe=source == "probe" or error.kind == "invalid_request",
            ),
            time.monotonic(), self.policies.get(route.id, RoutePolicy()),
        )
        if error.kind == "authentication_error":
            # A bad credential is deterministic. Disable only this route so
            # aggregate requests can continue with another provider/model.
            self.health_states[route.id] = replace(
                self.health_states[route.id],
                status=HealthStatus.DISABLED,
                cooldown_until=None,
            )
            self.routes = [
                replace(item, enabled=False, health=HealthStatus.DISABLED)
                if item.id == route.id else item
                for item in self.routes
            ]
            if self.on_route_changed is not None:
                self.on_route_changed(self.route(route.id))
            return
        self._sync_route_health(route.id)

    def _sync_route_health(self, route_id: str) -> None:
        status = self.health_states[route_id].status
        self.routes = [replace(route, health=status) if route.id == route_id else route for route in self.routes]

    def _promote_route(self, route_id: str) -> None:
        self._move_route(route_id, front=True)

    def _demote_route(self, route_id: str) -> None:
        self._move_route(route_id, front=False)

    def _move_route(self, route_id: str, *, front: bool) -> None:
        ordered = sorted(self.routes, key=lambda route: (route.priority, route.id))
        selected = next((route for route in ordered if route.id == route_id), None)
        if selected is None:
            return
        remaining = [route for route in ordered if route.id != route_id]
        target = [selected, *remaining] if front else [*remaining, selected]
        if [route.id for route in target] == [route.id for route in ordered]:
            return
        previous_priorities = {route.id: route.priority for route in self.routes}
        self.routes = [replace(route, priority=index) for index, route in enumerate(target, 1)]
        if self.on_route_changed is not None:
            for route in self.routes:
                if previous_priorities.get(route.id) != route.priority:
                    self.on_route_changed(route)

    def _log_connection(
        self,
        *,
        request_id: str,
        requested_model: str,
        capability: str,
        stream: bool,
        attempt: int,
        route: ModelRoute | None,
        status: str,
        elapsed_ms: int,
        error_kind: str | None = None,
        usage: dict | None = None,
        usage_context: Mapping[str, str] | None = None,
    ) -> None:
        if self.on_connection_logged is None:
            return
        identity = dict(usage_context or {})
        usage_source = "provider" if isinstance(usage, dict) and usage else "unknown"
        estimated_usage = identity.get("usage_estimate")
        definitely_rejected = {
            "authentication_error",
            "permission_error",
            "rate_limit",
            "quota_exhausted",
            "invalid_request",
            "model_unavailable",
        }
        if (
            usage is None
            and isinstance(estimated_usage, dict)
            and estimated_usage.get("source") in {"estimated", "estimated_partial"}
            and (status == "success" or error_kind not in definitely_rejected)
        ):
            usage = {
                key: estimated_usage[key]
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                if isinstance(estimated_usage.get(key), int)
            }
            usage_source = str(estimated_usage["source"])
        entry = {
            "request_id": request_id,
            "tenant_id": identity.get("tenant_id") or "system",
            "application_id": identity.get("application_id") or "legacy-global",
            "requested_model": requested_model,
            "capability": capability,
            "stream": stream,
            "attempt": attempt,
            "route_id": route.id if route else None,
            "provider_id": route.provider_id if route else None,
            "remote_model": route.remote_model if route else None,
            "status": status,
            "elapsed_ms": elapsed_ms,
            "usage": usage,
            "usage_source": usage_source,
        }
        if error_kind:
            entry["error_kind"] = error_kind
        try:
            self.on_connection_logged(entry)
        except Exception:
            # Diagnostics must never break a user request.
            return


def infer_capability(payload: dict) -> str:
    if payload.get("task") == "image_generation":
        return "image_generation"
    if _contains_image(payload.get("messages", [])):
        return "vision"
    estimated_tokens = len(str(payload.get("messages", ""))) // 4
    if estimated_tokens > 8192:
        return "long_context"
    return "chat"


def request_for_route(payload: dict, route: ModelRoute) -> dict:
    request = dict(payload)
    request["model"] = route.remote_model
    if "reasoning_effort" not in request and route.reasoning_effort is not None:
        request["reasoning_effort"] = route.reasoning_effort
    return request


def is_usable_completion(response: object, capability: str = "chat") -> bool:
    """Return whether an upstream response contains a usable result."""
    if not isinstance(response, dict):
        return False
    if capability == "image_generation":
        if response.get("error"):
            return False
        data = response.get("data")
        return isinstance(data, list) and any(
            isinstance(item, dict)
            and (
                isinstance(item.get("url"), str) and bool(item["url"].strip())
                or isinstance(item.get("b64_json"), str) and bool(item["b64_json"].strip())
            )
            for item in data
        )
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        return False
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        text = choice.get("text")
        if isinstance(text, str) and text.strip():
            return True
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return True
        if isinstance(content, list) and any(
            isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip()
            for part in content
        ):
            return True
        if message.get("tool_calls") or message.get("function_call"):
            return True
    return False


def is_probe_completion(response: object) -> bool:
    """Return whether a response has an OpenAI-style completion envelope.

    This checks protocol shape only. Chat probes also call
    ``is_usable_completion`` so an empty assistant message cannot be reported
    as a chat-ready model.
    """
    if not isinstance(response, dict) or response.get("error"):
        return False
    choices = response.get("choices")
    if not isinstance(choices, list):
        return False
    return any(
        isinstance(choice, dict)
        and (
            isinstance(choice.get("text"), str)
            or isinstance(choice.get("message"), dict)
            or "finish_reason" in choice
        )
        for choice in choices
    )


def completion_shape_diagnostic(response: object) -> str:
    """Describe an unusable response without retaining prompt or output text."""
    choices = response.get("choices") if isinstance(response, dict) else None
    choices = choices if isinstance(choices, list) else []
    choice = next((item for item in choices if isinstance(item, dict)), {})
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    content = message.get("content", choice.get("text"))
    if isinstance(content, str):
        content_type = "string"
    elif isinstance(content, list):
        content_type = "array"
    elif content is None:
        content_type = "null" if "content" in message else "absent"
    else:
        content_type = "other"

    reasoning = message.get("reasoning_content", message.get("reasoning"))
    reasoning_chars = len(reasoning) if isinstance(reasoning, str) else 0
    message_keys = [
        key for key in ("content", "reasoning_content", "reasoning", "tool_calls", "function_call")
        if key in message
    ]
    tool_calls = message.get("tool_calls")
    tool_call_count = len(tool_calls) if isinstance(tool_calls, list) else 0
    finish_reason = choice.get("finish_reason")
    allowed_finish_reasons = {"stop", "length", "tool_calls", "function_call", "content_filter"}
    finish_reason = (
        finish_reason
        if isinstance(finish_reason, str) and finish_reason in allowed_finish_reasons
        else "other"
    )
    usage = response.get("usage") if isinstance(response, dict) else None
    completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
    if not isinstance(completion_tokens, int) or isinstance(completion_tokens, bool):
        completion_tokens = "unknown"
    return (
        "completion_shape: "
        f"choices={len(choices)}; message_keys={','.join(message_keys) or 'none'}; "
        f"content_type={content_type}; content_chars={len(extract_output_text(response)) if isinstance(response, dict) else 0}; "
        f"reasoning_chars={reasoning_chars}; tool_calls={tool_call_count}; "
        f"finish_reason={finish_reason}; completion_tokens={completion_tokens}"
    )


def extract_usage(response: object) -> dict | None:
    if not isinstance(response, dict):
        return None
    return _normalize_usage(response.get("usage"))


def extract_stream_usage(chunk: bytes) -> dict | None:
    try:
        text = chunk.decode("utf-8")
    except UnicodeDecodeError:
        return None
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            import json
            parsed = json.loads(data)
        except (TypeError, ValueError):
            continue
        usage = _normalize_usage(parsed.get("usage") if isinstance(parsed, dict) else None)
        if usage:
            return usage
    return None


def _normalize_usage(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    keys = ("prompt_tokens", "completion_tokens", "total_tokens")
    usage = {key: value[key] for key in keys if isinstance(value.get(key), int)}
    return usage or None


def _contains_image(value) -> bool:
    if isinstance(value, dict):
        if value.get("type") in {"image_url", "input_image"}:
            return True
        return any(_contains_image(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_image(item) for item in value)
    return False
