export const MAX_GRADIENT_STOPS = 8;

export const defaultState = Object.freeze({
  canvas: { width: 1920, height: 1080, previewScale: 0.5 },
  color: { hue: 210, saturation: 0.55, lightness: 0.45, gamma: 1.0 },
  gradient: {
    type: 'radial',
    mode: 'continuous',
    angle: 45,
    center: { x: 0.5, y: 0.5 },
    scale: 1.0,
    stops: [
      { pos: 0.0, hueShift: 0.0, lightnessDelta: 0.0, opacity: 1.0 },
      { pos: 1.0, hueShift: 30.0, lightnessDelta: 0.25, opacity: 0.6 },
    ],
    blend: 'overlay',
  },
  grain: {
    amount: 35,
    size: 'normal',
    algorithm: 'fbm',
    octaves: 4,
    lacunarity: 2.0,
    gain: 0.5,
    chroma: { enabled: true, intensity: 0.08 },
    intensityCurve: 's-curve',
    protectShadows: 0.05,
  },
  vignette: { strength: 0.4, radius: 0.8, feather: 0.6, roundness: 1.0, mode: 'multiply' },
  random: { seed: Math.floor(Math.random() * 2 ** 32) >>> 0 },
  output: { format: 'png', jpgQuality: 0.92, embedMetadata: true },
});

export function cloneState(state) {
  return structuredClone(state);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

export function normalizeState(raw) {
  const merged = cloneState(defaultState);
  return deepMerge(merged, raw ?? {});
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge({ ...(target[key] ?? {}) }, value);
    } else if (Array.isArray(value)) {
      target[key] = value.map((item) => (typeof item === 'object' ? { ...item } : item));
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(str) {
  try {
    return normalizeState(JSON.parse(str));
  } catch (error) {
    console.error('Failed to parse settings JSON', error);
    return cloneState(defaultState);
  }
}

export function encodeStateToUrl(state) {
  const json = serializeState(state);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded.replace(/=+$/, '');
}

export function decodeStateFromUrl(hash) {
  if (!hash) return null;
  try {
    const json = decodeURIComponent(escape(atob(hash)));
    return normalizeState(JSON.parse(json));
  } catch (error) {
    console.error('Failed to decode settings from URL', error);
    return null;
  }
}

export function stateFingerprint(state) {
  return encodeStateToUrl(state);
}
