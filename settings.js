// Configuración por defecto y utilidades compartidas por content.js, popup.js, options.js y
// background.js. Depende de i18n.js (T/currentLang/STRINGS) — debe cargarse después de él.
//
// Las declaraciones de nivel superior usan "var" (no "const") a propósito: este archivo puede
// ejecutarse dos veces en el mismo mundo aislado de un frame (la inyección del manifest y la
// reinyección de background.js pueden coincidir al arrancar el navegador o al instalar). Con
// "const", la segunda ejecución lanzaba "SyntaxError: Identifier ... has already been declared"
// en la consola de la página; con "var" simplemente se reasignan los mismos valores.

// Rango real de velocidad admitido por el reproductor (ver setSpeed en content.js). Vive aquí para
// que options.js pueda validar presets manuales contra el mismo límite sin duplicar los números.
var SPEED_MIN = 0.07;
var SPEED_MAX = 16;

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
// "labelKey" apunta a STRINGS[lang][labelKey] en i18n.js (que debe cargarse antes que este archivo)
// — así el label sale siempre traducido al idioma activo (settings.lang, ver SYNC_DEFAULTS más
// abajo), nunca en un solo idioma fijo. "{n}" dentro de esa cadena se sustituye en tiempo real por
// el valor configurado real (multiFrameCount o seekSeconds, según la acción — ver
// ACTION_LABEL_COUNT_SOURCE/resolveActionLabel más abajo).
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
var ACTION_DEFS = {
  frameBack:          { labelKey: "action.frameBack",         shortcut: "Ctrl+,",               repeatable: true },
  frameForward:        { labelKey: "action.frameForward",      shortcut: "Ctrl+.",               repeatable: true },
  frameBackMulti:      { labelKey: "action.frameBackMulti",    shortcut: "Ctrl+Shift+,",         repeatable: true },
  frameForwardMulti:   { labelKey: "action.frameForwardMulti", shortcut: "Ctrl+Shift+.",         repeatable: true },
  speedUp:             { labelKey: "action.speedUp",           shortcut: "Ctrl+]",               repeatable: false },
  speedDown:           { labelKey: "action.speedDown",         shortcut: "Ctrl+[",               repeatable: false },
  speedReset:          { labelKey: "action.speedReset",        shortcut: "Ctrl+\\",              repeatable: false },
  togglePlay:          { labelKey: "action.togglePlay",        shortcut: "k",                    repeatable: false },
  seekBack:            { labelKey: "action.seekBack",          shortcut: "j",                    repeatable: true },
  seekForward:          { labelKey: "action.seekForward",       shortcut: "l",                    repeatable: true },
  toggleLoop:          { labelKey: "action.toggleLoop",        shortcut: "Ctrl+Shift+L",         repeatable: false },
  togglePip:           { labelKey: "action.togglePip",         shortcut: "Ctrl+I",               repeatable: false },
  toggleMute:          { labelKey: "action.toggleMute",        shortcut: "Ctrl+M",               repeatable: false },
  screenshot:          { labelKey: "action.screenshot",        shortcut: "Ctrl+Shift+F",         repeatable: false },
  recordClip:          { labelKey: "action.recordClip",        shortcut: "Ctrl+Shift+G",         repeatable: false },
  volumeUp:            { labelKey: "action.volumeUp",          shortcut: "Ctrl+Shift+ArrowUp",   repeatable: true },
  volumeDown:          { labelKey: "action.volumeDown",        shortcut: "Ctrl+Shift+ArrowDown", repeatable: true },
  volumeReset:         { labelKey: "action.volumeReset",       shortcut: "Ctrl+Shift+\\",        repeatable: false }
};

// Qué ajuste numérico rellena el "{n}" del label de cada acción.
var ACTION_LABEL_COUNT_SOURCE = {
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
var FORMER_DEFAULT_SHORTCUTS = {
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
var SYNC_DEFAULTS = {
  // null = "no elegido a mano todavía" — currentLang() (i18n.js) sigue entonces el idioma del
  // navegador en cada momento. Se fija a "es" o "en" en cuanto el usuario toca el interruptor de
  // idioma del popup o de Opciones, y a partir de ahí ya no se mueve solo.
  lang: null,
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
  pausedDomains: {},
  // Duración máxima de un clip, en minutos (0 = sin límite). Al llegar, la grabación se para y se
  // guarda sola: la grabación vive en memoria hasta pararla y una muy larga ocupaba cientos de MB.
  clipMaxMinutes: 10
};

// Ajustes que crecen con el uso (uno por cada dominio visitado) y no tiene sentido sincronizar
// entre equipos: van a chrome.storage.local, que tiene mucho más margen de cuota.
var LOCAL_DEFAULTS = {
  // hostname -> última velocidad usada en ese sitio
  domainSpeeds: {},
  // hostname -> fps confirmado manualmente por el usuario para ese sitio (prioridad sobre la detección automática)
  domainFps: {},
  // hostname -> último volumen usado en ese sitio, en % (puede superar 100)
  domainVolumes: {}
};

var DEFAULT_SETTINGS = { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS };
var LOCAL_ONLY_KEYS = new Set(Object.keys(LOCAL_DEFAULTS));

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
        Object.keys(NUMERIC_LIMITS).forEach((key) => {
          merged[key] = clampNumber(merged[key], key, SYNC_DEFAULTS[key]);
        });
        if (!Array.isArray(merged.speedPresets) || !merged.speedPresets.some((v) => typeof v === "number" && v > 0)) {
          merged.speedPresets = SYNC_DEFAULTS.speedPresets.slice();
        } else {
          merged.speedPresets = merged.speedPresets.filter(
            (v) => typeof v === "number" && isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX
          );
          if (!merged.speedPresets.length) merged.speedPresets = SYNC_DEFAULTS.speedPresets.slice();
        }
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

// cb recibe el mensaje de error (o null si todo se guardó). Antes los errores de escritura se
// perdían en silencio — p. ej. superar la cuota por elemento de storage.sync (8 KB) con muchos
// overrides de dominio — y Opciones mostraba "Guardado" aunque no se hubiera guardado nada.
function saveSettings(partial, cb) {
  const syncPart = {};
  const localPart = {};
  Object.keys(partial).forEach((key) => {
    (LOCAL_ONLY_KEYS.has(key) ? localPart : syncPart)[key] = partial[key];
  });
  const write = (area, part) =>
    new Promise((res) =>
      chrome.storage[area].set(part, () => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : null))
    );
  const pending = [];
  if (Object.keys(syncPart).length) pending.push(write("sync", syncPart));
  if (Object.keys(localPart).length) pending.push(write("local", localPart));
  Promise.all(pending).then((errors) => {
    const error = errors.find((e) => e) || null;
    if (cb) cb(error);
  });
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
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"].includes(e.key)) return null;
  if (typeof e.key !== "string" || !e.key) return null;
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

// Forma canónica de un atajo para COMPARAR (nunca para guardar: lo guardado sigue siendo lo que
// produce eventToShortcut). eventToShortcut siempre pone en mayúscula la tecla de un carácter
// ("k" -> "K"), pero ACTION_DEFS declara j/k/l en minúscula: comparando las cadenas tal cual, los
// atajos de fábrica de Play/Pausa, Retroceder y Avanzar no coincidían nunca con ninguna pulsación.
// Se separan los modificadores por prefijo (no con split("+")) para que la tecla "+" funcione.
var SHORTCUT_MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"];

function canonicalShortcut(shortcut) {
  if (typeof shortcut !== "string" || !shortcut) return "";
  let rest = shortcut;
  const mods = new Set();
  let found = true;
  while (found) {
    found = false;
    for (const m of SHORTCUT_MODIFIERS) {
      if (rest.length > m.length + 1 && rest.startsWith(m + "+")) {
        mods.add(m);
        rest = rest.slice(m.length + 1);
        found = true;
      }
    }
  }
  const key = rest.length === 1 ? rest.toUpperCase() : rest;
  return SHORTCUT_MODIFIERS.filter((m) => mods.has(m)).concat(key).join("+");
}

function shortcutsEqual(a, b) {
  const ca = canonicalShortcut(a);
  return !!ca && ca === canonicalShortcut(b);
}

// Tecla "física" (posición en un teclado US) de las teclas de puntuación, según KeyboardEvent.code.
// Solo se usa como segunda opción cuando Shift cambia el carácter: con Shift pulsado, e.key de
// "Ctrl+Shift+," llega como "<" (teclado US) o ";" (teclado español), así que los atajos de fábrica
// Ctrl+Shift+, / Ctrl+Shift+. / Ctrl+Shift+\ no se podían pulsar en la práctica.
var PUNCTUATION_CODE_KEYS = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`"
};

// Todas las formas de atajo con las que una pulsación puede coincidir, por orden de prioridad: la
// del carácter real (lo que se graba en Opciones) y, solo con Shift y una tecla de puntuación cuyo
// carácter cambia con Shift, la de su posición física. No se aplica a letras ni números ni sin
// Shift, para no reinterpretar pulsaciones normales en otras distribuciones (Dvorak, AZERTY…).
function eventShortcutCandidates(e) {
  const primary = eventToShortcut(e);
  if (!primary) return [];
  const list = [primary];
  if (e.shiftKey && typeof e.key === "string" && e.key.length === 1 && !/[\p{L}\p{N}]/u.test(e.key)) {
    const physical = PUNCTUATION_CODE_KEYS[e.code];
    if (physical && physical !== e.key) {
      const parts = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      parts.push(physical);
      list.push(parts.join("+"));
    }
  }
  return list;
}

// Atajos alternativos para teclados donde [ ] y \ solo salen con AltGr (español, alemán, francés,
// italiano…): ahí Ctrl+[, Ctrl+], Ctrl+\ y Ctrl+Shift+\ no se pueden pulsar. NO son los de fábrica
// (eso cambiaría los atajos de quien ya los usa): Opciones los ofrece con un botón y solo se aplican
// a las acciones que el usuario no haya personalizado. Combinaciones elegidas para no chocar con el
// navegador ni con el sistema (Ctrl+Shift+flecha izquierda/derecha no es de Chrome, Edge ni macOS).
var ALT_LAYOUT_SHORTCUTS = {
  speedDown: "Ctrl+Shift+ArrowLeft",
  speedUp: "Ctrl+Shift+ArrowRight",
  speedReset: "Ctrl+Shift+Enter",
  volumeReset: "Ctrl+Shift+Backspace"
};

// Combinaciones que la página nunca llega a recibir o que son ambiguas — se usan solo para AVISAR
// al grabar un atajo en Opciones, nunca para impedirlo.
var BROWSER_RESERVED_SHORTCUTS = [
  "Ctrl+T", "Ctrl+N", "Ctrl+W", "Ctrl+Shift+T", "Ctrl+Shift+N", "Ctrl+Shift+W", "Ctrl+Tab",
  "Ctrl+Shift+Tab", "Ctrl+K", "Ctrl+J", "Ctrl+L", "Ctrl+Shift+J", "Ctrl+Shift+I", "Ctrl+Shift+C",
  "Ctrl+Shift+Delete", "Ctrl+Shift+B", "Ctrl+H", "Ctrl+D", "Ctrl+Shift+Q"
];

// "reserved" si el navegador se lo queda antes que la página, "altgr" si usa Ctrl+Alt (AltGr en
// teclados europeos), null si no hay nada que advertir.
function shortcutWarningKind(shortcut) {
  const c = canonicalShortcut(shortcut);
  if (!c) return null;
  if (BROWSER_RESERVED_SHORTCUTS.some((r) => canonicalShortcut(r) === c)) return "reserved";
  if (c.startsWith("Ctrl+Alt+")) return "altgr";
  return null;
}

// Límites de cada ajuste numérico. Son los mismos que los min/max de los campos de options.html;
// se aplican al importar un archivo y al cargar ajustes (solo en memoria: nunca se reescribe nada
// guardado por cargarlo) para que un valor imposible (fps 0, salto negativo…) no rompa nada.
var NUMERIC_LIMITS = {
  fps: [1, 240],
  speedStep: [0.01, 2],
  seekSeconds: [0.1, 600],
  multiFrameCount: [1, 500],
  // Sin tope superior a propósito: el usuario decide cuánto amplificar (con audio muy bajo, ×10 a
  // veces no basta). Solo se exige un número válido y al menos el 100 %.
  volumeMax: [100, Infinity],
  volumeStep: [1, 100],
  clipMaxMinutes: [0, 120]
};

function clampNumber(v, key, fallback) {
  const lim = NUMERIC_LIMITS[key];
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !isFinite(n)) return fallback;
  if (!lim) return n;
  return Math.max(lim[0], Math.min(lim[1], n));
}

// Valida un mapa hostname -> valor numérico (velocidades, fps o volúmenes recordados): descarta
// entradas con clave o valor inválido en vez de dejar que un valor imposible llegue al <video>
// (p. ej. playbackRate = 1e9 lanza una excepción).
function sanitizeDomainNumberMap(map, min, max) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  Object.keys(map).forEach((host) => {
    if (!isValidHostKey(host)) return;
    const v = map[host];
    if (typeof v === "number" && isFinite(v) && v >= min && v <= max) out[host] = v;
  });
  return out;
}

function isValidHostKey(host) {
  return (
    typeof host === "string" &&
    host.length > 0 &&
    host.length <= 253 &&
    host !== "__proto__" &&
    host !== "constructor" &&
    host !== "prototype" &&
    /^[a-z0-9.\-_:\[\]]+$/i.test(host)
  );
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

// Devuelve el label de una acción listo para mostrar, ya traducido al idioma activo y con "{n}"
// sustituido por el valor real configurado — así la interfaz nunca muestra la letra N suelta,
// siempre el número vigente. Lee el texto siempre de i18n.js vía ACTION_DEFS[id].labelKey (código
// actual), nunca de algo persistido.
function resolveActionLabel(settings, actionId) {
  const def = ACTION_DEFS[actionId];
  if (!def) return "";
  const countKey = ACTION_LABEL_COUNT_SOURCE[actionId];
  const vars = countKey ? { n: settings[countKey] } : undefined;
  return T(currentLang(settings), def.labelKey, vars);
}
