# Minimal, Modular Wallpaper Generator

This repository contains a fully working implementation of the Minimal, Modular Wallpaper Generator. The application ships as a
static-first single-page experience backed by a lightweight FastAPI server. The front end relies on vanilla JavaScript with a
Canvas2D renderer to produce deterministic abstract wallpapers with customizable gradients, grain/noise, vignette, and export
options.

## Specification
The original product and technical specification that guided the implementation is available in
[docs/product-tech-spec.md](docs/product-tech-spec.md).

## Getting Started

### Prerequisites
- Python 3.11+
- Node tooling is **not** required; the front end is vanilla JS served from the FastAPI app.

### Installation
```bash
python -m venv .venv
source .venv/bin/activate
pip install .[dev]
```

### Running the App Locally
```bash
uvicorn app.main:app --reload
```
Visit http://localhost:8000 to interact with the generator. The app renders everything with Canvas2D and caches static assets
via a service worker for offline access.

### Running Tests
```bash
pytest
```

### Docker
```bash
docker build -t wallpaper-generator .
docker run --rm -p 8000:8000 wallpaper-generator
```

## Project Structure
- `app/`: FastAPI application, configuration, and telemetry handling.
- `static/`: Client-side assets including HTML, CSS, JavaScript modules, presets, and the service worker.
- `tests/`: FastAPI endpoint tests covering health checks, presets, and telemetry rate limiting.
- `Dockerfile`: Production-ready image definition serving the FastAPI app via Uvicorn.
- `.github/workflows/`: Automation for building and pushing images to GHCR.

## Feature Highlights
- Settings can be exported/imported as JSON, embedded in PNG/WebP downloads, and shared via URL hashes.
- Presets are served from the backend and cached client-side; recent history is tracked locally.
- Gradients, noise, and vignette rendering are deterministic per seed, ensuring reproducibility across sessions.
