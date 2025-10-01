"""FastAPI application for the wallpaper generator."""
from __future__ import annotations

import base64
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings, get_settings
from .shaders import SHADER_VARIANTS
from .telemetry import TelemetryEvent, TelemetryStore


FAVICON_BYTES = base64.b64decode(
    (
        "AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAADikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQ"
        "Sv/ikEr/4pBK/+KQSv/ikEr/4pBK/+KQSv/ikEr/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
    )
)


def _ensure_static_root(path: Path) -> Path:
    """Validate that the static directory exists."""

    if not path.exists():
        raise RuntimeError(f"Static directory '{path}' does not exist")
    return path


def _create_lifespan(settings: Settings):
    """Create an application lifespan manager bound to the provided settings."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.telemetry_store = TelemetryStore(
            max_events=settings.telemetry_max_events,
            rate_limit_seconds=settings.telemetry_rate_limit_seconds,
        )
        yield

    return lifespan


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    """Instantiate the FastAPI application with the given settings."""

    settings = settings or get_settings()
    static_root = _ensure_static_root(Path(settings.static_dir))

    app = FastAPI(
        title="Minimal Wallpaper Generator",
        version="0.1.0",
        lifespan=_create_lifespan(settings),
    )
    app.state.settings = settings
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.mount("/static", StaticFiles(directory=str(static_root), html=True), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index(current_settings: Settings = Depends(get_settings)) -> Response:
        index_path = Path(current_settings.static_dir) / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="Index not found")
        return FileResponse(index_path)

    @app.get("/api/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok"}

    @app.get("/api/presets")
    async def presets(current_settings: Settings = Depends(get_settings)) -> Response:
        presets_path = Path(current_settings.static_dir) / "presets.json"
        if not presets_path.exists():
            raise HTTPException(status_code=404, detail="Presets not found")
        data = json.loads(presets_path.read_text("utf-8"))
        if not isinstance(data, list):  # pragma: no cover - defensive guard
            raise HTTPException(status_code=500, detail="Invalid presets format")
        return JSONResponse(content=data)

    @app.get("/service-worker.js", response_class=FileResponse)
    async def service_worker(current_settings: Settings = Depends(get_settings)) -> Response:
        sw_path = Path(current_settings.static_dir) / "service-worker.js"
        if not sw_path.exists():
            raise HTTPException(status_code=404, detail="Service worker not found")
        return FileResponse(sw_path, media_type="application/javascript")

    @app.get("/favicon.ico")
    async def favicon() -> Response:
        return Response(content=FAVICON_BYTES, media_type="image/x-icon")

    @app.get("/api/shaders")
    async def shaders() -> Response:
        return JSONResponse(content=SHADER_VARIANTS)

    @app.post("/api/telemetry")
    async def telemetry(request: Request, current_settings: Settings = Depends(get_settings)) -> Dict[str, Any]:
        if not current_settings.enable_telemetry:
            raise HTTPException(status_code=404, detail="Telemetry disabled")
        payload = await request.json()
        try:
            event = TelemetryEvent(**payload)
        except Exception as exc:  # pragma: no cover - FastAPI handles detail
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        client_ip = request.client.host if request.client else "unknown"
        store: TelemetryStore = app.state.telemetry_store
        accepted = store.record(event, client_ip)
        if not accepted:
            return {"accepted": False, "reason": "rate_limited"}
        return {"accepted": True}

    return app


app = create_app()
