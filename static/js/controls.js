import { MAX_GRADIENT_STOPS, cloneState, randomSeed, defaultState } from './state.js';
import { clamp, formatSeed, hslToRgb } from './utils.js';

const GRADIENT_TYPES = ['flat', 'linear', 'radial', 'conic', 'corner-glow'];
const GRADIENT_MODES = ['continuous', 'discrete'];
const BLEND_MODES = ['normal', 'overlay', 'soft-light', 'screen'];
const GRAIN_SIZES = ['fine', 'normal', 'coarse'];
const GRAIN_ALGORITHMS = [
  'uniform',
  'gaussian',
  'value',
  'perlin',
  'fbm',
  'simplex',
  'blue-noise',
  'poisson-stipple',
  'paper-fiber',
];
const INTENSITY_CURVES = ['linear', 'log', 's-curve'];
const VIGNETTE_MODES = ['multiply', 'soft-light'];
const OUTPUT_FORMATS = ['png', 'webp', 'jpg'];
const MULTI_OCTAVE_GRAIN_ALGOS = new Set(['value', 'perlin', 'fbm', 'simplex']);

export class ControlPanel {
  constructor(root, accordionRoot, initialState, onChange, shaderOptions = []) {
    this.root = root;
    this.accordionRoot = accordionRoot;
    this.onChange = onChange;
    this.state = cloneState(initialState);
    this.shaderOptions = Array.isArray(shaderOptions) ? shaderOptions : [];
    this.shaderDescriptionEl = null;
    this.visibilityBindings = [];
    this.sectionIdCounter = 0;
    this.render();
  }

  get stateSnapshot() {
    return cloneState(this.state);
  }

  render() {
    this.sectionIdCounter = 0;
    this.accordionRoot.innerHTML = '';
    this.shaderDescriptionEl = null;
    this.shaderStrengthInput = null;
    this.shaderStrengthNumber = null;
    this.visibilityBindings = [];
    this.onColorPreviewUpdate = null;
    this.createCanvasSection();
    this.createRenderingSection();
    this.createGradientSection();
    this.createGrainSection();
    this.createVignetteSection();
    this.createRandomSection();
    this.createOutputSection();
    this.updateVisibilityBindings();
  }

  createCanvasSection() {
    const section = this.createSection('Canvas');
    const widthControl = this.createNumberInput('Width', this.state.canvas.width, 256, 10000, 1, (value) => {
      this.state.canvas.width = value;
      this.emitChange();
    }, {
      description: 'Output width in pixels for the rendered wallpaper.',
    });
    const heightControl = this.createNumberInput('Height', this.state.canvas.height, 256, 10000, 1, (value) => {
      this.state.canvas.height = value;
      this.emitChange();
    }, {
      description: 'Output height in pixels for the rendered wallpaper.',
    });
    const previewScaleControl = this.createRangeInput(
      'Preview Scale',
      this.state.canvas.previewScale,
      0.1,
      1,
      0.05,
      (value) => {
        this.state.canvas.previewScale = value;
        this.emitChange();
      },
      {
        description: 'Zoom level for the on-screen preview (does not affect exports).',
      }
    );
    section.body.append(widthControl, heightControl, previewScaleControl);
  }

  createRenderingSection() {
    if (!this.state.rendering) {
      this.state.rendering = cloneState(defaultState.rendering);
    }
    if (typeof this.state.rendering.enabled !== 'boolean') {
      this.state.rendering.enabled = true;
    }
    const section = this.createSection('Rendering', {
      toggle: {
        isEnabled: () => this.state.rendering.enabled !== false,
        onToggle: (enabled) => {
          this.state.rendering.enabled = enabled;
          this.emitChange();
        },
      },
    });
    const options = (this.shaderOptions.length
      ? this.shaderOptions
      : [{ id: 'classic', name: 'Classic Gradient', description: 'Baseline renderer.', default_strength: 0 }]
    ).map((option) => ({ value: option.id, label: option.name, description: option.description, strength: option.default_strength ?? 0 }));
    const shaderVariantControl = this.createSelect(
      'Shader Variant',
      options,
      this.state.rendering.shader,
      (value) => {
        this.state.rendering.shader = value;
        const match = options.find((item) => item.value === value);
        if (match && typeof match.strength === 'number' && Number.isFinite(match.strength) && match.strength >= 0) {
          this.state.rendering.shaderStrength = clamp(match.strength, 0, 1);
        }
        this.updateShaderDescription();
        this.emitChange();
        if (this.shaderStrengthInput) {
          this.shaderStrengthInput.value = String(this.state.rendering.shaderStrength);
          if (this.shaderStrengthNumber) {
            this.shaderStrengthNumber.value = String(Math.round(this.state.rendering.shaderStrength * 100));
          }
        }
      },
      {
        description: 'Choose how the renderer tones and layers the base gradient.',
      }
    );
    section.body.append(shaderVariantControl);
    const description = document.createElement('p');
    description.className = 'small text-secondary mb-0';
    section.body.append(description);
    this.shaderDescriptionEl = description;
    this.updateShaderDescription();
    const strengthControl = this.createRangeInput(
      'Shader Strength',
      this.state.rendering.shaderStrength,
      0,
      1,
      0.01,
      (value) => {
        this.state.rendering.shaderStrength = value;
        this.emitChange();
      },
      {
        showAsPercent: true,
        description: 'Blend amount for the selected shader variant relative to the base gradient.',
      }
    );
    const [rangeEl, numberEl] = strengthControl.querySelectorAll('input');
    this.shaderStrengthInput = rangeEl;
    this.shaderStrengthNumber = numberEl;
    section.body.append(strengthControl);
    this.registerVisibility(strengthControl, () => this.state.rendering.shader !== 'classic');
    this.setSectionDisabled(section, this.state.rendering.enabled === false);
  }

  createGradientSection() {
    if (!this.state.gradient) {
      this.state.gradient = cloneState(defaultState.gradient);
    }
    if (typeof this.state.gradient.enabled !== 'boolean') {
      this.state.gradient.enabled = true;
    }
    if (this.state.gradient.type === 'none' || !GRADIENT_TYPES.includes(this.state.gradient.type)) {
      this.state.gradient.type = 'flat';
    }
    const section = this.createSection('Gradient', {
      toggle: {
        isEnabled: () => this.state.gradient.enabled !== false,
        onToggle: (enabled) => {
          this.state.gradient.enabled = enabled;
          this.emitChange();
        },
      },
    });
    const palette = this.ensureGradientPalette();
    const typeControl = this.createSelect('Type', GRADIENT_TYPES, this.state.gradient.type, (value) => {
      this.state.gradient.type = value;
      this.emitChange();
    }, {
      description: 'Select the gradient style. Choose Flat for a solid color fill.',
    });
    section.body.append(typeControl);
    section.body.append(this.createBaseColorControls());
    const modeControl = this.createSelect('Mode', GRADIENT_MODES, this.state.gradient.mode, (value) => {
      this.state.gradient.mode = value;
      this.emitChange();
    }, {
      description: 'Blend stops smoothly or snap between colors for stepped bands.',
    });
    const angleControl = this.createRangeInput('Angle', this.state.gradient.angle, 0, 360, 1, (value) => {
      this.state.gradient.angle = value;
      this.emitChange();
    }, {
      description: 'Rotate the gradient orientation in degrees.',
    });
    const centerXControl = this.createRangeInput('Center X', this.state.gradient.center.x, 0, 1, 0.01, (value) => {
      this.state.gradient.center.x = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Horizontal origin of the gradient focus.',
    });
    const centerYControl = this.createRangeInput('Center Y', this.state.gradient.center.y, 0, 1, 0.01, (value) => {
      this.state.gradient.center.y = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Vertical origin of the gradient focus.',
    });
    const scaleControl = this.createRangeInput('Scale', this.state.gradient.scale, 0.1, 2, 0.01, (value) => {
      this.state.gradient.scale = value;
      this.emitChange();
    }, {
      description: 'Radius multiplier for radial gradients.',
    });
    const paletteHueControl = this.createRangeInput('Palette Hue', palette.hue, 0, 360, 1, (value) => {
      this.state.gradient.palette.hue = value;
      this.emitChange();
    }, {
      description: 'Base hue applied to gradient color stops.',
    });
    const paletteSatControl = this.createRangeInput('Palette Saturation', palette.saturation, 0, 1, 0.01, (value) => {
      this.state.gradient.palette.saturation = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Color saturation baseline for gradient stops.',
    });
    const paletteLightControl = this.createRangeInput('Palette Lightness', palette.lightness, 0, 1, 0.01, (value) => {
      this.state.gradient.palette.lightness = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Lightness baseline for gradient stops.',
    });
    const blendControl = this.createSelect('Blend', BLEND_MODES, this.state.gradient.blend, (value) => {
      this.state.gradient.blend = value;
      this.emitChange();
    }, {
      description: 'Canvas blend mode used when applying the gradient.',
    });
    section.body.append(
      modeControl,
      angleControl,
      centerXControl,
      centerYControl,
      scaleControl,
      paletteHueControl,
      paletteSatControl,
      paletteLightControl,
      blendControl
    );
    const stopContainer = document.createElement('div');
    stopContainer.className = 'mt-3 stop-list';
    section.body.append(stopContainer);
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-outline-light btn-sm';
    addButton.textContent = 'Add Stop';
    addButton.addEventListener('click', () => this.addGradientStop());
    section.body.append(addButton);
    this.stopContainer = stopContainer;
    this.addStopButton = addButton;
    this.renderGradientStops();
    this.registerVisibility(modeControl, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(angleControl, () => ['linear', 'conic'].includes(this.state.gradient.type));
    this.registerVisibility(centerXControl, () => ['radial', 'conic', 'corner-glow'].includes(this.state.gradient.type));
    this.registerVisibility(centerYControl, () => ['radial', 'conic', 'corner-glow'].includes(this.state.gradient.type));
    this.registerVisibility(scaleControl, () => this.state.gradient.type === 'radial');
    this.registerVisibility(paletteHueControl, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(paletteSatControl, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(paletteLightControl, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(blendControl, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(stopContainer, () => this.state.gradient.type !== 'flat');
    this.registerVisibility(addButton, () => this.state.gradient.type !== 'flat');
    this.setSectionDisabled(section, this.state.gradient.enabled === false);
  }

  createBaseColorControls() {
    const container = document.createElement('div');
    container.className = 'd-flex flex-column gap-2';
    const hueControl = this.createRangeInput('Base Hue', this.state.color.hue, 0, 360, 1, (value) => {
      this.state.color.hue = value;
      this.emitChange();
    }, {
      description: 'Hue for the underlying canvas fill color.',
    });
    const saturationControl = this.createRangeInput('Base Saturation', this.state.color.saturation, 0, 1, 0.01, (value) => {
      this.state.color.saturation = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Saturation of the solid base color before gradients.',
    });
    const lightnessControl = this.createRangeInput('Base Lightness', this.state.color.lightness, 0, 1, 0.01, (value) => {
      this.state.color.lightness = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Lightness of the base fill applied across the canvas.',
    });
    const gammaControl = this.createRangeInput('Base Gamma', this.state.color.gamma, 0.8, 2.2, 0.01, (value) => {
      this.state.color.gamma = value;
      this.emitChange();
    }, {
      description: 'Applies gamma compensation when shading the base color.',
    });
    const preview = document.createElement('div');
    preview.className = 'mt-2 p-3 rounded border border-secondary bg-dark text-center color-preview';
    preview.textContent = 'Base Color Preview';
    const updatePreview = () => {
      const [r, g, b] = hslToRgb(this.state.color.hue, this.state.color.saturation, this.state.color.lightness);
      preview.style.background = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    };
    updatePreview();
    this.onColorPreviewUpdate = updatePreview;
    container.append(hueControl, saturationControl, lightnessControl, gammaControl, preview);
    return container;
  }

  ensureGradientPalette() {
    if (!this.state.gradient.palette) {
      this.state.gradient.palette = {
        hue: this.state.color?.hue ?? 210,
        saturation: this.state.color?.saturation ?? 0.6,
        lightness: this.state.color?.lightness ?? 0.5,
      };
    }
    if (typeof this.state.gradient.palette.hue !== 'number') {
      this.state.gradient.palette.hue = this.state.color?.hue ?? 210;
    }
    if (typeof this.state.gradient.palette.saturation !== 'number') {
      this.state.gradient.palette.saturation = this.state.color?.saturation ?? 0.6;
    }
    if (typeof this.state.gradient.palette.lightness !== 'number') {
      this.state.gradient.palette.lightness = this.state.color?.lightness ?? 0.5;
    }
    return this.state.gradient.palette;
  }

  renderGradientStops() {
    this.stopContainer.innerHTML = '';
    this.state.gradient.stops.slice(0, MAX_GRADIENT_STOPS).forEach((stop, index) => {
      const item = document.createElement('div');
      item.className = 'stop-item';
      const header = document.createElement('div');
      header.className = 'd-flex justify-content-between align-items-center mb-2';
      const label = document.createElement('span');
      label.text = `Stop ${index + 1}`;
      label.textContent = `Stop ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline-danger btn-sm';
      remove.textContent = 'Remove';
      remove.disabled = this.state.gradient.stops.length <= 1;
      remove.addEventListener('click', () => this.removeGradientStop(index));
      header.append(label, remove);
      item.append(header);
      item.append(
        this.createRangeInput('Position', stop.pos, 0, 1, 0.01, (value) => {
          this.state.gradient.stops[index].pos = value;
          this.emitChange();
        }, {
          showAsPercent: true,
          description: 'Placement of the stop along the gradient span.',
        }),
        this.createRangeInput('Hue Shift', stop.hueShift, -180, 180, 1, (value) => {
          this.state.gradient.stops[index].hueShift = value;
          this.emitChange();
        }, {
          description: 'Hue offset relative to the palette base color.',
        }),
        this.createRangeInput('Lightness Δ', stop.lightnessDelta, -1, 1, 0.01, (value) => {
          this.state.gradient.stops[index].lightnessDelta = value;
          this.emitChange();
        }, {
          showAsPercent: true,
          description: 'Lightness adjustment for this stop.',
        }),
        this.createRangeInput('Opacity', stop.opacity, 0, 1, 0.01, (value) => {
          this.state.gradient.stops[index].opacity = value;
          this.emitChange();
        }, {
          showAsPercent: true,
          description: 'Transparency of this color stop.',
        })
      );
      this.stopContainer.append(item);
    });
    if (this.addStopButton) {
      if (this.state.gradient.stops.length >= MAX_GRADIENT_STOPS) {
        this.addStopButton.setAttribute('disabled', 'true');
      } else {
        this.addStopButton.removeAttribute('disabled');
      }
    }
  }

  addGradientStop() {
    if (this.state.gradient.stops.length >= MAX_GRADIENT_STOPS) return;
    this.state.gradient.stops.push({ pos: 0.5, hueShift: 0, lightnessDelta: 0, opacity: 1 });
    this.renderGradientStops();
    this.emitChange();
  }

  removeGradientStop(index) {
    if (this.state.gradient.stops.length <= 1) return;
    this.state.gradient.stops.splice(index, 1);
    this.renderGradientStops();
    this.emitChange();
  }

  createGrainSection() {
    if (!this.state.grain) {
      this.state.grain = cloneState(defaultState.grain);
    }
    if (typeof this.state.grain.enabled !== 'boolean') {
      this.state.grain.enabled = true;
    }
    const section = this.createSection('Grain', {
      toggle: {
        isEnabled: () => this.state.grain.enabled !== false,
        onToggle: (enabled) => {
          this.state.grain.enabled = enabled;
          this.emitChange();
        },
      },
    });
    const amountControl = this.createRangeInput('Amount', this.state.grain.amount, 0, 100, 1, (value) => {
      this.state.grain.amount = value;
      this.emitChange();
    }, {
      description: 'Strength of the grain overlay applied to the image.',
    });
    const sizeControl = this.createSelect('Size', GRAIN_SIZES, this.state.grain.size, (value) => {
      this.state.grain.size = value;
      this.emitChange();
    }, {
      description: 'Base scale for noise features within the grain texture.',
    });
    const algorithmControl = this.createSelect('Algorithm', GRAIN_ALGORITHMS, this.state.grain.algorithm, (value) => {
      this.state.grain.algorithm = value;
      this.emitChange();
    }, {
      description: 'Noise model used to synthesize the grain pattern.',
    });
    const octavesControl = this.createNumberInput('Octaves', this.state.grain.octaves, 1, 8, 1, (value) => {
      this.state.grain.octaves = value;
      this.emitChange();
    }, {
      description: 'Number of layered noise passes for fractal grain.',
    });
    const lacunarityControl = this.createRangeInput('Lacunarity', this.state.grain.lacunarity, 1, 4, 0.05, (value) => {
      this.state.grain.lacunarity = value;
      this.emitChange();
    }, {
      description: 'Frequency multiplier between successive noise octaves.',
    });
    const gainControl = this.createRangeInput('Gain', this.state.grain.gain, 0.1, 1, 0.01, (value) => {
      this.state.grain.gain = value;
      this.emitChange();
    }, {
      description: 'Amplitude falloff controlling contrast between octaves.',
    });
    const chromaToggle = this.createCheckbox('Chroma Noise', this.state.grain.chroma.enabled, (checked) => {
      this.state.grain.chroma.enabled = checked;
      this.emitChange();
    }, {
      description: 'Adds subtle color variation to the grain.',
    });
    const chromaIntensityControl = this.createRangeInput(
      'Chroma Intensity',
      this.state.grain.chroma.intensity,
      0,
      0.2,
      0.01,
      (value) => {
        this.state.grain.chroma.intensity = value;
        this.emitChange();
      },
      {
        showAsPercent: true,
        description: 'Strength of color modulation when chroma noise is enabled.',
      }
    );
    const intensityCurveControl = this.createSelect('Intensity Curve', INTENSITY_CURVES, this.state.grain.intensityCurve, (value) => {
      this.state.grain.intensityCurve = value;
      this.emitChange();
    }, {
      description: 'Adjusts how grain values are distributed across shadows and highlights.',
    });
    const protectShadowsControl = this.createRangeInput('Protect Shadows', this.state.grain.protectShadows, 0, 0.2, 0.01, (value) => {
      this.state.grain.protectShadows = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Reduces grain strength in the darkest portions of the image.',
    });
    section.body.append(
      amountControl,
      sizeControl,
      algorithmControl,
      octavesControl,
      lacunarityControl,
      gainControl,
      chromaToggle,
      chromaIntensityControl,
      intensityCurveControl,
      protectShadowsControl
    );
    this.registerVisibility(octavesControl, () => MULTI_OCTAVE_GRAIN_ALGOS.has(this.state.grain.algorithm));
    this.registerVisibility(lacunarityControl, () => MULTI_OCTAVE_GRAIN_ALGOS.has(this.state.grain.algorithm));
    this.registerVisibility(gainControl, () => MULTI_OCTAVE_GRAIN_ALGOS.has(this.state.grain.algorithm));
    this.registerVisibility(chromaIntensityControl, () => this.state.grain.chroma.enabled);
    this.setSectionDisabled(section, this.state.grain.enabled === false);
  }

  createVignetteSection() {
    if (!this.state.vignette) {
      this.state.vignette = cloneState(defaultState.vignette);
    }
    if (typeof this.state.vignette.enabled !== 'boolean') {
      this.state.vignette.enabled = true;
    }
    const section = this.createSection('Vignette', {
      toggle: {
        isEnabled: () => this.state.vignette.enabled !== false,
        onToggle: (enabled) => {
          this.state.vignette.enabled = enabled;
          this.emitChange();
        },
      },
    });
    const strengthControl = this.createRangeInput('Strength', this.state.vignette.strength, 0, 1, 0.01, (value) => {
      this.state.vignette.strength = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Opacity of the vignette overlay.',
    });
    const radiusControl = this.createRangeInput('Radius', this.state.vignette.radius, 0, 1, 0.01, (value) => {
      this.state.vignette.radius = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Size of the bright center area before darkening begins.',
    });
    const featherControl = this.createRangeInput('Feather', this.state.vignette.feather, 0, 1, 0.01, (value) => {
      this.state.vignette.feather = value;
      this.emitChange();
    }, {
      showAsPercent: true,
      description: 'Softness of the transition between center and edges.',
    });
    const roundnessControl = this.createRangeInput('Roundness', this.state.vignette.roundness, 0.2, 2, 0.01, (value) => {
      this.state.vignette.roundness = value;
      this.emitChange();
    }, {
      description: 'Aspect ratio of the vignette shape (lower = more rectangular).',
    });
    const modeControl = this.createSelect('Mode', VIGNETTE_MODES, this.state.vignette.mode, (value) => {
      this.state.vignette.mode = value;
      this.emitChange();
    }, {
      description: 'Blend mode used when darkening the edges.',
    });
    section.body.append(
      strengthControl,
      radiusControl,
      featherControl,
      roundnessControl,
      modeControl
    );
    this.setSectionDisabled(section, this.state.vignette.enabled === false);
  }

  createRandomSection() {
    const section = this.createSection('Randomness');
    const seedDisplay = document.createElement('div');
    seedDisplay.className = 'mb-2 text-monospace small';
    seedDisplay.id = 'seed-display';
    seedDisplay.textContent = `Seed: ${formatSeed(this.state.random.seed)}`;
    section.body.append(seedDisplay);
    const seedInput = this.createNumberInput('Seed', this.state.random.seed, 0, 2 ** 32 - 1, 1, (value) => {
      this.state.random.seed = value >>> 0;
      seedDisplay.textContent = `Seed: ${formatSeed(this.state.random.seed)}`;
      this.emitChange();
    }, {
      description: 'Random seed that drives gradient, grain, and vignette variation.',
    });
    section.body.append(seedInput);
    const randomizeButton = document.getElementById('randomize-button');
    if (randomizeButton) {
      if (!randomizeButton.dataset.bound) {
        randomizeButton.addEventListener('click', () => {
          this.state.random.seed = randomSeed();
          seedDisplay.textContent = `Seed: ${formatSeed(this.state.random.seed)}`;
          seedInput.querySelector('input').value = this.state.random.seed;
          this.emitChange();
        });
        randomizeButton.dataset.bound = 'true';
      }
    }
  }

  createOutputSection() {
    const section = this.createSection('Output');
    const formatControl = this.createSelect('Format', OUTPUT_FORMATS, this.state.output.format, (value) => {
      this.state.output.format = value;
      this.emitChange();
    }, {
      description: 'File type to generate when exporting the wallpaper.',
    });
    const jpegQualityControl = this.createRangeInput('JPEG Quality', this.state.output.jpgQuality, 0.6, 1, 0.01, (value) => {
      this.state.output.jpgQuality = value;
      this.emitChange();
    }, {
      description: 'Compression quality for JPEG exports (higher = larger file).',
    });
    const metadataControl = this.createCheckbox('Embed Metadata', this.state.output.embedMetadata, (checked) => {
      this.state.output.embedMetadata = checked;
      this.emitChange();
    }, {
      description: 'Include the generator settings in the exported file metadata.',
    });
    section.body.append(formatControl, jpegQualityControl, metadataControl);
    this.registerVisibility(jpegQualityControl, () => this.state.output.format === 'jpg');
  }

  updateShaderDescription() {
    if (!this.shaderDescriptionEl) return;
    const current = this.state.rendering?.shader ?? 'classic';
    const option = this.shaderOptions.find((entry) => entry.id === current);
    const fallbacks = {
      classic: 'Baseline renderer blending the gradient with the base color.',
      lumina: 'Adds a subtle bloom from the center to enhance luminosity.',
      nocturne: 'Applies a cool tint and gentle contrast lift for night scenes.',
      ember: 'Warms outer edges with ember-inspired glow.',
    };
    this.shaderDescriptionEl.textContent = option?.description ?? fallbacks[current] ?? 'Configure the shader pipeline for the background.';
  }

  createSection(title, options = {}) {
    const id = `section-${this.sectionIdCounter++}`;
    const card = document.createElement('div');
    card.className = 'accordion-item bg-transparent text-light border-secondary';
    const header = document.createElement('h2');
    header.className = 'accordion-header';
    const headerRow = document.createElement('div');
    headerRow.className = 'd-flex align-items-center justify-content-between gap-2';
    const button = document.createElement('button');
    button.className = 'accordion-button collapsed bg-dark text-light';
    button.type = 'button';
    button.dataset.bsToggle = 'collapse';
    button.dataset.bsTarget = `#${id}`;
    button.textContent = title;
    headerRow.append(button);
    const bodyWrapper = document.createElement('div');
    bodyWrapper.id = id;
    bodyWrapper.className = 'accordion-collapse collapse';
    const body = document.createElement('div');
    body.className = 'accordion-body d-flex flex-column gap-3';
    bodyWrapper.append(body);
    const section = { card, header, body, bodyWrapper };
    if (options.toggle) {
      const toggleWrapper = document.createElement('div');
      toggleWrapper.className = 'form-check form-switch mb-0 section-toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'form-check-input';
      toggleInput.id = `${id}-toggle`;
      toggleInput.checked = options.toggle.isEnabled();
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'form-check-label small';
      toggleLabel.setAttribute('for', toggleInput.id);
      toggleLabel.textContent = options.toggle.label ?? 'Enabled';
      toggleWrapper.append(toggleInput, toggleLabel);
      toggleWrapper.addEventListener('click', (event) => event.stopPropagation());
      toggleInput.addEventListener('change', () => {
        const enabled = toggleInput.checked;
        options.toggle.onToggle(enabled);
        this.setSectionDisabled(section, !enabled);
      });
      headerRow.append(toggleWrapper);
    }
    header.append(headerRow);
    card.append(header, bodyWrapper);
    this.accordionRoot.append(card);
    return section;
  }

  setSectionDisabled(section, disabled) {
    const isDisabled = Boolean(disabled);
    section.card.classList.toggle('section-disabled', isDisabled);
    section.body.setAttribute('aria-disabled', String(isDisabled));
    const controls = section.body.querySelectorAll('input, select, textarea, button');
    controls.forEach((control) => {
      if (isDisabled) {
        if (control.disabled) {
          control.dataset.sectionToggleDisabled = 'preserve';
        } else {
          control.dataset.sectionToggleDisabled = 'toggle';
          control.disabled = true;
        }
      } else {
        if (control.dataset.sectionToggleDisabled === 'toggle') {
          control.disabled = false;
        }
        delete control.dataset.sectionToggleDisabled;
      }
    });
  }

  registerVisibility(element, predicate) {
    if (!element || typeof predicate !== 'function') return;
    const binding = { element, predicate };
    this.visibilityBindings.push(binding);
    this.updateVisibilityForBinding(binding);
  }

  updateVisibilityBindings() {
    this.visibilityBindings.forEach((binding) => this.updateVisibilityForBinding(binding));
  }

  updateVisibilityForBinding(binding) {
    if (!binding?.element || typeof binding.predicate !== 'function') {
      return;
    }
    const shouldShow = Boolean(binding.predicate());
    binding.element.hidden = !shouldShow;
    if (shouldShow) {
      binding.element.removeAttribute('aria-hidden');
    } else {
      binding.element.setAttribute('aria-hidden', 'true');
    }
  }

  applyDescription(element, description) {
    if (!description || !element) return;
    element.setAttribute('title', description);
    const desc = document.createElement('div');
    desc.className = 'setting-description';
    desc.textContent = description;
    element.append(desc);
  }

  createRangeInput(label, value, min, max, step, onChange, options = {}) {
    let showAsPercent = false;
    let description;
    if (typeof options === 'boolean') {
      showAsPercent = options;
    } else if (options && typeof options === 'object') {
      showAsPercent = Boolean(options.showAsPercent);
      description = options.description;
    }
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100';
    const title = document.createElement('span');
    title.className = 'setting-label';
    title.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'form-range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    const number = document.createElement('input');
    number.type = 'number';
    number.className = 'form-control form-control-sm';
    number.value = showAsPercent ? (value * 100).toFixed(0) : value;
    number.min = showAsPercent ? min * 100 : min;
    number.max = showAsPercent ? max * 100 : max;
    number.step = showAsPercent ? step * 100 : step;
    number.inputMode = 'decimal';
    const sliderRow = document.createElement('div');
    sliderRow.className = 'slider-input';
    sliderRow.append(range, number);
    const sync = (newValue) => {
      const clamped = clamp(newValue, min, max);
      range.value = String(clamped);
      number.value = showAsPercent ? Math.round(clamped * 100) : clamped;
      onChange(parseFloat(clamped));
    };
    range.addEventListener('input', () => {
      const val = parseFloat(range.value);
      number.value = showAsPercent ? Math.round(val * 100) : val;
      onChange(val);
    });
    number.addEventListener('change', () => {
      const val = parseFloat(number.value);
      const normalized = showAsPercent ? val / 100 : val;
      sync(normalized);
    });
    wrapper.append(title, sliderRow);
    this.applyDescription(wrapper, description);
    return wrapper;
  }

  createNumberInput(label, value, min, max, step, onChange, options = {}) {
    const description = options?.description;
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100';
    const title = document.createElement('span');
    title.className = 'setting-label';
    title.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'form-control form-control-sm';
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('change', () => {
      const val = clamp(parseFloat(input.value), min, max);
      input.value = val;
      onChange(val);
    });
    wrapper.append(title, input);
    this.applyDescription(wrapper, description);
    return wrapper;
  }

  createSelect(label, options, selected, onChange, config = {}) {
    const description = config?.description;
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100';
    const title = document.createElement('span');
    title.className = 'setting-label';
    title.textContent = label;
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm bg-dark text-light';
    options.forEach((optionEntry) => {
      const value = typeof optionEntry === 'string' ? optionEntry : optionEntry.value;
      const text = typeof optionEntry === 'string' ? optionEntry : optionEntry.label ?? optionEntry.value;
      const optionEl = document.createElement('option');
      optionEl.value = value;
      optionEl.textContent = text;
      if (value === selected) optionEl.selected = true;
      select.append(optionEl);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrapper.append(title, select);
    this.applyDescription(wrapper, description);
    return wrapper;
  }

  createCheckbox(label, checked, onChange, options = {}) {
    const description = options?.description;
    const wrapper = document.createElement('div');
    wrapper.className = 'form-check form-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('label');
    span.className = 'form-check-label';
    span.textContent = label;
    wrapper.append(input, span);
    this.applyDescription(wrapper, description);
    return wrapper;
  }

  setState(nextState) {
    this.state = cloneState(nextState);
    this.render();
  }

  emitChange() {
    this.updateVisibilityBindings();
    this.onColorPreviewUpdate?.();
    this.onChange(this.stateSnapshot);
  }
}
