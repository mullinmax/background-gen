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
    this.addHistory(preset.name, state, { detail: 'Preset applied' });
    this.onApply(cloneState(state));
  }

  addHistory(label, state, metadata = {}) {
    const fingerprint = stateFingerprint(state);
    const exists = this.history.find((item) => item.fingerprint === fingerprint);
    if (exists) return;
    const entry = {
      label,
      fingerprint,
      state: cloneState(state),
      detail: metadata.detail ?? '',
      timestamp: metadata.timestamp ?? Date.now(),
    };
    this.history.unshift(entry);
    if (this.history.length > 12) {
      this.history.pop();
    }
    this.renderHistory();
  }

  removeHistory(fingerprint) {
    this.history = this.history.filter((item) => item.fingerprint !== fingerprint);
    this.renderHistory();
  }

  renderHistory() {
    this.historyEl.innerHTML = '';
    this.history.forEach((item) => {
      const entry = document.createElement('div');
      entry.className = 'list-group-item bg-transparent text-light';

      const row = document.createElement('div');
      row.className = 'd-flex justify-content-between align-items-start gap-2';

      const info = document.createElement('div');
      info.className = 'flex-grow-1';

      const title = document.createElement('div');
      title.className = 'fw-semibold';
      title.textContent = item.label;
      info.appendChild(title);

      const metaParts = [];
      if (item.detail) {
        metaParts.push(item.detail);
      }
      if (item.timestamp) {
        metaParts.push(this.formatTimestamp(item.timestamp));
      }
      if (metaParts.length) {
        const meta = document.createElement('div');
        meta.className = 'small text-secondary';
        meta.textContent = metaParts.join(' · ');
        info.appendChild(meta);
      }

      const actions = document.createElement('div');
      actions.className = 'btn-group btn-group-sm flex-shrink-0';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-outline-light btn-sm';
      applyBtn.textContent = 'Reapply';
      applyBtn.addEventListener('click', () => this.onApply(cloneState(item.state)));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-outline-danger btn-sm';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => this.removeHistory(item.fingerprint));

      actions.append(applyBtn, removeBtn);
      row.append(info, actions);
      entry.append(row);
      this.historyEl.appendChild(entry);
    });
  }

  formatTimestamp(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (error) {
      console.warn('Unable to format timestamp', error);
      return '';
    }
  }
}
