import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def configure_settings(monkeypatch):
    monkeypatch.setenv("STATIC_DIR", "static")
    monkeypatch.setenv("ENABLE_TELEMETRY", "true")
    monkeypatch.setenv("TELEMETRY_RATE_LIMIT_SECONDS", "0.05")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def client():
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "<canvas" in response.text


def test_index_has_no_webgl_warning(client):
    response = client.get("/")
    assert "WebGL2 is unavailable" not in response.text


def test_presets_endpoint(client):
    response = client.get("/api/presets")
    assert response.status_code == 200
    presets = response.json()
    assert isinstance(presets, list)
    assert presets
    assert {"id", "name", "settings"} <= set(presets[0].keys())


def test_shader_catalog(client):
    response = client.get("/api/shaders")
    assert response.status_code == 200
    catalog = response.json()
    assert isinstance(catalog, list)
    assert catalog
    first = catalog[0]
    assert {"id", "name", "description", "default_strength"} <= set(first)
    strengths = [entry["default_strength"] for entry in catalog]
    assert all(0 <= value <= 1 for value in strengths)


def test_telemetry_rate_limiting(client):
    payload = {"category": "ui", "payload": {"action": "change"}}
    first = client.post("/api/telemetry", json=payload)
    assert first.status_code == 200
    assert first.json()["accepted"] is True
    second = client.post("/api/telemetry", json=payload)
    assert second.status_code == 200
    assert second.json()["accepted"] is False
    time.sleep(0.06)
    third = client.post("/api/telemetry", json=payload)
    assert third.status_code == 200
    assert third.json()["accepted"] is True


def test_telemetry_disabled(monkeypatch):
    monkeypatch.setenv("STATIC_DIR", "static")
    monkeypatch.setenv("ENABLE_TELEMETRY", "false")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as test_client:
        response = test_client.post("/api/telemetry", json={"category": "ui", "payload": {"action": "noop"}})
    get_settings.cache_clear()
    assert response.status_code == 404
    assert response.json()["detail"] == "Telemetry disabled"


def test_utils_exports_clamp():
    utils_path = Path("static/js/utils.js")
    assert utils_path.exists()
    content = utils_path.read_text("utf-8")
    assert "export function clamp" in content


def test_favicon_served(client):
    response = client.get("/favicon.ico")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/x-icon")
    assert len(response.content) > 0
