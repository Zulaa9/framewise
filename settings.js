// Configuración por defecto y utilidades compartidas por content.js, popup.js, options.js y background.js.

// Rango real de velocidad admitido por el reproductor (ver setSpeed en content.js). Vive aquí para
// que options.js pueda validar presets manuales contra el mismo límite sin duplicar los números.
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

// ---------------------------------------------------------------------------------------------
// Metadatos de cada acción — SIEMPRE vienen del código, nunca de chrome.storage.
//
// Antes, "actions" en SYNC_DEFAULTS mezclaba label + shortcut + repeatable en un mismo objeto que
// se guardaba entero en cuanto el usuario pulsaba "Guardar cambios" una sola vez — lo que congelaba
// el label (y la plantilla "{n}") para siempre en la versión que hubiera en ese momento, sin
// importar cuántas veces cambiara después el código. ACTION_DEFS es la única fuente de verdad para
// "label", "repeatable" y el shortcut de fábrica; lo único que persiste por usuario es el shortcut
// realmente elegido (ver SYNC_DEFAULTS.shortcuts más abajo), y solo cuando difiere de este default.
//
// "{n}" en un label se sustituye en tiempo real por el valor configurado real (multiFrameCount o
// seekSeconds, según la acción — ver ACTION_LABEL_COUNT_SOURCE/resolveActionLabel más abajo).
//
// Shortcuts de fábrica: todos los que antes eran una sola tecla van con Ctrl, para reducir el
// riesgo de chocar con los atajos nativos del propio sitio (la mayoría de páginas evita enlazar
// combinaciones con Ctrl precisamente por eso). togglePlay/seekBack/seekForward son la excepción
// deliberada — j/k/l sueltas, sin modificador — y no por descuido: es la decisión de producto de
// que ese trío de controles de transporte se comporta como un bloque aparte, alineado a propósito
// con el convenio nativo de YouTube. El resto de acciones propias de Framewise (incluido Silenciar,
// que podría parecer candidata a lo mismo) usa siempre combinaciones modificadas.
//
// Combinaciones evitadas a propósito y por qué: Ctrl+K/J/L (reservadas por Chrome/Edge: buscar en
// la omnibox, abrir Descargas y enfocar la barra de direcciones — ni siquiera llegarían a la
// página); Ctrl+R / Ctrl+Shift+R (recargar / recargar sin caché); Ctrl+Shift+C (inspector de
// elementos de DevTools); Ctrl+S (guardar página); cualquier Ctrl+Alt+* (en teclados europeos,
// AltGr se reporta como ctrlKey+altKey a la vez, indistinguible de un Ctrl+Alt real); Ctrl+Flecha
// sin Shift (en macOS son los atajos de Mission Control/Spaces, a nivel de sistema operativo).
const ACTION_DEFS = {
  frameBack:          { label: "Retroceder 1 fotograma",              shortcut: "Ctrl+,",               repeatable: true },
  frameForward:        { label: "Avanzar 1 fotograma",                 shortcut: "Ctrl+.",               repeatable: true },
  frameBackMulti:      { label: "Retroceder {n} fotogramas",           shortcut: "Ctrl+Shift+,",         repeatable: true },
  frameForwardMulti:   { label: "Avanzar {n} fotogramas",              shortcut: "Ctrl+Shift+.",         repeatable: true },
  speedUp:             { label: "Subir velocidad (siguiente preset)", shortcut: "Ctrl+]",               repeatable: false },
  speedDown:           { label: "Bajar velocidad (preset anterior)",  shortcut: "Ctrl+[",               repeatable: false },
  speedReset:          { label: "Velocidad normal (1x)",              shortcut: "Ctrl+\\",              repeatable: false },
  togglePlay:          { label: "Play / Pausa",                       shortcut: "k",                    repeatable: false },
  seekBack:            { label: "Retroceder {n} segundos",            shortcut: "j",                    repeatable: true },
  seekForward:          { label: "Avanzar {n} segundos",               shortcut: "l",                    repeatable: true },
  toggleLoop:          { label: "Activar/desactivar bucle",           shortcut: "Ctrl+Shift+L",         repeatable: false },
  togglePip:           { label: "Picture-in-Picture",                 shortcut: "Ctrl+I",               repeatable: false },
  toggleMute:          { label: "Silenciar / Activar audio",          shortcut: "Ctrl+M",               repeatable: false },
  screenshot:          { label: "Capturar fotograma actual (PNG)",    shortcut: "Ctrl+Shift+F",         repeatable: false },
  recordClip:          { label: "Grabar / detener clip de vídeo",     shortcut: "Ctrl+Shift+G",         repeatable: false },
  volumeUp:            { label: "Subir volumen",                      shortcut: "Ctrl+Shift+ArrowUp",   repeatable: true },
  volumeDown:          { label: "Bajar volumen",                      shortcut: "Ctrl+Shift+ArrowDown", repeatable: true },
  volumeReset:         { label: "Volumen normal (100%)",              shortcut: "Ctrl+Shift+\\",        repeatable: false }
};

// Qué ajuste numérico rellena el "{n}" del label de cada acción.
const ACTION_LABEL_COUNT_SOURCE = {
  frameBackMulti: "multiFrameCount",
  frameForwardMulti: "multiFrameCount",
  seekBack: "seekSeconds",
  seekForward: "seekSeconds"
};

// Todo shortcut de fábrica que una acción ha tenido alguna vez en versiones anteriores del código —
// no solo el actual. Un valor guardado que coincide con CUALQUIERA de estos se trata como "el
// usuario nunca lo tocó", nunca como una personalización real (ver migrateLegacyActions). La
// mayoría solo necesita su único default original (de antes de que todo pasara a llevar Ctrl); los
// cuatro que han cambiado dos veces durante el desarrollo de esta función (screenshot, recordClip,
// volumeUp, volumeDown) listan también el intermedio que tuvieron por el camino.
const FORMER_DEFAULT_SHORTCUTS = {
  frameBack: [","],
  frameForward: ["."],
  frameBackMulti: [""],
  frameForwardMulti: [""],
  speedUp: ["]"],
  speedDown: ["["],
  speedReset: ["\\"],
  togglePlay: ["k"],
  seekBack: ["j"],
  seekForward: ["l"],
  toggleLoop: [""],
  togglePip: [""],
  toggleMute: [""],
  screenshot: ["", "Ctrl+Shift+S"],
  recordClip: ["", "Ctrl+Alt+R"],
  volumeUp: ["", "Ctrl+ArrowUp"],
  volumeDown: ["", "Ctrl+ArrowDown"],
  volumeReset: [""]
};

// Ajustes que tiene sentido llevar contigo entre equipos (chrome.storage.sync, límite ~100KB).
// "shortcuts" (id -> combo) solo contiene DELTAS: una acción sin entrada aquí simplemente hereda el
// shortcut de fábrica de ACTION_DEFS — así, un shortcut nuevo asignado en una versión futura del
// código llega de inmediato a quien nunca lo haya personalizado, sin esperar a ninguna migración.
// "pausedDomains" vive aquí (no en local) por el mismo motivo que domainOverrides: es una decisión
// deliberada del usuario sobre un dominio concreto ("aquí, los atajos de Framewise no"), no un dato
// que se acumule solo con el uso — encaja con el criterio de qué va a sync, no con el de qué va a
// local (ver LOCAL_DEFAULTS más abajo).
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
  // hostname -> { actionId: "shortcutString" }  (override total o parcial del shortcut global)
  domainOverrides: {},
  // id -> "shortcutString"  (solo las acciones cuyo shortcut real difiere del de ACTION_DEFS)
  shortcuts: {},
  // hostname -> true si los atajos de teclado y la rueda están desactivados en ese sitio (botón de
  // pausa rápida del popup). Solo afecta a los listeners automáticos de teclado/rueda; los botones
  // del popup siguen funcionando igual.
  pausedDomains: {}
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

// ---------------------------------------------------------------------------------------------
// Migración desde el formato antiguo (versiones donde "actions" guardaba label+shortcut+repeatable
// enteros en chrome.storage.sync). Reduce ese objeto a solo lo que de verdad es una personalización
// real del usuario — todo lo que coincide con cualquier default conocido (viejo o actual, ver
// FORMER_DEFAULT_SHORTCUTS) se descarta, porque tenerlo guardado ahí no significa que el usuario lo
// eligiera: significa que nunca lo tocó.
//
// Es una función pura del valor guardado, así que es segura de ejecutar en paralelo desde varios
// contextos a la vez sin coordinarse entre ellos (background, popup, content scripts y options
// pueden llamar a loadSettings casi al mismo tiempo al arrancar el navegador): con la misma entrada,
// cualquier número de ejecuciones concurrentes calcula exactamente el mismo resultado, así que no
// hay condición de carrera real aunque varias escriban el resultado por su cuenta.
function migrateLegacyActions(stored) {
  const oldActions = stored && stored.actions;
  if (!oldActions || typeof oldActions !== "object") return null;

  const shortcuts = { ...((stored && stored.shortcuts) || {}) };
  Object.keys(ACTION_DEFS).forEach((id) => {
    const old = oldActions[id];
    if (!old || typeof old.shortcut !== "string") return;
    const formerDefaults = FORMER_DEFAULT_SHORTCUTS[id] || [];
    const wasNeverCustomized = formerDefaults.includes(old.shortcut) || old.shortcut === ACTION_DEFS[id].shortcut;
    if (wasNeverCustomized) return;
    if (!Object.prototype.hasOwnProperty.call(shortcuts, id)) shortcuts[id] = old.shortcut;
  });
  return shortcuts;
}

function loadSettings(cb) {
  // chrome.storage.get(objetoConDefaults, cb) SOLO devuelve las claves presentes en ese objeto —
  // cualquier otra clave que exista de verdad en storage pero no se pida aquí, no llega nunca a la
  // respuesta. "actions" ya no forma parte de SYNC_DEFAULTS, así que hay que pedirlo aparte
  // (con "null" como valor por defecto: no queremos inventar ningún valor, solo saber si está
  // presente) o migrateLegacyActions jamás vería el objeto antiguo y la migración nunca se dispararía.
  chrome.storage.sync.get({ ...SYNC_DEFAULTS, actions: null }, (syncStored) => {
    // pausedDomains vivió brevemente en local durante una versión de desarrollo anterior a esta —
    // se pide igualmente aquí (sin añadirlo de vuelta a LOCAL_DEFAULTS) solo para poder recogerlo y
    // limpiarlo si queda algo, evitando un duplicado obsoleto entre local y sync.
    chrome.storage.local.get({ ...LOCAL_DEFAULTS, pausedDomains: {} }, (localStored) => {
      const legacyLocalPaused = localStored.pausedDomains || {};
      const hasLegacyLocalPaused = Object.keys(legacyLocalPaused).length > 0;
      const pausedDomains = { ...(syncStored.pausedDomains || {}), ...legacyLocalPaused };

      const migratedShortcuts = migrateLegacyActions(syncStored);
      const shortcuts = migratedShortcuts || { ...(syncStored.shortcuts || {}) };

      const needsSyncWrite = !!migratedShortcuts || hasLegacyLocalPaused;
      const finish = () => {
        const merged = { ...SYNC_DEFAULTS, ...syncStored, ...LOCAL_DEFAULTS, ...localStored };
        delete merged.actions; // formato antiguo: nunca se expone ni se vuelve a escribir
        merged.domainOverrides = { ...(syncStored.domainOverrides || {}) };
        merged.domainSpeeds = { ...(localStored.domainSpeeds || {}) };
        merged.domainFps = { ...(localStored.domainFps || {}) };
        merged.domainVolumes = { ...(localStored.domainVolumes || {}) };
        merged.shortcuts = shortcuts;
        merged.pausedDomains = pausedDomains;
        cb(merged);
      };

      if (!needsSyncWrite) {
        finish();
        return;
      }
      chrome.storage.sync.set({ shortcuts, pausedDomains }, () => {
        chrome.storage.sync.remove("actions", () => {
          if (hasLegacyLocalPaused) chrome.storage.local.remove("pausedDomains", finish);
          else finish();
        });
      });
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

// Deja todo como recién instalado — incluye limpiar restos del formato antiguo ("actions" en sync,
// "pausedDomains" en local) por si "Restaurar todo" se pulsa antes de que loadSettings haya tenido
// ocasión de migrarlos.
function resetSettings(cb) {
  chrome.storage.sync.set(SYNC_DEFAULTS, () => {
    chrome.storage.sync.remove("actions", () => {
      chrome.storage.local.set(LOCAL_DEFAULTS, () => {
        chrome.storage.local.remove("pausedDomains", cb || (() => {}));
      });
    });
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

// Shortcut global efectivo de una acción: el que el usuario ha personalizado si lo hay, si no el de
// fábrica (ACTION_DEFS). Es la única función que debe leer settings.shortcuts directamente.
function effectiveGlobalShortcut(settings, actionId) {
  const shortcuts = settings.shortcuts || {};
  if (Object.prototype.hasOwnProperty.call(shortcuts, actionId)) return shortcuts[actionId];
  const def = ACTION_DEFS[actionId];
  return def ? def.shortcut : "";
}

// Resuelve el atajo efectivo de una acción para un dominio dado: override de dominio si existe, si no el global.
function effectiveShortcutFor(settings, domain, actionId) {
  const overrides = settings.domainOverrides && settings.domainOverrides[domain];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    return overrides[actionId];
  }
  return effectiveGlobalShortcut(settings, actionId);
}

// Devuelve el label de una acción listo para mostrar, con "{n}" ya sustituido por el valor real
// configurado — así la interfaz nunca muestra la letra N suelta, siempre el número vigente. Lee el
// label siempre de ACTION_DEFS (código actual), nunca de algo persistido.
function resolveActionLabel(settings, actionId) {
  const def = ACTION_DEFS[actionId];
  if (!def) return "";
  const countKey = ACTION_LABEL_COUNT_SOURCE[actionId];
  if (!countKey) return def.label;
  return def.label.replace("{n}", settings[countKey]);
}
