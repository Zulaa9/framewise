let settings = null;
let activeTabId = null;
let activeHostname = null;

function q(id) { return document.getElementById(id); }

// Pregunta al background en qué frame de la pestaña está el vídeo (puede ser un iframe). Si no lo
// sabe (aún no se registró), null — se manda sin frame concreto y responde el que corresponda.
function resolveVideoFrameId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getVideoFrame", tabId: activeTabId }, (resp) => {
      if (chrome.runtime.lastError || !resp) return resolve(null);
      resolve(typeof resp.frameId === "number" ? resp.frameId : null);
    });
  });
}

function sendToTabOnce(msg, frameId) {
  return new Promise((resolve) => {
    const opts = typeof frameId === "number" ? { frameId } : undefined;
    const cb = (resp) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    };
    if (opts) chrome.tabs.sendMessage(activeTabId, msg, opts, cb);
    else chrome.tabs.sendMessage(activeTabId, msg, cb);
  });
}

// Envía el mensaje al frame donde sabemos que está el vídeo; si falla (frame desactualizado tras
// una navegación, o el content script aún no había arrancado — típico si el popup se abre muy
// rápido tras cargar la página) reintenta sin frame fijo y, si sigue sin éxito, unas pocas veces más
// con un pequeño margen.
async function sendToTab(msg, attempt) {
  attempt = attempt || 0;
  if (!activeTabId) return null;

  const frameId = await resolveVideoFrameId();
  let resp = await sendToTabOnce(msg, frameId);
  if ((!resp || resp.ok === false) && frameId !== null) {
    resp = await sendToTabOnce(msg, null);
  }
  if (!resp && attempt < 4) {
    await new Promise((r) => setTimeout(r, 200));
    return sendToTab(msg, attempt + 1);
  }
  return resp;
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

// Deshabilita en el popup lo que ya sabemos con certeza que no va a funcionar en este vídeo/sitio
// (capacidad del navegador, no cambia), en vez de dejar que el usuario lo descubra al pulsar.
function setButtonAvailability(id, available, reasonIfNot) {
  const btn = q(id);
  if (btn.dataset.defaultTitle === undefined) btn.dataset.defaultTitle = btn.title || "";
  btn.disabled = !available;
  btn.title = available ? btn.dataset.defaultTitle : reasonIfNot;
}

// Para cosas que dependen del estado del buffer (cambia con el tiempo, no se puede "deshabilitar
// para siempre"): se deja pulsable, solo se avisa con un estilo de advertencia si ya falló antes.
function setButtonWarning(id, warn, reasonIfWarn) {
  const btn = q(id);
  if (btn.dataset.defaultTitle === undefined) btn.dataset.defaultTitle = btn.title || "";
  btn.classList.toggle("warn", warn);
  btn.title = warn ? reasonIfWarn : btn.dataset.defaultTitle;
}

function applyCapabilities(caps, loopBroken) {
  caps = caps || { pip: true, screenshot: true, frameAudio: true };
  setButtonAvailability("togglePip", caps.pip, "Picture-in-Picture no disponible en este vídeo");
  setButtonAvailability(
    "screenshot",
    caps.screenshot,
    "No se puede capturar: vídeo protegido (DRM) — el navegador bloquea leer sus fotogramas"
  );
  setButtonWarning(
    "toggleLoop",
    loopBroken,
    "El bucle falló antes en este vídeo (el inicio ya no está cargado) — puedes reintentarlo"
  );
}

// Mientras el popup está abierto sin más, refresca solo el tiempo/estado de reproducción (nada
// del slider ni de los presets, para no interferir si el usuario está interactuando con ellos).
async function tickTime() {
  const resp = await sendToTab({ type: "getState" });
  if (!resp || !resp.ok) return;
  q("stateBadge").textContent = resp.paused ? "⏸ Pausa" : "▶ Reproduciendo";
  q("timeBadge").textContent = `${formatTime(resp.currentTime)} / ${formatTime(resp.duration)}`;
}

let timeTicker = null;

function startTimeTicker() {
  stopTimeTicker();
  timeTicker = setInterval(tickTime, 400);
}

function stopTimeTicker() {
  if (timeTicker) clearInterval(timeTicker);
  timeTicker = null;
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
  applyCapabilities(resp.capabilities, resp.loopBroken);

  const volumeMax = resp.volumeMax || 300;
  q("volumeSlider").max = volumeMax;
  q("volumeSlider").value = resp.volume;
  q("volumeBadge").textContent = `${resp.volume}%`;
  q("volumeMaxHint").textContent = `(hasta ${volumeMax}% amplificado)`;

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

let isDetachedWindow = false;

// Convierte la ventana desacoplada en una ventana flotante DE VERDAD (Document Picture-in-Picture:
// Chrome/Edge 116+), que se mantiene por encima de todo, incluida la pestaña del vídeo. La ventana
// flotante necesita que "algo" siga vivo de fondo para no cerrarse sola en cuanto pierde el foco —
// por eso, en vez de mover el contenido actual, cargamos una copia independiente del panel dentro
// de un iframe (con su propio popup.js corriendo), y minimizamos la ventana host para que solo se
// vea la flotante.
async function floatWindow() {
  if (!("documentPictureInPicture" in window)) {
    alert("Tu navegador no soporta ventanas superpuestas (Document Picture-in-Picture). Hace falta Chrome/Edge 116 o superior.");
    return;
  }

  const hostWindow = await chrome.windows.getCurrent();
  const pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 700 });

  pipWindow.document.title = "Framewise";
  // Un iframe con height:100% necesita que TODA la cadena de ancestros (html y body) tenga una
  // altura explícita — si no, "100%" no tiene de qué partir y el iframe colapsa a su alto por
  // defecto (~150px), recortando el contenido y añadiendo scroll.
  pipWindow.document.documentElement.style.cssText = "height:100%; margin:0; padding:0;";
  pipWindow.document.body.style.cssText = "height:100%; margin:0; padding:0; overflow:hidden;";

  const iframe = pipWindow.document.createElement("iframe");
  iframe.style.cssText = "border:0; width:100%; height:100%; display:block;";
  iframe.src = chrome.runtime.getURL(
    `popup.html?tabId=${activeTabId}&hostname=${encodeURIComponent(activeHostname || "")}&floating=1`
  );
  pipWindow.document.body.appendChild(iframe);

  chrome.windows.update(hostWindow.id, { state: "minimized" });

  pipWindow.addEventListener("pagehide", () => {
    chrome.windows.update(hostWindow.id, { state: "normal", focused: true }).catch(() => {});
  });
}

async function init() {
  // Cuando el panel se abre "en ventana aparte" (ver detachBtn más abajo), viene con la pestaña
  // objetivo ya indicada en la URL — en ese caso NO hay que usar chrome.tabs.query({currentWindow})
  // porque "la ventana actual" sería esta ventanita nueva, no la que tiene el vídeo.
  const params = new URLSearchParams(location.search);
  const paramTabId = params.get("tabId");

  const isFloatingInstance = params.get("floating") === "1";

  if (paramTabId) {
    isDetachedWindow = true;
    activeTabId = parseInt(paramTabId, 10);
    activeHostname = params.get("hostname") || null;
    q("detachBtn").classList.add("hidden");

    // "Superponer" solo tiene sentido desde la ventana ya desacoplada (no desde el popup normal
    // de la barra de herramientas, que se cerraría solo en cuanto la ventana flotante robe el foco,
    // matando el contexto que la mantiene viva) y solo si el navegador soporta Document PiP.
    if (!isFloatingInstance && "documentPictureInPicture" in window) {
      q("floatBtn").classList.remove("hidden");
      q("floatBtn").addEventListener("click", floatWindow);
    }
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab && tab.id;
    try {
      activeHostname = tab && tab.url ? new URL(tab.url).hostname : null;
    } catch (e) {
      activeHostname = null;
    }
    q("detachBtn").addEventListener("click", () => {
      const url = chrome.runtime.getURL(
        `popup.html?tabId=${activeTabId}&hostname=${encodeURIComponent(activeHostname || "")}`
      );
      chrome.windows.create({ url, type: "popup", width: 340, height: 700, focused: true });
      window.close();
    });
  }

  loadSettings((s) => {
    settings = s;
    refreshState();
    startTimeTicker();
  });

  window.addEventListener("unload", stopTimeTicker);

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
  bind("volumeUp", () => sendToTab({ type: "runAction", id: "volumeUp" }));
  bind("volumeDown", () => sendToTab({ type: "runAction", id: "volumeDown" }));
  bind("volumeReset", () => sendToTab({ type: "runAction", id: "volumeReset" }));
  bind("useDetectedFps", () => sendToTab({ type: "useDetectedFpsForDomain" }));

  // Redes de seguridad para cuando no se encuentra vídeo (p. ej. justo tras recargar la
  // extensión, con content scripts huérfanos en pestañas que ya estaban abiertas).
  q("retryBtn").addEventListener("click", () => refreshState());

  q("reloadTabBtn").addEventListener("click", () => {
    if (!activeTabId) return;
    chrome.tabs.reload(activeTabId, {}, () => {
      void chrome.runtime.lastError;
      setTimeout(refreshState, 1200);
    });
  });

  q("pickVideoBtn").addEventListener("click", () => {
    if (!activeTabId) return;
    // Se manda vía background (en vez de tabs.sendMessage directo) porque desde la ventana
    // desacoplada/flotante activeTabId no es "la pestaña actual" de este contexto, y
    // chrome.tabs.sendMessage no necesita ningún permiso especial para esto de todos modos.
    chrome.runtime.sendMessage({ type: "startVideoPickerOnTab", tabId: activeTabId }, () => void chrome.runtime.lastError);
    window.close();
  });

  q("speedSlider").addEventListener("input", async (e) => {
    const vals = sliderValues();
    const idx = parseInt(e.target.value, 10);
    const speed = vals[idx] !== undefined ? vals[idx] : 1;
    await sendToTab({ type: "setSpeed", speed });
    refreshState();
  });

  q("volumeSlider").addEventListener("input", async (e) => {
    await sendToTab({ type: "setVolume", percent: parseInt(e.target.value, 10) });
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
