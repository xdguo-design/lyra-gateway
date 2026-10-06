"""Probe configured FreeLLM models through a running Lyra Gateway instance.

This script is intended for an isolated CI runner. Credentials are read from
environment variables and are never included in the printed report.
"""

from __future__ import annotations

import os
import shlex
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


@dataclass(frozen=True)
class ModelTarget:
    config_env: str
    key_env: str
    default_config: str | None = None
    optional: bool = False


TARGETS = (
    ModelTarget("FREELLM_TEST_ATRIA_CONFIG", "FREELLM_TEST_ATRIA_KEY"),
    ModelTarget("FREELLM_TEST_DEEPSEEKV4FLASH_CONFIG", "FREELLM_TEST_SENSENOVA_KEY"),
    ModelTarget("FREELLM_TEST_GLM52_CONFIG", "FREELLM_TEST_SENSENOVA_KEY"),
    ModelTarget("FREELLM_TEST_KIMIK3_CONFIG", "FREELLM_TEST_SENSENOVA_KEY"),
    ModelTarget("FREELLM_TEST_SENSENOVA68FLASHLITE_CONFIG", "FREELLM_TEST_SENSENOVA_KEY"),
    ModelTarget(
        "FREELLM_TEST_DEEPSEEK_CONFIG",
        "FREELLM_TEST_DEEPSEEK_KEY",
        "NOVEL_AI_KIND=openai-compatible NOVEL_AI_MODEL=deepseek-flash "
        "NOVEL_AI_BASE_URL=https://api.deepseek.com NOVEL_AI_API_KEY_ENV=DEEPSEEK",
        optional=True,
    ),
)


def parse_config(raw: str, env_name: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for field in shlex.split(raw):
        if "=" not in field:
            raise ValueError(f"{env_name} contains a malformed config field")
        key, value = field.split("=", 1)
        if key in result or not value:
            raise ValueError(f"{env_name} contains an empty or duplicate config field")
        result[key] = value

    required = {"NOVEL_AI_KIND", "NOVEL_AI_MODEL", "NOVEL_AI_BASE_URL", "NOVEL_AI_API_KEY_ENV"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"{env_name} is missing required fields: {', '.join(sorted(missing))}")
    if result["NOVEL_AI_KIND"] != "openai-compatible":
        raise ValueError(f"{env_name} provider kind is not openai-compatible")
    parsed_url = urlparse(result["NOVEL_AI_BASE_URL"])
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise ValueError(f"{env_name} has an invalid HTTPS base URL")
    return result


def build_connections() -> tuple[list[dict], list[tuple[str, str]]]:
    connections = []
    targets = []
    for target in TARGETS:
        raw_config = os.getenv(target.config_env, "").strip()
        credential = os.getenv(target.key_env, "").strip()
        if not raw_config:
            raw_config = target.default_config or ""
        if target.optional and not credential:
            parsed = parse_config(raw_config, target.config_env)
            print(
                f"SKIP provider=deepseek model={parsed['NOVEL_AI_MODEL']} "
                f"reason=GitHub Actions secret {target.key_env} is not configured"
            )
            continue
        if not raw_config:
            raise ValueError(f"GitHub Actions variable for {target.config_env} is missing")
        if not credential:
            raise ValueError(f"GitHub Actions secret for {target.key_env} is missing")

        config = parse_config(raw_config, target.config_env)
        remote_model = config["NOVEL_AI_MODEL"]
        base_url = config["NOVEL_AI_BASE_URL"].rstrip("/")
        hostname = urlparse(base_url).hostname or ""
        if hostname.endswith("atria-asi.ai"):
            provider_id, provider_name = "atria", "Atria"
        elif hostname.endswith("sensenova.cn"):
            provider_id, provider_name = "sensenova", "SenseNova"
        elif hostname == "api.deepseek.com":
            provider_id, provider_name = "deepseek", "DeepSeek"
        else:
            raise ValueError(f"{target.config_env} uses an unsupported provider host")
        connections.append(
            {
                "provider": {
                    "id": provider_id,
                    "name": provider_name,
                    "protocol": "openai",
                    "base_url": base_url,
                    "official_url": f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}",
                },
                "models": [{"remote_model": remote_model, "enabled": True}],
                "credential": credential,
                "display_name": f"{provider_name} CI probe",
                "catalog_status": "draft",
                "capabilities": ["chat"],
            }
        )
        targets.append((provider_id, remote_model))

    # Put a deliberately invalid credential ahead of the real routes. The
    # aggregate `auto` request must mark it unusable and continue to a working
    # provider, proving gateway failover rather than only direct model calls.
    atria_provider = connections[0]["provider"]
    atria_model = targets[0][1]
    connections.insert(
        0,
        {
            "provider": {
                **atria_provider,
                "id": "probe-invalid-credential",
                "name": "Intentional authentication failure (CI only)",
            },
            "models": [{"remote_model": atria_model, "enabled": True, "priority": 1}],
            "credential": "intentionally-invalid-ci-probe-credential",
            "display_name": "Intentional CI failover trigger",
            "catalog_status": "draft",
            "capabilities": ["chat"],
        },
    )
    return connections, targets


def main() -> int:
    base_url = os.getenv("FREELLM_TEST_GATEWAY_URL", "http://127.0.0.1:18770").rstrip("/")
    admin_token = os.getenv("FREELLM_TEST_ADMIN_TOKEN") or os.environ["FREELLM_GATEWAY_ADMIN_TOKEN"]
    client_token = os.getenv("FREELLM_TEST_CLIENT_TOKEN") or os.environ["FREELLM_GATEWAY_API_TOKEN"]
    headers_admin = {"Authorization": f"Bearer {admin_token}"}
    headers_client = {"Authorization": f"Bearer {client_token}"}

    try:
        connections, targets = build_connections()
    except (KeyError, ValueError) as error:
        print(f"CONFIGURATION_ERROR: {error}", file=sys.stderr)
        return 2

    timeout = httpx.Timeout(45.0, connect=10.0)
    results = []
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{base_url}/api/admin/routes/bulk-connections",
            headers=headers_admin,
            json={"connections": connections},
        )
        if response.is_error:
            print(f"GATEWAY_IMPORT_ERROR: HTTP {response.status_code}", file=sys.stderr)
            return 2
        import_data = response.json().get("data", {})
        failed_imports = import_data.get("failed", [])
        if failed_imports:
            for failure in failed_imports:
                print(
                    f"IMPORT_FAILED provider={failure.get('provider_id', 'unknown')} "
                    f"category={failure.get('error_type', 'unknown')}"
                )
            return 2

        for provider_id, remote_model in targets:
            started = time.monotonic()
            try:
                response = client.post(
                    f"{base_url}/v1/chat/completions",
                    headers=headers_client,
                    json={
                        "model": remote_model,
                        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                        "max_tokens": 16,
                        "temperature": 0,
                    },
                )
                elapsed_ms = int((time.monotonic() - started) * 1000)
                if response.is_error:
                    try:
                        payload = response.json()
                        detail = payload.get("detail", {})
                        category = detail if isinstance(detail, str) else detail.get("error", "http_error")
                    except (ValueError, AttributeError):
                        category = "http_error"
                    results.append((provider_id, remote_model, False, elapsed_ms, f"HTTP {response.status_code} {category}"))
                    continue

                payload = response.json()
                choices = payload.get("choices")
                content = choices[0].get("message", {}).get("content") if choices else None
                if not isinstance(content, str) or not content.strip():
                    results.append((provider_id, remote_model, False, elapsed_ms, "invalid_completion_shape"))
                else:
                    results.append((provider_id, remote_model, True, elapsed_ms, "ok"))
            except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                # Exception text can contain request details, so report only the class.
                results.append((provider_id, remote_model, False, elapsed_ms, type(error).__name__))

    for provider_id, model, ok, elapsed_ms, outcome in results:
        print(
            f"{'PASS' if ok else 'FAIL'} provider={provider_id} model={model} "
            f"elapsed_ms={elapsed_ms} result={outcome}"
        )
    passed = sum(1 for result in results if result[2])

    started = time.monotonic()
    failover_ok = False
    failover_outcome = "unknown"
    failover_client = httpx.Client(timeout=timeout)
    try:
        response = failover_client.post(
            f"{base_url}/v1/chat/completions",
            headers=headers_client,
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "max_tokens": 16,
                "temperature": 0,
            },
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if response.is_error:
            failover_outcome = f"HTTP {response.status_code}"
        else:
            routes_response = failover_client.get(
                f"{base_url}/api/admin/routes",
                headers=headers_admin,
            )
            routes_response.raise_for_status()
            invalid_route = next(
                route
                for route in routes_response.json().get("data", [])
                if route.get("provider_id") == "probe-invalid-credential"
            )
            payload = response.json()
            choices = payload.get("choices")
            content = choices[0].get("message", {}).get("content") if choices else None
            failover_ok = isinstance(content, str) and bool(content.strip()) and (
                not invalid_route.get("enabled") or invalid_route.get("health") != "healthy"
            )
            failover_outcome = "failed_route_skipped" if failover_ok else "failed_route_not_demoted"
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, StopIteration) as error:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        failover_outcome = type(error).__name__
    finally:
        failover_client.close()

    print(
        f"{'PASS' if failover_ok else 'FAIL'} provider=auto model=auto "
        f"elapsed_ms={elapsed_ms} result={failover_outcome}"
    )
    print(
        f"SUMMARY: {passed}/{len(results)} direct model calls succeeded; "
        f"automatic failover={'passed' if failover_ok else 'failed'}"
    )
    return 0 if passed == len(targets) and failover_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
