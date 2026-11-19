// Service worker: badge del icono (velocidad actual por pestaña), resolución de a qué frame de la
// pestaña dirigirse cuando hay vídeo en más de un frame, y reinyección automática de content
// scripts huérfanos (ver reinjectOrphanedContentScripts más abajo).
// ---------- Registro de frames con vídeo ----------
// tabId -> Set<frameId> (frames que en algún momento tuvieron vídeo). Antes vivía solo en memoria:
// el service worker de MV3 se apaga tras ~30 s sin eventos y, al despertar, el registro estaba vacío
// — y como cada content script avisa de cada vídeo una única vez, ya no se volvía a llenar. En
// pestañas con el reproductor dentro de un iframe (el caso de Crunchyroll), el popup dejaba de
// encontrar el vídeo pasado ese rato. Ahora se guarda también en chrome.storage.session (memoria del
// navegador, se borra al cerrarlo, no necesita permisos nuevos) y se recupera al despertar.
const tabVideoFrames = new Map();
const SESSION_KEY = "tabVideoFrames";
let registryLoaded = null;

function loadRegistry() {
  if (!registryLoaded) {
    registryLoaded = new Promise((resolve) => {
      try {
        chrome.storage.session.get(SESSION_KEY, (res) => {
          const raw = (!chrome.runtime.lastError && res && res[SESSION_KEY]) || {};
          Object.keys(raw).forEach((tabId) => {
            const frames = Array.isArray(raw[tabId]) ? raw[tabId].filter((f) => typeof f === "number") : [];
            const set = tabVideoFrames.get(Number(tabId)) || new Set();
            frames.forEach((f) => set.add(f));
            tabVideoFrames.set(Number(tabId), set);
          });
          resolve();
        });
      } catch (err) {
        resolve(); // navegador sin storage.session: se sigue solo con la memoria, como antes
      }
    });
  }
  return registryLoaded;
}

let persistTimer = null;
function persistRegistry() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const out = {};
    tabVideoFrames.forEach((set, tabId) => {
      if (set.size) out[tabId] = Array.from(set);
    });
    try {
      chrome.storage.session.set({ [SESSION_KEY]: out }, () => void chrome.runtime.lastError);
    } catch (err) {}
  }, 50);
}

async function addVideoFrame(tabId, frameId) {
  await loadRegistry();
  if (!tabVideoFrames.has(tabId)) tabVideoFrames.set(tabId, new Set());
  const set = tabVideoFrames.get(tabId);
  if (set.has(frameId)) return;
  set.add(frameId);
  persistRegistry();
}

async function forgetTab(tabId) {
  await loadRegistry();
  if (tabVideoFrames.delete(tabId)) persistRegistry();
}

// Las llamadas a chrome.action devuelven promesas en MV3: si la pestaña ya no existe (se cerró
// justo antes) se rechazan, y sin capturarlas aparecían como errores en el service worker.
function ignoreError(p) {
  if (p && typeof p.catch === "function") p.catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || sender.id !== chrome.runtime.id) return;

  if (msg.type === "speedChanged" && sender.tab) {
    if (typeof msg.speed !== "number" || !isFinite(msg.speed)) return;
    const label = Math.abs(msg.speed - 1) < 0.001 ? "" : formatBadge(msg.speed);
    ignoreError(chrome.action.setBadgeText({ tabId: sender.tab.id, text: label }));
    ignoreError(chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#e8637a" }));
    return;
  }

  if (msg.type === "videoFound" && sender.tab) {
    addVideoFrame(sender.tab.id, sender.frameId || 0);
    return;
  }

  if (msg.type === "getVideoFrame" && typeof msg.tabId === "number") {
    resolveBestFrame(msg.tabId).then((frameId) => sendResponse({ frameId }));
    return true; // respuesta asíncrona
  }

  // El popup pidió buscar el vídeo "a mano" (clic directo sobre él); una vez elegido en un frame,
  // avisamos a TODOS los frames de esa pestaña para que cualquier otro que siguiera en modo de
  // selección se cancele solo.
  if (msg.type === "videoPickerDone" && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "cancelVideoPicker" }, () => void chrome.runtime.lastError);
    return;
  }

  if (msg.type === "startVideoPickerOnTab" && typeof msg.tabId === "number") {
    chrome.tabs.sendMessage(msg.tabId, { type: "startVideoPicker" }, () => void chrome.runtime.lastError);
    return;
  }
});

// Entre los frames que en algún momento avisaron de tener vídeo, pregunta a cada uno en tiempo
// real cuál está reproduciéndose ahora mismo. Si hay varios reproduciéndose a la vez, gana el de
// mayor área visible (mismo criterio que ya se usa dentro de un solo frame). Si ninguno está en
// reproducción, gana el más grande visible sin más.
//
// IMPORTANTE: un frame que falla en ESTA consulta puntual NO se borra del registro. En SPAs como
// YouTube, el <video> puede estar a medio recrear justo cuando preguntamos (p.ej. al pasar al
// siguiente vídeo de una lista) — borrarlo ahí dejaría el frame "huérfano" para siempre, aunque el
// vídeo volviera un instante después. El registro solo se limpia de verdad al navegar o cerrar la
// pestaña (ver listeners más abajo).
async function resolveBestFrame(tabId) {
  await loadRegistry();
  const frames = tabVideoFrames.get(tabId);
  if (!frames || frames.size === 0) return null;

  const candidates = Array.from(frames);
  const results = await Promise.all(
    candidates.map(
      (frameId) =>
        new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: "getLocalVideoStatus" }, { frameId }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) resolve({ frameId, ok: false });
            else resolve({ frameId, ok: true, playing: !!resp.playing, area: resp.area || 0, audio: !!resp.audio });
          });
        })
    )
  );

  let valid = results.filter((r) => r.ok);
  if (valid.length === 0) return null;
  // Un frame con vídeo gana siempre a uno que solo tiene audio.
  if (valid.some((r) => !r.audio)) valid = valid.filter((r) => !r.audio);

  const playing = valid.filter((r) => r.playing);
  const pool = playing.length ? playing : valid;
  pool.sort((a, b) => b.area - a.area);
  return pool[0].frameId;
}

function formatBadge(speed) {
  let s = speed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s + "x";
}

// Limpia el badge y el registro de frames cada vez que la pestaña navega a una página nueva.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    ignoreError(chrome.action.setBadgeText({ tabId, text: "" }));
    forgetTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

// ---------- Reinyección automática de content scripts huérfanos ----------
// Cuando la extensión se recarga o se actualiza, las pestañas que YA estaban abiertas se quedan
// con un content script "huérfano": su conexión con la extensión se rompe y no se reemplaza solo
// hasta que el usuario recarga esa pestaña. Es la causa más probable de que "a veces no detecte el
// vídeo, sobre todo justo después de recargar la extensión". Hacemos ping a cada pestaña abierta;
// si no responde, es que no hay content script vivo ahí (huérfano o nunca se inyectó) y lo
// reinyectamos nosotros mismos, sin esperar a que el usuario recargue nada.
//
// IMPORTANTE: esto SOLO se dispara desde onInstalled/onStartup (ver el final del archivo), nunca
// de forma incondicional al cargar este script. El service worker de una extensión MV3 se apaga
// por inactividad y se reinicia (reejecutando todo este archivo) con cualquier evento normal —un
// mensaje, un cambio de pestaña, etc.—, y eso NO deja huérfano a ningún content script: un content
// script vive en el proceso de la pestaña, ajeno a que el service worker esté despierto o dormido.
// Lo único que de verdad invalida un content script ya inyectado es que el propio código de la
// extensión se reemplace (instalar, actualizar, o "Recargar" en chrome://extensions, que dispara
// onInstalled igualmente) o que el navegador arranque de cero (onStartup). Barrer todas las
// pestañas en cada despertar normal del worker sería trabajo repetido sin ningún caso real que
// cubrir de más.
async function reinjectOrphanedContentScripts() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    return;
  }

  // Solo pestañas ya cargadas: en una que aún está cargando (p. ej. las que se restauran al abrir el
  // navegador) el content script del manifest todavía no ha llegado a ejecutarse, el ping falla, y
  // reinyectar ahí solo duplicaba la inyección. Las descartadas (discarded) no tienen documento.
  const injectable = tabs.filter(
    (t) => t.id != null && /^https?:\/\//.test(t.url || "") && t.status === "complete" && !t.discarded
  );

  await Promise.allSettled(injectable.map((tab) => ensureContentScript(tab.id)));
}

function ensureContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "ping" }, async (resp) => {
      if (!chrome.runtime.lastError && resp && resp.ok) {
        resolve(); // ya hay un content script vivo respondiendo — no tocar nada
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ["i18n.js", "settings.js", "content.js"]
        });
        await chrome.scripting.insertCSS({
          target: { tabId, allFrames: true },
          files: ["overlay.css"]
        });
      } catch (err) {
        // Pestañas sin permiso (chrome://, Web Store, PDFs, etc.) fallan aquí — se ignora sin más.
      }
      resolve();
    });
  });
}

chrome.runtime.onInstalled.addListener(() => reinjectOrphanedContentScripts());
chrome.runtime.onStartup.addListener(() => reinjectOrphanedContentScripts());

// ---------- Copia de seguridad de clips en grabación ----------
// content.js envía por un puerto ("fsc-clip") cada trozo de la grabación en curso; aquí se guarda en
// IndexedDB (almacenamiento propio de la extensión, sin permisos nuevos). Si el puerto se cierra sin
// el aviso "done" —la pestaña navegó o se cerró a mitad de grabación—, el clip queda "huérfano" y se
// abre recover.html para descargarlo. Si el clip terminó bien, content.js ya lo descargó y aquí se
// borra la copia.
const CLIP_DB = "framewise-clips";
const ORPHAN_GRACE_MS = 1500; // margen para que un puerto caído por un reinicio del worker se reabra
const STALE_RECORDING_MS = 20000; // sin trozos nuevos en este tiempo = la grabación ya no existe
const DOWNLOADED_TTL_MS = 24 * 3600 * 1000;
const ORPHAN_TTL_MS = 7 * 24 * 3600 * 1000;

let clipDbPromise = null;
function openClipDb() {
  if (!clipDbPromise) {
    clipDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CLIP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["id", "seq"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        clipDbPromise = null;
        reject(req.error);
      };
    });
  }
  return clipDbPromise;
}

function idbTx(stores, mode, fn) {
  return openClipDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        result = fn(tx);
      })
  );
}

function reqValue(req) {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function clipUpsert(id, patch) {
  await idbTx(["clips"], "readwrite", (tx) => {
    const store = tx.objectStore("clips");
    const req = store.get(id);
    req.onsuccess = () => {
      const now = Date.now();
      const rec = req.result || { id, createdAt: now, state: "recording", bytes: 0, chunks: 0 };
      Object.assign(rec, patch, { updatedAt: now });
      store.put(rec);
    };
  });
}

async function clipAddChunk(id, seq, b64) {
  if (typeof seq !== "number" || typeof b64 !== "string") return;
  const bytes = base64ToBytes(b64);
  await idbTx(["clips", "chunks"], "readwrite", (tx) => {
    tx.objectStore("chunks").put({ id, seq, data: new Blob([bytes]) });
    const store = tx.objectStore("clips");
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result;
      if (!rec) return;
      rec.bytes += bytes.length;
      rec.chunks += 1;
      rec.updatedAt = Date.now();
      if (rec.state === "orphaned") rec.state = "recording"; // el puerto se reabrió a tiempo
      store.put(rec);
    };
  });
}

async function clipDelete(id) {
  await idbTx(["clips", "chunks"], "readwrite", (tx) => {
    tx.objectStore("clips").delete(id);
    tx.objectStore("chunks").delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
  });
}

async function listClips() {
  return idbTx(["clips"], "readonly", (tx) => reqValue(tx.objectStore("clips").getAll())).then((r) => r || []);
}

// Marca como huérfanos los clips dados (si siguen sin trozos nuevos) y avisa / abre recover.html.
async function orphanClips(ids) {
  let any = false;
  for (const id of ids) {
    const all = await listClips();
    const rec = all.find((c) => c.id === id);
    if (!rec || rec.state !== "recording") continue;
    if (!rec.chunks) {
      await clipDelete(id); // nada grabado todavía: no hay nada que recuperar
      continue;
    }
    await clipUpsert(id, { state: "orphaned" });
    any = true;
  }
  if (any) showRecoverPage();
}

// Si ya hay una página de recuperación abierta, se refresca; si no, se abre una en segundo plano.
function showRecoverPage() {
  chrome.runtime.sendMessage({ type: "clipsChanged" }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok) return;
    chrome.tabs.create({ url: chrome.runtime.getURL("recover.html"), active: false }, () => void chrome.runtime.lastError);
  });
}

// Limpieza y recuperación de lo que quedó a medias (worker reiniciado, navegador cerrado grabando).
async function sweepClips() {
  let all;
  try {
    all = await listClips();
  } catch (err) {
    return;
  }
  const now = Date.now();
  const stale = [];
  for (const c of all) {
    if (c.state === "recording" && now - c.updatedAt > STALE_RECORDING_MS) stale.push(c.id);
    else if (c.state === "downloaded" && now - c.updatedAt > DOWNLOADED_TTL_MS) await clipDelete(c.id);
    else if (c.state === "orphaned" && now - c.updatedAt > ORPHAN_TTL_MS) await clipDelete(c.id);
  }
  if (stale.length) await orphanClips(stale);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "fsc-clip" || !port.sender || port.sender.id !== chrome.runtime.id || !port.sender.tab) return;
  let clipId = null;
  let done = false;
  let writes = Promise.resolve();
  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg.id !== "string" || msg.id.length > 64) return;
    if (clipId && msg.id !== clipId) return;
    clipId = msg.id;
    if (msg.type === "start") {
      const filename = typeof msg.filename === "string" && /^[\w.-]{1,100}$/.test(msg.filename) ? msg.filename : "clip.webm";
      const mimeType = typeof msg.mimeType === "string" && /^video\/webm[\w;=,.\- ]*$/.test(msg.mimeType) ? msg.mimeType : "video/webm";
      const page = typeof msg.page === "string" ? msg.page.slice(0, 500) : "";
      writes = writes.then(() => clipUpsert(clipId, { state: "recording", filename, mimeType, page })).catch(() => {});
    } else if (msg.type === "chunk") {
      writes = writes.then(() => clipAddChunk(clipId, msg.seq, msg.data)).catch(() => {});
    } else if (msg.type === "done") {
      done = true;
      writes = writes.then(() => clipDelete(clipId)).catch(() => {});
    }
  });
  port.onDisconnect.addListener(() => {
    if (!clipId || done) return;
    const id = clipId;
    // Espera a terminar de escribir y da un margen por si el content script vuelve a conectar
    // (reinicio del worker); si en ese tiempo llegan trozos nuevos, el clip vuelve a "recording".
    writes.then(() => setTimeout(() => {
      listClips().then((all) => {
        const rec = all.find((c) => c.id === id);
        if (rec && rec.state === "recording" && Date.now() - rec.updatedAt >= ORPHAN_GRACE_MS - 100) orphanClips([id]);
      }).catch(() => {});
    }, ORPHAN_GRACE_MS));
  });
});

sweepClips();
