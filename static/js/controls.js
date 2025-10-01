import { MAX_GRADIENT_STOPS, cloneState, randomSeed } from './state.js';
import { clamp, formatSeed, hslToRgb } from './utils.js';

const GRADIENT_TYPES = ['none', 'linear', 'radial', 'conic', 'corner-glow'];
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

export class ControlPanel {
  constructor(root, accordionRoot, initialState, onChange, shaderOptions = []) {
    this.root = root;
    this.accordionRoot = accordionRoot;
    this.onChange = onChange;
    this.state = cloneState(initialState);
    this.shaderOptions = Array.isArray(shaderOptions) ? shaderOptions : [];
    this.shaderDescriptionEl = null;
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
    this.createCanvasSection();
    this.createColorSection();
    this.createRenderingSection();
    this.createGradientSection();
    this.createGrainSection();
    this.createVignetteSection();
    this.createRandomSection();
    this.createOutputSection();
  }

  createCanvasSection() {
    const section = this.createSection('Canvas');
    section.body.append(
      this.createNumberInput('Width', this.state.canvas.width, 256, 10000, 1, (value) => {
        this.state.canvas.width = value;
        this.emitChange();
      }),
      this.createNumberInput('Height', this.state.canvas.height, 256, 10000, 1, (value) => {
        this.state.canvas.height = value;
        this.emitChange();
      }),
      this.createRangeInput('Preview Scale', this.state.canvas.previewScale, 0.1, 1, 0.05, (value) => {
        this.state.canvas.previewScale = value;
        this.emitChange();
      })
    );
  }

  createColorSection() {
    const section = this.createSection('Color');
    section.body.append(
      this.createRangeInput('Hue', this.state.color.hue, 0, 360, 1, (value) => {
        this.state.color.hue = value;
        this.emitChange();
      }),
      this.createRangeInput('Saturation', this.state.color.saturation, 0, 1, 0.01, (value) => {
        this.state.color.saturation = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Lightness', this.state.color.lightness, 0, 1, 0.01, (value) => {
        this.state.color.lightness = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Gamma', this.state.color.gamma, 0.8, 2.2, 0.01, (value) => {
        this.state.color.gamma = value;
        this.emitChange();
      })
    );
    const preview = document.createElement('div');
    preview.className = 'mt-3 p-3 rounded border border-secondary bg-dark text-center';
    preview.textContent = 'Color Preview';
    section.body.append(preview);
    const updatePreview = () => {
      const [r, g, b] = hslToRgb(this.state.color.hue, this.state.color.saturation, this.state.color.lightness);
      preview.style.background = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    };
    updatePreview();
    this.onColorPreviewUpdate = updatePreview;
  }

  createRenderingSection() {
    if (!this.state.rendering) {
      this.state.rendering = { shader: 'classic', shaderStrength: 0.5 };
    }
    const section = this.createSection('Rendering');
    const options = (this.shaderOptions.length
      ? this.shaderOptions
      : [{ id: 'classic', name: 'Classic Gradient', description: 'Baseline renderer.', default_strength: 0 }]
    ).map((option) => ({ value: option.id, label: option.name, description: option.description, strength: option.default_strength ?? 0 }));
    section.body.append(
      this.createSelect(
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
        }
      )
    );
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
      true
    );
    const [rangeEl, numberEl] = strengthControl.querySelectorAll('input');
    this.shaderStrengthInput = rangeEl;
    this.shaderStrengthNumber = numberEl;
    section.body.append(strengthControl);
  }

  createGradientSection() {
    const section = this.createSection('Gradient');
    const palette = this.ensureGradientPalette();
    section.body.append(
      this.createSelect('Type', GRADIENT_TYPES, this.state.gradient.type, (value) => {
        this.state.gradient.type = value;
        this.emitChange();
      }),
      this.createSelect('Mode', GRADIENT_MODES, this.state.gradient.mode, (value) => {
        this.state.gradient.mode = value;
        this.emitChange();
      }),
      this.createRangeInput('Angle', this.state.gradient.angle, 0, 360, 1, (value) => {
        this.state.gradient.angle = value;
        this.emitChange();
      }),
      this.createRangeInput('Center X', this.state.gradient.center.x, 0, 1, 0.01, (value) => {
        this.state.gradient.center.x = value;
        this.emitChange();
      }),
      this.createRangeInput('Center Y', this.state.gradient.center.y, 0, 1, 0.01, (value) => {
        this.state.gradient.center.y = value;
        this.emitChange();
      }),
      this.createRangeInput('Scale', this.state.gradient.scale, 0.1, 2, 0.01, (value) => {
        this.state.gradient.scale = value;
        this.emitChange();
      }),
      this.createRangeInput('Palette Hue', palette.hue, 0, 360, 1, (value) => {
        this.state.gradient.palette.hue = value;
        this.emitChange();
      }),
      this.createRangeInput('Palette Saturation', palette.saturation, 0, 1, 0.01, (value) => {
        this.state.gradient.palette.saturation = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Palette Lightness', palette.lightness, 0, 1, 0.01, (value) => {
        this.state.gradient.palette.lightness = value;
        this.emitChange();
      }, true),
      this.createSelect('Blend', BLEND_MODES, this.state.gradient.blend, (value) => {
        this.state.gradient.blend = value;
        this.emitChange();
      })
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
        }, true),
        this.createRangeInput('Hue Shift', stop.hueShift, -180, 180, 1, (value) => {
          this.state.gradient.stops[index].hueShift = value;
          this.emitChange();
        }),
        this.createRangeInput('Lightness Δ', stop.lightnessDelta, -1, 1, 0.01, (value) => {
          this.state.gradient.stops[index].lightnessDelta = value;
          this.emitChange();
        }, true),
        this.createRangeInput('Opacity', stop.opacity, 0, 1, 0.01, (value) => {
          this.state.gradient.stops[index].opacity = value;
          this.emitChange();
        }, true)
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
    const section = this.createSection('Grain');
    section.body.append(
      this.createRangeInput('Amount', this.state.grain.amount, 0, 100, 1, (value) => {
        this.state.grain.amount = value;
        this.emitChange();
      }),
      this.createSelect('Size', GRAIN_SIZES, this.state.grain.size, (value) => {
        this.state.grain.size = value;
        this.emitChange();
      }),
      this.createSelect('Algorithm', GRAIN_ALGORITHMS, this.state.grain.algorithm, (value) => {
        this.state.grain.algorithm = value;
        this.emitChange();
      }),
      this.createNumberInput('Octaves', this.state.grain.octaves, 1, 8, 1, (value) => {
        this.state.grain.octaves = value;
        this.emitChange();
      }),
      this.createRangeInput('Lacunarity', this.state.grain.lacunarity, 1, 4, 0.05, (value) => {
        this.state.grain.lacunarity = value;
        this.emitChange();
      }),
      this.createRangeInput('Gain', this.state.grain.gain, 0.1, 1, 0.01, (value) => {
        this.state.grain.gain = value;
        this.emitChange();
      }),
      this.createCheckbox('Chroma Noise', this.state.grain.chroma.enabled, (checked) => {
        this.state.grain.chroma.enabled = checked;
        this.emitChange();
      }),
      this.createRangeInput('Chroma Intensity', this.state.grain.chroma.intensity, 0, 0.2, 0.01, (value) => {
        this.state.grain.chroma.intensity = value;
        this.emitChange();
      }, true),
      this.createSelect('Intensity Curve', INTENSITY_CURVES, this.state.grain.intensityCurve, (value) => {
        this.state.grain.intensityCurve = value;
        this.emitChange();
      }),
      this.createRangeInput('Protect Shadows', this.state.grain.protectShadows, 0, 0.2, 0.01, (value) => {
        this.state.grain.protectShadows = value;
        this.emitChange();
      }, true)
    );
  }

  createVignetteSection() {
    const section = this.createSection('Vignette');
    section.body.append(
      this.createRangeInput('Strength', this.state.vignette.strength, 0, 1, 0.01, (value) => {
        this.state.vignette.strength = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Radius', this.state.vignette.radius, 0, 1, 0.01, (value) => {
        this.state.vignette.radius = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Feather', this.state.vignette.feather, 0, 1, 0.01, (value) => {
        this.state.vignette.feather = value;
        this.emitChange();
      }, true),
      this.createRangeInput('Roundness', this.state.vignette.roundness, 0.2, 2, 0.01, (value) => {
        this.state.vignette.roundness = value;
        this.emitChange();
      }),
      this.createSelect('Mode', VIGNETTE_MODES, this.state.vignette.mode, (value) => {
        this.state.vignette.mode = value;
        this.emitChange();
      })
    );
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
    section.body.append(
      this.createSelect('Format', OUTPUT_FORMATS, this.state.output.format, (value) => {
        this.state.output.format = value;
        this.emitChange();
      }),
      this.createRangeInput('JPEG Quality', this.state.output.jpgQuality, 0.6, 1, 0.01, (value) => {
        this.state.output.jpgQuality = value;
        this.emitChange();
      }),
      this.createCheckbox('Embed Metadata', this.state.output.embedMetadata, (checked) => {
        this.state.output.embedMetadata = checked;
        this.emitChange();
      })
    );
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

  createSection(title) {
    const id = `section-${this.sectionIdCounter++}`;
    const card = document.createElement('div');
    card.className = 'accordion-item bg-transparent text-light border-secondary';
    const header = document.createElement('h2');
    header.className = 'accordion-header';
    const button = document.createElement('button');
    button.className = 'accordion-button collapsed bg-dark text-light';
    button.type = 'button';
    button.dataset.bsToggle = 'collapse';
    button.dataset.bsTarget = `#${id}`;
    button.textContent = title;
    header.append(button);
    const bodyWrapper = document.createElement('div');
    bodyWrapper.id = id;
    bodyWrapper.className = 'accordion-collapse collapse';
    bodyWrapper.dataset.bsParent = '#controls-accordion';
    const body = document.createElement('div');
    body.className = 'accordion-body d-flex flex-column gap-3';
    bodyWrapper.append(body);
    card.append(header, bodyWrapper);
    this.accordionRoot.append(card);
    return { card, header, body, bodyWrapper };
  }

  createRangeInput(label, value, min, max, step, onChange, showAsPercent = false) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100 slider-input';
    wrapper.textContent = label;
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
    wrapper.append(range, number);
    return wrapper;
  }

  createNumberInput(label, value, min, max, step, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100';
    wrapper.textContent = label;
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
    wrapper.append(input);
    return wrapper;
  }

  createSelect(label, options, selected, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-label w-100';
    wrapper.textContent = label;
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
    wrapper.append(select);
    return wrapper;
  }

  createCheckbox(label, checked, onChange) {
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
    return wrapper;
  }

  setState(nextState) {
    this.state = cloneState(nextState);
    this.render();
  }

  emitChange() {
    this.onColorPreviewUpdate?.();
    this.onChange(this.stateSnapshot);
  }
}
