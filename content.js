// Se ejecuta en cada pestaña. Controla el/los <video> de la página y escucha los atajos configurados.
(function () {
  let settings = null;
  let overlayTimeout = null;
  const domain = location.hostname;

  // Repetición ("burst") mientras se mantiene pulsada una tecla de acción repetible.
  let heldRepeat = null; // { combo, id }

  // FPS detectado en vivo por requestVideoFrameCallback (no persiste, se recalcula cada carga).
  let liveDetectedFps = null;

  loadSettings((s) => { settings = s; });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" || area === "local") loadSettings((s) => { settings = s; });
  });

  function activeVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;
    let v;
    if (videos.length === 1) v = videos[0];
    else {
      const playing = videos.find((vv) => !vv.paused && !vv.ended && vv.readyState > 2);
      v = playing || videos.reduce((a, b) => (b.clientWidth * b.clientHeight > a.clientWidth * a.clientHeight ? b : a));
    }
    initVideo(v);
    return v;
  }

  function initVideo(v) {
    if (v.__fscInit) return;
    v.__fscInit = true;
    v.__fscCapabilities = { pip: false, screenshot: false, frameAudio: false };
    v.__fscLoopBroken = false;
    v.__fscManualLoop = false;
    v.loop = false; // por si el sitio lo trae activado de fábrica; el bucle lo gestionamos nosotros
    applyDomainSpeed(v);
    applyDomainVolume(v);
    attachFpsDetection(v);
    detectCapabilities(v);
    // El "tainted" del canvas (DRM) y la disponibilidad de PiP a veces no se saben hasta que hay
    // datos decodificados de verdad, así que se vuelve a comprobar cuando el vídeo ya tiene un frame.
    v.addEventListener("loadeddata", () => detectCapabilities(v));
    // Avisa al background de en qué frame de la pestaña está este vídeo — así el popup puede
    // dirigirse directamente a este frame en vez de arriesgarse a que responda antes uno sin vídeo
    // (relevante cuando el reproductor real vive dentro de un iframe).
    chrome.runtime.sendMessage({ type: "videoFound" }, () => void chrome.runtime.lastError);
  }

  // Comprueba, una vez por vídeo, qué funciones son técnicamente posibles aquí (no cambia con el
  // tiempo, a diferencia del bucle o el retroceso más allá del buffer, que solo se sabe al probar).
  function detectCapabilities(v) {
    const caps = v.__fscCapabilities;

    caps.frameAudio = typeof v.requestVideoFrameCallback === "function";
    caps.pip = !!(document.pictureInPictureEnabled && !v.disablePictureInPicture);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      canvas.getContext("2d").drawImage(v, 0, 0, 2, 2);
      canvas.toDataURL(); // lanza SecurityError si el frame es "tainted" (típico en vídeo con DRM)
      caps.screenshot = true;
    } catch (err) {
      caps.screenshot = false;
    }
  }

  // En SPAs como YouTube, al pasar al siguiente vídeo de una lista se recrea (o reemplaza) el
  // <video> sin recargar la página. Si nada dispara activeVideo() justo en ese momento (el usuario
  // no toca nada), ese vídeo nuevo nunca se registra. Este observer detecta el cambio por sí solo,
  // sin depender de que el usuario interactúe.
  function scanForNewVideos() {
    document.querySelectorAll("video").forEach((v) => {
      if (!v.__fscInit) initVideo(v);
    });
  }
  new MutationObserver(scanForNewVideos).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Velocidad recordada por dominio ----------
  function applyDomainSpeed(v) {
    if (!settings || !settings.rememberSpeedPerDomain) return;
    const remembered = settings.domainSpeeds[domain];
    if (remembered && remembered > 0) v.playbackRate = remembered;
  }

  function persistDomainSpeed(speed) {
    if (!settings || !settings.rememberSpeedPerDomain) return;
    settings.domainSpeeds[domain] = speed;
    saveSettings({ domainSpeeds: settings.domainSpeeds });
  }

  // ---------- Volumen de la extensión (independiente del volumen propio del reproductor) ----------
  // IMPORTANTE: esto NO es lo mismo que el volumen nativo del <video> (el que controla el slider
  // del propio sitio) — son dos cosas distintas y no se sincronizan entre sí a propósito. El
  // volumen de la extensión es una capa de GANANCIA aparte, aplicada POR ENCIMA de lo que sea que
  // tenga puesto el reproductor: 100% aquí significa "no toco nada", y el resto es un multiplicador
  // independiente (0% = silencio propio, 300% = el triple de fuerte que lo que ya suene el sitio).
  // Nunca se lee ni se escribe video.volume — así, mover el volumen del propio reproductor no
  // afecta a lo que muestra la extensión, y viceversa.
  function ensureAudioGraph(video) {
    if (video.__fscGain) return video.__fscGain;
    if (video.__fscAudioUnavailable) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      video.__fscAudioCtx = ctx;
      video.__fscGain = gain;
      return gain;
    } catch (err) {
      // Puede fallar en vídeo de origen cruzado sin cabeceras CORS (Web Audio API lo silencia por
      // seguridad) o si el navegador no soporta AudioContext.
      video.__fscAudioUnavailable = true;
      return null;
    }
  }

  function currentVolumePercent(video) {
    // Sin grafo propio todavía = no hemos tocado nada = 100% (neutro), sea cual sea el volumen
    // real del reproductor en ese momento.
    if (video.__fscGain) return Math.round(video.__fscGain.gain.value * 100);
    return 100;
  }

  function setVolume(video, percent, opts) {
    const silent = opts && opts.silent;
    const max = (settings && settings.volumeMax) || 300;
    percent = Math.max(0, Math.min(max, Math.round(percent)));

    if (percent === 100) {
      // Neutro: si había un grafo activo de una ganancia previa, se dispone en 1x (no lo
      // destruimos — recrearlo tiene coste y no molesta dejarlo enrutado sin alterar nada).
      if (video.__fscGain) video.__fscGain.gain.value = 1;
    } else {
      const gain = ensureAudioGraph(video);
      if (!gain) {
        if (!silent) showOverlay("⚠ El volumen de la extensión no está disponible en este vídeo");
        return;
      }
      if (video.__fscAudioCtx && video.__fscAudioCtx.state === "suspended") {
        video.__fscAudioCtx.resume().catch(() => {});
      }
      gain.gain.value = percent / 100;
    }

    if (!silent) {
      showOverlay(`🔊 Volumen (extensión): ${percent}%`);
      persistDomainVolume(percent);
    }
  }

  function volumeStep(video, dir) {
    const max = (settings && settings.volumeMax) || 300;
    const step = (settings && settings.volumeStep) || 10;
    const next = Math.max(0, Math.min(max, currentVolumePercent(video) + dir * step));
    setVolume(video, next);
  }

  function applyDomainVolume(v) {
    if (!settings || !settings.rememberVolumePerDomain) return;
    const remembered = settings.domainVolumes[domain];
    if (remembered == null) return;
    // Solo se restaura solo si es el valor neutro (100% = no requiere crear ningún grafo de
    // audio). Cualquier otro valor necesitaría construir el grafo de Web Audio antes de que haya
    // habido un gesto de usuario en la página, lo que podría silenciar el vídeo por completo
    // (política de autoplay del navegador) — se recupera en cuanto el usuario ajuste el volumen
    // de la extensión una vez.
    if (remembered === 100) setVolume(v, remembered, { silent: true });
  }

  function persistDomainVolume(percent) {
    if (!settings || !settings.rememberVolumePerDomain) return;
    settings.domainVolumes[domain] = percent;
    saveSettings({ domainVolumes: settings.domainVolumes });
  }

  // ---------- Auto-detección de FPS ----------
  function attachFpsDetection(v) {
    if (typeof v.requestVideoFrameCallback !== "function") return;
    const times = [];
    function cb(_now, metadata) {
      times.push(metadata.mediaTime);
      if (times.length > 24) times.shift();
      if (times.length >= 8) {
        const diffs = [];
        for (let i = 1; i < times.length; i++) {
          const d = times[i] - times[i - 1];
          if (d > 0) diffs.push(d);
        }
        if (diffs.length) {
          const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          if (avg > 0) liveDetectedFps = 1 / avg;
        }
      }
      if (!v.paused && !v.ended) v.requestVideoFrameCallback(cb);
    }
    v.requestVideoFrameCallback(cb);
  }

  function effectiveFps() {
    if (settings.domainFps && settings.domainFps[domain]) return settings.domainFps[domain];
    if (liveDetectedFps && liveDetectedFps > 1 && liveDetectedFps < 240) return liveDetectedFps;
    return settings.fps;
  }

  // ---------- Overlay ----------
  function showOverlay(text) {
    if (!settings || !settings.showOverlay) return;
    let el = document.getElementById("__fsc_overlay__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__fsc_overlay__";
      document.body.appendChild(el);
    }
    const fsEl = document.fullscreenElement;
    const parent = fsEl || document.body;
    if (el.parentElement !== parent) parent.appendChild(el);
    el.textContent = text;
    clearTimeout(overlayTimeout);
    el.classList.remove("__fsc_show__");
    void el.offsetWidth;
    el.classList.add("__fsc_show__");
    overlayTimeout = setTimeout(() => el.classList.remove("__fsc_show__"), 900);
  }

  // Evita que el aviso genérico de pausa/reanudación tape el aviso de "frame ±N" cuando
  // el propio frameStep() reproduce/pausa el vídeo internamente para generar audio.
  let suppressGenericOverlayUntil = 0;

  document.addEventListener(
    "pause",
    (e) => {
      if (e.target.tagName !== "VIDEO" || Date.now() < suppressGenericOverlayUntil) return;
      showOverlay(`⏸ Pausa · ${formatTime(e.target.currentTime)}`);
    },
    true
  );
  document.addEventListener(
    "play",
    (e) => {
      if (e.target.tagName !== "VIDEO" || Date.now() < suppressGenericOverlayUntil) return;
      showOverlay(`▶ ${formatTime(e.target.currentTime)}`);
    },
    true
  );

  function clampTime(video, t) {
    const dur = isFinite(video.duration) ? video.duration : Infinity;
    return Math.max(0, Math.min(dur, t));
  }

  // Reproduce el vídeo de verdad durante `frameCount` fotogramas (con audio real) y pausa
  // justo al terminar, usando requestVideoFrameCallback para parar en el fotograma exacto.
  function playFramesForward(video, frameCount) {
    return new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback !== "function" || video.ended) {
        resolve(false);
        return;
      }
      let played = 0;
      let settled = false;
      const fps = effectiveFps();
      const safety = setTimeout(() => finish(false), Math.max(400, (frameCount * 1000) / fps + 300));

      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        try { video.pause(); } catch (err) {}
        resolve(ok);
      }

      function onFrame() {
        played++;
        if (settled) return;
        if (played >= frameCount || video.paused || video.ended) {
          finish(true);
          return;
        }
        video.requestVideoFrameCallback(onFrame);
      }

      video.requestVideoFrameCallback(onFrame);
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => finish(false));
    });
  }

  // Espera a que un salto de currentTime se resuelva de verdad (evento "seeked") en vez de
  // asumir que fue instantáneo. Si el tramo no está cargado (típico al retroceder mucho en
  // streaming adaptativo), el salto puede tardar o no completarse — sin esto, un "burst" de
  // retroceso podía interrumpir cada intento de búsqueda con el siguiente antes de resolverse,
  // dejando el reproductor colgado (sin poder reanudar ni buscar nunca más).
  function waitForSeek(video, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        video.removeEventListener("seeked", onSeeked);
        clearTimeout(timer);
        resolve(ok);
      }
      function onSeeked() { finish(true); }
      video.addEventListener("seeked", onSeeked);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  // Nº de saltos consecutivos que no se han resuelto a tiempo (indicio de tramo no cargado/licenciado).
  let consecutiveSeekStalls = 0;
  const MAX_SEEK_STALLS = 1;
  const SEEK_TIMEOUT_MS = 1500; // margen para un rebuffer real; si Crunchyroll no lo carga, no lo carga ni esperando más

  // Nota: se probó a usar video.buffered para detectar de antemano si `target` está fuera de lo
  // cargado, pero en contenido con DRM (como Crunchyroll) el navegador no expone TimeRanges
  // fiables — el propio Chrome API no puede saberlo aquí, así que nos apoyamos solo en la espera
  // real + revert de abajo, que sí funciona.

  // Salta a `time` y espera de verdad a que se resuelva. Si no se resuelve a tiempo, en vez de
  // dejar el vídeo clavado en un punto irrecuperable, VUELVE a la última posición que sí
  // funcionaba — el reproductor nunca se queda "muerto" aunque el tramo no esté disponible.
  async function seekWithGuard(video, time) {
    const before = video.currentTime;
    const target = clampTime(video, time);

    video.currentTime = target;

    const loadingHint = setTimeout(() => {
      suppressGenericOverlayUntil = Date.now() + 600;
      showOverlay("⏳ Cargando ese tramo…");
    }, 450);

    const ok = await waitForSeek(video, SEEK_TIMEOUT_MS);
    clearTimeout(loadingHint);

    if (ok) {
      consecutiveSeekStalls = 0;
      return { ok: true, time: target };
    }

    consecutiveSeekStalls++;
    try { video.currentTime = before; } catch (err) {}
    if (consecutiveSeekStalls >= MAX_SEEK_STALLS) {
      consecutiveSeekStalls = 0;
      stopAllRepeats();
      suppressGenericOverlayUntil = Date.now() + 500;
      showOverlay("⚠ No se puede retroceder más allá de lo cargado en este punto");
    }
    return { ok: false, time: before };
  }

  // Evita solapar dos pasos de frame (relevante durante el "burst" al mantener la tecla).
  let frameStepBusy = false;

  async function frameStep(video, frames, opts) {
    if (frameStepBusy) return;
    frameStepBusy = true;
    try {
      const audioAllowed = opts && opts.audio === false ? false : settings.frameStepAudio;
      const fps = effectiveFps();
      const target = clampTime(video, video.currentTime + frames / fps);
      const canUseAudio = audioAllowed && typeof video.requestVideoFrameCallback === "function";
      let seekFailed = false;

      if (canUseAudio && frames > 0) {
        // Avanzar: reproducir de verdad esos N fotogramas hacia delante = audio real.
        suppressGenericOverlayUntil = Date.now() + 2000;
        await playFramesForward(video, frames);
        video.currentTime = target;
      } else if (canUseAudio && frames < 0) {
        // Retroceder: los navegadores no soportan reproducción inversa con audio.
        // Nos posicionamos en el destino y reproducimos un fotograma hacia delante como
        // "tic" audible de confirmación, y volvemos a fijar el tiempo exacto de destino.
        suppressGenericOverlayUntil = Date.now() + 2000;
        video.pause();
        const res = await seekWithGuard(video, target);
        seekFailed = !res.ok;
        if (res.ok) {
          await playFramesForward(video, 1);
          video.currentTime = res.time;
        }
      } else {
        suppressGenericOverlayUntil = Date.now() + 250;
        video.pause();
        const res = await seekWithGuard(video, target);
        seekFailed = !res.ok;
      }

      // Si el salto falló, seekWithGuard ya dejó su propio aviso en pantalla — no lo tapamos
      // con el overlay normal de "±N frame".
      if (!seekFailed) {
        showOverlay(`${frames > 0 ? "▶" : "◀"} ${frames > 0 ? "+" : ""}${frames} frame  ·  ${formatTime(video.currentTime)}`);
      }
    } finally {
      frameStepBusy = false;
    }
  }

  function setSpeed(video, speed) {
    speed = Math.max(0.07, Math.min(16, speed));
    video.playbackRate = speed;
    showOverlay(`Velocidad: ${speed.toFixed(2)}x`);
    persistDomainSpeed(speed);
    chrome.runtime.sendMessage({ type: "speedChanged", speed });
  }

  function stepSpeed(video, dir) {
    const presets = settings.speedPresets.slice().sort((a, b) => a - b);
    const cur = video.playbackRate;
    let next;
    if (dir > 0) {
      next = presets.find((p) => p > cur + 0.001);
      if (next === undefined) next = cur + settings.speedStep;
    } else {
      next = presets.slice().reverse().find((p) => p < cur - 0.001);
      if (next === undefined) next = Math.max(0.07, cur - settings.speedStep);
    }
    setSpeed(video, next);
  }

  function togglePlay(video) {
    if (video.paused) video.play(); else video.pause();
  }

  let seekBusy = false;

  async function seek(video, secs) {
    if (seekBusy) return;
    seekBusy = true;
    try {
      const target = clampTime(video, video.currentTime + secs);
      await seekWithGuard(video, target);
      showOverlay(`${secs > 0 ? "⏩" : "⏪"} ${Math.abs(secs)}s  ·  ${formatTime(video.currentTime)}`);
    } finally {
      seekBusy = false;
    }
  }

  // IMPORTANTE: no usamos el `video.loop` nativo. Cuando el navegador lo gestiona internamente,
  // el salto a currentTime=0 al llegar al final NO pasa por nuestro código — así que ninguna de
  // las protecciones de seekWithGuard (esperar, revertir si falla) se aplica, y si el principio ya
  // no está cargado (típico tras ver un rato en streaming adaptativo), el navegador se queda
  // colgado de verdad, sin recuperación posible. Por eso implementamos el bucle "a mano": dejamos
  // video.loop siempre en false, escuchamos el evento nativo "ended" (que así sí llega a
  // dispararse) y hacemos nosotros el salto a 0 con seekWithGuard, con las mismas garantías que el
  // resto de saltos de la extensión.
  document.addEventListener(
    "ended",
    async (e) => {
      const v = e.target;
      if (v.tagName !== "VIDEO" || !v.__fscManualLoop) return;
      suppressGenericOverlayUntil = Date.now() + 2000;
      const res = await seekWithGuard(v, 0);
      if (res.ok) {
        v.__fscLoopBroken = false;
        try { await v.play(); } catch (err) {}
        suppressGenericOverlayUntil = Date.now() + 300;
        showOverlay("🔁 Bucle: reiniciado desde el principio");
      } else {
        v.__fscLoopBroken = true;
        v.__fscManualLoop = false;
      }
    },
    true
  );

  function toggleLoop(video) {
    video.loop = false; // nunca dejamos que el navegador lo gestione internamente, ver nota arriba
    video.__fscManualLoop = !video.__fscManualLoop;
    if (video.__fscManualLoop) video.__fscLoopBroken = false;
    showOverlay(video.__fscManualLoop ? "🔁 Bucle activado" : "🔁 Bucle desactivado");
  }

  function toggleMute(video) {
    video.muted = !video.muted;
    showOverlay(video.muted ? "🔇 Silenciado" : "🔊 Audio activado");
  }

  async function togglePip(video) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      showOverlay("⚠ Picture-in-Picture no disponible");
    }
  }

  function screenshot(video) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `frame_${Math.round(video.currentTime * 1000)}ms.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, "image/png");
      showOverlay("📸 Frame capturado");
    } catch (err) {
      showOverlay("⚠ No se pudo capturar (¿vídeo protegido/DRM?)");
    }
  }

  function runAction(id, video, opts) {
    switch (id) {
      case "frameBack": return frameStep(video, -1, opts);
      case "frameForward": return frameStep(video, 1, opts);
      case "frameBackMulti": return frameStep(video, -settings.multiFrameCount, opts);
      case "frameForwardMulti": return frameStep(video, settings.multiFrameCount, opts);
      case "speedUp": return stepSpeed(video, 1);
      case "speedDown": return stepSpeed(video, -1);
      case "speedReset": return setSpeed(video, 1);
      case "togglePlay": return togglePlay(video);
      case "seekBack": return seek(video, -settings.seekSeconds);
      case "seekForward": return seek(video, settings.seekSeconds);
      case "toggleLoop": return toggleLoop(video);
      case "togglePip": return togglePip(video);
      case "toggleMute": return toggleMute(video);
      case "screenshot": return screenshot(video);
      case "volumeUp": return volumeStep(video, 1);
      case "volumeDown": return volumeStep(video, -1);
      case "volumeReset": return setVolume(video, 100);
    }
  }

  function isTypingTarget(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  // ---------- Repetición al mantener pulsada una tecla ----------
  // Dos modos:
  //  - "play": para avanzar (frameForward) con audio activado, mantener la tecla entra en
  //    reproducción real continua (como pulsar play) en vez de encadenar saltos discretos,
  //    para que se oiga igual que una reproducción normal. Al soltar, pausa y encaja al frame exacto.
  //  - "repeat": el resto de acciones repetibles siguen encadenando pasos discretos y silenciosos
  //    (sin audio) a intervalo fijo, más rápido y sin cortes porque no reinician play()/pause() con sonido.
  const REPEAT_START_DELAY = 300;
  const REPEAT_INTERVAL = 40;
  const HOLD_PLAY_ACTIONS = new Set(["frameForward"]);

  let holdPlay = null; // { id, combo, video, startTimeout, started }

  function stopRepeat() {
    if (heldRepeat) {
      clearTimeout(heldRepeat.timeoutId);
      clearInterval(heldRepeat.intervalId);
      heldRepeat = null;
    }
  }

  function stopHoldPlay() {
    if (!holdPlay) return;
    const { video, startTimeout, started, priorRate } = holdPlay;
    clearTimeout(startTimeout);
    holdPlay = null;
    if (!started) return; // nunca llegó a reproducir: el tap inicial ya movió 1 frame, nada más que hacer
    try { video.pause(); } catch (err) {}
    const fps = effectiveFps();
    const frameLen = 1 / fps;
    video.currentTime = clampTime(video, Math.round(video.currentTime / frameLen) * frameLen);
    if (typeof priorRate === "number") video.playbackRate = priorRate;
    suppressGenericOverlayUntil = Date.now() + 250;
    showOverlay(`▶ frame · ${formatTime(video.currentTime)}`);
  }

  function stopAllRepeats() {
    stopRepeat();
    stopHoldPlay();
  }

  function startRepeatIfNeeded(id, combo, video) {
    const action = settings.actions[id];
    if (!action || !action.repeatable) return;

    const canHoldPlay =
      HOLD_PLAY_ACTIONS.has(id) && settings.frameStepAudio && typeof video.requestVideoFrameCallback === "function";

    if (canHoldPlay) {
      if (holdPlay && holdPlay.combo === combo) return; // ya en marcha
      stopAllRepeats();
      holdPlay = { id, combo, video, started: false, startTimeout: null, priorRate: video.playbackRate };
      holdPlay.startTimeout = setTimeout(() => {
        if (!holdPlay || holdPlay.combo !== combo) return;
        holdPlay.started = true;
        suppressGenericOverlayUntil = Date.now() + 24 * 60 * 60 * 1000; // silencia el overlay nativo mientras dura la reproducción
        video.playbackRate = 1;
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }, REPEAT_START_DELAY);
      return;
    }

    if (heldRepeat && heldRepeat.combo === combo) return; // ya en marcha
    stopAllRepeats();
    heldRepeat = { combo, id, timeoutId: null, intervalId: null };
    heldRepeat.timeoutId = setTimeout(() => {
      if (!heldRepeat) return;
      heldRepeat.intervalId = setInterval(() => {
        const v = activeVideo();
        if (v) runAction(id, v, { audio: false });
      }, REPEAT_INTERVAL);
    }, REPEAT_START_DELAY);
  }

  window.addEventListener("blur", stopAllRepeats);
  document.addEventListener("keyup", stopAllRepeats, true);

  document.addEventListener(
    "keydown",
    (e) => {
      if (!settings || isTypingTarget(e)) return;
      const video = activeVideo();
      if (!video) return;
      const combo = eventToShortcut(e);
      if (!combo) return;
      for (const id of Object.keys(settings.actions)) {
        const shortcut = effectiveShortcutFor(settings, domain, id);
        if (shortcut && shortcut === combo) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) return; // los repeats del SO se ignoran, usamos nuestro propio temporizador
          runAction(id, video);
          startRepeatIfNeeded(id, combo, video);
          return;
        }
      }
    },
    true
  );

  // ---------- Ctrl + rueda del ratón sobre el vídeo = velocidad ----------
  // Solo con Ctrl (o Cmd en Mac) pulsado, para no robarle el scroll normal de la página a sitios
  // donde el vídeo está embebido dentro de un contenido más largo (blogs, foros, etc.).
  document.addEventListener(
    "wheel",
    (e) => {
      if (!settings || !settings.wheelSpeedControl) return;
      if (!e.ctrlKey && !e.metaKey) return;
      const video = activeVideo();
      if (!video) return;
      const rect = video.getBoundingClientRect();
      const over =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!over) return;
      e.preventDefault();
      stepSpeed(video, e.deltaY < 0 ? 1 : -1);
    },
    { passive: false }
  );

  // ---------- Mensajería con popup/options ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const video = activeVideo();
    if (!video) {
      sendResponse({ ok: false, error: "no-video" });
      return;
    }
    if (msg.type === "getLocalVideoStatus") {
      // Usado por background.js para decidir a qué frame dirigirse cuando hay vídeo en varios a
      // la vez: reutiliza el mismo criterio que activeVideo() (reproduciéndose > más grande).
      sendResponse({
        ok: true,
        playing: !video.paused && !video.ended && video.readyState > 2,
        area: video.clientWidth * video.clientHeight
      });
      return;
    }
    if (msg.type === "getState") {
      sendResponse({
        ok: true,
        playbackRate: video.playbackRate,
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration,
        muted: video.muted,
        loop: !!video.__fscManualLoop,
        domain,
        detectedFps: liveDetectedFps,
        domainFps: settings.domainFps[domain] || null,
        capabilities: video.__fscCapabilities || { pip: true, screenshot: true, frameAudio: true },
        loopBroken: !!video.__fscLoopBroken,
        volume: currentVolumePercent(video),
        volumeMax: (settings && settings.volumeMax) || 300
      });
      return;
    }
    if (msg.type === "runAction") {
      if (msg.id === "togglePip") {
        togglePip(video).then(() => sendResponse({ ok: true }));
        return true;
      }
      runAction(msg.id, video);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setSpeed") {
      setSpeed(video, msg.speed);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setVolume") {
      setVolume(video, msg.percent);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "useDetectedFpsForDomain") {
      if (liveDetectedFps) {
        settings.domainFps[domain] = liveDetectedFps;
        saveSettings({ domainFps: settings.domainFps });
      }
      sendResponse({ ok: true, fps: liveDetectedFps || null });
      return;
    }
  });
})();
