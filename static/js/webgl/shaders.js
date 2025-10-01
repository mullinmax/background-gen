export const MAX_STOPS = 8;

export const vertexShaderSource = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export function createFragmentShaderSource(maxStops = MAX_STOPS) {
  return `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uPreviewOffset;
uniform float uPreviewZoom;
uniform float uHue;
uniform float uSaturation;
uniform float uLightness;
uniform float uGamma;
uniform int uShaderVariant;
uniform float uShaderStrength;

uniform int uGradientType;
uniform int uGradientMode;
uniform float uGradientAngle;
uniform vec2 uGradientCenter;
uniform float uGradientScale;
uniform float uGradientBaseHue;
uniform float uGradientBaseSaturation;
uniform float uGradientBaseLightness;
uniform int uGradientStopCount;
uniform float uStopPositions[${maxStops}];
uniform vec4 uStopAdjustments[${maxStops}]; // hueShift, lightnessDelta, opacity, unused
uniform int uBlendMode;

uniform float uNoiseAmount;
uniform int uNoiseSize;
uniform int uNoiseAlgorithm;
uniform int uNoiseOctaves;
uniform float uNoiseLacunarity;
uniform float uNoiseGain;
uniform bool uChromaEnabled;
uniform float uChromaIntensity;
uniform int uIntensityCurve;
uniform float uProtectShadows;

uniform float uSeed;
uniform float uTime;
uniform sampler2D uBlueNoiseTexture;
uniform bool uHasBlueNoise;

uniform float uVignetteStrength;
uniform float uVignetteRadius;
uniform float uVignetteFeather;
uniform float uVignetteRoundness;
uniform int uVignetteMode;

uniform bool uApplyDither;

const float PI = 3.14159265359;

uint hash_u32(uint x) {
  x += 0x9e3779b9u;
  x = (x ^ (x >> 15)) * (1u | x);
  x ^= x + (x << 7);
  x ^= x >> 14;
  return x;
}

float rand_u(vec2 co, float seed) {
  const float INV_2POWER32 = 1.0 / 4294967296.0;
  uint h = hash_u32(uint(co.x * 16384.0 + co.y * 8192.0) ^ uint(seed));
  return float(h) * INV_2POWER32;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = mod(hsl.x, 1.0);
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if (hp < 1.0) {
    rgb = vec3(c, x, 0.0);
  } else if (hp < 2.0) {
    rgb = vec3(x, c, 0.0);
  } else if (hp < 3.0) {
    rgb = vec3(0.0, c, x);
  } else if (hp < 4.0) {
    rgb = vec3(0.0, x, c);
  } else if (hp < 5.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }
  float m = l - 0.5 * c;
  return rgb + vec3(m);
}

float smoothNoise(vec2 uv, float seed) {
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  float a = rand_u(i, seed);
  float b = rand_u(i + vec2(1.0, 0.0), seed);
  float c = rand_u(i + vec2(0.0, 1.0), seed);
  float d = rand_u(i + vec2(1.0, 1.0), seed);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 fade(vec2 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float gradient(vec2 hash, vec2 p) {
  hash = hash * 2.0 - 1.0;
  return dot(normalize(hash), p);
}

float perlin(vec2 p, float seed) {
  vec2 pi = floor(p);
  vec2 pf = fract(p);
  vec2 w = fade(pf);
  float aa = gradient(vec2(rand_u(pi, seed), rand_u(pi + vec2(0.5), seed)), pf);
  float ba = gradient(vec2(rand_u(pi + vec2(1.0, 0.0), seed), rand_u(pi + vec2(1.5, 0.0), seed)), pf - vec2(1.0, 0.0));
  float ab = gradient(vec2(rand_u(pi + vec2(0.0, 1.0), seed), rand_u(pi + vec2(0.0, 1.5), seed)), pf - vec2(0.0, 1.0));
  float bb = gradient(vec2(rand_u(pi + vec2(1.0, 1.0), seed), rand_u(pi + vec2(1.5, 1.5), seed)), pf - vec2(1.0));
  float x1 = mix(aa, ba, w.x);
  float x2 = mix(ab, bb, w.x);
  return mix(x1, x2, w.y) * 0.5 + 0.5;
}

float simplex(vec2 p, float seed) {
  const float K1 = 0.3660254037844386; // (sqrt(3)-1)/2
  const float K2 = 0.2113248654051871; // (3-sqrt(3))/6
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - (i - (i.x + i.y) * K2);
  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  float n = 0.0;
  for (int j = 0; j < 3; ++j) {
    vec2 pos;
    if (j == 0) pos = a;
    else if (j == 1) pos = b;
    else pos = c;
    vec2 ij;
    if (j == 0) ij = i;
    else if (j == 1) ij = i + o;
    else ij = i + vec2(1.0);
    float t = 0.5 - dot(pos, pos);
    if (t > 0.0) {
      t *= t;
      float g = gradient(vec2(rand_u(ij, seed), rand_u(ij + vec2(0.4), seed)), pos);
      n += t * t * g;
    }
  }
  return clamp(0.5 + 40.0 * n, 0.0, 1.0);
}

float fbm(vec2 p, float seed, int octaves, float lacunarity, float gain, bool useSimplex) {
  float sum = 0.0;
  float amp = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 8; ++i) {
    if (i >= octaves) break;
    float n = useSimplex ? simplex(p * frequency, seed + float(i) * 19.19) : perlin(p * frequency, seed + float(i) * 7.13);
    sum += amp * n;
    frequency *= lacunarity;
    amp *= gain;
  }
  return sum;
}

float blueNoise(vec2 uv) {
  return texture(uBlueNoiseTexture, uv).r;
}

float poissonStipple(vec2 uv, float seed, float scale) {
  vec2 grid = floor(uv * scale);
  vec2 cellSeed = grid + vec2(rand_u(grid, seed), rand_u(grid + vec2(0.5), seed));
  vec2 jitter = fract(cellSeed);
  vec2 point = (grid + jitter) / scale;
  float dist = distance(point, uv);
  float radius = 0.5 / scale;
  float falloff = smoothstep(radius, 0.0, dist);
  return falloff;
}

float paperFiber(vec2 uv, float seed) {
  vec2 dir = normalize(vec2(cos(seed), sin(seed)));
  float fiber = fbm(vec2(dot(uv, dir), dot(uv, vec2(-dir.y, dir.x))) * 3.0, seed, 5, 1.9, 0.6, true);
  float micro = perlin(uv * 12.0, seed + 42.0);
  return clamp(0.7 * fiber + 0.3 * micro, 0.0, 1.0);
}

float noiseValue(vec2 uv) {
  float scale = mix(1.0, 3.0, float(uNoiseSize) / 2.0);
  vec2 p = uv * scale * uPreviewZoom;
  float result = 0.0;
  if (uNoiseAlgorithm == 0) {
    result = rand_u(floor(p * uResolution) / uResolution, uSeed);
  } else if (uNoiseAlgorithm == 1) {
    float r1 = rand_u(p + vec2(1.2, 0.7), uSeed);
    float r2 = rand_u(p + vec2(3.4, 2.1), uSeed + 19.0);
    float u = sqrt(-2.0 * log(max(r1, 1e-4))) * cos(2.0 * PI * r2);
    result = clamp(0.5 + 0.18 * u, 0.0, 1.0);
  } else if (uNoiseAlgorithm == 2) {
    result = smoothNoise(p * 4.0, uSeed);
  } else if (uNoiseAlgorithm == 3) {
    result = perlin(p * 3.0, uSeed);
  } else if (uNoiseAlgorithm == 4) {
    result = fbm(p * 2.0, uSeed, uNoiseOctaves, uNoiseLacunarity, uNoiseGain, false);
  } else if (uNoiseAlgorithm == 5) {
    result = fbm(p * 2.0, uSeed, uNoiseOctaves, uNoiseLacunarity, uNoiseGain, true);
  } else if (uNoiseAlgorithm == 6) {
    vec2 bnUV = fract(p * 0.5 + vec2(uSeed / 7919.0, uSeed / 1543.0));
    result = uHasBlueNoise ? blueNoise(bnUV) : rand_u(bnUV * uResolution, uSeed);
  } else if (uNoiseAlgorithm == 7) {
    result = poissonStipple(fract(p * 0.5), uSeed, 24.0);
  } else if (uNoiseAlgorithm == 8) {
    result = paperFiber(p * 0.4, uSeed);
  }
  return clamp(result, 0.0, 1.0);
}

float applyCurve(float value) {
  if (uIntensityCurve == 1) {
    return log(1.0 + value * 9.0) / log(10.0);
  } else if (uIntensityCurve == 2) {
    float t = clamp(value, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }
  return clamp(value, 0.0, 1.0);
}

float gradientFactor(vec2 uv) {
  vec2 centered = (uv - uGradientCenter) * uGradientScale;
  if (uGradientType == 0) {
    return 0.0;
  } else if (uGradientType == 1) {
    float angle = radians(uGradientAngle);
    vec2 dir = vec2(cos(angle), sin(angle));
    return clamp(0.5 + dot(centered, dir), 0.0, 1.0);
  } else if (uGradientType == 2) {
    return clamp(length(centered) * 1.414, 0.0, 1.0);
  } else if (uGradientType == 3) {
    return mod(atan(centered.y, centered.x) / (2.0 * PI) + 0.5 + uGradientAngle / 360.0, 1.0);
  } else {
    vec2 corner = clamp(uGradientCenter, vec2(0.0), vec2(1.0));
    vec2 diff = (uv - corner) * vec2(1.0, 1.0);
    float dist = length(diff);
    return clamp(dist * 1.2, 0.0, 1.0);
  }
}

vec3 gradientColor(float t, vec3 fillBaseHSL, vec3 gradientBaseHSL) {
  if (uGradientStopCount == 0) {
    return hsl2rgb(gradientBaseHSL);
  }
  if (uGradientMode == 1) {
    float bestPos = 0.0;
    vec4 bestAdjust = uStopAdjustments[0];
    for (int i = 0; i < ${maxStops}; ++i) {
      if (i >= uGradientStopCount) break;
      float pos = uStopPositions[i];
      if (t >= pos) {
        bestPos = pos;
        bestAdjust = uStopAdjustments[i];
      }
    }
    vec3 hsl = vec3(
      gradientBaseHSL.x + bestAdjust.x / 360.0,
      clamp(gradientBaseHSL.y, 0.0, 1.0),
      clamp(gradientBaseHSL.z + bestAdjust.y, 0.0, 1.0)
    );
    return mix(hsl2rgb(fillBaseHSL), hsl2rgb(hsl), clamp(bestAdjust.z, 0.0, 1.0));
  }
  float prevPos = uStopPositions[0];
  vec4 prevAdjust = uStopAdjustments[0];
  for (int i = 1; i < ${maxStops}; ++i) {
    if (i >= uGradientStopCount) break;
    float nextPos = uStopPositions[i];
    vec4 nextAdjust = uStopAdjustments[i];
    if (t <= prevPos) {
      vec3 hsl = vec3(
        gradientBaseHSL.x + prevAdjust.x / 360.0,
        clamp(gradientBaseHSL.y, 0.0, 1.0),
        clamp(gradientBaseHSL.z + prevAdjust.y, 0.0, 1.0)
      );
      return mix(hsl2rgb(fillBaseHSL), hsl2rgb(hsl), clamp(prevAdjust.z, 0.0, 1.0));
    }
    if (t <= nextPos) {
      float segment = clamp((t - prevPos) / max(nextPos - prevPos, 1e-5), 0.0, 1.0);
      vec3 hslA = vec3(
        gradientBaseHSL.x + prevAdjust.x / 360.0,
        clamp(gradientBaseHSL.y, 0.0, 1.0),
        clamp(gradientBaseHSL.z + prevAdjust.y, 0.0, 1.0)
      );
      vec3 hslB = vec3(
        gradientBaseHSL.x + nextAdjust.x / 360.0,
        clamp(gradientBaseHSL.y, 0.0, 1.0),
        clamp(gradientBaseHSL.z + nextAdjust.y, 0.0, 1.0)
      );
      vec3 rgbA = hsl2rgb(hslA);
      vec3 rgbB = hsl2rgb(hslB);
      float blend = mix(prevAdjust.z, nextAdjust.z, segment);
      float eased = smoothstep(0.0, 1.0, segment);
      return mix(rgbA, rgbB, eased) * clamp(blend, 0.0, 1.0) + hsl2rgb(fillBaseHSL) * (1.0 - clamp(blend, 0.0, 1.0));
    }
    prevPos = nextPos;
    prevAdjust = nextAdjust;
  }
  vec3 hsl = vec3(
    gradientBaseHSL.x + prevAdjust.x / 360.0,
    clamp(gradientBaseHSL.y, 0.0, 1.0),
    clamp(gradientBaseHSL.z + prevAdjust.y, 0.0, 1.0)
  );
  return mix(hsl2rgb(fillBaseHSL), hsl2rgb(hsl), clamp(prevAdjust.z, 0.0, 1.0));
}

vec3 blend(vec3 base, vec3 layer, int mode) {
  if (mode == 0) return mix(base, layer, 1.0);
  if (mode == 1) return mix(base, mix(base, layer, 0.7) + base * layer, 0.7);
  if (mode == 2) return mix(base, (base <= 0.5) ? (2.0 * base * layer) : (1.0 - 2.0 * (1.0 - base) * (1.0 - layer)), 0.8);
  if (mode == 3) return 1.0 - (1.0 - base) * (1.0 - layer);
  return mix(base, layer, 1.0);
}

vec3 applyShaderVariant(vec3 color, float gradientT, vec3 gradientBaseRGB) {
  float strength = clamp(uShaderStrength, 0.0, 1.0);
  if (uShaderVariant == 0 || strength <= 0.0001) {
    return color;
  }
  if (uShaderVariant == 1) {
    float halo = pow(clamp(1.0 - gradientT, 0.0, 1.0), 1.5);
    vec3 glow = mix(color, gradientBaseRGB + vec3(0.2, 0.15, 0.3), 0.5);
    return mix(color, clamp(glow, 0.0, 1.0), strength * halo);
  }
  if (uShaderVariant == 2) {
    float rim = smoothstep(0.25, 1.0, gradientT);
    vec3 cooled = vec3(color.r * 0.75 + 0.05, color.g * 0.85 + 0.05, min(color.b + 0.2, 1.0));
    return mix(color, clamp(cooled, 0.0, 1.0), strength * (0.6 + 0.4 * rim));
  }
  if (uShaderVariant == 3) {
    float edge = smoothstep(0.4, 1.0, gradientT);
    vec3 warmed = mix(color + vec3(0.2, 0.1, -0.05), gradientBaseRGB + vec3(0.1, 0.05, -0.02), 0.5);
    return mix(color, clamp(warmed, 0.0, 1.0), strength * edge);
  }
  return color;
}

vec3 applyVignette(vec3 color, vec2 uv) {
  vec2 centered = (uv - 0.5) * vec2(1.0, uResolution.y / uResolution.x);
  centered = sign(centered) * pow(abs(centered), vec2(uVignetteRoundness));
  float dist = length(centered) / uVignetteRadius;
  float vignette = smoothstep(1.0 - uVignetteFeather, 1.0 + uVignetteFeather, dist);
  float strength = clamp(uVignetteStrength, 0.0, 1.0);
  if (uVignetteMode == 0) {
    return mix(color, color * (1.0 - strength * vignette), strength);
  }
  return mix(color, color * (1.0 - strength * vignette) + strength * vignette * 0.2, strength);
}

vec3 applyNoise(vec3 color, float noiseValue) {
  float intensity = applyCurve(noiseValue) * (uNoiseAmount / 100.0);
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  float protect = smoothstep(0.0, uProtectShadows, luminance);
  float adjusted = mix(intensity, intensity * luminance, protect);
  vec3 monochrome = color + (adjusted - 0.5 * adjusted);
  if (uChromaEnabled) {
    vec3 chromaNoise = vec3(
      rand_u(gl_FragCoord.xy + vec2(1.0, 0.0), uSeed),
      rand_u(gl_FragCoord.xy + vec2(0.0, 1.0), uSeed + 17.0),
      rand_u(gl_FragCoord.xy + vec2(2.0, 2.0), uSeed + 41.0)
    );
    chromaNoise = chromaNoise * 2.0 - 1.0;
    monochrome += chromaNoise * uChromaIntensity * adjusted;
  } else {
    monochrome += (noiseValue - 0.5) * adjusted;
  }
  return clamp(monochrome, 0.0, 1.0);
}

float bayerDither(vec2 uv) {
  int x = int(mod(uv.x * 8.0, 8.0));
  int y = int(mod(uv.y * 8.0, 8.0));
  int index = x + y * 8;
  const float matrix[64] = float[64](
    0.0, 48.0, 12.0, 60.0, 3.0, 51.0, 15.0, 63.0,
    32.0, 16.0, 44.0, 28.0, 35.0, 19.0, 47.0, 31.0,
    8.0, 56.0, 4.0, 52.0, 11.0, 59.0, 7.0, 55.0,
    40.0, 24.0, 36.0, 20.0, 43.0, 27.0, 39.0, 23.0,
    2.0, 50.0, 14.0, 62.0, 1.0, 49.0, 13.0, 61.0,
    34.0, 18.0, 46.0, 30.0, 33.0, 17.0, 45.0, 29.0,
    10.0, 58.0, 6.0, 54.0, 9.0, 57.0, 5.0, 53.0,
    42.0, 26.0, 38.0, 22.0, 41.0, 25.0, 37.0, 21.0
  );
  return (matrix[index] + 0.5) / 64.0;
}

void main() {
  vec2 uv = (v_uv - 0.5) / max(uPreviewZoom, 0.001) + 0.5 + uPreviewOffset;
  vec2 previewUV = clamp(uv, 0.0, 1.0);
  vec3 baseHSL = vec3(uHue / 360.0, uSaturation, uLightness);
  vec3 baseColor = hsl2rgb(baseHSL);
  vec3 gradientBaseHSL = vec3(uGradientBaseHue / 360.0, clamp(uGradientBaseSaturation, 0.0, 1.0), clamp(uGradientBaseLightness, 0.0, 1.0));
  float gradientT = gradientFactor(previewUV);
  vec3 gradientCol = gradientColor(gradientT, baseHSL, gradientBaseHSL);
  vec3 composed = blend(baseColor, gradientCol, uBlendMode);
  composed = applyShaderVariant(composed, gradientT, hsl2rgb(gradientBaseHSL));
  float n = noiseValue(uv);
  composed = applyNoise(composed, n);
  composed = applyVignette(composed, previewUV);
  if (uApplyDither) {
    float threshold = bayerDither(gl_FragCoord.xy);
    composed = composed + (threshold - 0.5) / 255.0;
  }
  composed = pow(composed, vec3(1.0 / max(uGamma, 0.001)));
  fragColor = vec4(clamp(composed, 0.0, 1.0), 1.0);
}
`;
}
