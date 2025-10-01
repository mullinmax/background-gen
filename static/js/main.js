import { ControlPanel } from './controls.js';
import { PresetManager } from './presets.js';
import { WallpaperRenderer, downloadWallpaper } from './renderer.js';
import {
  cloneState,
  defaultState,
  decodeStateFromUrl,
  encodeStateToUrl,
  normalizeState,
  serializeState,
} from './state.js';
import { debounce, downloadBlob, fileToText, toast } from './utils.js';

const accordionRoot = document.getElementById('controls-accordion');
const controlsPanel = document.getElementById('controls-panel');
const presetsList = document.getElementById('presets-list');
const historyList = document.getElementById('history-list');
const togglePresets = document.getElementById('toggle-presets');
const previewCanvas = document.getElementById('preview-canvas');

let currentState = initState();
const renderer = new WallpaperRenderer(previewCanvas, currentState);
const controlPanel = new ControlPanel(controlsPanel, accordionRoot, currentState, handleStateChange);
const presets = new PresetManager(presetsList, historyList, (state) => {
  updateState(state);
  controlPanel.setState(state);
  renderer.updateState(state);
  updateLocationHash(state);
});

presets.loadPresets();
presets.addHistory('Initial', currentState);

bindUi();
updateLocationHash(currentState);

function initState() {
  const urlState = decodeStateFromUrl(window.location.hash.slice(1));
  if (urlState) {
    return urlState;
  }
  return cloneState(defaultState);
}

function handleStateChange(nextState) {
  updateState(nextState);
  renderer.updateState(nextState);
  presets.addHistory('Adjusted', nextState);
  scheduleHashUpdate();
}

function updateState(nextState) {
  currentState = normalizeState(nextState);
}

const scheduleHashUpdate = debounce(() => {
  updateLocationHash(currentState);
}, 300);

function updateLocationHash(state) {
  const encoded = encodeStateToUrl(state);
  window.location.hash = encoded;
}

function bindUi() {
  document.getElementById('reset-button').addEventListener('click', () => {
    currentState = cloneState(defaultState);
    controlPanel.setState(currentState);
    renderer.updateState(currentState);
    toast('Settings reset to defaults', 'warning');
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
      updateLocationHash(state);
    } catch (error) {
      console.error(error);
      toast('Failed to import preset', 'danger');
    }
  });

  document.getElementById('download-button').addEventListener('click', async () => {
    await downloadWallpaper(renderer, currentState);
  });

  togglePresets.addEventListener('click', () => {
    const panel = document.getElementById('presets-panel');
    panel.classList.toggle('d-none');
  });
}

window.addEventListener('hashchange', () => {
  const state = decodeStateFromUrl(window.location.hash.slice(1));
  if (state) {
    currentState = state;
    controlPanel.setState(state);
    renderer.updateState(state);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((error) => console.warn('Service worker registration failed', error));
  });
}
