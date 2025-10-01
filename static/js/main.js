import { ControlPanel } from './controls.js';
import { PresetManager } from './presets.js';
import { WallpaperRenderer } from './renderer.js';
import {
  cloneState,
  defaultState,
  decodeStateFromUrl,
  encodeStateToUrl,
  normalizeState,
  serializeState,
  stateFingerprint,
} from './state.js';
import { debounce, downloadBlob, fileToText, formatDimension, toast } from './utils.js';

const accordionRoot = document.getElementById('controls-accordion');
const controlsPanel = document.getElementById('controls-panel');
const presetsList = document.getElementById('presets-list');
const historyList = document.getElementById('history-list');
const togglePresets = document.getElementById('toggle-presets');
const previewCanvas = document.getElementById('preview-canvas');
const renderButton = document.getElementById('render-button');
const downloadButton = document.getElementById('download-button');
const renderStatus = document.getElementById('render-status');

let currentState = null;
let renderer = null;
let controlPanel = null;
let presets = null;
let shaderOptions = [];
let lastRenderResult = null;
let renderDirty = true;
let isRendering = false;
let autoRenderHandle = null;
let pendingHistorySnapshot = null;
let pendingHistoryDetail = '';

const commitHistoryEntry = debounce(() => {
  if (!pendingHistorySnapshot || !pendingHistoryDetail || !presets) {
    return;
  }
  presets.addHistory('Adjusted', pendingHistorySnapshot, { detail: pendingHistoryDetail });
  pendingHistorySnapshot = null;
  pendingHistoryDetail = '';
}, 500);

bootstrap();

async function bootstrap() {
  shaderOptions = await loadShaderOptions();
  currentState = initState();
  renderer = new WallpaperRenderer(previewCanvas, currentState);
  controlPanel = new ControlPanel(controlsPanel, accordionRoot, currentState, handleStateChange, shaderOptions);
  presets = new PresetManager(presetsList, historyList, (state) => {
    updateState(state);
    controlPanel.setState(state);
    renderer.updateState(state);
    markRenderDirty();
    updateLocationHash(state);
  });

  presets.loadPresets();
  presets.addHistory('Initial', currentState, { detail: 'Starting point' });

  bindUi();
  setRenderStatus('Render pending', 'secondary');
  markRenderDirty();
  await ensureRender({ showSuccessToast: false });
  updateLocationHash(currentState);
}

async function loadShaderOptions() {
  try {
    const response = await fetch('/api/shaders');
    if (!response.ok) throw new Error('Failed to fetch shader catalog');
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Invalid shader catalog response');
    return payload;
  } catch (error) {
    console.warn('Falling back to built-in shader catalog', error);
    return [
      { id: 'classic', name: 'Classic Gradient', description: 'Baseline renderer.', default_strength: 0 },
      { id: 'lumina', name: 'Lumina Bloom', description: 'Soft bloom highlight.', default_strength: 0.5 },
      { id: 'nocturne', name: 'Nocturne Veil', description: 'Cool-toned variant.', default_strength: 0.6 },
      { id: 'ember', name: 'Ember Drift', description: 'Warm edge glow.', default_strength: 0.5 },
    ];
  }
}

function initState() {
  const urlState = decodeStateFromUrl(window.location.hash.slice(1));
  if (urlState) {
    return urlState;
  }
  return cloneState(defaultState);
}

function handleStateChange(nextState) {
  const previousState = currentState ? cloneState(currentState) : null;
  updateState(nextState);
  renderer.updateState(nextState);
  const detail = summarizeStateChange(previousState, currentState);
  queueHistoryEntry(currentState, detail);
  markRenderDirty();
  scheduleHashUpdate();
}

function updateState(nextState) {
  currentState = normalizeState(nextState);
}

const scheduleHashUpdate = debounce(() => {
  updateLocationHash(currentState);
}, 300);

function queueHistoryEntry(state, detail) {
  if (!detail || detail === 'Settings updated') {
    pendingHistorySnapshot = null;
    pendingHistoryDetail = '';
    return;
  }
  pendingHistorySnapshot = cloneState(state);
  pendingHistoryDetail = detail;
  commitHistoryEntry();
}

function updateLocationHash(state) {
  const encoded = encodeStateToUrl(state);
  window.location.hash = encoded;
}

function summarizeStateChange(previousState, nextState) {
  if (!previousState || !nextState) {
    return 'Settings updated';
  }

  const sectionLabels = [
    ['canvas', 'Canvas'],
    ['color', 'Color'],
    ['rendering', 'Rendering'],
    ['gradient', 'Gradient'],
    ['grain', 'Grain'],
    ['vignette', 'Vignette'],
    ['random', 'Randomness'],
    ['output', 'Output'],
  ];

  const changedSections = sectionLabels
    .filter(([key]) => JSON.stringify(previousState[key]) !== JSON.stringify(nextState[key]))
    .map(([, label]) => label);

  if (changedSections.length === 0) {
    return 'Settings updated';
  }

  if (changedSections.length === 1) {
    return `${changedSections[0]} settings adjusted`;
  }

  if (changedSections.length === 2) {
    return `${changedSections[0]} & ${changedSections[1]} settings adjusted`;
  }

  const initial = changedSections.slice(0, -1).join(', ');
  const last = changedSections[changedSections.length - 1];
  return `${initial}, & ${last} settings adjusted`;
}

function bindUi() {
  document.getElementById('reset-button').addEventListener('click', () => {
    currentState = cloneState(defaultState);
    controlPanel.setState(currentState);
    renderer.updateState(currentState);
    toast('Settings reset to defaults', 'warning');
    markRenderDirty();
    scheduleHashUpdate();
  });

  document.getElementById('copy-url-button').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Share URL copied to clipboard', 'success');
    } catch (error) {
      console.error(error);
      toast('Unable to copy URL', 'danger');
    }
  });

  document.getElementById('export-json-button').addEventListener('click', () => {
    const blob = new Blob([serializeState(currentState)], { type: 'application/json' });
    downloadBlob(blob, `wallpaper-settings-${Date.now()}.json`);
  });

  document.getElementById('import-json-input').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const text = await fileToText(file);
      const state = normalizeState(JSON.parse(text));
      currentState = state;
      controlPanel.setState(state);
      renderer.updateState(state);
      toast('Preset imported', 'success');
      markRenderDirty();
      updateLocationHash(state);
    } catch (error) {
      console.error(error);
      toast('Failed to import preset', 'danger');
    }
  });

  if (renderButton) {
    renderButton.addEventListener('click', () => {
      performRender({ notifyBusy: true });
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener('click', async () => {
      const needsRender = renderDirty || !lastRenderMatchesCurrent();
      const rendered = await ensureRender({
        showSuccessToast: needsRender,
        successMessage: 'Render complete — starting download',
      });
      if (!rendered) {
        return;
      }
      if (!lastRenderResult) {
        toast('No rendered wallpaper is available', 'danger');
        return;
      }
      const { blob, state } = lastRenderResult;
      const extension = state.output.format === 'jpg' ? 'jpg' : state.output.format;
      const filename = `wall_${formatDimension(state.canvas.width, state.canvas.height)}_${state.random.seed}.${extension}`;
      downloadBlob(blob, filename);
      if (!needsRender) {
        toast('Download started', 'success');
      }
    });
  }

  if (togglePresets) {
    togglePresets.setAttribute('aria-controls', 'presets-panel');
    togglePresets.setAttribute('aria-expanded', 'true');
    togglePresets.textContent = 'Hide';
    togglePresets.addEventListener('click', () => {
      const panel = document.getElementById('presets-panel');
      if (!panel) return;
      const collapsed = panel.classList.toggle('collapsed');
      togglePresets.textContent = collapsed ? 'Show' : 'Hide';
      togglePresets.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  updateDownloadAvailability();
}

window.addEventListener('hashchange', () => {
  if (!controlPanel || !renderer) return;
  const state = decodeStateFromUrl(window.location.hash.slice(1));
  if (!state) {
    return;
  }
  if (currentState && stateFingerprint(state) === stateFingerprint(currentState)) {
    return;
  }
  pendingHistorySnapshot = null;
  pendingHistoryDetail = '';
  currentState = state;
  controlPanel.setState(state);
  renderer.updateState(state);
  markRenderDirty();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((error) => console.warn('Service worker registration failed', error));
  });
}

function markRenderDirty() {
  renderDirty = true;
  scheduleAutoRender();
  if (!isRendering) {
    setRenderStatus('Changes pending render', 'warning');
  }
  updateDownloadAvailability();
}

function lastRenderMatchesCurrent() {
  if (!lastRenderResult) return false;
  return lastRenderResult.fingerprint === stateFingerprint(currentState);
}

function updateDownloadAvailability() {
  if (!downloadButton) return;
  const ready = !renderDirty && lastRenderMatchesCurrent();
  downloadButton.disabled = isRendering || !ready;
  downloadButton.title = ready ? 'Download the most recent render' : 'Render the wallpaper before downloading';
}

function scheduleAutoRender() {
  if (autoRenderHandle) {
    clearTimeout(autoRenderHandle);
  }
  autoRenderHandle = setTimeout(() => {
    ensureRender({ showSuccessToast: false });
  }, 800);
}

function setRenderStatus(message, tone = 'secondary') {
  if (!renderStatus) return;
  const toneClass = tone === 'secondary' ? 'text-secondary' : `text-${tone}`;
  renderStatus.className = `small ${toneClass}`;
  renderStatus.textContent = message;
}

function setRenderButtonBusy(busy) {
  if (renderButton) {
    renderButton.disabled = busy;
    renderButton.textContent = busy ? 'Rendering…' : 'Render';
  }
  updateDownloadAvailability();
}

async function performRender({ showSuccessToast = true, successMessage = 'Render complete', showErrorToast = true, notifyBusy = false } = {}) {
  if (!renderer) return false;
  if (isRendering) {
    if (notifyBusy) {
      toast('A render is already in progress', 'info');
    }
    return false;
  }
  if (autoRenderHandle) {
    clearTimeout(autoRenderHandle);
    autoRenderHandle = null;
  }
  isRendering = true;
  setRenderButtonBusy(true);
  setRenderStatus('Rendering…', 'info');
  updateDownloadAvailability();
  const snapshot = cloneState(currentState);
  const fingerprint = stateFingerprint(snapshot);
  const format = snapshot.output.format;
  try {
    const blob = await renderer.renderToBlob(snapshot, format);
    lastRenderResult = { blob, state: snapshot, fingerprint };
    renderDirty = false;
    if (showSuccessToast) {
      toast(successMessage, 'success');
    }
    setRenderStatus('Render up to date', 'success');
    return true;
  } catch (error) {
    console.error(error);
    renderDirty = true;
    if (showErrorToast) {
      toast('Failed to render wallpaper', 'danger');
    }
    setRenderStatus('Render failed', 'danger');
    return false;
  } finally {
    isRendering = false;
    setRenderButtonBusy(false);
    updateDownloadAvailability();
  }
}

async function ensureRender(options = {}) {
  if (!renderDirty && lastRenderMatchesCurrent()) {
    return true;
  }
  return performRender(options);
}
