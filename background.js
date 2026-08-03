// Service worker: badge del icono (velocidad actual por pestaña) y resolución de a qué frame de
// la pestaña dirigirse cuando hay vídeo en más de un frame (p.ej. el reproductor principal en un
// iframe, o varios reproductores/embeds simultáneos en frames distintos).
const tabVideoFrames = new Map(); // tabId -> Set<frameId> (frames que en algún momento tuvieron vídeo)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "speedChanged" && sender.tab) {
    const label = Math.abs(msg.speed - 1) < 0.001 ? "" : formatBadge(msg.speed);
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: label });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#3a91d2" });
    return;
  }

  if (msg.type === "videoFound" && sender.tab) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId || 0;
    if (!tabVideoFrames.has(tabId)) tabVideoFrames.set(tabId, new Set());
    tabVideoFrames.get(tabId).add(frameId);
    return;
  }

  if (msg.type === "getVideoFrame" && typeof msg.tabId === "number") {
    resolveBestFrame(msg.tabId).then((frameId) => sendResponse({ frameId }));
    return true; // respuesta asíncrona
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
  const frames = tabVideoFrames.get(tabId);
  if (!frames || frames.size === 0) return null;

  const candidates = Array.from(frames);
  const results = await Promise.all(
    candidates.map(
      (frameId) =>
        new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: "getLocalVideoStatus" }, { frameId }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) resolve({ frameId, ok: false });
            else resolve({ frameId, ok: true, playing: !!resp.playing, area: resp.area || 0 });
          });
        })
    )
  );

  const valid = results.filter((r) => r.ok);
  if (valid.length === 0) return null;

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
    chrome.action.setBadgeText({ tabId, text: "" });
    tabVideoFrames.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabVideoFrames.delete(tabId));
