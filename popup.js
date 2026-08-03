let settings = null;
let activeTabId = null;
let activeHostname = null;

function q(id) { return document.getElementById(id); }

function sendToTab(msg) {
  return new Promise((resolve) => {
    if (!activeTabId) return resolve(null);
    chrome.tabs.sendMessage(activeTabId, msg, (resp) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    });
  });
}

// El slider es "escalonado": solo puede pararse en los presets <= 2x, nunca en un valor intermedio.
function sliderValues() {
  const vals = settings.speedPresets.filter((v) => v <= 2.0001).sort((a, b) => a - b);
  return vals.length ? vals : [1];
}

function setupSlider() {
  const vals = sliderValues();
  const slider = q("speedSlider");
  slider.min = 0;
  slider.max = vals.length - 1;
  slider.step = 1;
}

function syncSliderToSpeed(speed) {
  const vals = sliderValues();
  let bestIdx = 0;
  let bestDiff = Infinity;
  vals.forEach((v, i) => {
    const diff = Math.abs(v - speed);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  q("speedSlider").value = bestIdx;
}

function renderPresets(currentSpeed) {
  const container = q("speedPresets");
  container.innerHTML = "";
  settings.speedPresets.forEach((p) => {
    const btn = document.createElement("button");
    btn.textContent = p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "x";
    if (Math.abs(p - currentSpeed) < 0.001) btn.classList.add("active");
    btn.addEventListener("click", async () => {
      await sendToTab({ type: "setSpeed", speed: p });
      refreshState();
    });
    container.appendChild(btn);
  });
}

async function refreshState() {
  const resp = await sendToTab({ type: "getState" });
  if (!resp || !resp.ok) {
    q("noVideo").classList.remove("hidden");
    q("controls").classList.add("hidden");
    return;
  }
  q("noVideo").classList.add("hidden");
  q("controls").classList.remove("hidden");

  q("stateBadge").textContent = resp.paused ? "⏸ Pausa" : "▶ Reproduciendo";
  q("timeBadge").textContent = `${formatTime(resp.currentTime)} / ${formatTime(resp.duration)}`;
  q("speedBadge").textContent = `${resp.playbackRate.toFixed(2)}x`;
  setupSlider();
  syncSliderToSpeed(resp.playbackRate);
  q("toggleMute").textContent = resp.muted ? "🔇" : "🔊";
  q("toggleLoop").classList.toggle("active", !!resp.loop);
  renderPresets(resp.playbackRate);

  if (resp.domainFps) {
    q("fpsInfo").textContent = `${resp.domainFps.toFixed(3)} fps (fijado para este sitio)`;
  } else if (resp.detectedFps) {
    q("fpsInfo").textContent = `~${resp.detectedFps.toFixed(3)} fps (detectado)`;
  } else {
    q("fpsInfo").textContent = `usando global (${settings.fps} fps)`;
  }
}

function bind(id, action) {
  q(id).addEventListener("click", async () => {
    await action();
    refreshState();
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab && tab.id;
  try {
    activeHostname = tab && tab.url ? new URL(tab.url).hostname : null;
  } catch (e) {
    activeHostname = null;
  }

  loadSettings((s) => {
    settings = s;
    refreshState();
  });

  bind("frameBack", () => sendToTab({ type: "runAction", id: "frameBack" }));
  bind("frameForward", () => sendToTab({ type: "runAction", id: "frameForward" }));
  bind("togglePlay", () => sendToTab({ type: "runAction", id: "togglePlay" }));
  bind("seekBack", () => sendToTab({ type: "runAction", id: "seekBack" }));
  bind("seekForward", () => sendToTab({ type: "runAction", id: "seekForward" }));
  bind("toggleMute", () => sendToTab({ type: "runAction", id: "toggleMute" }));
  bind("toggleLoop", () => sendToTab({ type: "runAction", id: "toggleLoop" }));
  bind("togglePip", () => sendToTab({ type: "runAction", id: "togglePip" }));
  bind("screenshot", () => sendToTab({ type: "runAction", id: "screenshot" }));
  bind("speedUp", () => sendToTab({ type: "runAction", id: "speedUp" }));
  bind("speedDown", () => sendToTab({ type: "runAction", id: "speedDown" }));
  bind("useDetectedFps", () => sendToTab({ type: "useDetectedFpsForDomain" }));

  q("speedSlider").addEventListener("input", async (e) => {
    const vals = sliderValues();
    const idx = parseInt(e.target.value, 10);
    const speed = vals[idx] !== undefined ? vals[idx] : 1;
    await sendToTab({ type: "setSpeed", speed });
    refreshState();
  });

  // chrome.runtime.openOptionsPage() solo ENFOCA la pestaña de Opciones si ya está abierta, sin
  // recargarla — así que el ámbito no cambiaría. Por eso avisamos también en caliente por mensaje,
  // además de dejar la preferencia guardada por si la pestaña se abre desde cero.
  function requestOptionsScope(domain) {
    chrome.runtime.sendMessage({ type: "requestScope", domain }, () => {
      void chrome.runtime.lastError; // sin oyente todavía (pestaña no abierta aún): se ignora
    });
  }

  q("openOptions").addEventListener("click", () => {
    requestOptionsScope("global");
    chrome.runtime.openOptionsPage();
  });
  q("openOptions2").addEventListener("click", (e) => {
    e.preventDefault();
    requestOptionsScope("global");
    chrome.runtime.openOptionsPage();
  });
  q("openDomainOptions").addEventListener("click", (e) => {
    e.preventDefault();
    if (activeHostname) {
      requestOptionsScope(activeHostname);
      chrome.storage.local.set({ pendingDomain: activeHostname }, () => chrome.runtime.openOptionsPage());
    } else {
      chrome.runtime.openOptionsPage();
    }
  });
}

init();
