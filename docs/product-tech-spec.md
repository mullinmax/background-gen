# Minimal, Modular Wallpaper Generator — Product & Technical Specification

## Overview
The Minimal, Modular Wallpaper Generator is a single-page, client-rendered web application for generating deterministic, high-quality abstract wallpapers. The core experience is a responsive control panel that drives a Canvas2D rendering pipeline, enabling users to tweak gradients, grain, and vignette effects and export the results at arbitrary resolutions. A lightweight FastAPI service delivers static assets and optional telemetry endpoints, keeping server load minimal.

## Primary User Flows
1. **Configure appearance controls.** Users adjust color, gradient, grain, vignette, and random seed parameters through labeled, keyboard-accessible inputs.
2. **Preview results instantly.** A working-resolution canvas updates in real time (≥30 FPS target) as parameters change, with support for pan and zoom.
3. **Render and download.** Users trigger a full-resolution render and download the output as PNG, WebP, or JPEG.
4. **Share or reuse settings.** Settings can be exported/imported as JSON or encoded into shareable URLs for reproducibility.

## Scope (MVP)
### Input Controls
- **Canvas size:** User-defined width/height with preset options; editable numeric inputs.
- **Color:** Hue (0–360), Saturation (0–100%), Lightness (0–100%), optional Gamma (0.8–2.2).
- **Gradient:**
  - Types: none | linear | radial | conic | corner-glow.
  - Modes: continuous (smooth interpolation) or discrete (hard bands).
  - Stops: up to _N_ entries with position (0–100%), hue shift (±), lightness delta (±), opacity.
  - Orientation/placement: angle (linear), center (radial/conic/corner-glow), scale.
  - Blend modes: normal | overlay | soft-light | screen.
- **Grain/Noise:**
  - Amount (0–100 perceived intensity).
  - Size presets: fine | normal | coarse.
  - Algorithms: uniform, gaussian, value, perlin, fbm, simplex, blue-noise (tiled), poisson-stipple, paper-fiber.
  - FBM parameters: octaves, lacunarity, gain.
  - Intensity curve: linear | log | s-curve.
  - Chroma noise: enable + intensity (0–20%).
  - Protect deep shadows: 0–20% clamp to limit highlights in dark areas.
- **Vignette:** Strength (0–100), radius %, feather %, roundness, blend mode (multiply | soft-light).
- **Randomness:** Seed (32-bit integer) and randomize button with displayed seed for reproducibility.
- **Output:** Format (PNG/WebP/JPG), JPEG quality (0.6–1.0), metadata embedding toggle.

### Preview & QA
- Working canvas maintains ≥30 FPS during interaction.
- Full-resolution render completes within ~1–2 seconds for ~4 MP outputs.
- Preview supports pan/zoom.

### Output
- Formats: PNG (default), WebP, optional JPEG with adjustable quality.
- Filenames follow `wall_<width>x<height>_<seed>.<ext>`.
- Embed JSON settings metadata within PNG/WebP outputs when enabled.

### Presets
- Ship bundled presets covering continuous/discrete gradients and different grain algorithms.
- Store presets in localStorage and support import/export via JSON.
- Provide shareable URLs with compressed, encoded settings payloads.

### Non-Goals (MVP)
- Device-specific presets or orientation handling.
- Complex geometric overlays or pattern libraries.
- User accounts or server-side persistence.

## Information Architecture & UI
- Single-page layout with three columns (responsive):
  1. Control accordion (Canvas, Color, Gradient, Grain, Vignette, Randomness, Output).
  2. Central preview canvas with resize and pan/zoom controls.
  3. Presets & history panel (collapsible) for quick load/save, URL copy, JSON import/export.
- Bootstrap (or similar lightweight framework) provides grid, form, and modal components.
- Accessibility: keyboard navigation, labeled inputs, sliders paired with numeric fields.

## Rendering Pipeline (Client)
- Pure Canvas2D implementation composed of sequential paint passes:
  1. **BaseFill:** Convert HSL controls to RGB and fill the canvas background.
  2. **GradientPass:** Build CSS gradients for linear, radial, conic, and corner-glow modes; composite using the configured blend mode.
  3. **VariantPass:** Apply stylistic overlays (lumina, nocturne, ember) via additional gradients and blend operations.
  4. **NoisePass:** Scatter seeded luminance noise using a deterministic PRNG; optionally extend to more algorithms as future work.
  5. **VignettePass:** Draw radial vignette with configurable strength, radius, feather, and blend mode.
  6. **Encode:** Use `HTMLCanvasElement.toBlob` to produce PNG/WebP/JPEG output with deterministic filenames.
- Deterministic seeding via 32-bit PRNG (Mulberry32). Seed stored in UI and metadata.

### Canvas Rendering Strategy
- Canvas gradients and blend modes approximate shader results while remaining CPU-friendly.
- Off-screen canvas caches the full-resolution wallpaper; the preview samples from this buffer with pan/zoom transforms.
- Metadata embedding occurs post-encode for PNG/WebP outputs.

## State & Shareability
- Application state serialized as JSON (see schema below).
- URL synchronization with compressed, encoded settings stored in query/hash.
- Defaults load when no URL state present; presets stored in localStorage.

### Settings JSON Schema (Outline)
```json
{
  "canvas": { "width": int, "height": int, "previewScale": float },
  "color": { "hue": 0-360, "saturation": 0-1, "lightness": 0-1, "gamma": 0.8-2.2 },
  "gradient": {
    "type": "none|linear|radial|conic|corner-glow",
    "mode": "continuous|discrete",
    "angle": 0-360,
    "center": { "x": 0-1, "y": 0-1 },
    "scale": 0-2,
    "stops": [
      { "pos": 0-1, "hueShift": float, "lightnessDelta": float, "opacity": 0-1 }
    ],
    "blend": "normal|overlay|soft-light|screen"
  },
  "grain": {
    "amount": 0-100,
    "size": "fine|normal|coarse",
    "algorithm": "uniform|gaussian|value|perlin|fbm|simplex|blue-noise|poisson-stipple|paper-fiber",
    "octaves": int,
    "lacunarity": float,
    "gain": float,
    "chroma": { "enabled": bool, "intensity": 0-0.2 },
    "intensityCurve": "linear|log|s-curve",
    "protectShadows": 0-0.2
  },
  "vignette": { "strength": 0-1, "radius": 0-1, "feather": 0-1, "roundness": 0-2, "mode": "multiply|soft-light" },
  "random": { "seed": uint32 },
  "output": { "format": "png|webp|jpg", "jpgQuality": 0.6-1.0, "embedMetadata": bool }
}
```

## Performance Targets
- Preview rendering ≤20 ms per frame on mid-range laptops.
- Full-resolution (~4 MP) render within ~1–2 seconds.
- Efficient GPU memory usage via buffer reuse and compact pass graph.

## FastAPI Backend (Minimal)
- Serves static assets (index, JS, CSS, presets JSON).
- Endpoints:
  - `GET /api/health` → status JSON.
  - `POST /api/telemetry` (optional) → anonymous usage stats with rate limiting.
- Configurable via environment variables:
  - `PORT` (default 8000)
  - `STATIC_DIR` (default `/app/static`)
  - `ENABLE_TELEMETRY` (bool)
- Provide caching headers for hashed static assets and enable same-origin CORS.

## Offline & Resilience (Optional)
- Service worker caches static assets and last-used presets for offline use.
- Canvas2D renderer works across devices without requiring GPU extensions.

## Docker & Deployment
- Single container image running FastAPI (Uvicorn) with static file serving.
- Lightweight build without heavy toolchains.
- Compatible with CDN-fronted static hosting; FastAPI layer can be disabled when serving purely static assets.

## Testing & QA
- Visual regression: deterministic renders validated via hash/SSIM comparisons for known seeds.
- Performance benchmarks for preview and full render paths.
- Cross-browser verification (Chrome, Firefox, Safari) ensuring Canvas2D feature parity.

## Extensibility (Post-MVP)
- Additional Canvas paint passes for geometric overlays and pattern libraries.
- Batch rendering interface for seed variations.
- Palette extraction from uploaded images.
- Public presets gallery and share link enhancements.

## Risks & Mitigations
- **Canvas performance:** Keep paint passes simple, reuse off-screen buffers, and avoid per-frame allocations.
- **Noise quality/performance:** Balance sample counts with perceived grain intensity; precompute reusable patterns if needed.
- **Large output sizes:** Render final output in a single pass at target size; avoid dynamic resizing.

## Success Criteria
- Responsive, stable preview with smooth controls.
- High-quality, deterministic outputs at arbitrary resolutions.
- Minimal server footprint with easily extendable, modular codebase.
