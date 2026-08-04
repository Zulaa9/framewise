let settings = null;
let recordingId = null;
let currentScope = "global"; // "global" | hostname

function q(id) { return document.getElementById(id); }

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
  renderPresetChips();
  renderScopeSelect();
  renderShortcuts();
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
      removeBtn.title = `Quitar ${label}x`;
      removeBtn.addEventListener("click", () => {
        settings.speedPresets = settings.speedPresets.filter((v) => Math.abs(v - p) > 0.0001);
        if (settings.speedPresets.length === 0) settings.speedPresets = [1];
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
    alert("Escribe un número de velocidad válido, ej: 1.6");
    return;
  }
  if (value < SPEED_MIN || value > SPEED_MAX) {
    alert(`La velocidad debe estar entre ${SPEED_MIN}x y ${SPEED_MAX}x — es el rango real que admite la extensión.`);
    return;
  }
  if (!settings.speedPresets.some((v) => Math.abs(v - value) < 0.0001)) {
    settings.speedPresets.push(value);
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
  renderPresetChips();
}

// ---------- Selector de ámbito (global / por dominio) ----------
function renderScopeSelect() {
  const sel = q("scopeSelect");
  sel.innerHTML = "";
  const globalOpt = document.createElement("option");
  globalOpt.value = "global";
  globalOpt.textContent = "Global (todos los sitios)";
  sel.appendChild(globalOpt);

  Object.keys(settings.domainOverrides)
    .sort()
    .forEach((domain) => {
      const opt = document.createElement("option");
      opt.value = domain;
      const n = Object.keys(settings.domainOverrides[domain]).length;
      opt.textContent = `${domain}  (${n} override${n === 1 ? "" : "s"})`;
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

  Object.entries(settings.actions).forEach(([id, cfg]) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = cfg.label;

    const controls = document.createElement("div");
    controls.className = "controls";

    const keycap = document.createElement("span");
    keycap.id = `keycap-${id}`;

    let displayValue, isOverridden;
    if (isGlobal) {
      displayValue = cfg.shortcut;
      isOverridden = false;
    } else if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      displayValue = overrides[id];
      isOverridden = true;
    } else {
      displayValue = cfg.shortcut;
      isOverridden = false;
    }

    keycap.className = "keycap" + (displayValue ? "" : " empty");
    keycap.textContent = displayValue || "sin atajo";

    const tag = document.createElement("span");
    if (!isGlobal) {
      tag.className = isOverridden ? "override-tag" : "inherited-tag";
      tag.textContent = isOverridden ? "personalizado aquí" : "heredado de global";
    }

    const recordBtn = document.createElement("button");
    recordBtn.textContent = "Grabar";
    recordBtn.addEventListener("click", () => startRecording(id, keycap, recordBtn));

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Borrar";
    clearBtn.title = isGlobal
      ? "Deja esta acción sin atajo global"
      : "Desactiva esta acción solo en este dominio (sin heredar del global)";
    clearBtn.addEventListener("click", () => {
      if (isGlobal) {
        settings.actions[id].shortcut = "";
      } else {
        settings.domainOverrides[currentScope][id] = "";
      }
      renderShortcuts();
      renderScopeSelect();
    });

    controls.appendChild(keycap);
    if (!isGlobal) controls.appendChild(tag);
    controls.appendChild(recordBtn);
    controls.appendChild(clearBtn);

    if (!isGlobal && isOverridden) {
      const inheritBtn = document.createElement("button");
      inheritBtn.textContent = "Heredar de global";
      inheritBtn.addEventListener("click", () => {
        delete settings.domainOverrides[currentScope][id];
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
  Object.keys(settings.actions).forEach((id) => {
    map[id] = effectiveShortcutFor(settings, scope === "global" ? "__global__" : scope, id);
  });
  return map;
}

function startRecording(id, keycapEl, btnEl) {
  if (recordingId) return;
  recordingId = id;
  keycapEl.textContent = "Pulsa una tecla…";
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
        const clash = Object.entries(settings.actions).find(([oid, c]) => oid !== id && c.shortcut === combo);
        settings.actions[id].shortcut = combo;
        renderShortcuts();
        warnIfClash(clash, combo);
      } else {
        if (!settings.domainOverrides[currentScope]) settings.domainOverrides[currentScope] = {};
        settings.domainOverrides[currentScope][id] = combo;
        renderShortcuts();
        renderScopeSelect();
        warnIfDomainClash(id, combo);
      }
    } else {
      renderShortcuts();
    }
  }

  document.addEventListener("keydown", onKeydown, true);
}

function warnIfClash(clash, combo) {
  if (!clash) return;
  const clashLabel = settings.actions[clash[0]].label;
  const clashRow = [...document.querySelectorAll(".shortcut-row")].find(
    (r) => r.querySelector(".label").textContent === clashLabel
  );
  if (clashRow) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = `⚠ "${combo}" ya estaba asignado aquí — considera cambiarlo`;
    clashRow.appendChild(warn);
  }
}

// Colisión de atajos EFECTIVOS dentro de un dominio: comprueba la acción recién grabada (id/combo,
// ya guardada en settings.domainOverrides[currentScope]) contra el resultado real de cada acción en
// ese dominio — que puede venir de un override propio, o heredado del global si no hay override (o
// si el override está vacío, es decir la acción está desactivada ahí, lo cual nunca choca con nada).
function warnIfDomainClash(id, combo) {
  const effective = effectiveShortcutsForScope(currentScope);
  const clashId = Object.keys(effective).find((oid) => oid !== id && effective[oid] && effective[oid] === combo);
  if (!clashId) return;

  const overrides = settings.domainOverrides[currentScope] || {};
  const clashIsOwnOverride = Object.prototype.hasOwnProperty.call(overrides, clashId) && overrides[clashId] !== "";
  const source = clashIsOwnOverride ? "personalizado en este dominio" : "heredado del global";
  const clashLabel = settings.actions[clashId].label;

  const clashRow = [...document.querySelectorAll(".shortcut-row")].find(
    (r) => r.querySelector(".label").textContent === clashLabel
  );
  if (clashRow) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = `⚠ "${combo}" ya está en uso aquí por "${clashLabel}" (${source}) — considera cambiarlo`;
    clashRow.appendChild(warn);
  }
}

// ---------- Formulario general ----------
function collectFormIntoSettings() {
  settings.fps = parseFloat(q("fps").value) || DEFAULT_SETTINGS.fps;
  settings.multiFrameCount = parseInt(q("multiFrameCount").value, 10) || DEFAULT_SETTINGS.multiFrameCount;
  settings.speedStep = parseFloat(q("speedStep").value) || DEFAULT_SETTINGS.speedStep;
  settings.seekSeconds = parseFloat(q("seekSeconds").value) || DEFAULT_SETTINGS.seekSeconds;
  settings.showOverlay = q("showOverlay").checked;
  settings.frameStepAudio = q("frameStepAudio").checked;
  settings.rememberSpeedPerDomain = q("rememberSpeedPerDomain").checked;
  settings.wheelSpeedControl = q("wheelSpeedControl").checked;
  settings.volumeMax = parseInt(q("volumeMax").value, 10) || DEFAULT_SETTINGS.volumeMax;
  settings.volumeStep = parseInt(q("volumeStep").value, 10) || DEFAULT_SETTINGS.volumeStep;
  settings.rememberVolumePerDomain = q("rememberVolumePerDomain").checked;
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

const KNOWN_ACTION_IDS = Object.keys(SYNC_DEFAULTS.actions);

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Normaliza una entrada de settings.actions[id] proveniente de un archivo importado: si no tiene la
// forma esperada, se usa la acción por defecto entera; si la tiene, cada campo se sanea por
// separado (nunca se confía en el tipo de un campo suelto del JSON importado).
function normalizeImportedAction(id, raw) {
  const base = DEFAULT_SETTINGS.actions[id];
  if (!isPlainObject(raw)) return { ...base };
  return {
    label: typeof raw.label === "string" && raw.label ? raw.label : base.label,
    shortcut: typeof raw.shortcut === "string" ? raw.shortcut : base.shortcut,
    repeatable: typeof raw.repeatable === "boolean" ? raw.repeatable : base.repeatable
  };
}

// Valida una configuración importada ANTES de aplicar nada: si algo tiene un tipo fundamentalmente
// incorrecto en los campos clave (speedPresets, actions, domainOverrides, los mapas por dominio),
// se rechaza entera con un mensaje claro en vez de dejar el ajuste actual a medio pisar. Los campos
// ausentes (configuraciones antiguas) se rellenan con los valores por defecto; los valores sueltos
// con tipo incorrecto dentro de una colección válida se descartan uno a uno en vez de invalidar todo
// el archivo.
function validateImportedSettings(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "el archivo no contiene un objeto de configuración." };
  }

  let speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
  if (raw.speedPresets !== undefined) {
    if (!Array.isArray(raw.speedPresets)) {
      return { ok: false, error: '"speedPresets" debería ser una lista de números.' };
    }
    const valid = raw.speedPresets.filter(
      (v) => typeof v === "number" && isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX
    );
    speedPresets = valid.length ? valid : DEFAULT_SETTINGS.speedPresets.slice();
  }

  let actions = { ...DEFAULT_SETTINGS.actions };
  if (raw.actions !== undefined) {
    if (!isPlainObject(raw.actions)) {
      return { ok: false, error: '"actions" debería ser un objeto de acciones.' };
    }
    actions = {};
    KNOWN_ACTION_IDS.forEach((id) => {
      actions[id] = normalizeImportedAction(id, raw.actions[id]);
    });
  }

  let domainOverrides = {};
  if (raw.domainOverrides !== undefined) {
    if (!isPlainObject(raw.domainOverrides)) {
      return { ok: false, error: '"domainOverrides" debería ser un objeto (dominio → atajos).' };
    }
    Object.keys(raw.domainOverrides).forEach((domain) => {
      const entry = raw.domainOverrides[domain];
      if (!isPlainObject(entry)) return; // dominio con forma inválida: se descarta sin invalidar el resto
      const cleanEntry = {};
      Object.keys(entry).forEach((id) => {
        if (KNOWN_ACTION_IDS.includes(id) && typeof entry[id] === "string") {
          cleanEntry[id] = entry[id];
        }
      });
      domainOverrides[domain] = cleanEntry;
    });
  }

  const domainMapFields = ["domainSpeeds", "domainFps", "domainVolumes"];
  const domainMaps = {};
  for (const field of domainMapFields) {
    if (raw[field] !== undefined && !isPlainObject(raw[field])) {
      return { ok: false, error: `"${field}" debería ser un objeto (dominio → valor).` };
    }
    domainMaps[field] = isPlainObject(raw[field]) ? { ...raw[field] } : { ...DEFAULT_SETTINGS[field] };
  }

  const numberOr = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
  const boolOr = (v, fallback) => (typeof v === "boolean" ? v : fallback);

  const normalized = {
    ...DEFAULT_SETTINGS,
    fps: numberOr(raw.fps, DEFAULT_SETTINGS.fps),
    speedStep: numberOr(raw.speedStep, DEFAULT_SETTINGS.speedStep),
    seekSeconds: numberOr(raw.seekSeconds, DEFAULT_SETTINGS.seekSeconds),
    multiFrameCount: numberOr(raw.multiFrameCount, DEFAULT_SETTINGS.multiFrameCount),
    showOverlay: boolOr(raw.showOverlay, DEFAULT_SETTINGS.showOverlay),
    frameStepAudio: boolOr(raw.frameStepAudio, DEFAULT_SETTINGS.frameStepAudio),
    wheelSpeedControl: boolOr(raw.wheelSpeedControl, DEFAULT_SETTINGS.wheelSpeedControl),
    rememberSpeedPerDomain: boolOr(raw.rememberSpeedPerDomain, DEFAULT_SETTINGS.rememberSpeedPerDomain),
    volumeMax: numberOr(raw.volumeMax, DEFAULT_SETTINGS.volumeMax),
    volumeStep: numberOr(raw.volumeStep, DEFAULT_SETTINGS.volumeStep),
    rememberVolumePerDomain: boolOr(raw.rememberVolumePerDomain, DEFAULT_SETTINGS.rememberVolumePerDomain),
    speedPresets,
    actions,
    domainOverrides,
    domainSpeeds: domainMaps.domainSpeeds,
    domainFps: domainMaps.domainFps,
    domainVolumes: domainMaps.domainVolumes
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
      alert("Archivo inválido: " + err.message);
      return;
    }

    const result = validateImportedSettings(raw);
    if (!result.ok) {
      alert("No se pudo importar la configuración: " + result.error);
      return; // settings actual queda intacto, no se aplica nada parcial
    }

    settings = result.settings;
    currentScope = "global";
    populateForm();
    alert('Configuración importada. Pulsa "Guardar cambios" para aplicarla.');
  };
  reader.readAsText(file);
}

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
  btn.textContent = "♻ Restaurar todo a valores por defecto";
  btn.classList.remove("danger-confirm");
}

function handleResetAllClick() {
  const btn = q("resetAllBtn");
  if (!resetConfirmPending) {
    resetConfirmPending = true;
    btn.textContent = "⚠ Pulsa de nuevo para confirmar el borrado";
    btn.classList.add("danger-confirm");
    resetConfirmTimeout = setTimeout(disarmResetConfirm, 5000);
    return;
  }
  disarmResetConfirm();
  resetSettings(() => {
    loadSettings((s) => {
      settings = s;
      currentScope = "global";
      populateForm();
      const msg = q("savedMsg");
      msg.textContent = "✔ Restaurado a valores por defecto";
      msg.classList.remove("hidden");
      setTimeout(() => {
        msg.classList.add("hidden");
        msg.textContent = "✔ Guardado";
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

  q("fpsPreset").addEventListener("change", (e) => {
    if (e.target.value) q("fps").value = e.target.value;
  });

  q("resetPresets").addEventListener("click", () => {
    settings.speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
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
      alert("Escribe un dominio válido, ej: www.crunchyroll.com");
      return;
    }
    if (!settings.domainOverrides[domain]) settings.domainOverrides[domain] = {};
    q("newDomainInput").value = "";
    renderScopeSelect();
    switchScope(domain);
  });

  q("removeDomainBtn").addEventListener("click", () => {
    if (currentScope === "global") return;
    if (!confirm(`¿Eliminar todos los overrides de "${currentScope}"?`)) return;
    delete settings.domainOverrides[currentScope];
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
    saveSettings(settings, () => {
      const msg = q("savedMsg");
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 1500);
    });
  });

  q("resetAllBtn").addEventListener("click", handleResetAllClick);
}

init();
