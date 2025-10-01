import time

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


def test_presets_endpoint(client):
    response = client.get("/api/presets")
    assert response.status_code == 200
    presets = response.json()
    assert isinstance(presets, list)
    assert presets
    assert {"id", "name", "settings"} <= set(presets[0].keys())


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
