import { clamp } from './utils.js';

const TAU = Math.PI * 2;

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function hashInt(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 362437;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function randomGradient(ix, iy, seed) {
  const angle = hashInt(ix, iy, seed) * TAU;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const v00 = hashInt(x0, y0, seed);
  const v10 = hashInt(x0 + 1, y0, seed);
  const v01 = hashInt(x0, y0 + 1, seed);
  const v11 = hashInt(x0 + 1, y0 + 1, seed);
  const sx = smoothstep(tx);
  const sy = smoothstep(ty);
  const ix0 = lerp(v00, v10, sx);
  const ix1 = lerp(v01, v11, sx);
  return lerp(ix0, ix1, sy);
}

function gradientNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const grad00 = randomGradient(x0, y0, seed);
  const grad10 = randomGradient(x1, y0, seed);
  const grad01 = randomGradient(x0, y1, seed);
  const grad11 = randomGradient(x1, y1, seed);
  const sx = smoothstep(tx);
  const sy = smoothstep(ty);
  const dot00 = grad00.x * (tx) + grad00.y * (ty);
  const dot10 = grad10.x * (tx - 1) + grad10.y * (ty);
  const dot01 = grad01.x * (tx) + grad01.y * (ty - 1);
  const dot11 = grad11.x * (tx - 1) + grad11.y * (ty - 1);
  const ix0 = lerp(dot00, dot10, sx);
  const ix1 = lerp(dot01, dot11, sx);
  const value = lerp(ix0, ix1, sy);
  return clamp01(0.5 + value * 0.5);
}

function simplexCorner(ix, iy, x, y, seed) {
  const t = 0.5 - x * x - y * y;
  if (t <= 0) return 0;
  const grad = randomGradient(ix, iy, seed);
  const dot = grad.x * x + grad.y * y;
  const t4 = t * t * t * t;
  return t4 * dot;
}

function simplexNoise2D(x, y, seed) {
  const F2 = 0.3660254037844386; // (sqrt(3) - 1) / 2
  const G2 = 0.21132486540518713; // (3 - sqrt(3)) / 6

  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const n0 = simplexCorner(i, j, x0, y0, seed);
  const n1 = simplexCorner(i + i1, j + j1, x1, y1, seed);
  const n2 = simplexCorner(i + 1, j + 1, x2, y2, seed);

  const value = 70 * (n0 + n1 + n2);
  return clamp01(0.5 + value * 0.5);
}

function worleyNoise2D(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let minDist = 1;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cellX = xi + dx;
      const cellY = yi + dy;
      const px = cellX + hashInt(cellX, cellY, seed) - 0.5;
      const py = cellY + hashInt(cellX, cellY, seed + 97) - 0.5;
      const dist = Math.hypot(px - x, py - y);
      if (dist < minDist) {
        minDist = dist;
      }
    }
  }
  const normalized = clamp01(minDist * 1.25);
  return clamp01(Math.exp(-3 * normalized));
}

const BAYER_8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

function blueNoise2D(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const matrixValue = BAYER_8[(xi % 8 + 8) % 8][(yi % 8 + 8) % 8] / 64;
  const jitter = hashInt(xi, yi, seed) * 0.15 - 0.075;
  return clamp01(matrixValue + jitter);
}

function paperFiberNoise2D(x, y, seed) {
  const fiber = Math.sin(y * TAU * 0.5 + hashInt(Math.floor(x), Math.floor(y), seed) * TAU) * 0.5 + 0.5;
  const grain = valueNoise2D(x * 0.7, y * 2.1, seed + 1337);
  return clamp01(fiber * 0.35 + grain * 0.65);
}

function sampleBaseNoise(algorithm, nx, ny, frequency, seed) {
  const x = nx * frequency;
  const y = ny * frequency;
  switch (algorithm) {
    case 'gaussian': {
      const u1 = hashInt(Math.floor(x), Math.floor(y), seed) || 1e-6;
      const u2 = hashInt(Math.floor(x), Math.floor(y), seed + 19);
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
      return clamp01(0.5 + z * 0.18);
    }
    case 'value':
      return valueNoise2D(x, y, seed);
    case 'perlin':
      return gradientNoise2D(x, y, seed);
    case 'fbm': {
      const base = gradientNoise2D(x, y, seed);
      const ridged = 1 - Math.abs(base * 2 - 1);
      return clamp01(base * 0.6 + ridged * 0.4);
    }
    case 'simplex':
      return simplexNoise2D(x, y, seed + 71);
    case 'blue-noise':
      return blueNoise2D(x, y, seed + 811);
    case 'poisson-stipple':
      return worleyNoise2D(x, y, seed + 409);
    case 'paper-fiber':
      return paperFiberNoise2D(x, y, seed + 997);
    case 'uniform':
    default:
      return hashInt(Math.floor(x * 4096), Math.floor(y * 4096), seed + 53);
  }
}

function applyIntensityCurve(value, curve) {
  switch (curve) {
    case 'log':
      return Math.log10(1 + value * 9);
    case 's-curve':
      return 0.5 - Math.cos(value * Math.PI) / 2;
    case 'linear':
    default:
      return value;
  }
}

function sizeToFrequency(size) {
  switch (size) {
    case 'fine':
      return 12;
    case 'coarse':
      return 4;
    case 'normal':
    default:
      return 8;
  }
}

export function generateGrainData(width, height, grainState, baseLightness = 0.5, seed = 0) {
  if (!grainState || grainState.enabled === false) {
    return null;
  }
  const amount = clamp(grainState.amount ?? 0, 0, 100);
  if (amount <= 0) {
    return null;
  }

  const algorithm = grainState.algorithm ?? 'uniform';
  const size = grainState.size ?? 'normal';
  const octaves = Math.max(1, Math.floor(grainState.octaves ?? 1));
  const lacunarity = clamp(grainState.lacunarity ?? 2, 1, 4);
  const gain = clamp(grainState.gain ?? 0.5, 0.1, 1);
  const intensityCurve = grainState.intensityCurve ?? 'linear';
  const chromaEnabled = grainState.chroma?.enabled ?? false;
  const chromaIntensity = clamp(grainState.chroma?.intensity ?? 0, 0, 0.5);
  const protectShadows = clamp(grainState.protectShadows ?? 0, 0, 0.4);

  const frequencyBase = sizeToFrequency(size);
  const amplitudeBase = amount / 100;
  const base = clamp(baseLightness ?? 0.5, 0, 1);

  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = width > 1 ? x / (width - 1) : 0;
      const ny = height > 1 ? y / (height - 1) : 0;
      let frequency = frequencyBase;
      let amplitude = 1;
      let sum = 0;
      let amplitudeSum = 0;
      for (let octave = 0; octave < octaves; octave += 1) {
        const sample = sampleBaseNoise(algorithm, nx, ny, frequency, seed + octave * 131);
        sum += sample * amplitude;
        amplitudeSum += amplitude;
        frequency *= lacunarity;
        amplitude *= gain;
      }
      let value = amplitudeSum > 0 ? sum / amplitudeSum : 0.5;
      value = applyIntensityCurve(clamp01(value), intensityCurve);

      const shadowThreshold = protectShadows;
      let shadowFactor = 1;
      if (shadowThreshold > 0 && base < shadowThreshold) {
        shadowFactor = clamp01(base / shadowThreshold);
      }

      const centered = value - 0.5;
      const amplitudeScaled = amplitudeBase * (0.6 + 0.4 * value) * shadowFactor;
      const neutral = clamp01(0.5 + centered * amplitudeScaled * 2);

      let r = neutral;
      let g = neutral;
      let b = neutral;

      if (chromaEnabled && chromaIntensity > 0) {
        const hueSample = sampleBaseNoise('uniform', nx + 1.37, ny + 3.11, frequencyBase * 0.75 + 1, seed + 911);
        const angle = hueSample * TAU;
        const chromaAmount = chromaIntensity * amplitudeBase * shadowFactor * 2;
        r = clamp01(neutral + Math.cos(angle) * chromaAmount);
        g = clamp01(neutral + Math.cos(angle + (TAU / 3)) * chromaAmount);
        b = clamp01(neutral + Math.cos(angle + (2 * TAU) / 3) * chromaAmount);
      }

      const alpha = clamp01(0.3 + amplitudeScaled * 0.9);
      const index = (y * width + x) * 4;
      data[index] = Math.round(r * 255);
      data[index + 1] = Math.round(g * 255);
      data[index + 2] = Math.round(b * 255);
      data[index + 3] = Math.round(alpha * 255);
    }
  }

  return { width, height, data };
}

