import { cloneState, MAX_GRADIENT_STOPS } from './state.js';
import { createFragmentShaderSource, vertexShaderSource } from './webgl/shaders.js';
import { downloadBlob, formatDimension, toast } from './utils.js';

const DPR = () => window.devicePixelRatio || 1;
const BLUE_NOISE_SEED = 0x9e3779b9;

function createPrng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function createQuad(gl) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const vertices = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return buffer;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function seedToFloat(seed) {
  return seed % 2147483647;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function embedPngMetadata(blob, text) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  const keyword = encoder.encode('settings\x00');
  const payload = encoder.encode(text);
  const data = new Uint8Array(keyword.length + payload.length);
  data.set(keyword, 0);
  data.set(payload, keyword.length);
  const chunkLength = data.length;
  const chunkType = new Uint8Array([0x74, 0x45, 0x58, 0x74]); // tEXt
  const chunk = new Uint8Array(12 + chunkLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunkLength);
  chunk.set(chunkType, 4);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + chunkLength));
  view.setUint32(8 + chunkLength, crc);
  // Insert before IEND
  let offset = 8; // skip signature
  while (offset < bytes.length) {
    const length = new DataView(bytes.buffer, offset, 4).getUint32(0);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const result = new Uint8Array(bytes.length + chunk.length);
  result.set(bytes.subarray(0, offset), 0);
  result.set(chunk, offset);
  result.set(bytes.subarray(offset), offset + chunk.length);
  return new Blob([result], { type: 'image/png' });
}

async function embedWebpMetadata(blob, text) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF') {
    return blob;
  }
  const encoder = new TextEncoder();
  const payload = encoder.encode(text);
  const paddedSize = payload.length + (payload.length % 2);
  const chunk = new Uint8Array(8 + paddedSize);
  chunk.set([0x58, 0x4d, 0x50, 0x20], 0); // 'XMP '
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  if (paddedSize !== payload.length) {
    chunk[8 + payload.length] = 0;
  }
  const result = new Uint8Array(bytes.length + chunk.length);
  result.set(bytes, 0);
  result.set(chunk, bytes.length);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return new Blob([result], { type: 'image/webp' });
}

async function maybeEmbedMetadata(blob, format, state) {
  if (!state.output.embedMetadata) return blob;
  const text = JSON.stringify(state);
  if (format === 'png') {
    try {
      return await embedPngMetadata(blob, text);
    } catch (error) {
      console.warn('Failed to embed PNG metadata', error);
    }
  } else if (format === 'webp') {
    try {
      return await embedWebpMetadata(blob, text);
    } catch (error) {
      console.warn('Failed to embed WebP metadata', error);
    }
  }
  return blob;
}

export class WallpaperRenderer {
  constructor(canvas, initialState) {
    this.canvas = canvas;
    this.state = cloneState(initialState);
    this.gl = this.createContext();
    this.blueNoiseTexture = null;
    this.previewZoom = 1;
    this.previewOffset = { x: 0, y: 0 };
    this.dragging = false;
    this.lastPointer = null;
    this.needsRender = true;
    this.frameHandle = null;
    this.init();
  }

  createContext() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) {
      return null;
    }
    return gl;
  }

  async init() {
    if (this.gl) {
      try {
        this.setupWebGL();
        await this.loadBlueNoise();
      } catch (error) {
        console.error(error);
        this.gl = null;
        this.canvas.getContext('2d');
        document.getElementById('webgl-warning')?.classList.remove('d-none');
      }
    } else {
      document.getElementById('webgl-warning')?.classList.remove('d-none');
    }
    this.attachEvents();
    this.handleResize();
    this.startLoop();
  }

  setupWebGL() {
    const gl = this.gl;
    const fsSource = createFragmentShaderSource(MAX_GRADIENT_STOPS);
    this.program = createProgram(gl, vertexShaderSource, fsSource);
    this.positionBuffer = createQuad(gl);
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = this.collectUniforms(gl, this.program);
  }

  collectUniforms(gl, program) {
    const names = [
      'uResolution',
      'uPreviewOffset',
      'uPreviewZoom',
      'uHue',
      'uSaturation',
      'uLightness',
      'uGamma',
      'uGradientType',
      'uGradientMode',
      'uGradientAngle',
      'uGradientCenter',
      'uGradientScale',
      'uGradientStopCount',
      'uStopPositions',
      'uStopAdjustments',
      'uBlendMode',
      'uNoiseAmount',
      'uNoiseSize',
      'uNoiseAlgorithm',
      'uNoiseOctaves',
      'uNoiseLacunarity',
      'uNoiseGain',
      'uChromaEnabled',
      'uChromaIntensity',
      'uIntensityCurve',
      'uProtectShadows',
      'uSeed',
      'uTime',
      'uBlueNoiseTexture',
      'uHasBlueNoise',
      'uVignetteStrength',
      'uVignetteRadius',
      'uVignetteFeather',
      'uVignetteRoundness',
      'uVignetteMode',
      'uApplyDither',
    ];
    const map = {};
    names.forEach((name) => {
      map[name] = gl.getUniformLocation(program, name);
    });
    return map;
  }

  async loadBlueNoise() {
    const gl = this.gl;
    if (!gl) return;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const { data, size } = generateBlueNoiseTextureData(128, BLUE_NOISE_SEED);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.blueNoiseTexture = texture;
  }

  attachEvents() {
    window.addEventListener('resize', () => this.handleResize());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 1.05 : 0.95;
      this.previewZoom = Math.min(Math.max(this.previewZoom * delta, 0.5), 4);
      this.needsRender = true;
    });
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointerup', (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.dragging = false;
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging || !this.lastPointer) return;
      const dx = (event.clientX - this.lastPointer.x) / this.canvas.clientWidth;
      const dy = (event.clientY - this.lastPointer.y) / this.canvas.clientHeight;
      this.previewOffset.x -= dx;
      this.previewOffset.y += dy;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.needsRender = true;
    });
  }

  handleResize() {
    const dpr = DPR();
    const width = Math.max(320, Math.round(this.state.canvas.width * this.state.canvas.previewScale));
    const height = Math.max(240, Math.round(this.state.canvas.height * this.state.canvas.previewScale));
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.needsRender = true;
  }

  startLoop() {
    const loop = () => {
      this.frameHandle = requestAnimationFrame(loop);
      if (this.needsRender) {
        this.renderPreview();
        this.needsRender = false;
      }
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
  }

  updateState(nextState) {
    this.state = cloneState(nextState);
    this.handleResize();
    this.needsRender = true;
  }

  renderPreview() {
    if (this.gl) {
      this.renderWebGL(this.canvas.width, this.canvas.height, true);
    } else {
      this.renderCanvasFallback();
    }
  }

  renderWebGL(width, height, preview = false) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const t = performance.now() / 1000;
    const state = this.state;
    gl.uniform2f(this.uniforms.uResolution, state.canvas.width, state.canvas.height);
    gl.uniform2f(this.uniforms.uPreviewOffset, this.previewOffset.x, this.previewOffset.y);
    gl.uniform1f(this.uniforms.uPreviewZoom, this.previewZoom);
    gl.uniform1f(this.uniforms.uHue, state.color.hue);
    gl.uniform1f(this.uniforms.uSaturation, state.color.saturation);
    gl.uniform1f(this.uniforms.uLightness, state.color.lightness);
    gl.uniform1f(this.uniforms.uGamma, state.color.gamma);
    gl.uniform1i(this.uniforms.uGradientType, gradientTypeToInt(state.gradient.type));
    gl.uniform1i(this.uniforms.uGradientMode, state.gradient.mode === 'discrete' ? 1 : 0);
    gl.uniform1f(this.uniforms.uGradientAngle, state.gradient.angle);
    gl.uniform2f(this.uniforms.uGradientCenter, state.gradient.center.x, state.gradient.center.y);
    gl.uniform1f(this.uniforms.uGradientScale, state.gradient.scale);
    gl.uniform1i(this.uniforms.uBlendMode, blendModeToInt(state.gradient.blend));
    const stopPositions = new Float32Array(MAX_GRADIENT_STOPS);
    const stopAdjustments = new Float32Array(MAX_GRADIENT_STOPS * 4);
    state.gradient.stops.slice(0, MAX_GRADIENT_STOPS).forEach((stop, index) => {
      stopPositions[index] = stop.pos;
      const baseIndex = index * 4;
      stopAdjustments[baseIndex] = stop.hueShift;
      stopAdjustments[baseIndex + 1] = stop.lightnessDelta;
      stopAdjustments[baseIndex + 2] = stop.opacity;
      stopAdjustments[baseIndex + 3] = 0;
    });
    gl.uniform1i(this.uniforms.uGradientStopCount, Math.min(state.gradient.stops.length, MAX_GRADIENT_STOPS));
    gl.uniform1fv(this.uniforms.uStopPositions, stopPositions);
    gl.uniform4fv(this.uniforms.uStopAdjustments, stopAdjustments);
    gl.uniform1f(this.uniforms.uNoiseAmount, state.grain.amount);
    gl.uniform1i(this.uniforms.uNoiseSize, grainSizeToInt(state.grain.size));
    gl.uniform1i(this.uniforms.uNoiseAlgorithm, grainAlgorithmToInt(state.grain.algorithm));
    gl.uniform1i(this.uniforms.uNoiseOctaves, state.grain.octaves);
    gl.uniform1f(this.uniforms.uNoiseLacunarity, state.grain.lacunarity);
    gl.uniform1f(this.uniforms.uNoiseGain, state.grain.gain);
    gl.uniform1i(this.uniforms.uChromaEnabled, state.grain.chroma.enabled ? 1 : 0);
    gl.uniform1f(this.uniforms.uChromaIntensity, state.grain.chroma.intensity);
    gl.uniform1i(this.uniforms.uIntensityCurve, intensityCurveToInt(state.grain.intensityCurve));
    gl.uniform1f(this.uniforms.uProtectShadows, state.grain.protectShadows);
    gl.uniform1f(this.uniforms.uSeed, seedToFloat(state.random.seed));
    gl.uniform1f(this.uniforms.uTime, t);
    gl.uniform1f(this.uniforms.uVignetteStrength, state.vignette.strength);
    gl.uniform1f(this.uniforms.uVignetteRadius, state.vignette.radius);
    gl.uniform1f(this.uniforms.uVignetteFeather, state.vignette.feather);
    gl.uniform1f(this.uniforms.uVignetteRoundness, state.vignette.roundness);
    gl.uniform1i(this.uniforms.uVignetteMode, state.vignette.mode === 'soft-light' ? 1 : 0);
    const applyDither = state.output.format === 'jpg';
    gl.uniform1i(this.uniforms.uApplyDither, applyDither ? 1 : 0);
    if (this.blueNoiseTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blueNoiseTexture);
      gl.uniform1i(this.uniforms.uBlueNoiseTexture, 0);
      gl.uniform1i(this.uniforms.uHasBlueNoise, 1);
    } else {
      gl.uniform1i(this.uniforms.uHasBlueNoise, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!preview) {
      gl.finish();
    }
  }

  renderCanvasFallback(targetCanvas = this.canvas, stateOverride = this.state) {
    const ctx = targetCanvas.getContext('2d');
    const state = stateOverride;
    const width = targetCanvas.width;
    const height = targetCanvas.height;
    const baseHue = state.color.hue;
    const baseSat = state.color.saturation * 100;
    const baseLight = state.color.lightness * 100;
    ctx.fillStyle = `hsl(${baseHue} ${baseSat}% ${baseLight}%)`;
    ctx.fillRect(0, 0, width, height);
    if (state.gradient.type !== 'none') {
      const gradient = this.createCanvasGradient(ctx, width, height, state.gradient, state.color);
      ctx.globalCompositeOperation = mapBlendToComposite(state.gradient.blend);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    const prng = createPrng(state.random.seed);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    const samples = Math.floor(width * height * (state.grain.amount / 5000));
    for (let i = 0; i < samples; i += 1) {
      const x = prng() * width;
      const y = prng() * height;
      ctx.fillRect(x, y, 1, 1);
    }
    const radial = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.5);
    radial.addColorStop(0, 'rgba(0,0,0,0)');
    radial.addColorStop(1, `rgba(0,0,0,${state.vignette.strength})`);
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);
  }

  createCanvasGradient(ctx, width, height, gradientState, colorState) {
    let gradient;
    if (gradientState.type === 'linear') {
      const angle = (gradientState.angle * Math.PI) / 180;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const half = Math.max(width, height);
      gradient = ctx.createLinearGradient(
        width / 2 - x * half,
        height / 2 - y * half,
        width / 2 + x * half,
        height / 2 + y * half
      );
    } else {
      gradient = ctx.createRadialGradient(
        width * gradientState.center.x,
        height * gradientState.center.y,
        0,
        width * gradientState.center.x,
        height * gradientState.center.y,
        Math.max(width, height) * gradientState.scale
      );
    }
    gradientState.stops.forEach((stop) => {
      const hue = (colorState.hue + stop.hueShift + 360) % 360;
      const lightness = Math.min(Math.max(colorState.lightness + stop.lightnessDelta, 0), 1);
      gradient.addColorStop(
        stop.pos,
        `hsla(${hue} ${(colorState.saturation * 100).toFixed(0)}% ${(lightness * 100).toFixed(0)}%, ${stop.opacity})`
      );
    });
    return gradient;
  }

  async renderToBlob(state, format) {
    if (this.gl) {
      return this.renderWebGLToBlob(state, format);
    }
    return this.renderCanvasToBlob(state, format);
  }

  async renderWebGLToBlob(state, format) {
    const gl = this.gl;
    const width = state.canvas.width;
    const height = state.canvas.height;
    const prevState = cloneState(this.state);
    this.state = cloneState(state);
    const prevCanvasSize = { width: this.canvas.width, height: this.canvas.height };
    const prevOffset = { ...this.previewOffset };
    const prevZoom = this.previewZoom;
    this.previewOffset = { x: 0, y: 0 };
    this.previewZoom = 1;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderWebGL(width, height, false);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const flipped = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const srcStart = y * width * 4;
      const dstStart = (height - y - 1) * width * 4;
      flipped.set(pixels.subarray(srcStart, srcStart + width * 4), dstStart);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(flipped, width, height);
    ctx.putImageData(imageData, 0, 0);
    const type = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = format === 'jpg' ? state.output.jpgQuality : undefined;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode image'));
      }, type, quality);
    });
    this.canvas.width = prevCanvasSize.width;
    this.canvas.height = prevCanvasSize.height;
    this.state = prevState;
    this.previewOffset = prevOffset;
    this.previewZoom = prevZoom;
    this.handleResize();
    const withMetadata = await maybeEmbedMetadata(blob, format, state);
    return withMetadata;
  }

  async renderCanvasToBlob(state, format) {
    const canvas = document.createElement('canvas');
    canvas.width = state.canvas.width;
    canvas.height = state.canvas.height;
    this.renderCanvasFallback(canvas, cloneState(state));
    const type = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = format === 'jpg' ? state.output.jpgQuality : undefined;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode image'));
      }, type, quality);
    });
    return maybeEmbedMetadata(blob, format, state);
  }
}

function gradientTypeToInt(type) {
  return ['none', 'linear', 'radial', 'conic', 'corner-glow'].indexOf(type);
}

function blendModeToInt(mode) {
  return ['normal', 'overlay', 'soft-light', 'screen'].indexOf(mode);
}

function grainSizeToInt(size) {
  return ['fine', 'normal', 'coarse'].indexOf(size);
}

function grainAlgorithmToInt(name) {
  return [
    'uniform',
    'gaussian',
    'value',
    'perlin',
    'fbm',
    'simplex',
    'blue-noise',
    'poisson-stipple',
    'paper-fiber',
  ].indexOf(name);
}

function intensityCurveToInt(name) {
  return ['linear', 'log', 's-curve'].indexOf(name);
}

function mapBlendToComposite(mode) {
  switch (mode) {
    case 'overlay':
      return 'overlay';
    case 'soft-light':
      return 'soft-light';
    case 'screen':
      return 'screen';
    default:
      return 'source-over';
  }
}

function generateBlueNoiseTextureData(size, seed) {
  const prng = createPrng(seed);
  const base = new Float32Array(size * size);
  for (let i = 0; i < base.length; i += 1) {
    base[i] = prng();
  }
  const blurred = applyWrappedGaussianBlur(base, size, 3);
  const diff = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < diff.length; i += 1) {
    const value = base[i] - blurred[i];
    diff[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-5) {
    min = -0.5;
    max = 0.5;
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < diff.length; i += 1) {
    let value = (diff[i] - min) / (max - min);
    value = Math.pow(Math.min(Math.max(value, 0), 1), 1.1);
    const byte = Math.round(value * 255);
    const offset = i * 4;
    data[offset] = byte;
    data[offset + 1] = byte;
    data[offset + 2] = byte;
    data[offset + 3] = 255;
  }
  return { data, size };
}

function applyWrappedGaussianBlur(values, size, radius) {
  if (radius <= 0) {
    return values.slice();
  }
  const sigma = radius / 2 || 1;
  const kernel = [];
  let kernelSum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(weight);
    kernelSum += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= kernelSum;
  }
  const temp = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let accum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const weight = kernel[k + radius];
        const nx = (x + k + size) % size;
        accum += values[y * size + nx] * weight;
      }
      temp[y * size + x] = accum;
    }
  }
  const output = new Float32Array(size * size);
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      let accum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const weight = kernel[k + radius];
        const ny = (y + k + size) % size;
        accum += temp[ny * size + x] * weight;
      }
      output[y * size + x] = accum;
    }
  }
  return output;
}

export async function downloadWallpaper(renderer, state) {
  const format = state.output.format;
  try {
    const blob = await renderer.renderToBlob(state, format);
    const filename = `wall_${formatDimension(state.canvas.width, state.canvas.height)}_${state.random.seed}.${format === 'jpg' ? 'jpg' : format}`;
    downloadBlob(blob, filename);
    toast('Render complete', 'success');
  } catch (error) {
    console.error(error);
    toast('Failed to render wallpaper', 'danger');
  }
}
