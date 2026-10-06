"""Run a real HTTP client call through an isolated Gateway instance."""

from __future__ import annotations

import json
import multiprocessing
import socket
import sys
import tempfile
import time
from pathlib import Path

import httpx
import uvicorn

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from freellm_gateway.api import create_app
from freellm_gateway.db import Database
from freellm_gateway.models import ModelRoute, Provider
from freellm_gateway.repository import Repository
from freellm_gateway.service import ModelGateway


class DeterministicProviderAdapter:
    async def complete(self, payload: dict) -> dict:
        return {
            "id": "chatcmpl-local-client-test",
            "object": "chat.completion",
            "model": payload["model"],
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "local Gateway HTTP call: ok"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12},
        }


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _serve_gateway(database_path: str, port: int, admin_token: str) -> None:
    repository = Repository(Database(database_path))
    repository.initialize()
    routes = repository.list_routes()
    gateway = ModelGateway(
        routes,
        {route.id: DeterministicProviderAdapter() for route in routes},
    )
    app = create_app(
        gateway=gateway,
        repository=repository,
        api_token="unused-global-token",
        admin_token=admin_token,
    )
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def _wait_until_ready(base_url: str) -> None:
    deadline = time.monotonic() + 20
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=1)
            if response.status_code == 200:
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Gateway did not become ready: {last_error}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="lyra-gateway-client-call-") as temp_dir:
        database_path = str(Path(temp_dir) / "gateway.sqlite")
        repository = Repository(Database(database_path))
        repository.initialize()
        repository.save_provider(
            Provider(
                id="local-test-provider",
                name="Deterministic Test Provider",
                protocol="openai",
                base_url="https://provider-not-called.invalid/v1",
                official_url="https://provider-not-called.invalid",
            )
        )
        repository.save_route(
            ModelRoute(
                id="local-test-route",
                provider_id="local-test-provider",
                remote_model="local-test-model",
                priority=1,
            )
        )
        repository.create_tenant("local-test-tenant", "Local API Test")
        application, application_key = repository.create_application(
            "client-simulator",
            "local-test-tenant",
            "Simulated API Client",
        )

        port = _free_port()
        base_url = f"http://127.0.0.1:{port}"
        admin_token = "local-test-admin-token"
        process = multiprocessing.Process(
            target=_serve_gateway,
            args=(database_path, port, admin_token),
            daemon=True,
        )
        process.start()
        try:
            _wait_until_ready(base_url)
            response = httpx.post(
                f"{base_url}/v1/chat/completions",
                headers={"X-Free-LLM-Token": application_key},
                json={
                    "model": "auto",
                    "messages": [{"role": "user", "content": "Return the local test acknowledgement."}],
                },
                timeout=10,
            )
            response.raise_for_status()
            body = response.json()
            request_id = response.headers.get("x-request-id")
            if body["choices"][0]["message"]["content"] != "local Gateway HTTP call: ok":
                raise AssertionError("unexpected completion content")
            if body.get("usage", {}).get("total_tokens") != 12:
                raise AssertionError("completion usage was not returned")
            if not request_id:
                raise AssertionError("Gateway did not return X-Request-ID")

            rejected = httpx.post(
                f"{base_url}/v1/chat/completions",
                headers={"X-Free-LLM-Token": "invalid-local-test-key"},
                json={
                    "model": "auto",
                    "messages": [{"role": "user", "content": "This must be rejected."}],
                },
                timeout=10,
            )
            if rejected.status_code != 401:
                raise AssertionError(f"invalid application key returned {rejected.status_code}, expected 401")

            usage_response = httpx.get(
                f"{base_url}/api/admin/usage",
                params={"application_id": application.id, "days": 1},
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=10,
            )
            usage_response.raise_for_status()
            usage = usage_response.json()["data"]

            connections_response = httpx.get(
                f"{base_url}/api/admin/connections",
                params={"limit": 20},
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=10,
            )
            connections_response.raise_for_status()
            records = connections_response.json()["data"]
            logged = next(
                (
                    item
                    for item in records
                    if item.get("application_id") == application.id
                    and item.get("request_id") == request_id
                    and item.get("status") == "success"
                ),
                None,
            )

            if usage["calls"] != 1 or usage["total_tokens"] != 12:
                raise AssertionError(f"unexpected application usage: {usage}")
            if logged is None or logged.get("route_id") != "local-test-route":
                raise AssertionError("HTTP request could not be correlated with its Gateway route log")

            print(
                json.dumps(
                    {
                        "http_call": "passed",
                        "application_id": application.id,
                        "model": body["model"],
                        "route_id": logged["route_id"],
                        "request_id_correlated": True,
                        "usage_calls": usage["calls"],
                        "total_tokens": usage["total_tokens"],
                        "invalid_key_status": rejected.status_code,
                        "provider_called": False,
                    },
                    sort_keys=True,
                )
            )
        finally:
            process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()
                process.join(timeout=5)


if __name__ == "__main__":
    main()
