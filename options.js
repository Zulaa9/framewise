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
}

function addPresetFromInput() {
  const input = q("newPresetValue");
  const value = parseFloat(input.value);
  if (isNaN(value) || value <= 0) {
    alert("Escribe un número de velocidad válido, ej: 1.6");
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
  settings.speedPresets = settings.speedPresets.slice().sort((a, b) => a - b);
  if (settings.speedPresets.length === 0) settings.speedPresets = DEFAULT_SETTINGS.speedPresets.slice();
}

// ---------- Exportar / Importar ----------
function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "frame-speed-controller-config.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function importSettingsFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      settings = { ...DEFAULT_SETTINGS, ...imported };
      settings.actions = { ...DEFAULT_SETTINGS.actions, ...(imported.actions || {}) };
      settings.domainOverrides = imported.domainOverrides || {};
      settings.domainSpeeds = imported.domainSpeeds || {};
      settings.domainFps = imported.domainFps || {};
      currentScope = "global";
      populateForm();
      alert('Configuración importada. Pulsa "Guardar cambios" para aplicarla.');
    } catch (err) {
      alert("Archivo inválido: " + err.message);
    }
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
