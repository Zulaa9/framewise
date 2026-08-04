// Configuración por defecto y utilidades compartidas por content.js, popup.js, options.js y background.js.

// Rango real de velocidad admitido por el reproductor (ver setSpeed en content.js). Vive aquí para
// que options.js pueda validar presets manuales contra el mismo límite sin duplicar los números.
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

// Ajustes que tiene sentido llevar contigo entre equipos (chrome.storage.sync, límite ~100KB).
const SYNC_DEFAULTS = {
  fps: 23.976,
  speedStep: 0.25,
  seekSeconds: 5,
  multiFrameCount: 5,
  showOverlay: true,
  frameStepAudio: true,
  wheelSpeedControl: true,
  rememberSpeedPerDomain: true,
  volumeMax: 300, // % máximo (100 = volumen normal del navegador; por encima se amplifica con Web Audio API)
  volumeStep: 10,
  rememberVolumePerDomain: true,
  speedPresets: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4],
  actions: {
    frameBack:         { label: "Retroceder 1 frame",                shortcut: ",", repeatable: true },
    frameForward:       { label: "Avanzar 1 frame",                    shortcut: ".", repeatable: true },
    frameBackMulti:     { label: "Retroceder N frames",                shortcut: "", repeatable: true },
    frameForwardMulti:  { label: "Avanzar N frames",                   shortcut: "", repeatable: true },
    speedUp:            { label: "Subir velocidad (siguiente preset)", shortcut: "]", repeatable: false },
    speedDown:          { label: "Bajar velocidad (preset anterior)",  shortcut: "[", repeatable: false },
    speedReset:         { label: "Velocidad normal (1x)",              shortcut: "\\", repeatable: false },
    togglePlay:         { label: "Play / Pausa",                       shortcut: "k", repeatable: false },
    seekBack:           { label: "Retroceder N segundos",              shortcut: "j", repeatable: true },
    seekForward:         { label: "Avanzar N segundos",                 shortcut: "l", repeatable: true },
    toggleLoop:         { label: "Activar/desactivar bucle",           shortcut: "", repeatable: false },
    togglePip:          { label: "Picture-in-Picture",                 shortcut: "", repeatable: false },
    toggleMute:         { label: "Silenciar / Activar audio",          shortcut: "", repeatable: false },
    screenshot:         { label: "Capturar frame actual (PNG)",        shortcut: "", repeatable: false },
    volumeUp:           { label: "Subir volumen",                      shortcut: "", repeatable: true },
    volumeDown:         { label: "Bajar volumen",                      shortcut: "", repeatable: true },
    volumeReset:        { label: "Volumen normal (100%)",              shortcut: "", repeatable: false }
  },
  // hostname -> { actionId: "shortcutString" }  (override total o parcial de settings.actions[*].shortcut)
  domainOverrides: {}
};

// Ajustes que crecen con el uso (uno por cada dominio visitado) y no tiene sentido sincronizar
// entre equipos: van a chrome.storage.local, que tiene mucho más margen de cuota.
const LOCAL_DEFAULTS = {
  // hostname -> última velocidad usada en ese sitio
  domainSpeeds: {},
  // hostname -> fps confirmado manualmente por el usuario para ese sitio (prioridad sobre la detección automática)
  domainFps: {},
  // hostname -> último volumen usado en ese sitio, en % (puede superar 100)
  domainVolumes: {}
};

const DEFAULT_SETTINGS = { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS };
const LOCAL_ONLY_KEYS = new Set(Object.keys(LOCAL_DEFAULTS));

function loadSettings(cb) {
  chrome.storage.sync.get(SYNC_DEFAULTS, (syncStored) => {
    chrome.storage.local.get(LOCAL_DEFAULTS, (localStored) => {
      const merged = { ...SYNC_DEFAULTS, ...syncStored, ...LOCAL_DEFAULTS, ...localStored };
      merged.actions = { ...SYNC_DEFAULTS.actions, ...(syncStored.actions || {}) };
      merged.domainOverrides = { ...(syncStored.domainOverrides || {}) };
      merged.domainSpeeds = { ...(localStored.domainSpeeds || {}) };
      merged.domainFps = { ...(localStored.domainFps || {}) };
      merged.domainVolumes = { ...(localStored.domainVolumes || {}) };
      cb(merged);
    });
  });
}

function saveSettings(partial, cb) {
  const syncPart = {};
  const localPart = {};
  Object.keys(partial).forEach((key) => {
    (LOCAL_ONLY_KEYS.has(key) ? localPart : syncPart)[key] = partial[key];
  });
  const done = () => cb && cb();
  const pending = [];
  if (Object.keys(syncPart).length) pending.push(new Promise((res) => chrome.storage.sync.set(syncPart, res)));
  if (Object.keys(localPart).length) pending.push(new Promise((res) => chrome.storage.local.set(localPart, res)));
  if (pending.length) Promise.all(pending).then(done);
  else done();
}

function resetSettings(cb) {
  chrome.storage.sync.set(SYNC_DEFAULTS, () => {
    chrome.storage.local.set(LOCAL_DEFAULTS, cb || (() => {}));
  });
}

// Convierte un KeyboardEvent en una cadena de atajo estable, p.ej. "Ctrl+Shift+F"
function eventToShortcut(e) {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  let key = e.key;
  if (key === " ") key = "Space";
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join("+");
}

function formatTime(t) {
  if (!isFinite(t)) return "0:00.00";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2);
  return (h ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(5, "0");
}

// Resuelve el atajo efectivo de una acción para un dominio dado: override de dominio si existe, si no el global.
function effectiveShortcutFor(settings, domain, actionId) {
  const overrides = settings.domainOverrides && settings.domainOverrides[domain];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    return overrides[actionId];
  }
  const action = settings.actions[actionId];
  return action ? action.shortcut : "";
}
