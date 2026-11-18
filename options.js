let settings = null;
let recordingId = null;
let currentScope = "global"; // "global" | hostname

// ---------- Cambios sin guardar ----------
// Todo lo que se edita en esta página (campos, presets, atajos, dominios) vive solo en memoria hasta
// pulsar "Guardar cambios". Antes, cualquier escritura en storage desde OTRO contexto —que pasa sin
// parar mientras se ve un vídeo: la velocidad y el volumen recordados por sitio se guardan en cada
// cambio— recargaba "settings" entero y tiraba a la basura, sin avisar, todo lo editado aquí.
let dirty = false;
// Tras importar un archivo, también hay que guardar lo que normalmente no se edita aquí (pausas y
// valores recordados por sitio), porque vienen del archivo.
let importPending = false;

// Claves que esta página edita y guarda. El resto (pausas por dominio, valores recordados por sitio)
// los escriben el popup y las pestañas de vídeo; aquí solo se muestran y se guardan tras importar.
// "lang" no está aquí: el interruptor ES/EN lo guarda al instante (ver setLang).
const PAGE_OWNED_KEYS = [
  "fps", "multiFrameCount", "speedStep", "seekSeconds", "showOverlay", "frameStepAudio",
  "rememberSpeedPerDomain", "wheelSpeedControl", "volumeMax", "volumeStep", "rememberVolumePerDomain",
  "speedPresets", "shortcuts", "domainOverrides", "clipMaxMinutes"
];
const EXTERNAL_KEYS = ["pausedDomains", "domainSpeeds", "domainFps", "domainVolumes"];

function markDirty() {
  dirty = true;
  const el = document.getElementById("unsavedMsg");
  if (el) el.classList.remove("hidden");
}

function clearDirty() {
  dirty = false;
  importPending = false;
  const el = document.getElementById("unsavedMsg");
  if (el) el.classList.add("hidden");
}

function q(id) { return document.getElementById(id); }
function lang() { return currentLang(settings); }

function populateForm() {
  q("fps").value = settings.fps;
  q("multiFrameCount").value = settings.multiFrameCount;
  q("speedStep").value = settings.speedStep;
  q("seekSeconds").value = settings.seekSeconds;
  q("showOverlay").checked = settings.showOverlay;
  q("frameStepAudio").checked = settings.frameStepAudio;
  q("rememberSpeedPerDomain").checked = settings.rememberSpeedPerDomain;
  q("wheelSpeedControl").checked = settings.wheelSpeedControl;
  q("volumeMax").value = settings.volumeMax;
  q("volumeStep").value = settings.volumeStep;
  q("rememberVolumePerDomain").checked = settings.rememberVolumePerDomain;
  q("clipMaxMinutes").value = settings.clipMaxMinutes;
  applyLang();
}

// Vuelve a aplicar el idioma a todo lo estático (data-i18n*) y a todo lo que se genera desde JS
// (listas de atajos, selector de ámbito, chips de preset, labels con "{n}") — se llama al cargar, al
// pulsar el interruptor ES/EN, y cuando llega un cambio de idioma desde otro contexto (el popup).
function applyLang() {
  applyI18n(lang());
  q("langSwitch").setAttribute("aria-label", T(lang(), "options.lang.label"));
  q("langEs").classList.toggle("active", lang() === "es");
  q("langEn").classList.toggle("active", lang() === "en");
  updateCountPreviews();
  renderPresetChips();
  renderScopeSelect();
  renderShortcuts();
}

function setLang(newLang) {
  if (settings.lang === newLang) return;
  settings.lang = newLang;
  saveSettings({ lang: newLang });
  applyLang();
}

// Los propios campos "Nº de fotogramas" y "Segundos" citan su valor en su propio label — se
// recompone entero (no un hueco relleno aparte) para que quede bien en cualquier idioma, y se
// mantiene en vivo, tecla a tecla, para que nunca se vea desincronizado del número que el campo
// tiene puesto en ese instante. Los labels de atajos (Retroceder {n} fotogramas, etc.) se
// refrescan aparte, en renderShortcuts, porque solo esos dos campos alimentan un "{n}" en las
// acciones (ver ACTION_LABEL_COUNT_SOURCE en settings.js).
function updateCountPreviews() {
  q("multiFrameCountLabel").textContent = T(lang(), "options.multiFrameCount.label", { n: settings.multiFrameCount });
  q("seekSecondsLabel").textContent = T(lang(), "options.seekSeconds.label", { n: settings.seekSeconds });
}

// ---------- Presets de velocidad (chips añadir/quitar) ----------
function renderPresetChips() {
  const container = q("presetChips");
  container.innerHTML = "";
  settings.speedPresets
    .slice()
    .sort((a, b) => a - b)
    .forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "preset-chip";
      const label = p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      const text = document.createElement("span");
      text.textContent = `${label}x`;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.title = T(lang(), "options.presetChip.remove.title", { label });
      removeBtn.setAttribute("aria-label", removeBtn.title);
      removeBtn.addEventListener("click", () => {
        settings.speedPresets = settings.speedPresets.filter((v) => Math.abs(v - p) > 0.0001);
        if (settings.speedPresets.length === 0) settings.speedPresets = [1];
        markDirty();
        renderPresetChips();
      });
      chip.appendChild(text);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  const hasGridValue = settings.speedPresets.some(isOnQuarterGrid);
  q("presetStepDown").disabled = !hasGridValue || settings.speedPresets.length <= 1;
  q("presetStepUp").disabled = highestGridPreset() >= SPEED_MAX;
}

function addPresetFromInput() {
  const input = q("newPresetValue");
  const value = parseFloat(input.value);
  if (isNaN(value)) {
    alert(T(lang(), "options.alert.invalidSpeed"));
    return;
  }
  if (value < SPEED_MIN || value > SPEED_MAX) {
    alert(T(lang(), "options.alert.speedRange", { min: SPEED_MIN, max: SPEED_MAX }));
    return;
  }
  if (!settings.speedPresets.some((v) => Math.abs(v - value) < 0.0001)) {
    settings.speedPresets.push(value);
    markDirty();
    renderPresetChips();
  }
  input.value = "";
  input.focus();
}

// La escala de +/-0.25 va siempre anclada en 0 (0.25, 0.5, 0.75, 1, 1.25…), no en "el valor más
// alto que haya ahora mismo". Así, si el usuario mete algo a mano que no es múltiplo de 0.25
// (ej. 1.6x), estos botones lo ignoran y siguen contando desde el último que sí encaja en la escala.
const QUARTER_STEP = 0.25;
const QUARTER_EPSILON = 0.001;

function isOnQuarterGrid(v) {
  const n = v / QUARTER_STEP;
  return Math.abs(n - Math.round(n)) < QUARTER_EPSILON;
}

function highestGridPreset() {
  const gridValues = settings.speedPresets.filter(isOnQuarterGrid);
  return gridValues.length ? Math.max(...gridValues) : 0;
}

// Añade el siguiente valor de la escala de 0.25, por encima del más alto que ya esté en esa escala.
function addQuarterStepUp() {
  const next = Math.round((highestGridPreset() + QUARTER_STEP) * 100) / 100;
  if (next > SPEED_MAX) return; // fuera del rango real admitido — el botón ya se deshabilita antes de llegar aquí
  if (!settings.speedPresets.some((v) => Math.abs(v - next) < 0.0001)) {
    settings.speedPresets.push(next);
    markDirty();
    renderPresetChips();
  }
}

// Quita el más alto de la escala de 0.25 (los valores añadidos a mano que no encajan no se tocan).
function removeHighestPreset() {
  const gridValues = settings.speedPresets.filter(isOnQuarterGrid);
  if (gridValues.length === 0) return; // nada de la escala que quitar
  if (settings.speedPresets.length <= 1) return; // siempre queda al menos un preset
  const max = Math.max(...gridValues);
  settings.speedPresets = settings.speedPresets.filter((v) => Math.abs(v - max) > 0.0001);
  if (settings.speedPresets.length === 0) settings.speedPresets = [1];
  markDirty();
  renderPresetChips();
}

// ---------- Selector de ámbito (global / por dominio) ----------
function renderScopeSelect() {
  const sel = q("scopeSelect");
  sel.innerHTML = "";
  const globalOpt = document.createElement("option");
  globalOpt.value = "global";
  globalOpt.textContent = T(lang(), "options.scopeSelect.global");
  sel.appendChild(globalOpt);

  Object.keys(settings.domainOverrides)
    .sort()
    .forEach((domain) => {
      const opt = document.createElement("option");
      opt.value = domain;
      const n = Object.keys(settings.domainOverrides[domain]).length;
      const paused = settings.pausedDomains && settings.pausedDomains[domain];
      const overrideWord = T(lang(), n === 1 ? "options.override.singular" : "options.override.plural");
      opt.textContent = `${domain}  (${n} ${overrideWord})${paused ? " · " + T(lang(), "options.scopeSelect.paused") : ""}`;
      sel.appendChild(opt);
    });

  sel.value = currentScope;
  q("removeDomainBtn").classList.toggle("hidden", currentScope === "global");
}

function normalizeDomainInput(raw) {
  let v = raw.trim();
  if (!v) return "";
  try {
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return new URL(v).hostname;
  } catch (e) {
    return "";
  }
}

function switchScope(domain) {
  currentScope = domain;
  q("scopeSelect").value = domain;
  q("removeDomainBtn").classList.toggle("hidden", domain === "global");
  renderShortcuts();
}

// ---------- Lista de atajos ----------
function renderShortcuts() {
  const container = q("shortcutList");
  container.innerHTML = "";
  const isGlobal = currentScope === "global";
  const overrides = isGlobal ? null : settings.domainOverrides[currentScope] || {};

  Object.keys(ACTION_DEFS).forEach((id) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.dataset.action = id;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = resolveActionLabel(settings, id);

    const controls = document.createElement("div");
    controls.className = "controls";

    const keycap = document.createElement("span");
    keycap.id = `keycap-${id}`;

    const globalShortcut = effectiveGlobalShortcut(settings, id);
    let displayValue, isOverridden;
    if (isGlobal) {
      displayValue = globalShortcut;
      isOverridden = false;
    } else if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      displayValue = overrides[id];
      isOverridden = true;
    } else {
      displayValue = globalShortcut;
      isOverridden = false;
    }

    keycap.className = "keycap" + (displayValue ? "" : " empty");
    keycap.textContent = displayValue || T(lang(), "options.keycap.empty");

    const tag = document.createElement("span");
    if (!isGlobal) {
      tag.className = isOverridden ? "override-tag" : "inherited-tag";
      tag.textContent = T(lang(), isOverridden ? "options.tag.overridden" : "options.tag.inherited");
    }

    const recordBtn = document.createElement("button");
    recordBtn.textContent = T(lang(), "options.recordBtn");
    recordBtn.setAttribute("aria-label", `${T(lang(), "options.recordBtn")}: ${label.textContent}`);
    recordBtn.addEventListener("click", () => startRecording(id, keycap, recordBtn));

    const clearBtn = document.createElement("button");
    clearBtn.textContent = T(lang(), "options.clearBtn");
    clearBtn.title = T(lang(), isGlobal ? "options.clearBtn.title.global" : "options.clearBtn.title.domain");
    clearBtn.setAttribute("aria-label", `${T(lang(), "options.clearBtn")}: ${label.textContent}`);
    clearBtn.addEventListener("click", () => {
      if (isGlobal) {
        if (!settings.shortcuts) settings.shortcuts = {};
        settings.shortcuts[id] = "";
      } else {
        settings.domainOverrides[currentScope][id] = "";
      }
      markDirty();
      renderShortcuts();
      renderScopeSelect();
    });

    controls.appendChild(keycap);
    if (!isGlobal) controls.appendChild(tag);
    controls.appendChild(recordBtn);
    controls.appendChild(clearBtn);

    if (!isGlobal && isOverridden) {
      const inheritBtn = document.createElement("button");
      inheritBtn.textContent = T(lang(), "options.inheritBtn");
      inheritBtn.addEventListener("click", () => {
        delete settings.domainOverrides[currentScope][id];
        markDirty();
        renderShortcuts();
        renderScopeSelect();
      });
      controls.appendChild(inheritBtn);
    }

    row.appendChild(label);
    row.appendChild(controls);
    container.appendChild(row);
  });
}

// Atajo efectivo de cada acción en un ámbito dado (global, o un dominio con sus overrides aplicados
// sobre el global) — mismo criterio que effectiveShortcutFor en settings.js, pero para todas las
// acciones a la vez, así se puede detectar si dos acciones comparten combinación en ese ámbito.
function effectiveShortcutsForScope(scope) {
  const map = {};
  Object.keys(ACTION_DEFS).forEach((id) => {
    map[id] = effectiveShortcutFor(settings, scope === "global" ? "__global__" : scope, id);
  });
  return map;
}

function startRecording(id, keycapEl, btnEl) {
  if (recordingId) return;
  recordingId = id;
  keycapEl.textContent = T(lang(), "options.keycap.recording");
  keycapEl.classList.add("recording");
  btnEl.disabled = true;

  function onKeydown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      finish(null);
      return;
    }
    const combo = eventToShortcut(e);
    if (!combo) return;
    finish(combo);
  }

  function finish(combo) {
    document.removeEventListener("keydown", onKeydown, true);
    recordingId = null;
    btnEl.disabled = false;
    if (combo) {
      const isGlobal = currentScope === "global";
      if (isGlobal) {
        const clash = Object.keys(ACTION_DEFS)
          .filter((oid) => oid !== id)
          .map((oid) => [oid, effectiveGlobalShortcut(settings, oid)])
          .find(([, shortcut]) => shortcutsEqual(shortcut, combo));
        if (!settings.shortcuts) settings.shortcuts = {};
        settings.shortcuts[id] = combo;
        markDirty();
        renderShortcuts();
        warnIfClash(clash, combo);
      } else {
        if (!settings.domainOverrides[currentScope]) settings.domainOverrides[currentScope] = {};
        settings.domainOverrides[currentScope][id] = combo;
        markDirty();
        renderShortcuts();
        renderScopeSelect();
        warnIfDomainClash(id, combo);
      }
      warnIfRiskyCombo(id, combo);
    } else {
      renderShortcuts();
    }
  }

  document.addEventListener("keydown", onKeydown, true);
}

function warnIfClash(clash, combo) {
  if (!clash) return;
  const clashLabel = resolveActionLabel(settings, clash[0]);
  const clashRow = [...document.querySelectorAll(".shortcut-row")].find(
    (r) => r.querySelector(".label").textContent === clashLabel
  );
  if (clashRow) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = T(lang(), "options.warn.clashHere", { combo });
    clashRow.appendChild(warn);
  }
}

// Aviso (no bloqueo) para combinaciones que el navegador se queda o que AltGr imita — ver
// shortcutWarningKind en settings.js. Se pinta bajo la fila de la propia acción recién grabada.
function warnIfRiskyCombo(id, combo) {
  const kind = shortcutWarningKind(combo);
  if (!kind) return;
  const row = document.querySelector(`.shortcut-row[data-action="${id}"]`);
  if (!row) return;
  const warn = document.createElement("div");
  warn.className = "warn";
  warn.setAttribute("role", "status");
  warn.textContent = T(lang(), kind === "reserved" ? "options.warn.reserved" : "options.warn.altgr", { combo });
  row.appendChild(warn);
}

// Colisión de atajos EFECTIVOS dentro de un dominio: comprueba la acción recién grabada (id/combo,
// ya guardada en settings.domainOverrides[currentScope]) contra el resultado real de cada acción en
// ese dominio — que puede venir de un override propio, o heredado del global si no hay override (o
// si el override está vacío, es decir la acción está desactivada ahí, lo cual nunca choca con nada).
function warnIfDomainClash(id, combo) {
  const effective = effectiveShortcutsForScope(currentScope);
  const clashId = Object.keys(effective).find((oid) => oid !== id && effective[oid] && shortcutsEqual(effective[oid], combo));
  if (!clashId) return;

  const overrides = settings.domainOverrides[currentScope] || {};
  const clashIsOwnOverride = Object.prototype.hasOwnProperty.call(overrides, clashId) && overrides[clashId] !== "";
  const source = T(lang(), clashIsOwnOverride ? "options.warn.source.ownOverride" : "options.warn.source.inherited");
  const clashLabel = resolveActionLabel(settings, clashId);

  const clashRow = [...document.querySelectorAll(".shortcut-row")].find(
    (r) => r.querySelector(".label").textContent === clashLabel
  );
  if (clashRow) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = T(lang(), "options.warn.clashDomain", { combo, label: clashLabel, source });
    clashRow.appendChild(warn);
  }
}

// ---------- Formulario general ----------
// Los campos numéricos se acotan a sus límites (NUMERIC_LIMITS, settings.js): los min/max del HTML
// no impiden escribir a mano un 0 o un negativo, y un fps de 0 o un salto negativo rompían el paso
// de fotograma y los saltos.
function collectFormIntoSettings() {
  settings.fps = clampNumber(parseFloat(q("fps").value), "fps", DEFAULT_SETTINGS.fps);
  settings.multiFrameCount = Math.round(
    clampNumber(parseInt(q("multiFrameCount").value, 10), "multiFrameCount", DEFAULT_SETTINGS.multiFrameCount)
  );
  settings.speedStep = clampNumber(parseFloat(q("speedStep").value), "speedStep", DEFAULT_SETTINGS.speedStep);
  settings.seekSeconds = clampNumber(parseFloat(q("seekSeconds").value), "seekSeconds", DEFAULT_SETTINGS.seekSeconds);
  settings.showOverlay = q("showOverlay").checked;
  settings.frameStepAudio = q("frameStepAudio").checked;
  settings.rememberSpeedPerDomain = q("rememberSpeedPerDomain").checked;
  settings.wheelSpeedControl = q("wheelSpeedControl").checked;
  settings.volumeMax = Math.round(clampNumber(parseInt(q("volumeMax").value, 10), "volumeMax", DEFAULT_SETTINGS.volumeMax));
  settings.volumeStep = Math.round(clampNumber(parseInt(q("volumeStep").value, 10), "volumeStep", DEFAULT_SETTINGS.volumeStep));
  settings.rememberVolumePerDomain = q("rememberVolumePerDomain").checked;
  settings.clipMaxMinutes = clampNumber(parseFloat(q("clipMaxMinutes").value), "clipMaxMinutes", DEFAULT_SETTINGS.clipMaxMinutes);
  settings.speedPresets = settings.speedPresets.slice().sort((a, b) => a - b);
  if (settings.speedPresets.length === 0) settings.speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
}

// ---------- Exportar / Importar ----------
function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "framewise-config.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const KNOWN_ACTION_IDS = Object.keys(ACTION_DEFS);

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Reduce lo que traiga el archivo importado a un mapa de deltas (id -> shortcut), el único formato
// que se persiste. Admite tanto una copia de seguridad ya en el formato nuevo ("shortcuts") como una
// exportada por una versión anterior a esta reestructuración ("actions" completo con label/shortcut/
// repeatable) — en ese segundo caso se reutiliza el mismo criterio que migrateLegacyActions en
// settings.js: solo se conserva lo que de verdad difiere de cualquier default conocido, viejo o
// actual, nunca el label ni el repeatable del archivo (esos siempre vienen del código actual).
function normalizeImportedShortcuts(raw) {
  if (isPlainObject(raw.shortcuts)) {
    const clean = {};
    Object.keys(raw.shortcuts).forEach((id) => {
      if (KNOWN_ACTION_IDS.includes(id) && typeof raw.shortcuts[id] === "string" && raw.shortcuts[id].length <= 64) {
        clean[id] = raw.shortcuts[id];
      }
    });
    return clean;
  }
  if (isPlainObject(raw.actions)) {
    return migrateLegacyActions({ actions: raw.actions, shortcuts: {} }) || {};
  }
  return {};
}

// Valida una configuración importada ANTES de aplicar nada: si algo tiene un tipo fundamentalmente
// incorrecto en los campos clave (speedPresets, shortcuts/actions, domainOverrides, los mapas por
// dominio), se rechaza entera con un error (clave i18n + variables, no un string ya traducido — el
// que llama decide en qué idioma mostrarlo) en vez de dejar el ajuste actual a medio pisar. Los
// campos ausentes (configuraciones antiguas) se rellenan con los valores por defecto; los valores
// sueltos con tipo incorrecto dentro de una colección válida se descartan uno a uno en vez de
// invalidar todo el archivo. "actions" (formato de antes de esta reestructuración) también se
// admite — ver normalizeImportedShortcuts.
function validateImportedSettings(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, errorKey: "options.err.notObject" };
  }

  let speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
  if (raw.speedPresets !== undefined) {
    if (!Array.isArray(raw.speedPresets)) {
      return { ok: false, errorKey: "options.err.speedPresetsType" };
    }
    const valid = raw.speedPresets
      .filter((v) => typeof v === "number" && isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX)
      .filter((v, i, arr) => arr.findIndex((o) => Math.abs(o - v) < 0.0001) === i)
      .slice(0, 100);
    speedPresets = valid.length ? valid : DEFAULT_SETTINGS.speedPresets.slice();
  }

  if (raw.shortcuts !== undefined && !isPlainObject(raw.shortcuts)) {
    return { ok: false, errorKey: "options.err.shortcutsType" };
  }
  if (raw.actions !== undefined && !isPlainObject(raw.actions)) {
    return { ok: false, errorKey: "options.err.actionsType" };
  }
  const shortcuts = normalizeImportedShortcuts(raw);

  let domainOverrides = {};
  if (raw.domainOverrides !== undefined) {
    if (!isPlainObject(raw.domainOverrides)) {
      return { ok: false, errorKey: "options.err.domainOverridesType" };
    }
    Object.keys(raw.domainOverrides).forEach((domain) => {
      const entry = raw.domainOverrides[domain];
      if (!isPlainObject(entry)) return; // dominio con forma inválida: se descarta sin invalidar el resto
      if (!isValidHostKey(domain)) return; // clave que no es un hostname (o "__proto__"): fuera
      const cleanEntry = {};
      Object.keys(entry).forEach((id) => {
        if (KNOWN_ACTION_IDS.includes(id) && typeof entry[id] === "string" && entry[id].length <= 64) {
          cleanEntry[id] = entry[id];
        }
      });
      domainOverrides[domain] = cleanEntry;
    });
  }

  // Los valores recordados por sitio se validan uno a uno, con los mismos límites que se usan al
  // aplicarlos: antes se copiaban tal cual y, p. ej., una velocidad de 1e9 hacía que el content
  // script lanzara una excepción al inicializar cada vídeo de ese sitio.
  const domainMapLimits = { domainSpeeds: [SPEED_MIN, SPEED_MAX], domainFps: [1, 240], domainVolumes: [0, 1000] };
  const domainMaps = {};
  for (const field of Object.keys(domainMapLimits)) {
    if (raw[field] !== undefined && !isPlainObject(raw[field])) {
      return { ok: false, errorKey: "options.err.domainMapType", errorVars: { field } };
    }
    const [min, max] = domainMapLimits[field];
    domainMaps[field] = isPlainObject(raw[field]) ? sanitizeDomainNumberMap(raw[field], min, max) : {};
  }

  // Las pausas por dominio también forman parte de la copia de seguridad (se exportaban, pero al
  // importar se descartaban y, al guardar, se perdían las que hubiera).
  if (raw.pausedDomains !== undefined && !isPlainObject(raw.pausedDomains)) {
    return { ok: false, errorKey: "options.err.pausedDomainsType" };
  }
  const pausedDomains = {};
  if (isPlainObject(raw.pausedDomains)) {
    Object.keys(raw.pausedDomains).forEach((host) => {
      if (isValidHostKey(host) && raw.pausedDomains[host] === true) pausedDomains[host] = true;
    });
  }

  const numberOr = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
  const limited = (key) => clampNumber(numberOr(raw[key], DEFAULT_SETTINGS[key]), key, DEFAULT_SETTINGS[key]);
  const boolOr = (v, fallback) => (typeof v === "boolean" ? v : fallback);
  // El idioma importado se respeta si viene en el archivo; si no, se conserva el que ya tuviera
  // esta instalación — importar una copia de seguridad no debería resetear la preferencia de
  // idioma a la fuerza (a diferencia de "Restaurar todo", que sí es un reset explícito).
  const lang = raw.lang === "en" || raw.lang === "es" ? raw.lang : (settings && settings.lang) || DEFAULT_SETTINGS.lang;

  const normalized = {
    ...DEFAULT_SETTINGS,
    lang,
    fps: limited("fps"),
    speedStep: limited("speedStep"),
    seekSeconds: limited("seekSeconds"),
    multiFrameCount: Math.round(limited("multiFrameCount")),
    showOverlay: boolOr(raw.showOverlay, DEFAULT_SETTINGS.showOverlay),
    frameStepAudio: boolOr(raw.frameStepAudio, DEFAULT_SETTINGS.frameStepAudio),
    wheelSpeedControl: boolOr(raw.wheelSpeedControl, DEFAULT_SETTINGS.wheelSpeedControl),
    rememberSpeedPerDomain: boolOr(raw.rememberSpeedPerDomain, DEFAULT_SETTINGS.rememberSpeedPerDomain),
    volumeMax: Math.round(limited("volumeMax")),
    volumeStep: Math.round(limited("volumeStep")),
    rememberVolumePerDomain: boolOr(raw.rememberVolumePerDomain, DEFAULT_SETTINGS.rememberVolumePerDomain),
    clipMaxMinutes: limited("clipMaxMinutes"),
    speedPresets,
    shortcuts,
    domainOverrides,
    domainSpeeds: domainMaps.domainSpeeds,
    domainFps: domainMaps.domainFps,
    domainVolumes: domainMaps.domainVolumes,
    pausedDomains
  };

  return { ok: true, settings: normalized };
}

function importSettingsFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let raw;
    try {
      raw = JSON.parse(reader.result);
    } catch (err) {
      alert(T(lang(), "options.alert.importInvalidFile", { msg: err.message }));
      return;
    }

    const result = validateImportedSettings(raw);
    if (!result.ok) {
      alert(T(lang(), "options.alert.importFailed", { error: T(lang(), result.errorKey, result.errorVars) }));
      return; // settings actual queda intacto, no se aplica nada parcial
    }

    settings = result.settings;
    currentScope = "global";
    importPending = true;
    populateForm();
    markDirty();
    alert(T(lang(), "options.alert.importSuccess"));
  };
  // Un archivo de configuración real ocupa unos pocos KB; algo enorme no es una copia de seguridad.
  if (file.size > 1024 * 1024) {
    alert(T(lang(), "options.alert.importInvalidFile", { msg: `${Math.round(file.size / 1024)} KB` }));
    return;
  }
  reader.readAsText(file);
}

// Si algo cambia en storage desde otro contexto (el popup, otra pestaña de Opciones) mientras esta
// sigue abierta, se refresca lo que se RENDERIZA a partir de settings (lista de atajos, selector de
// ámbito, vistas previas de {n}, idioma) — nunca los campos de formulario en sí, para no pisarle a
// media escritura algo que el usuario pueda estar editando en ese instante.
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area !== "sync" && area !== "local") || !settings) return;
  if (!dirty) {
    // Nada pendiente aquí: se puede recargar todo, campos incluidos, sin pisar nada del usuario.
    loadSettings((s) => {
      settings = s;
      populateForm();
    });
    return;
  }
  // Hay cambios sin guardar: solo se incorpora lo que esta página no edita (y, tras importar,
  // ni eso — lo importado es lo que el usuario quiere guardar).
  if (importPending) return;
  let touched = false;
  if (changes.lang) {
    settings.lang = changes.lang.newValue === "en" || changes.lang.newValue === "es" ? changes.lang.newValue : null;
    applyLang();
  }
  Object.keys(changes).forEach((key) => {
    if (!EXTERNAL_KEYS.includes(key)) return;
    const value = changes[key].newValue;
    settings[key] = value && typeof value === "object" ? value : {};
    touched = true;
  });
  if (touched) renderScopeSelect();
});

// Si la pestaña de Opciones ya estaba abierta, el popup no puede "recargarla" — nos avisa por
// mensaje para que cambiemos de ámbito en caliente sin esperar a una carga nueva de la página.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "requestScope" || !settings) return;
  const isDomainScope = msg.domain && msg.domain !== "global";
  if (isDomainScope) {
    if (!settings.domainOverrides[msg.domain]) settings.domainOverrides[msg.domain] = {};
    renderScopeSelect();
  }
  switchScope(msg.domain || "global");
  if (isDomainScope) {
    // Solo saltamos a la sección de atajos cuando lo que se pidió fue el ámbito de un dominio
    // concreto (ese es justo el caso de uso: "quiero ver/editar los atajos de este sitio").
    const shortcutsCard = document.getElementById("shortcutList");
    if (shortcutsCard) shortcutsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// ---------- Restablecer todo (doble confirmación en el propio botón) ----------
let resetConfirmPending = false;
let resetConfirmTimeout = null;

function disarmResetConfirm() {
  resetConfirmPending = false;
  clearTimeout(resetConfirmTimeout);
  const btn = q("resetAllBtn");
  btn.textContent = T(lang(), "options.resetAllBtn");
  btn.classList.remove("danger-confirm");
}

function handleResetAllClick() {
  const btn = q("resetAllBtn");
  if (!resetConfirmPending) {
    resetConfirmPending = true;
    btn.textContent = T(lang(), "options.resetAllBtn.confirm");
    btn.classList.add("danger-confirm");
    resetConfirmTimeout = setTimeout(disarmResetConfirm, 5000);
    return;
  }
  disarmResetConfirm();
  resetSettings(() => {
    loadSettings((s) => {
      settings = s;
      currentScope = "global";
      clearDirty();
      populateForm();
      const msg = q("savedMsg");
      msg.textContent = T(lang(), "options.savedMsg.reset");
      msg.classList.remove("hidden");
      setTimeout(() => {
        msg.classList.add("hidden");
        msg.textContent = T(lang(), "options.savedMsg");
      }, 2000);
    });
  });
}

// ---------- Init ----------
function init() {
  loadSettings((s) => {
    settings = s;
    chrome.storage.local.get("pendingDomain", (r) => {
      if (r.pendingDomain) {
        if (!settings.domainOverrides[r.pendingDomain]) settings.domainOverrides[r.pendingDomain] = {};
        currentScope = r.pendingDomain;
        chrome.storage.local.remove("pendingDomain");
      }
      populateForm();
    });
  });

  q("langEs").addEventListener("click", () => setLang("es"));
  q("langEn").addEventListener("click", () => setLang("en"));

  q("fpsPreset").addEventListener("change", (e) => {
    if (e.target.value) {
      q("fps").value = e.target.value;
      markDirty();
    }
  });

  // Cualquier edición en los campos generales cuenta como cambio sin guardar.
  ["fps", "multiFrameCount", "speedStep", "seekSeconds", "volumeMax", "volumeStep", "clipMaxMinutes"].forEach((id) =>
    q(id).addEventListener("input", markDirty)
  );
  ["showOverlay", "frameStepAudio", "rememberSpeedPerDomain", "wheelSpeedControl", "rememberVolumePerDomain"].forEach(
    (id) => q(id).addEventListener("change", markDirty)
  );

  // Vista previa en vivo: mientras se escribe, ya se actualiza tanto el propio label del campo como
  // los labels de los atajos que citan ese número (Retroceder {n} fotogramas/segundos) — sin esperar
  // a "Guardar cambios". settings.* se actualiza aquí también (no solo al guardar) para que ambos
  // reflejen exactamente lo que hay escrito en cada momento, tecleo a tecleo.
  q("multiFrameCount").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) settings.multiFrameCount = v;
    updateCountPreviews();
    renderShortcuts();
  });
  q("seekSeconds").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) settings.seekSeconds = v;
    updateCountPreviews();
    renderShortcuts();
  });

  q("resetPresets").addEventListener("click", () => {
    settings.speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
    markDirty();
    renderPresetChips();
  });

  q("addPresetBtn").addEventListener("click", addPresetFromInput);
  q("newPresetValue").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addPresetFromInput();
    }
  });
  q("presetStepUp").addEventListener("click", addQuarterStepUp);
  q("presetStepDown").addEventListener("click", removeHighestPreset);

  q("scopeSelect").addEventListener("change", (e) => switchScope(e.target.value));

  q("addDomainBtn").addEventListener("click", () => {
    const domain = normalizeDomainInput(q("newDomainInput").value);
    if (!domain) {
      alert(T(lang(), "options.alert.invalidDomain"));
      return;
    }
    if (!settings.domainOverrides[domain]) {
      settings.domainOverrides[domain] = {};
      markDirty();
    }
    q("newDomainInput").value = "";
    renderScopeSelect();
    switchScope(domain);
  });

  q("removeDomainBtn").addEventListener("click", () => {
    if (currentScope === "global") return;
    if (!confirm(T(lang(), "options.confirm.removeDomain", { domain: currentScope }))) return;
    delete settings.domainOverrides[currentScope];
    markDirty();
    currentScope = "global";
    renderScopeSelect();
    renderShortcuts();
  });

  q("exportBtn").addEventListener("click", exportSettings);
  q("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importSettingsFromFile(e.target.files[0]);
    e.target.value = "";
  });

  q("save").addEventListener("click", () => {
    collectFormIntoSettings();
    populateForm(); // refleja los valores ya acotados (p. ej. un fps de 0 vuelve al mínimo)
    const keys = importPending ? PAGE_OWNED_KEYS.concat(EXTERNAL_KEYS, ["lang"]) : PAGE_OWNED_KEYS;
    const partial = {};
    keys.forEach((k) => (partial[k] = settings[k]));
    saveSettings(partial, (error) => {
      if (error) {
        alert(T(lang(), "options.alert.saveFailed", { msg: error }));
        return;
      }
      clearDirty();
      const msg = q("savedMsg");
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 1500);
    });
  });

  // El botón de importar es un <label> que envuelve un <input type="file"> oculto: no recibía el
  // foco con el teclado. Se hace enfocable y se activa con Intro/Espacio como un botón normal.
  const importLabel = q("importFile").closest("label");
  if (importLabel) {
    importLabel.tabIndex = 0;
    importLabel.setAttribute("role", "button");
    importLabel.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        q("importFile").click();
      }
    });
  }


  q("resetAllBtn").addEventListener("click", handleResetAllClick);

  q("altLayoutBtn").addEventListener("click", applyAltLayoutShortcuts);
  detectAltLayout();

  // Aviso del navegador al cerrar o recargar la pestaña con cambios sin guardar.
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---------- Atajos alternativos para teclados con AltGr ----------
// Si el navegador deja leer la distribución del teclado (Keyboard API), se destaca el aviso cuando
// las teclas [ ] \ de la posición US no producen esos caracteres. El aviso se ve siempre igualmente:
// la API no existe en todos los navegadores ni con todas las distribuciones.
function detectAltLayout() {
  if (!navigator.keyboard || typeof navigator.keyboard.getLayoutMap !== "function") return;
  navigator.keyboard
    .getLayoutMap()
    .then((map) => {
      const needsAltGr = map.get("BracketLeft") !== "[" || map.get("BracketRight") !== "]" || map.get("Backslash") !== "\\";
      q("altLayoutDetected").classList.toggle("hidden", !needsAltGr);
      q("altLayoutBox").classList.toggle("highlight", needsAltGr);
    })
    .catch(() => {});
}

// Pone los atajos de ALT_LAYOUT_SHORTCUTS (settings.js) en las acciones globales que siguen con su
// atajo de fábrica, sin pisar nada personalizado ni crear choques. Queda como cambio sin guardar.
function applyAltLayoutShortcuts() {
  if (!settings.shortcuts) settings.shortcuts = {};
  const applied = [];
  const skipped = [];
  Object.keys(ALT_LAYOUT_SHORTCUTS).forEach((id) => {
    const combo = ALT_LAYOUT_SHORTCUTS[id];
    const customized = Object.prototype.hasOwnProperty.call(settings.shortcuts, id) && settings.shortcuts[id] !== combo;
    const clash = Object.keys(ACTION_DEFS).some(
      (other) => other !== id && shortcutsEqual(effectiveGlobalShortcut(settings, other), combo)
    );
    if (customized || clash) {
      skipped.push(resolveActionLabel(settings, id));
      return;
    }
    settings.shortcuts[id] = combo;
    applied.push(id);
  });
  if (applied.length) markDirty();
  if (currentScope !== "global") switchScope("global");
  else renderShortcuts();
  const msg = q("altLayoutMsg");
  let text = T(lang(), "options.altLayout.done", { n: applied.length });
  if (skipped.length) text += " " + T(lang(), "options.altLayout.skipped", { list: skipped.join(", ") });
  msg.textContent = text;
  msg.classList.remove("hidden");
}

init();
