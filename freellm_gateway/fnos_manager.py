from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel

DOCKER_SOCKET = os.getenv("FNOS_MANAGER_DOCKER_SOCKET", "/var/run/docker.sock")
SERVICES_FILE = Path(os.getenv("FNOS_MANAGER_SERVICES_FILE", "/etc/fnos-manager/services.json"))
AUDIT_FILE = Path(os.getenv("FNOS_MANAGER_AUDIT_FILE", "/var/log/fnos-manager/audit.log"))
TOKEN = os.getenv("FNOS_MANAGER_TOKEN", "")
MAX_LOG_TAIL = 1000
MAX_SINCE_SECONDS = 24 * 60 * 60

_SECRET_PATTERNS = [
    re.compile(r"(?i)(authorization:\s*bearer\s+)[^\s]+"),
    re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY)[A-Z0-9_]*)=([^\s]+)"),
]


class RestartRequest(BaseModel):
    reason: str = ""


class DockerClient:
    def __init__(self, socket_path: str = DOCKER_SOCKET) -> None:
        self._client = httpx.Client(
            transport=httpx.HTTPTransport(uds=socket_path),
            base_url="http://docker",
            timeout=15.0,
        )

    def list_containers(self) -> list[dict[str, Any]]:
        response = self._client.get("/containers/json", params={"all": "true"})
        response.raise_for_status()
        return response.json()

    def inspect(self, container: str) -> dict[str, Any]:
        response = self._client.get(f"/containers/{container}/json")
        response.raise_for_status()
        return response.json()

    def logs(self, container: str, *, tail: int, since_seconds: int) -> str:
        params = {"stdout": "true", "stderr": "true", "timestamps": "true", "tail": str(tail)}
        if since_seconds:
            params["since"] = str(max(0, int(time.time()) - since_seconds))
        response = self._client.get(f"/containers/{container}/logs", params=params)
        response.raise_for_status()
        return response.text

    def restart(self, container: str) -> None:
        response = self._client.post(f"/containers/{container}/restart", params={"t": "10"})
        response.raise_for_status()


def _load_services() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(SERVICES_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="service whitelist is not configured") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="service whitelist is invalid") from exc
    services = data.get("services")
    if not isinstance(services, dict):
        raise HTTPException(status_code=503, detail="service whitelist is invalid")
    return services


def _authorize(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="FNOS_MANAGER_TOKEN is not configured")
    prefix = "Bearer "
    supplied = authorization[len(prefix):] if authorization and authorization.startswith(prefix) else ""
    if not supplied or not secrets.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


def _service_config(service: str) -> dict[str, Any]:
    config = _load_services().get(service)
    if not isinstance(config, dict):
        raise HTTPException(status_code=404, detail="service is not approved")
    container = config.get("container")
    if not isinstance(container, str) or not container:
        raise HTTPException(status_code=503, detail="approved service configuration is invalid")
    return config


def _docker() -> DockerClient:
    return DockerClient()


def _redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        if "authorization" in pattern.pattern.lower():
            text = pattern.sub(r"\1[REDACTED]", text)
        else:
            text = pattern.sub(r"\1=[REDACTED]", text)
    return text


def _parse_since(value: str) -> int:
    value = value.strip().lower()
    if value == "0":
        return 0
    match = re.fullmatch(r"(\d+)([smh])", value)
    if not match:
        raise HTTPException(status_code=422, detail="since must look like 30s, 10m, or 2h")
    amount = int(match.group(1))
    factor = {"s": 1, "m": 60, "h": 3600}[match.group(2)]
    seconds = amount * factor
    if seconds > MAX_SINCE_SECONDS:
        raise HTTPException(status_code=422, detail="since may not exceed 24h")
    return seconds


def _audit(action: str, service: str, reason: str, success: bool, detail: str = "") -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "service": service,
        "reason": reason[:500],
        "success": success,
        "detail": detail[:500],
    }
    try:
        AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _memory_status() -> dict[str, Any]:
    values: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0]) * 1024
    except (OSError, ValueError):
        return {}
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    used = max(0, total - available)
    return {
        "total_bytes": total,
        "used_bytes": used,
        "usage_percent": round((used / total * 100), 1) if total else None,
    }


def _uptime() -> float | None:
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _system_status(client: DockerClient) -> dict[str, Any]:
    try:
        load = os.getloadavg()
    except (AttributeError, OSError):
        load = (None, None, None)
    disk = shutil.disk_usage("/")
    containers = client.list_containers()
    running = sum(1 for item in containers if item.get("State") == "running")
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "uptime_seconds": _uptime(),
        "load": {"1m": load[0], "5m": load[1], "15m": load[2]},
        "memory": _memory_status(),
        "disk": {
            "mount": "/",
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "usage_percent": round(disk.used / disk.total * 100, 1) if disk.total else None,
        },
        "docker": {
            "total": len(containers),
            "running": running,
            "stopped": len(containers) - running,
        },
    }


app = FastAPI(title="fnOS Manager", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/system/status", dependencies=[Depends(_authorize)])
def system_status(client: DockerClient = Depends(_docker)) -> dict[str, Any]:
    try:
        return _system_status(client)
    except (httpx.HTTPError, OSError) as exc:
        raise HTTPException(status_code=503, detail="docker is unavailable") from exc


@app.get("/api/v1/containers", dependencies=[Depends(_authorize)])
def containers(client: DockerClient = Depends(_docker)) -> dict[str, Any]:
    approved = _load_services()
    output = []
    for name, config in approved.items():
        container = config["container"]
        try:
            info = client.inspect(container)
            state = info.get("State") or {}
            output.append({
                "name": name,
                "container": container,
                "status": state.get("Status", "unknown"),
                "health": (state.get("Health") or {}).get("Status"),
                "restart_allowed": bool(config.get("allow_restart", False)),
                "logs_allowed": bool(config.get("allow_logs", True)),
            })
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                output.append({"name": name, "container": container, "status": "missing"})
            else:
                raise HTTPException(status_code=503, detail="docker is unavailable") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="docker is unavailable") from exc
    return {"services": output}


@app.get("/api/v1/containers/{service}", dependencies=[Depends(_authorize)])
def container_detail(service: str, client: DockerClient = Depends(_docker)) -> dict[str, Any]:
    config = _service_config(service)
    try:
        info = client.inspect(config["container"])
    except httpx.HTTPStatusError as exc:
        status = 404 if exc.response.status_code == 404 else 503
        raise HTTPException(status_code=status, detail="container is unavailable") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="docker is unavailable") from exc
    state = info.get("State") or {}
    return {
        "name": service,
        "container": config["container"],
        "status": state.get("Status", "unknown"),
        "health": (state.get("Health") or {}).get("Status"),
        "started_at": state.get("StartedAt"),
        "restart_count": info.get("RestartCount", 0),
        "image": (info.get("Config") or {}).get("Image"),
        "restart_allowed": bool(config.get("allow_restart", False)),
    }


@app.get("/api/v1/containers/{service}/logs", dependencies=[Depends(_authorize)])
def container_logs(
    service: str,
    tail: int = Query(default=200, ge=1, le=MAX_LOG_TAIL),
    since: str = Query(default="10m"),
    client: DockerClient = Depends(_docker),
) -> dict[str, Any]:
    config = _service_config(service)
    if not config.get("allow_logs", True):
        raise HTTPException(status_code=403, detail="logs are not allowed for this service")
    seconds = _parse_since(since)
    try:
        logs = client.logs(config["container"], tail=tail, since_seconds=seconds)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="docker is unavailable") from exc
    return {"service": service, "tail": tail, "since": since, "logs": _redact(logs)}


@app.post("/api/v1/containers/{service}/restart", dependencies=[Depends(_authorize)])
def restart_container(
    service: str,
    request: RestartRequest,
    client: DockerClient = Depends(_docker),
) -> dict[str, Any]:
    config = _service_config(service)
    if not config.get("allow_restart", False):
        raise HTTPException(status_code=403, detail="restart is not allowed for this service")
    try:
        client.restart(config["container"])
    except httpx.HTTPError as exc:
        _audit("restart", service, request.reason, False, type(exc).__name__)
        raise HTTPException(status_code=503, detail="restart failed") from exc
    _audit("restart", service, request.reason, True)
    return {"success": True, "service": service, "status": "restarting"}
