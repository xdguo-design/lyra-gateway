import json

from fastapi.testclient import TestClient

import freellm_gateway.fnos_manager as manager


class FakeDocker:
    def __init__(self):
        self.restarted = []

    def list_containers(self):
        return [{"State": "running"}, {"State": "exited"}]

    def inspect(self, container):
        return {
            "State": {"Status": "running", "Health": {"Status": "healthy"}, "StartedAt": "now"},
            "Config": {"Image": "example:latest"},
            "RestartCount": 1,
        }

    def logs(self, container, *, tail, since_seconds):
        return "OPENAI_API_KEY=secret\nAuthorization: Bearer abc123\nnormal line"

    def restart(self, container):
        self.restarted.append(container)


def make_client(tmp_path, monkeypatch):
    services = {
        "services": {
            "openclaw": {"container": "trim-openclaw", "allow_logs": True, "allow_restart": True},
            "postgres": {"container": "gateway-postgres", "allow_logs": True, "allow_restart": False},
        }
    }
    path = tmp_path / "services.json"
    path.write_text(json.dumps(services), encoding="utf-8")
    fake = FakeDocker()
    monkeypatch.setattr(manager, "SERVICES_FILE", path)
    monkeypatch.setattr(manager, "TOKEN", "test-token")
    monkeypatch.setattr(manager, "_docker", lambda: fake)
    manager.app.dependency_overrides[manager._docker] = lambda: fake
    return TestClient(manager.app), fake


def auth():
    return {"Authorization": "Bearer test-token"}


def test_health_is_public(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    assert client.get("/health").json() == {"status": "ok"}


def test_api_requires_token(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/api/v1/containers")
    assert response.status_code == 401


def test_unknown_service_is_blocked(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/api/v1/containers/not-approved", headers=auth())
    assert response.status_code == 404


def test_logs_are_redacted(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/api/v1/containers/openclaw/logs", headers=auth())
    assert response.status_code == 200
    body = response.json()["logs"]
    assert "secret" not in body
    assert "abc123" not in body
    assert "[REDACTED]" in body


def test_restart_respects_whitelist_permission(tmp_path, monkeypatch):
    client, fake = make_client(tmp_path, monkeypatch)
    denied = client.post("/api/v1/containers/postgres/restart", headers=auth(), json={"reason": "test"})
    assert denied.status_code == 403

    allowed = client.post("/api/v1/containers/openclaw/restart", headers=auth(), json={"reason": "test"})
    assert allowed.status_code == 200
    assert fake.restarted == ["trim-openclaw"]


def test_log_window_is_limited(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/api/v1/containers/openclaw/logs?since=25h", headers=auth())
    assert response.status_code == 422
