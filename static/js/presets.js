import { cloneState, normalizeState, stateFingerprint } from './state.js';
import { toast } from './utils.js';

export class PresetManager {
  constructor(listEl, historyEl, onApply) {
    this.listEl = listEl;
    this.historyEl = historyEl;
    this.onApply = onApply;
    this.history = [];
  }

  async loadPresets() {
    try {
      const response = await fetch('/api/presets');
      if (!response.ok) throw new Error('Failed to load presets');
      const presets = await response.json();
      this.renderPresets(presets);
    } catch (error) {
      console.error(error);
      toast('Unable to load presets. Falling back to defaults.', 'danger');
    }
  }

  renderPresets(presets) {
    this.listEl.innerHTML = '';
    presets.forEach((preset) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action bg-transparent text-light';
      item.textContent = preset.name;
      item.dataset.presetId = preset.id;
      item.addEventListener('click', () => this.applyPreset(preset));
      this.listEl.appendChild(item);
    });
  }

  applyPreset(preset) {
    const state = normalizeState(preset.settings);
    this.addHistory(preset.name, state);
    this.onApply(cloneState(state));
  }

  addHistory(label, state) {
    const fingerprint = stateFingerprint(state);
    const exists = this.history.find((item) => item.fingerprint === fingerprint);
    if (exists) return;
    const entry = { label, fingerprint, state: cloneState(state) };
    this.history.unshift(entry);
    if (this.history.length > 12) {
      this.history.pop();
    }
    this.renderHistory();
  }

  renderHistory() {
    this.historyEl.innerHTML = '';
    this.history.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-group-item list-group-item-action bg-transparent text-light';
      btn.textContent = item.label;
      btn.addEventListener('click', () => this.onApply(cloneState(item.state)));
      this.historyEl.appendChild(btn);
    });
  }
}
