// Se ejecuta en cada pestaña. Controla el/los <video> de la página y escucha los atajos configurados.
(function () {
  // ---------- Auto-reemplazo de instancias huérfanas ----------
  // Si la extensión se recarga/actualiza mientras esta pestaña ya estaba abierta, el content
  // script viejo queda "huérfano" (su conexión con la extensión se rompe) pero sigue vivo en la
  // página, con sus propios escuchadores de teclado/rueda/etc. todavía funcionando a medias. Si
  // background.js reinyecta una copia nueva encima, sin esto habría DOS instancias reaccionando a
  // la vez (cada pulsación movería el doble de frames, por ejemplo). Cada instancia se anuncia al
  // arrancar; cualquier instancia anterior que lo oiga se autodestruye (quita todos sus listeners).
  const INSTANCE_ID = Math.random().toString(36).slice(2);
  const NEW_INSTANCE_EVENT = "__fsc_new_instance__";
  window.dispatchEvent(new CustomEvent(NEW_INSTANCE_EVENT, { detail: INSTANCE_ID }));

  let evicted = false;
  function onNewInstanceAnnounced(e) {
    if (evicted || e.detail === INSTANCE_ID) return;
    evicted = true;
    cleanup();
  }
  window.addEventListener(NEW_INSTANCE_EVENT, onNewInstanceAnnounced);

  let settings = null;
  let overlayTimeout = null;
  const domain = location.hostname;

  // Vídeo marcado a mano con el picker (ver startVideoPicker más abajo). Como mucho uno activo por
  // documento: activeVideo() le da prioridad mientras siga conectado al DOM, y deja de usarlo en
  // cuanto se desconecta (el sitio lo quita/recrea), volviendo sola a la heurística automática.
  let manuallyPickedVideo = null;

  function setManuallyPickedVideo(video) {
    if (manuallyPickedVideo && manuallyPickedVideo !== video) {
      manuallyPickedVideo.__fscManuallyPicked = false;
    }
    manuallyPickedVideo = video;
    video.__fscManuallyPicked = true;
  }

  // Repetición ("burst") mientras se mantiene pulsada una tecla de acción repetible.
  let heldRepeat = null; // { combo, id }

  // El FPS detectado en vivo se guarda en cada vídeo (video.__fscFps), no en una variable común a
  // toda la instancia: con varios vídeos en la página, o al cambiar de vídeo, el valor de uno ya no
  // se aplica al siguiente.

  // Vídeos de los que YA hemos avisado al background en ESTA instancia. Es un WeakSet propio de
  // cada instancia (no un flag guardado en el elemento) a propósito: si esta instancia reemplaza a
  // una huérfana, el registro del background también empezó de cero, así que hay que re-avisar de
  // los vídeos aunque el elemento ya estuviera "inicializado" por la instancia anterior.
  const notifiedVideos = new WeakSet();

  // Vídeos ya inicializados por esta instancia (incluidos los que viven en shadow DOM, que
  // document.querySelectorAll no ve). Se depuran solos al escanear: los desconectados se quitan.
  const knownVideos = new Set();

  loadSettings((s) => {
    const firstLoad = !settings;
    settings = s;
    // El barrido inicial (scanForNewVideos, más abajo) se ejecuta en cuanto arranca el script,
    // ANTES de que lleguen los ajustes (loadSettings es asíncrono): sin esto, la velocidad y el
    // volumen recordados por dominio nunca se aplicaban a un vídeo que ya estuviera en la página
    // al cargarla — justo el caso más habitual.
    if (firstLoad) {
      knownVideos.forEach((v) => {
        applyDomainSpeed(v);
        applyDomainVolume(v);
      });
      updateWheelListener();
    }
  });

  function onStorageChanged(changes, area) {
    if (area !== "sync" && area !== "local") return;
    // "pendingDomain" (aviso interno entre el popup y Opciones) no afecta a nada de aquí.
    if (Object.keys(changes).every((k) => k === "pendingDomain")) return;
    loadSettings((s) => {
      settings = s;
      updateWheelListener();
    });
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

  function activeVideo() {
    if (manuallyPickedVideo) {
      if (manuallyPickedVideo.isConnected) {
        initVideo(manuallyPickedVideo);
        notifyVideoFound(manuallyPickedVideo);
        return manuallyPickedVideo;
      }
      // El sitio quitó/recreó el vídeo marcado (SPA, cambio de episodio, etc.) — se abandona la
      // marca en vez de quedarse apuntando a un elemento muerto, y se vuelve a la heurística normal.
      manuallyPickedVideo = null;
    }

    const videos = currentVideos();
    if (videos.length === 0) return null;
    let v;
    if (videos.length === 1) v = videos[0];
    else {
      const playing = videos.filter((vv) => !vv.paused && !vv.ended && vv.readyState > 2);
      // Si hay varios reproduciéndose a la vez, gana el de mayor área — el mismo criterio que usa
      // background.js entre frames (antes, aquí ganaba simplemente el primero del DOM).
      const pool = playing.length ? playing : videos;
      v = pool.reduce((a, b) => (videoArea(b) > videoArea(a) ? b : a));
    }
    initVideo(v);
    notifyVideoFound(v);
    return v;
  }

  function videoArea(v) {
    return v.clientWidth * v.clientHeight;
  }

  // Vídeos del documento: los del DOM normal (consulta directa, barata) más los encontrados dentro
  // de shadow roots abiertos durante los barridos (ver scanForNewVideos).
  function currentVideos() {
    const list = Array.from(document.querySelectorAll("video"));
    knownVideos.forEach((v) => {
      if (!v.isConnected) knownVideos.delete(v);
      else if (!list.includes(v)) list.push(v);
    });
    return list;
  }

  function notifyVideoFound(v) {
    if (notifiedVideos.has(v)) return;
    notifiedVideos.add(v);
    // Avisa al background de en qué frame de la pestaña está este vídeo — así el popup puede
    // dirigirse directamente a este frame en vez de arriesgarse a que responda antes uno sin vídeo
    // (relevante cuando el reproductor real vive dentro de un iframe).
    try {
      chrome.runtime.sendMessage({ type: "videoFound" }, () => void chrome.runtime.lastError);
    } catch (err) {
      // contexto de extensión inválido (instancia huérfana a la que aún no le ha llegado el aviso
      // de reemplazo) — se ignora, la instancia nueva ya se está encargando.
    }
  }

  function initVideo(v) {
    knownVideos.add(v);
    if (v.__fscInit) return;
    v.__fscInit = true;
    v.__fscCapabilities = { pip: false, screenshot: false, frameAudio: false, recordClip: false };
    v.__fscLoopBroken = false;
    v.__fscManualLoop = false;
    // Antes se ponía aquí v.loop = false a TODOS los vídeos de cualquier página, lo que rompía los
    // vídeos que el propio sitio hace repetir en bucle (fondos animados, "GIF" en vídeo de redes
    // sociales…) solo por tener la extensión instalada. El bucle propio de Framewise sigue sin usar
    // el atributo nativo (ver toggleLoop); el del sitio, simplemente, ya no se toca.
    applyDomainSpeed(v);
    applyDomainVolume(v);
    attachFpsDetection(v);
    detectCapabilities(v);
    // El "tainted" del canvas (DRM) y la disponibilidad de PiP a veces no se saben hasta que hay
    // datos decodificados de verdad, así que se vuelve a comprobar cuando el vídeo ya tiene un frame.
    v.addEventListener("loadeddata", () => detectCapabilities(v));
    // Cargar una fuente nueva en el MISMO elemento (lo habitual en SPAs como YouTube al pasar al
    // siguiente vídeo) reinicia playbackRate a defaultPlaybackRate según el estándar HTML: se vuelve
    // a aplicar la velocidad recordada del sitio, que es lo que promete "recordar por dominio".
    v.addEventListener("loadedmetadata", () => applyDomainSpeed(v));
    updateWheelListener();
  }

  // Comprueba, una vez por vídeo, qué funciones son técnicamente posibles aquí (no cambia con el
  // tiempo, a diferencia del bucle o el retroceso más allá del buffer, que solo se sabe al probar).
  function detectCapabilities(v) {
    const caps = v.__fscCapabilities;

    caps.frameAudio = typeof v.requestVideoFrameCallback === "function";
    caps.pip = !!(document.pictureInPictureEnabled && !v.disablePictureInPicture);

    try {
      // Igual que el canvas del screenshot: captureStream() lanza excepción de inmediato para vídeo
      // de origen cruzado sin cabeceras CORS (y, en la práctica, también para bastante contenido con
      // DRM), así que basta con probarlo y parar las pistas de prueba sin dejarlas corriendo.
      const probe =
        typeof v.captureStream === "function"
          ? v.captureStream()
          : typeof v.mozCaptureStream === "function"
          ? v.mozCaptureStream()
          : null;
      if (!probe) throw new Error("captureStream no soportado");
      probe.getTracks().forEach((t) => t.stop());
      caps.recordClip = true;
    } catch (err) {
      caps.recordClip = false;
    }

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
  // sin depender de que el usuario interactúe — y se hace un barrido inicial inmediato además de
  // vigilar cambios futuros, para no depender de que llegue una interacción o mutación primero.
  function scanForNewVideos() {
    // Si el sitio quita del DOM el vídeo que se estaba grabando, se cierra el clip con lo grabado.
    if (recordedVideo && !recordedVideo.isConnected) stopRecording();
    document.querySelectorAll("video").forEach((v) => {
      initVideo(v);
      notifyVideoFound(v);
    });
    scanShadowRootsThrottled();
  }

  // ---------- Vídeos dentro de shadow DOM ----------
  // document.querySelectorAll no entra en shadow roots, y el MutationObserver del documento no ve
  // lo que pasa dentro de ellos: un reproductor hecho como Web Component (shadow root abierto) era
  // invisible para la detección automática. Recorrer todos los elementos buscando shadow roots
  // cuesta más que la consulta normal (~3 ms en una página de 30.000 elementos), así que se hace como
  // mucho una vez cada 2 s y solo cuando el DOM ha cambiado, y cada
  // shadow root encontrado se observa también para enterarse de sus cambios. Los shadow roots
  // cerrados son inaccesibles por diseño — para esos queda el selector manual.
  const SHADOW_SCAN_INTERVAL_MS = 2000;
  const observedShadowRoots = new WeakSet();
  let lastShadowScan = 0;
  let shadowScanTimer = null;

  function scanShadowRootsThrottled() {
    const wait = lastShadowScan + SHADOW_SCAN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      scanShadowRoots();
      return;
    }
    if (shadowScanTimer === null) {
      shadowScanTimer = setTimeout(() => {
        shadowScanTimer = null;
        scanShadowRoots();
      }, wait);
    }
  }

  function scanShadowRoots() {
    lastShadowScan = Date.now();
    const visit = (root, depth) => {
      if (depth > 8) return;
      const all = root.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const sr = all[i].shadowRoot;
        if (!sr) continue;
        if (!observedShadowRoots.has(sr)) {
          observedShadowRoots.add(sr);
          try { mutationObserver.observe(sr, { childList: true, subtree: true }); } catch (err) {}
        }
        sr.querySelectorAll("video").forEach((v) => {
          initVideo(v);
          notifyVideoFound(v);
        });
        visit(sr, depth + 1);
      }
    };
    visit(document, 0);
  }

  // Páginas con DOM muy activo (chat en directo, scroll infinito…) pueden hacer que el observer se
  // dispare muchas veces por segundo. En vez de escanear todo el documento en cada aviso, se agrupan
  // las ráfagas en un único barrido, con un debounce corto y fijo (no requestAnimationFrame: rAF se
  // pausa o se retrasa mucho en pestañas que no se están pintando activamente —p. ej. una pestaña en
  // segundo plano con un vídeo reproduciéndose, que es precisamente un caso de uso real de esta
  // extensión— y eso retrasaría la detección de forma perceptible, justo lo que se quiere evitar).
  const VIDEO_SCAN_DEBOUNCE_MS = 120;
  let scanTimeoutId = null;
  function scheduleScan() {
    if (scanTimeoutId !== null) return;
    scanTimeoutId = setTimeout(() => {
      scanTimeoutId = null;
      scanForNewVideos();
    }, VIDEO_SCAN_DEBOUNCE_MS);
  }

  // Solo interesan mutaciones que añaden elementos: las de solo texto (contadores, chat, subtítulos
  // que cambian varias veces por segundo) no pueden traer un <video> nuevo y no merecen un barrido.
  function onMutations(records) {
    for (let i = 0; i < records.length; i++) {
      // Nodos quitados: solo importan si hay una grabación en marcha (su vídeo puede haberse ido).
      if (recordedVideo && records[i].removedNodes.length) {
        scheduleScan();
        return;
      }
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) {
          scheduleScan();
          return;
        }
      }
    }
  }
  const mutationObserver = new MutationObserver(onMutations);
  // El barrido inicial y la observación arrancan al final del archivo (ver "Arranque"), cuando ya
  // están declaradas todas las variables que usan initVideo y compañía.

  // ---------- Velocidad recordada por dominio ----------
  function applyDomainSpeed(v) {
    if (!settings || !settings.rememberSpeedPerDomain) return;
    const remembered = settings.domainSpeeds[domain];
    // Un valor fuera de rango (archivo importado de una versión sin validación, edición a mano) se
    // ignora: antes llegaba tal cual a playbackRate, que lanzaba una excepción en cada vídeo nuevo.
    if (typeof remembered !== "number" || !isFinite(remembered)) return;
    if (remembered < SPEED_MIN || remembered > SPEED_MAX) return;
    const speed = remembered;
    if (Math.abs(v.playbackRate - speed) < 0.001) return;
    try {
      v.playbackRate = speed;
    } catch (err) {
      // Valor fuera del rango que admite el navegador: se ignora, nunca debe romper la detección.
    }
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
  // Un único AudioContext por documento, compartido por todos sus vídeos. Antes se creaba uno por
  // cada <video> al que se le tocaba el volumen y nunca se cerraba: en una SPA que va recreando el
  // elemento (cambio de episodio, scroll de vídeos cortos) se acumulaban contextos de audio vivos,
  // cada uno con su propio hilo de audio del navegador.
  let sharedAudioCtx = null;

  function getAudioContext() {
    if (sharedAudioCtx && sharedAudioCtx.state !== "closed") return sharedAudioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
    return sharedAudioCtx;
  }

  // Sin ningún gesto previo del usuario en la página, el AudioContext nace "suspended" y no se puede
  // reanudar. Conectar el vídeo a él en ese estado (createMediaElementSource es irreversible)
  // desviaría su audio a un contexto mudo: el vídeo se quedaba sin sonido hasta que, después de
  // interactuar con la página, se volviera a tocar el volumen de la extensión. Pasa al usar el popup
  // en una pestaña donde aún no se ha hecho clic ni pulsado nada.
  function audioBlockedByAutoplayPolicy(ctx) {
    if (ctx.state === "running") return false;
    const activation = navigator.userActivation;
    return !!(activation && !activation.hasBeenActive);
  }

  // Devuelve el GainNode del vídeo, o un motivo si no se puede: "unavailable" (CORS/sin soporte,
  // definitivo para ese elemento) o "needsGesture" (temporal: basta con interactuar con la página).
  function ensureAudioGraph(video) {
    if (video.__fscGain) return { gain: video.__fscGain };
    if (video.__fscAudioUnavailable) return { reason: "unavailable" };
    let ctx;
    try {
      ctx = getAudioContext();
    } catch (err) {
      ctx = null;
    }
    if (!ctx) {
      video.__fscAudioUnavailable = true;
      return { reason: "unavailable" };
    }
    if (audioBlockedByAutoplayPolicy(ctx)) return { reason: "needsGesture" };
    try {
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      video.__fscAudioCtx = ctx;
      video.__fscGain = gain;
      return { gain };
    } catch (err) {
      // Puede fallar en vídeo de origen cruzado sin cabeceras CORS (Web Audio API lo silencia por
      // seguridad), o si el sitio ya conectó él mismo ese elemento a su propio AudioContext (solo
      // se admite un MediaElementSource por elemento).
      video.__fscAudioUnavailable = true;
      return { reason: "unavailable" };
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
    if (typeof percent !== "number" || !isFinite(percent)) return;
    percent = Math.max(0, Math.min(max, Math.round(percent)));

    if (percent === 100) {
      // Neutro: si había un grafo activo de una ganancia previa, se dispone en 1x (no lo
      // destruimos — recrearlo tiene coste y no molesta dejarlo enrutado sin alterar nada).
      if (video.__fscGain) video.__fscGain.gain.value = 1;
    } else {
      const graph = ensureAudioGraph(video);
      if (!graph.gain) {
        if (!silent) {
          showOverlay(T(currentLang(settings), graph.reason === "needsGesture" ? "overlay.volumeNeedsGesture" : "overlay.volumeUnavailable"));
        }
        return;
      }
      if (video.__fscAudioCtx && video.__fscAudioCtx.state === "suspended") {
        video.__fscAudioCtx.resume().catch(() => {});
      }
      graph.gain.gain.value = percent / 100;
    }

    if (!silent) {
      showOverlay(T(currentLang(settings), "overlay.volume", { percent }));
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
  // Tres defectos de la versión anterior, corregidos aquí:
  //  1. La cadena de callbacks se cortaba en cuanto un callback llegaba con el vídeo en pausa y no
  //     se reanudaba nunca. Si el vídeo estaba en pausa al detectarse (lo normal al cargar la
  //     página), a menudo no se llegaba a detectar nada y se usaba siempre el FPS global; tras un
  //     paso de fotograma pasaba lo mismo con el vídeo siguiente. Ahora se rearma en cada "play".
  //  2. Se promediaban las diferencias de mediaTime: un salto (seek) durante la reproducción podía
  //     meter una diferencia de varios segundos en la ventana y falsear la media. Ahora se usa la
  //     MEDIANA, y las muestras se descartan en cada seek, cambio de velocidad o de fuente.
  //  3. A velocidad alta el navegador no presenta todos los fotogramas (no caben en el refresco de
  //     pantalla) y la diferencia observada es de 2 o más: 30 fps a 4x se "detectaba" como 15 fps.
  //     Si los fotogramas se presentan a un ritmo cercano al de la pantalla, la medida no es fiable
  //     y no se actualiza.
  const FPS_WINDOW = 16;
  const FPS_MIN_SAMPLES = 8;
  const FPS_MAX_PRESENT_RATE = 50; // fotogramas presentados por segundo de reloj a partir de los que se desconfía

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function attachFpsDetection(v) {
    if (typeof v.requestVideoFrameCallback !== "function") return;
    v.__fscFps = null;
    let samples = []; // [{ media, wall }]
    let armed = false;

    function reset() {
      samples = [];
    }

    function cb(now, metadata) {
      armed = false;
      samples.push({ media: metadata.mediaTime, wall: now });
      if (samples.length > FPS_WINDOW + 1) samples.shift();
      if (samples.length >= FPS_MIN_SAMPLES) {
        const mediaDiffs = [];
        const wallDiffs = [];
        for (let i = 1; i < samples.length; i++) {
          const dm = samples[i].media - samples[i - 1].media;
          const dw = samples[i].wall - samples[i - 1].wall;
          if (dm > 0 && dw > 0) {
            mediaDiffs.push(dm);
            wallDiffs.push(dw);
          }
        }
        if (mediaDiffs.length >= FPS_MIN_SAMPLES - 1) {
          const frameLen = median(mediaDiffs);
          const presentRate = 1000 / median(wallDiffs);
          const fps = 1 / frameLen;
          if (presentRate < FPS_MAX_PRESENT_RATE && fps > 1 && fps < 240) v.__fscFps = fps;
        }
      }
      arm();
    }

    function arm() {
      if (armed || v.paused || v.ended) return;
      armed = true;
      v.requestVideoFrameCallback(cb);
    }

    v.addEventListener("play", arm);
    v.addEventListener("playing", arm);
    v.addEventListener("seeking", reset);
    v.addEventListener("ratechange", reset);
    v.addEventListener("emptied", () => {
      reset();
      v.__fscFps = null;
    });
    arm();
  }

  function detectedFps(video) {
    const fps = video && video.__fscFps;
    return typeof fps === "number" && fps > 1 && fps < 240 ? fps : null;
  }

  function effectiveFps(video) {
    if (settings.domainFps && settings.domainFps[domain]) return settings.domainFps[domain];
    return detectedFps(video) || settings.fps;
  }

  // ---------- Overlay (aviso en pantalla y banner del selector manual) ----------
  // Ambos viven dentro de un shadow root CERRADO colgado de un único elemento anfitrión: así el CSS
  // de la página (reglas genéricas como "div { display:none }", fuentes, transformaciones…) no los
  // puede deformar ni ocultar, y los scripts de la página no pueden leer ni tocar su contenido.
  // El anfitrión es además un popover "manual" cuando el navegador lo soporta: volver a mostrarlo lo
  // sube a la capa superior (top layer), POR ENCIMA del elemento a pantalla completa — también
  // cuando lo que está a pantalla completa es el propio <video> (controles nativos), donde antes el
  // aviso se añadía como hijo del <video> y no se veía nunca.
  const UI_CSS = `
    .fsc-overlay {
      position: fixed; top: 16px; right: 16px; max-width: calc(100vw - 32px);
      background: rgba(0, 0, 0, 0.78); color: #fff; padding: 7px 16px; border-radius: 8px;
      font: 600 14px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; letter-spacing: 0.2px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); pointer-events: none; white-space: pre-wrap;
      opacity: 0; transform: translateY(-6px); transition: opacity 0.15s ease, transform 0.15s ease;
      box-sizing: border-box; text-align: left; direction: ltr;
    }
    .fsc-overlay.show { opacity: 1; transform: translateY(0); }
    .fsc-banner {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px);
      background: rgba(15, 15, 18, 0.94); color: #fff; padding: 10px 18px; border-radius: 10px;
      font: 600 14px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45); border: 1px solid #e8637a; box-sizing: border-box;
    }
    @media (prefers-reduced-motion: reduce) { .fsc-overlay { transition: none; } }
  `;
  const HOST_STYLE = [
    ["all", "initial"], ["position", "fixed"], ["top", "0"], ["left", "0"], ["width", "0"], ["height", "0"],
    ["margin", "0"], ["padding", "0"], ["border", "0"], ["background", "transparent"], ["overflow", "visible"],
    ["pointer-events", "none"], ["z-index", "2147483647"], ["display", "block"], ["inset", "0 auto auto 0"]
  ];
  let uiHost = null;
  let uiRoot = null;
  let overlayEl = null;
  let bannerEl = null;

  function ensureUi() {
    if (uiHost && uiHost.isConnected) return uiRoot;
    const container = document.body || document.documentElement;
    if (!container) return null;
    uiHost = document.createElement("div");
    uiHost.id = "__fsc_ui_host__";
    HOST_STYLE.forEach(([prop, value]) => uiHost.style.setProperty(prop, value, "important"));
    if (typeof uiHost.showPopover === "function") uiHost.setAttribute("popover", "manual");
    uiRoot = uiHost.attachShadow({ mode: "closed" });
    // Hoja construible (adoptedStyleSheets) en vez de un <style>: no le afecta la directiva
    // style-src de la CSP de la página, que en algunos sitios bloquearía un <style> insertado.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(UI_CSS);
      uiRoot.adoptedStyleSheets = [sheet];
    } catch (err) {
      const style = document.createElement("style");
      style.textContent = UI_CSS;
      uiRoot.appendChild(style);
    }
    overlayEl = document.createElement("div");
    overlayEl.className = "fsc-overlay";
    overlayEl.setAttribute("role", "status");
    overlayEl.setAttribute("aria-live", "polite");
    uiRoot.appendChild(overlayEl);
    bannerEl = null;
    container.appendChild(uiHost);
    return uiRoot;
  }

  // Coloca el anfitrión por encima de todo lo visible ahora mismo (ver nota de arriba).
  function raiseUi() {
    if (!uiHost) return;
    if (uiHost.hasAttribute("popover")) {
      try {
        if (uiHost.matches(":popover-open")) uiHost.hidePopover();
        uiHost.showPopover();
        return;
      } catch (err) {
        // Documento sin soporte real (o anfitrión desconectado): se cae al método clásico.
      }
    }
    const fsEl = document.fullscreenElement;
    const parent = fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body || document.documentElement;
    if (parent && uiHost.parentNode !== parent) parent.appendChild(uiHost);
  }

  function showOverlay(text) {
    if (!settings || !settings.showOverlay) return;
    if (!ensureUi()) return;
    raiseUi();
    overlayEl.textContent = text;
    clearTimeout(overlayTimeout);
    overlayEl.classList.remove("show");
    void overlayEl.offsetWidth;
    overlayEl.classList.add("show");
    overlayTimeout = setTimeout(() => overlayEl && overlayEl.classList.remove("show"), 900);
  }

  function removeUi() {
    clearTimeout(overlayTimeout);
    if (uiHost) uiHost.remove();
    uiHost = uiRoot = overlayEl = bannerEl = null;
  }

  // Evita que el aviso genérico de pausa/reanudación tape el aviso de "frame ±N" cuando
  // el propio frameStep() reproduce/pausa el vídeo internamente para generar audio.
  let suppressGenericOverlayUntil = 0;

  function onNativePause(e) {
    if (e.target.tagName !== "VIDEO" || Date.now() < suppressGenericOverlayUntil) return;
    showOverlay(T(currentLang(settings), "overlay.nativePause", { time: formatTime(e.target.currentTime) }));
  }
  function onNativePlay(e) {
    if (e.target.tagName !== "VIDEO" || Date.now() < suppressGenericOverlayUntil) return;
    showOverlay(T(currentLang(settings), "overlay.nativePlay", { time: formatTime(e.target.currentTime) }));
  }
  document.addEventListener("pause", onNativePause, true);
  document.addEventListener("play", onNativePlay, true);

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
      const fps = effectiveFps(video);
      // A velocidades lentas (0.1x) un solo fotograma tarda en reproducirse 10 veces más: el margen
      // de seguridad tiene que contar con la velocidad, o salta siempre antes de tiempo y el paso
      // se queda sin audio.
      const rate = video.playbackRate > 0 ? video.playbackRate : 1;
      const safety = setTimeout(() => finish(false), Math.max(400, (frameCount * 1000) / (fps * rate) + 300));

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
      showOverlay(T(currentLang(settings), "overlay.loadingSegment"));
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
      showOverlay(T(currentLang(settings), "overlay.seekBlocked"));
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
      const fps = effectiveFps(video);
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
        showOverlay(T(currentLang(settings), "overlay.frameStep", {
          dir: frames > 0 ? "▶" : "◀",
          sign: frames > 0 ? "+" : "",
          frames,
          time: formatTime(video.currentTime)
        }));
      }
    } finally {
      frameStepBusy = false;
    }
  }

  function setSpeed(video, speed) {
    if (typeof speed !== "number" || !isFinite(speed)) return;
    speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed));
    try {
      video.playbackRate = speed;
    } catch (err) {
      return;
    }
    showOverlay(T(currentLang(settings), "overlay.speed", { speed: speed.toFixed(2) }));
    persistDomainSpeed(speed);
    reportSpeed(speed);
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
    if (video.paused) {
      // play() devuelve una promesa que se rechaza si el navegador lo impide (autoplay, fuente sin
      // datos…): sin capturarla quedaba un "Uncaught (in promise)" en la consola de la página.
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => showOverlay(T(currentLang(settings), "overlay.playBlocked")));
    } else {
      video.pause();
    }
  }

  let seekBusy = false;

  async function seek(video, secs) {
    if (seekBusy) return;
    seekBusy = true;
    try {
      const target = clampTime(video, video.currentTime + secs);
      const res = await seekWithGuard(video, target);
      // Si el salto falló, seekWithGuard ya dejó su propio aviso — no se tapa con el de "±N s".
      if (!res.ok) return;
      showOverlay(T(currentLang(settings), "overlay.seek", {
        icon: secs > 0 ? "⏩" : "⏪",
        secs: Math.abs(secs),
        time: formatTime(video.currentTime)
      }));
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
  async function onNativeEnded(e) {
    const v = e.target;
    if (v.tagName !== "VIDEO" || !v.__fscManualLoop) return;
    suppressGenericOverlayUntil = Date.now() + 2000;
    const res = await seekWithGuard(v, 0);
    if (res.ok) {
      v.__fscLoopBroken = false;
      try { await v.play(); } catch (err) {}
      suppressGenericOverlayUntil = Date.now() + 300;
      showOverlay(T(currentLang(settings), "overlay.loopRestarted"));
    } else {
      v.__fscLoopBroken = true;
      v.__fscManualLoop = false;
    }
  }
  document.addEventListener("ended", onNativeEnded, true);

  // Un vídeo "está en bucle" tanto si lo puso Framewise (manual) como si ya lo traía el propio sitio
  // (atributo loop): el botón refleja lo que el usuario ve. Al pulsarlo nunca se deja el bucle en
  // manos del atributo nativo — activar = bucle manual; desactivar = quitar ambos.
  function isLooping(video) {
    return !!video.__fscManualLoop || !!video.loop;
  }

  function toggleLoop(video) {
    const enable = !isLooping(video);
    video.loop = false; // nunca dejamos que el navegador lo gestione internamente, ver nota arriba
    video.__fscManualLoop = enable;
    if (enable) video.__fscLoopBroken = false;
    showOverlay(T(currentLang(settings), enable ? "overlay.loopOn" : "overlay.loopOff"));
  }

  function toggleMute(video) {
    video.muted = !video.muted;
    showOverlay(T(currentLang(settings), video.muted ? "overlay.muted" : "overlay.unmuted"));
  }

  async function togglePip(video) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      showOverlay(T(currentLang(settings), "overlay.pipUnavailable"));
    }
  }

  // Descarga un Blob con un <a download> temporal y libera la URL después. El object URL se revoca
  // con margen (no justo tras el clic) porque la descarga arranca de forma asíncrona.
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function screenshot(video) {
    // Sin dimensiones todavía (vídeo sin datos): antes se creaba un canvas de 0x0, toBlob devolvía
    // null y URL.createObjectURL(null) lanzaba dentro del callback, después de haber mostrado ya
    // "Fotograma capturado".
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      showOverlay(T(currentLang(settings), "overlay.captureNotReady"));
      return;
    }
    const time = video.currentTime;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          showOverlay(T(currentLang(settings), "overlay.captureFailed"));
          return;
        }
        downloadBlob(blob, `frame_${Math.round(time * 1000)}ms.png`);
        showOverlay(T(currentLang(settings), "overlay.frameCaptured"));
      }, "image/png");
    } catch (err) {
      showOverlay(T(currentLang(settings), "overlay.captureFailed"));
    }
  }

  // ---------- Grabación de clip ----------
  // Graba el vídeo tal como se está reproduciendo AHORA (misma velocidad, mismo audio) desde que se
  // pulsa hasta que se vuelve a pulsar — no es un buffer retroactivo tipo "replay", es una grabación
  // hacia delante en tiempo real, con el mismo criterio que el screenshot: lo que se ve es lo que se
  // guarda. Un único MediaRecorder activo a la vez, ligado al vídeo sobre el que se pulsó "grabar".
  let mediaRecorder = null;

  function pickRecorderMimeType() {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "";
  }

  function saveRecording(chunks, mimeType, startTime) {
    if (!chunks.length) {
      showOverlay(T(currentLang(settings), "overlay.recordingEmpty"));
      return;
    }
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    chunks.length = 0; // los trozos ya están en el Blob: no retener dos copias en memoria
    downloadBlob(blob, `clip_${Math.round(startTime * 1000)}ms.webm`);
    showOverlay(T(currentLang(settings), "overlay.clipSaved"));
  }

  function startRecording(video) {
    if (mediaRecorder) return; // ya hay una grabación en marcha
    let stream;
    try {
      stream =
        typeof video.captureStream === "function"
          ? video.captureStream()
          : typeof video.mozCaptureStream === "function"
          ? video.mozCaptureStream()
          : null;
      if (!stream) throw new Error("captureStream no soportado");
      const mimeType = pickRecorderMimeType();
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      mediaRecorder = null;
      showOverlay(T(currentLang(settings), "overlay.recordingFailed"));
      return;
    }

    const recorder = mediaRecorder;
    const chunks = [];
    const startTime = video.currentTime;
    recordedVideo = video;
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((t) => t.stop());
      video.removeEventListener("emptied", onRecordedSourceGone);
      if (mediaRecorder === recorder) mediaRecorder = null;
      if (recordedVideo === video) recordedVideo = null;
      saveRecording(chunks, recorder.mimeType, startTime);
    });
    // Si el grabador falla a mitad (p. ej. el sitio cambia las pistas del vídeo), se para y se
    // guarda lo grabado hasta ese momento en vez de dejar el botón en "grabando" para siempre.
    recorder.addEventListener("error", () => {
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch (err) {}
      }
    });
    // Cambio de fuente en el mismo elemento (siguiente vídeo de una lista): se cierra el clip con lo
    // que había, que es lo que el usuario estaba viendo al pulsar grabar.
    video.addEventListener("emptied", onRecordedSourceGone);

    // Con un intervalo, el navegador entrega trozos periódicos: si la grabación se corta de golpe
    // (la pestaña navega), ya hay datos que guardar, y nunca queda todo en un único búfer interno.
    recorder.start(1000);
    showOverlay(T(currentLang(settings), "overlay.recording"));
  }

  let recordedVideo = null;

  function onRecordedSourceGone() {
    stopRecording();
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    showOverlay(T(currentLang(settings), "overlay.stoppingRecording"));
    mediaRecorder.stop();
  }

  function toggleRecording(video) {
    if (mediaRecorder) stopRecording();
    else startRecording(video);
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
      case "recordClip": return toggleRecording(video);
      case "volumeUp": return volumeStep(video, 1);
      case "volumeDown": return volumeStep(video, -1);
      case "volumeReset": return setVolume(video, 100);
    }
  }

  // Elementos donde una pulsación es texto, no un atajo. Se mira el elemento REAL que tiene el
  // foco (composedPath), no e.target: dentro de un shadow root abierto (buscadores y comentarios
  // hechos como Web Components) e.target es el anfitrión, y antes las j/k/l escritas en esos campos
  // se interpretaban como atajos. <select> también cuenta: ahí una letra elige una opción.
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute && el.getAttribute("role");
    return role === "textbox" || role === "searchbox" || role === "combobox";
  }

  function isTypingTarget(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const first = path.length ? path[0] : e.target;
    if (isEditable(first) || isEditable(e.target)) return true;
    // Un elemento enfocado dentro de un shadow root no aparece en document.activeElement.
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return isEditable(active);
  }

  // Mientras un IME está componiendo (japonés, chino, coreano…) cada tecla forma parte del texto.
  function isComposing(e) {
    return e.isComposing || e.keyCode === 229 || e.key === "Process";
  }

  // Acción cuyo atajo efectivo en este dominio coincide con la pulsación. Primero se busca una
  // coincidencia exacta con el carácter; solo si no la hay, con la tecla física (ver
  // eventShortcutCandidates en settings.js).
  function actionForEvent(e) {
    const candidates = eventShortcutCandidates(e);
    for (const combo of candidates) {
      for (const id of Object.keys(ACTION_DEFS)) {
        const shortcut = effectiveShortcutFor(settings, domain, id);
        if (shortcut && shortcutsEqual(shortcut, combo)) return { id, combo };
      }
    }
    return null;
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
    const fps = effectiveFps(video);
    const frameLen = 1 / fps;
    video.currentTime = clampTime(video, Math.round(video.currentTime / frameLen) * frameLen);
    if (typeof priorRate === "number") video.playbackRate = priorRate;
    suppressGenericOverlayUntil = Date.now() + 250;
    showOverlay(T(currentLang(settings), "overlay.holdFrame", { time: formatTime(video.currentTime) }));
  }

  function stopAllRepeats() {
    stopRepeat();
    stopHoldPlay();
  }

  function startRepeatIfNeeded(id, combo, video) {
    const action = ACTION_DEFS[id];
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

  // Pausa rápida por dominio (botón ⏸ del popup): desactiva SOLO la escucha automática de
  // teclado/rueda en este sitio, no la extensión entera — los botones del popup siguen enviando
  // "runAction" con normalidad, porque esos son clics deliberados y nunca chocan con los atajos del
  // propio sitio, que es justo el problema que este botón existe para resolver.
  function isPausedHere() {
    return !!(settings.pausedDomains && settings.pausedDomains[domain]);
  }

  function onKeydown(e) {
    if (!settings || pickerActive || isComposing(e) || isPausedHere()) return;
    // Primero lo barato (¿es un atajo nuestro?) y solo después buscar el vídeo: antes se recorría
    // el DOM buscando vídeos en CADA pulsación de cualquier tecla en cualquier página.
    const match = actionForEvent(e);
    if (!match || isTypingTarget(e)) return;
    const video = activeVideo();
    if (!video) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return; // los repeats del SO se ignoran, usamos nuestro propio temporizador
    runAction(match.id, video);
    startRepeatIfNeeded(match.id, match.combo, video);
  }
  document.addEventListener("keydown", onKeydown, true);

  // ---------- Ctrl + rueda del ratón sobre el vídeo = velocidad ----------
  // Solo con Ctrl (o Cmd en Mac) pulsado, para no robarle el scroll normal de la página a sitios
  // donde el vídeo está embebido dentro de un contenido más largo (blogs, foros, etc.).
  function onWheel(e) {
    if (!settings || !settings.wheelSpeedControl || isPausedHere()) return;
    if (e.deltaY === 0) return; // rueda horizontal / trackpad lateral: no es un gesto de velocidad
    if (!e.ctrlKey && !e.metaKey) return;
    const video = activeVideo();
    if (!video) return;
    const rect = video.getBoundingClientRect();
    const over =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!over) return;
    e.preventDefault();
    stepSpeed(video, e.deltaY < 0 ? 1 : -1);
  }
  // Un listener de rueda "no pasivo" a nivel de documento obliga al navegador a esperar al hilo
  // principal antes de cada scroll de la página. Antes se registraba en TODOS los frames de todas
  // las páginas; ahora solo en los que tienen algún vídeo y con la opción activada.
  let wheelAttached = false;

  function updateWheelListener() {
    const want = !evicted && !!settings && !!settings.wheelSpeedControl && knownVideos.size > 0;
    if (want && !wheelAttached) {
      document.addEventListener("wheel", onWheel, { passive: false });
      wheelAttached = true;
    } else if (!want && wheelAttached) {
      document.removeEventListener("wheel", onWheel, { passive: false });
      wheelAttached = false;
    }
  }

  // ---------- Badge de velocidad ----------
  // El badge del icono se actualizaba solo cuando la velocidad la cambiaba Framewise con un atajo o
  // el popup; ahora sigue también a la velocidad recordada que se aplica al cargar y a los cambios
  // hechos desde el propio reproductor del sitio.
  let lastReportedSpeed = null;

  function reportSpeed(speed) {
    if (typeof speed !== "number" || !isFinite(speed)) return;
    if (lastReportedSpeed !== null && Math.abs(lastReportedSpeed - speed) < 0.001) return;
    lastReportedSpeed = speed;
    try {
      chrome.runtime.sendMessage({ type: "speedChanged", speed }, () => void chrome.runtime.lastError);
    } catch (err) {}
  }

  function onRateChange(e) {
    const v = e.target;
    if (!v || v.tagName !== "VIDEO" || !v.__fscInit) return;
    if (activeVideo() !== v) return;
    reportSpeed(v.playbackRate);
  }
  document.addEventListener("ratechange", onRateChange, true);

  // ---------- Selección manual de vídeo ("Marcar vídeo") ----------
  // Red de seguridad final: si la detección automática no encuentra nada (embed atípico, vídeo
  // dentro de shadow DOM inalcanzable, etc.), el usuario puede señalar directamente el vídeo con
  // el ratón, como el "inspeccionar elemento" de las herramientas de desarrollador.
  let pickerActive = false;
  let pickerHighlightEl = null;

  function startVideoPicker() {
    if (pickerActive) return;
    pickerActive = true;
    document.documentElement.style.cursor = "crosshair";
    showPickerBanner();
    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeydown, true);
  }

  function stopVideoPicker() {
    if (!pickerActive) return;
    pickerActive = false;
    document.documentElement.style.cursor = "";
    hidePickerBanner();
    clearPickerHighlight();
    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeydown, true);
  }

  // Se guarda el outline que tuviera el elemento (estilo inline del propio sitio) para devolverlo
  // tal cual al quitar el resaltado — antes se borraba sin más.
  let pickerSavedOutline = null;

  function clearPickerHighlight() {
    if (pickerHighlightEl) {
      pickerHighlightEl.style.outline = pickerSavedOutline ? pickerSavedOutline.outline : "";
      pickerHighlightEl.style.outlineOffset = pickerSavedOutline ? pickerSavedOutline.offset : "";
      pickerHighlightEl = null;
      pickerSavedOutline = null;
    }
  }

  // Elemento real bajo el ratón, aunque esté dentro de un shadow root abierto (e.target llega
  // "retargeteado" al anfitrión del shadow root).
  function realTarget(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : null;
    return (path && path[0] && path[0].nodeType === 1 ? path[0] : e.target) || null;
  }

  function onPickerMouseMove(e) {
    const target = realTarget(e);
    if (!target || target === pickerHighlightEl || !target.style) return;
    clearPickerHighlight();
    pickerHighlightEl = target;
    pickerSavedOutline = { outline: target.style.outline, offset: target.style.outlineOffset };
    target.style.outline = "3px solid #7cc7ff";
    target.style.outlineOffset = "-2px";
  }

  function queryVideoDeep(root) {
    if (!root || !root.querySelector) return null;
    const direct = root.querySelector("video");
    if (direct) return direct;
    const all = root.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        const v = queryVideoDeep(all[i].shadowRoot);
        if (v) return v;
      }
    }
    return null;
  }

  function findVideoNear(el, x, y) {
    if (!el) return null;
    if (el.tagName === "VIDEO") return el;
    // Primero, lo que hay de verdad bajo el punto del clic: si encima del vídeo hay una capa de
    // controles, elementsFromPoint la atraviesa y encuentra el <video> exacto que está debajo. Antes
    // se buscaba solo "el primer <video> dentro de algún ancestro", que con varios vídeos en la
    // página podía devolver otro distinto del señalado.
    if (typeof x === "number" && typeof document.elementsFromPoint === "function") {
      const stack = document.elementsFromPoint(x, y);
      for (const node of stack) {
        if (node.tagName === "VIDEO") return node;
        if (node.shadowRoot && typeof node.shadowRoot.elementsFromPoint === "function") {
          const inner = node.shadowRoot.elementsFromPoint(x, y).find((n) => n.tagName === "VIDEO");
          if (inner) return inner;
        }
      }
    }
    const inside = queryVideoDeep(el);
    if (inside) return inside;
    // El clic pudo caer en un control por encima del vídeo (barra de progreso, botón de play…):
    // buscamos también en los contenedores ancestros (saliendo de shadow roots si hace falta).
    let node = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    while (node) {
      const v = queryVideoDeep(node);
      if (v) return v;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = realTarget(e);
    stopVideoPicker();
    const video = findVideoNear(target, e.clientX, e.clientY);
    if (!video) {
      showOverlay(T(currentLang(settings), "overlay.noVideoAtPoint"));
      notifyPickerDone();
      return;
    }
    setManuallyPickedVideo(video);
    initVideo(video);
    notifiedVideos.delete(video); // fuerza a re-avisar aunque ya estuviera notificado
    notifyVideoFound(video);
    suppressGenericOverlayUntil = Date.now() + 400;
    showOverlay(T(currentLang(settings), "overlay.videoPicked"));
    notifyPickerDone();
  }

  function onPickerKeydown(e) {
    if (e.key === "Escape") {
      stopVideoPicker();
      notifyPickerDone();
    }
  }

  function notifyPickerDone() {
    try {
      chrome.runtime.sendMessage({ type: "videoPickerDone" }, () => void chrome.runtime.lastError);
    } catch (err) {}
  }

  // El banner se muestra siempre (no depende de "Mostrar aviso en pantalla"): sin él, el usuario
  // no sabría que la página está esperando un clic para elegir el vídeo.
  function showPickerBanner() {
    const root = ensureUi();
    if (!root) return;
    raiseUi();
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.className = "fsc-banner";
      bannerEl.setAttribute("role", "status");
      root.appendChild(bannerEl);
    }
    bannerEl.textContent = T(currentLang(settings), "overlay.pickerBanner");
  }

  function hidePickerBanner() {
    if (bannerEl) bannerEl.remove();
    bannerEl = null;
  }

  // ---------- Mensajería con popup/options/background ----------
  function onRuntimeMessage(msg, sender, sendResponse) {
    if (msg.type === "ping") {
      // Usado por background.js para saber si ya hay un content script vivo en este frame antes
      // de decidir si hace falta reinyectar uno nuevo.
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "startVideoPicker") {
      startVideoPicker();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "cancelVideoPicker") {
      stopVideoPicker();
      sendResponse({ ok: true });
      return;
    }

    const video = activeVideo();
    if (!video) {
      // Mensaje enviado a TODOS los frames de la pestaña (el popup aún no sabe en cuál está el
      // vídeo): el primero que responde gana. Antes, el frame principal sin vídeo contestaba "no hay
      // vídeo" al instante y el popup lo creía aunque el reproductor estuviera en un iframe. Ahora
      // los iframes sin vídeo no contestan y el frame principal espera un poco antes de hacerlo.
      if (msg.broadcast) {
        if (window !== window.top) return;
        setTimeout(() => {
          try { sendResponse({ ok: false, error: "no-video" }); } catch (err) {}
        }, 300);
        return true;
      }
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
        loop: isLooping(video),
        domain,
        detectedFps: detectedFps(video),
        domainFps: settings.domainFps[domain] || null,
        capabilities: video.__fscCapabilities || { pip: true, screenshot: true, frameAudio: true, recordClip: true },
        loopBroken: !!video.__fscLoopBroken,
        volume: currentVolumePercent(video),
        volumeMax: (settings && settings.volumeMax) || 300,
        recording: !!mediaRecorder,
        pip: document.pictureInPictureElement === video,
        volumeBlocked: !video.__fscGain && !!video.__fscAudioUnavailable,
        pausedHere: isPausedHere()
      });
      return;
    }
    if (msg.type === "runAction") {
      if (!Object.prototype.hasOwnProperty.call(ACTION_DEFS, msg.id)) {
        sendResponse({ ok: false, error: "unknown-action" });
        return;
      }
      if (msg.id === "togglePip") {
        togglePip(video).then(() => sendResponse({ ok: true, pip: document.pictureInPictureElement === video }));
        return true;
      }
      runAction(msg.id, video);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setSpeed") {
      const ok = typeof msg.speed === "number" && isFinite(msg.speed);
      if (ok) setSpeed(video, msg.speed);
      sendResponse({ ok });
      return;
    }
    if (msg.type === "setVolume") {
      const ok = typeof msg.percent === "number" && isFinite(msg.percent);
      if (ok) setVolume(video, msg.percent);
      sendResponse({ ok });
      return;
    }
    if (msg.type === "useDetectedFpsForDomain") {
      const fps = detectedFps(video);
      if (fps) {
        settings.domainFps[domain] = fps;
        saveSettings({ domainFps: settings.domainFps });
      }
      sendResponse({ ok: true, fps: fps || null });
      return;
    }
    if (msg.type === "clearDomainFps") {
      delete settings.domainFps[domain];
      saveSettings({ domainFps: settings.domainFps });
      sendResponse({ ok: true });
      return;
    }
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // ---------- Limpieza al ser reemplazados por una instancia nueva ----------
  function cleanup() {
    window.removeEventListener(NEW_INSTANCE_EVENT, onNewInstanceAnnounced);
    document.removeEventListener("pause", onNativePause, true);
    document.removeEventListener("play", onNativePlay, true);
    document.removeEventListener("ended", onNativeEnded, true);
    window.removeEventListener("blur", stopAllRepeats);
    document.removeEventListener("keyup", stopAllRepeats, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("wheel", onWheel, { passive: false });
    wheelAttached = false;
    document.removeEventListener("ratechange", onRateChange, true);
    if (shadowScanTimer !== null) clearTimeout(shadowScanTimer);
    removeUi();
    stopVideoPicker();
    stopAllRepeats();
    stopRecording(); // si había una grabación en marcha, se cierra y se guarda en vez de perderla
    mutationObserver.disconnect();
    // Los vídeos ya conectados a Web Audio siguen sonando a través del contexto compartido: no se
    // cierra (cerrarlo los dejaría mudos). La instancia nueva no puede volver a conectarlos
    // (un único MediaElementSource por elemento), así que su volumen queda como estaba.
    if (scanTimeoutId !== null) clearTimeout(scanTimeoutId);
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (err) {}
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch (err) {}
  }

  // ---------- Arranque ----------
  scanForNewVideos(); // barrido inicial inmediato, sin pasar por el agrupado de ráfagas
  if (document.documentElement) {
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
