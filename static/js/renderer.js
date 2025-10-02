import { createCanvas2DContext } from './context.js';
import { generateGrainData } from './noise.js';
import { cloneState } from './state.js';
import { clamp, downloadBlob, formatDimension, hslToRgb, toast } from './utils.js';

const DPR = () => window.devicePixelRatio || 1;

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
    this.canvas2d = createCanvas2DContext(this.canvas);
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCtx = createCanvas2DContext(this.bufferCanvas);
    this.noiseCanvas = document.createElement('canvas');
    this.noiseCtx = createCanvas2DContext(this.noiseCanvas);
    this.noiseCacheKey = null;
    this.previewZoom = 1;
    this.previewOffset = { x: 0, y: 0 };
    this.dragging = false;
    this.lastPointer = null;
    this.needsRender = true;
    this.wallpaperDirty = true;
    this.frameHandle = null;
    this.attachEvents();
    this.handleResize();
    this.startLoop();
  }

  attachEvents() {
    window.addEventListener('resize', () => this.handleResize());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 1.05 : 0.95;
      this.previewZoom = clamp(this.previewZoom * delta, 0.5, 4);
      this.clampPreviewOffset();
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
      this.clampPreviewOffset();
      this.needsRender = true;
    });
  }

  clampPreviewOffset() {
    const zoom = Math.max(this.previewZoom, 1e-3);
    const { width, height } = this.state.canvas;
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    const limitX = Math.max(0, 0.5 - viewWidth / (2 * width));
    const limitY = Math.max(0, 0.5 - viewHeight / (2 * height));
    this.previewOffset.x = clamp(this.previewOffset.x, -limitX, limitX);
    this.previewOffset.y = clamp(this.previewOffset.y, -limitY, limitY);
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
    this.wallpaperDirty = true;
    this.noiseCacheKey = null;
    this.handleResize();
    this.clampPreviewOffset();
    this.needsRender = true;
  }

  renderPreview() {
    this.renderCanvas(this.canvas, this.state, { preview: true });
  }

  ensureBufferCanvas(state) {
    const width = Math.max(1, Math.round(state.canvas.width));
    const height = Math.max(1, Math.round(state.canvas.height));
    if (this.bufferCanvas.width !== width || this.bufferCanvas.height !== height) {
      this.bufferCanvas.width = width;
      this.bufferCanvas.height = height;
      this.bufferCtx = createCanvas2DContext(this.bufferCanvas);
      this.wallpaperDirty = true;
    }
  }

  renderCanvas(targetCanvas = this.canvas, stateOverride = this.state, options = {}) {
    const state = stateOverride;
    if (!targetCanvas) return;
    if (options.preview) {
      if (!this.canvas2d || !this.bufferCtx) return;
      this.ensureBufferCanvas(state);
      if (this.wallpaperDirty) {
        this.paintWallpaper(this.bufferCtx, this.bufferCanvas.width, this.bufferCanvas.height, state);
        this.wallpaperDirty = false;
      }
      const ctx = this.canvas2d;
      const deviceWidth = this.canvas.width;
      const deviceHeight = this.canvas.height;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, deviceWidth, deviceHeight);
      ctx.imageSmoothingEnabled = true;
      const zoom = Math.max(this.previewZoom, 1e-3);
      const viewWidth = this.bufferCanvas.width / zoom;
      const viewHeight = this.bufferCanvas.height / zoom;
      const centerX = (0.5 + this.previewOffset.x) * this.bufferCanvas.width;
      const centerY = (0.5 + this.previewOffset.y) * this.bufferCanvas.height;
      const halfViewWidth = viewWidth / 2;
      const halfViewHeight = viewHeight / 2;
      const sx = clamp(centerX - halfViewWidth, 0, Math.max(0, this.bufferCanvas.width - viewWidth));
      const sy = clamp(centerY - halfViewHeight, 0, Math.max(0, this.bufferCanvas.height - viewHeight));
      ctx.drawImage(
        this.bufferCanvas,
        sx,
        sy,
        viewWidth,
        viewHeight,
        0,
        0,
        deviceWidth,
        deviceHeight
      );
      ctx.restore();
      return;
    }
    const ctx = createCanvas2DContext(targetCanvas);
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    this.paintWallpaper(ctx, targetCanvas.width, targetCanvas.height, state);
    ctx.restore();
  }

  paintWallpaper(ctx, width, height, state) {
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    const baseHue = state.color.hue;
    const baseSat = state.color.saturation * 100;
    const baseLight = state.color.lightness * 100;
    ctx.fillStyle = `hsl(${baseHue}, ${baseSat}%, ${baseLight}%)`;
    ctx.fillRect(0, 0, width, height);
    const gradientType = state.gradient?.type === 'none' ? 'flat' : state.gradient?.type;
    const gradientEnabled = state.gradient?.enabled !== false && gradientType !== 'flat';
    const palette = this.getGradientPalette(state);
    if (gradientEnabled) {
      const gradientState = { ...state.gradient, type: gradientType };
      const gradient = this.createCanvasGradient(ctx, width, height, gradientState, palette);
      if (gradient) {
        ctx.globalCompositeOperation = mapBlendToComposite(state.gradient.blend);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    this.applyShaderVariantFallback(ctx, width, height, state, palette);
    this.applyNoise(ctx, width, height, state);
    this.applyVignette(ctx, width, height, state.vignette);
    ctx.restore();
  }

  getGradientPalette(state) {
    const gradientType = state.gradient?.type === 'none' ? 'flat' : state.gradient?.type;
    if (gradientType === 'flat') {
      return {
        hue: state.color.hue,
        saturation: clamp(state.color.saturation, 0, 1),
        lightness: clamp(state.color.lightness, 0, 1),
      };
    }
    const palette = state.gradient?.palette ?? {};
    const hue = typeof palette.hue === 'number' ? palette.hue : state.color.hue;
    const saturation = typeof palette.saturation === 'number' ? palette.saturation : state.color.saturation;
    const lightness = typeof palette.lightness === 'number' ? palette.lightness : state.color.lightness;
    return {
      hue,
      saturation: clamp(saturation, 0, 1),
      lightness: clamp(lightness, 0, 1),
    };
  }

  applyShaderVariantFallback(ctx, width, height, state, palette) {
    if (state.rendering?.enabled === false) {
      return;
    }
    const variant = state.rendering?.shader || 'classic';
    const strength = clamp(state.rendering?.shaderStrength ?? 0, 0, 1);
    if (variant === 'classic' || strength <= 0) {
      return;
    }
    ctx.save();
    if (variant === 'lumina') {
      const [r, g, b] = hslToRgb(palette.hue, palette.saturation, clamp(palette.lightness + 0.15, 0, 1));
      const gradient = ctx.createRadialGradient(
        width * state.gradient.center.x,
        height * state.gradient.center.y,
        0,
        width * state.gradient.center.x,
        height * state.gradient.center.y,
        Math.max(width, height) * 0.6
      );
      gradient.addColorStop(0, `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${0.6 * strength})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else if (variant === 'nocturne') {
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = strength * 0.35;
      ctx.fillStyle = 'rgba(60, 80, 140, 1)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = strength * 0.25;
      ctx.fillStyle = 'rgba(20, 30, 60, 1)';
      ctx.fillRect(0, 0, width, height);
    } else if (variant === 'ember') {
      const [r, g, b] = hslToRgb((palette.hue + 20) % 360, clamp(palette.saturation + 0.1, 0, 1), clamp(palette.lightness + 0.05, 0, 1));
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.2,
        width / 2,
        height / 2,
        Math.max(width, height)
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${0.5 * strength})`);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  createCanvasGradient(ctx, width, height, gradientState, palette) {
    const stops = gradientState.stops ?? [];
    if (!stops.length) return null;
    const type = gradientState.type === 'none' ? 'flat' : gradientState.type;
    if (type === 'flat') {
      return null;
    }
    let gradient = null;
    if (type === 'linear') {
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
    } else if (type === 'radial') {
      gradient = ctx.createRadialGradient(
        width * gradientState.center.x,
        height * gradientState.center.y,
        0,
        width * gradientState.center.x,
        height * gradientState.center.y,
        Math.max(width, height) * gradientState.scale
      );
    } else if (type === 'conic') {
      if (typeof ctx.createConicGradient !== 'function') {
        console.warn('Conic gradients are not supported in this browser.');
        return null;
      }
      gradient = ctx.createConicGradient(
        ((gradientState.angle ?? 0) * Math.PI) / 180,
        width * gradientState.center.x,
        height * gradientState.center.y
      );
    } else if (type === 'corner-glow') {
      const cornerX = clamp(gradientState.center.x, 0, 1) * width;
      const cornerY = clamp(gradientState.center.y, 0, 1) * height;
      gradient = ctx.createRadialGradient(
        cornerX,
        cornerY,
        0,
        cornerX,
        cornerY,
        Math.max(width, height) * 1.2
      );
    }
    if (!gradient) return null;
    const colors = stops.map((stop) => this.resolveStopColor(stop, palette));
    if (gradientState.mode === 'discrete') {
      stops.forEach((stop, index) => {
        const color = colors[index];
        gradient.addColorStop(stop.pos, color);
        const nextPos = stops[index + 1]?.pos ?? 1;
        const epsilon = Math.max((nextPos - stop.pos) * 0.5, 1e-4);
        gradient.addColorStop(Math.min(stop.pos + epsilon, 1), color);
      });
    } else {
      stops.forEach((stop, index) => {
        gradient.addColorStop(stop.pos, colors[index]);
      });
    }
    return gradient;
  }

  resolveStopColor(stop, palette) {
    const hue = (palette.hue + stop.hueShift + 360) % 360;
    const lightness = clamp(palette.lightness + stop.lightnessDelta, 0, 1);
    const saturation = clamp(palette.saturation, 0, 1);
    const opacity = clamp(stop.opacity, 0, 1);
    return `hsla(${hue}, ${(saturation * 100).toFixed(0)}%, ${(lightness * 100).toFixed(0)}%, ${opacity})`;
  }

  applyNoise(ctx, width, height, state) {
    if (state.grain?.enabled === false) {
      return;
    }
    const amount = clamp(state.grain.amount, 0, 100);
    if (amount <= 0) return;
    const gradientType = state.gradient?.type === 'none' ? 'flat' : state.gradient?.type;
    const gradientActive = state.gradient?.enabled !== false && gradientType !== 'flat';
    const palette = this.getGradientPalette(state);
    const paletteLightness = clamp(gradientActive ? palette.lightness : state.color.lightness, 0, 1);
    const cacheKey = this.createGrainCacheKey(width, height, state.grain, paletteLightness, state.random.seed);
    if (this.noiseCacheKey !== cacheKey) {
      const grainData = generateGrainData(width, height, state.grain, paletteLightness, state.random.seed);
      if (!grainData) {
        return;
      }
      this.noiseCanvas.width = grainData.width;
      this.noiseCanvas.height = grainData.height;
      this.noiseCtx = createCanvas2DContext(this.noiseCanvas);
      if (!this.noiseCtx) {
        return;
      }
      const imageData = new ImageData(grainData.data, grainData.width, grainData.height);
      this.noiseCtx.putImageData(imageData, 0, 0);
      this.noiseCacheKey = cacheKey;
    }
    if (!this.noiseCanvas || !this.noiseCtx) {
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.noiseCanvas, 0, 0, width, height);
    ctx.restore();
  }

  createGrainCacheKey(width, height, grainState, paletteLightness, seed) {
    const chroma = grainState.chroma ?? {};
    return [
      width,
      height,
      seed,
      clamp(grainState.amount ?? 0, 0, 100),
      grainState.size ?? 'normal',
      grainState.algorithm ?? 'uniform',
      grainState.octaves ?? 1,
      grainState.lacunarity ?? 2,
      grainState.gain ?? 0.5,
      chroma.enabled ? 1 : 0,
      chroma.intensity ?? 0,
      grainState.intensityCurve ?? 'linear',
      grainState.protectShadows ?? 0,
      paletteLightness,
    ]
      .map((value) => (typeof value === 'number' ? value.toString() : value))
      .join('|');
  }

  applyVignette(ctx, width, height, vignetteState) {
    if (vignetteState?.enabled === false) {
      return;
    }
    const strength = clamp(vignetteState?.strength ?? 0, 0, 1);
    if (strength <= 0) return;
    const radius = clamp(vignetteState.radius ?? 0.8, 0.1, 2);
    const feather = clamp(vignetteState.feather ?? 0.5, 0.01, 1);
    const maxDim = Math.max(width, height);
    const outer = maxDim * radius;
    const inner = Math.max(0, outer * (1 - feather));
    const gradient = ctx.createRadialGradient(width / 2, height / 2, inner, width / 2, height / 2, outer);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.save();
    ctx.globalCompositeOperation = vignetteState.mode === 'soft-light' ? 'soft-light' : 'multiply';
    ctx.globalAlpha = strength;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  async renderToBlob(state, format) {
    return this.renderCanvasToBlob(state, format);
  }

  async renderCanvasToBlob(state, format) {
    const canvas = document.createElement('canvas');
    canvas.width = state.canvas.width;
    canvas.height = state.canvas.height;
    const ctx = createCanvas2DContext(canvas);
    if (!ctx) {
      throw new Error('Canvas2D context unavailable for rendering');
    }
    this.paintWallpaper(ctx, canvas.width, canvas.height, cloneState(state));
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
