// Página de clips recuperados: lista los clips que se estaban grabando cuando su pestaña navegó o se
// cerró (los guarda background.js en IndexedDB, ver "Copia de seguridad de clips"), descarga una vez
// cada clip nuevo automáticamente y permite volver a descargarlo o eliminarlo.
let settings = null;
const CLIP_DB = "framewise-clips";
let dbPromise = null;

function q(id) { return document.getElementById(id); }
function lang() { return currentLang(settings); }

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CLIP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["id", "seq"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let out;
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        fn(t, (v) => (out = v));
      })
  );
}

function getClips() {
  return tx(["clips"], "readonly", (t, set) => {
    const req = t.objectStore("clips").getAll();
    req.onsuccess = () => set(req.result || []);
  });
}

function getChunks(id) {
  return tx(["chunks"], "readonly", (t, set) => {
    const req = t.objectStore("chunks").getAll(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    req.onsuccess = () => set((req.result || []).sort((a, b) => a.seq - b.seq).map((c) => c.data));
  });
}

function markDownloaded(id) {
  return tx(["clips"], "readwrite", (t) => {
    const store = t.objectStore("clips");
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return;
      req.result.state = "downloaded";
      req.result.updatedAt = Date.now();
      store.put(req.result);
    };
  });
}

function deleteClip(id) {
  return tx(["clips", "chunks"], "readwrite", (t) => {
    t.objectStore("clips").delete(id);
    t.objectStore("chunks").delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
  });
}

async function downloadClip(clip) {
  const parts = await getChunks(clip.id);
  if (!parts.length) return;
  const blob = new Blob(parts, { type: clip.mimeType || "video/webm" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = clip.filename || "clip.webm";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  await markDownloaded(clip.id);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function pageLabel(page) {
  try {
    return new URL(page).hostname || page;
  } catch (err) {
    return page || "";
  }
}

let rendering = Promise.resolve();
function refresh() {
  rendering = rendering.then(render).catch(() => {});
  return rendering;
}

async function render() {
  let clips = (await getClips()).filter((c) => c.state === "orphaned" || c.state === "downloaded");
  // Los nuevos se descargan solos una vez, para que no se pierdan aunque no se mire esta pestaña.
  for (const c of clips) {
    if (c.state === "orphaned") {
      await downloadClip(c);
      c.state = "downloaded";
    }
  }
  clips = clips.sort((a, b) => b.createdAt - a.createdAt);
  const list = q("clipList");
  list.innerHTML = "";
  q("emptyMsg").classList.toggle("hidden", clips.length > 0);
  const fmt = new Intl.DateTimeFormat(lang() === "en" ? "en-GB" : "es-ES", { dateStyle: "short", timeStyle: "medium" });
  clips.forEach((c) => {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    const info = document.createElement("div");
    info.className = "clip-info";
    const name = document.createElement("div");
    name.textContent = c.filename || "clip.webm";
    const meta = document.createElement("div");
    meta.className = "clip-state";
    meta.textContent =
      T(lang(), "recover.item", { date: fmt.format(new Date(c.createdAt)), size: formatSize(c.bytes || 0), page: pageLabel(c.page) }) +
      (c.state === "downloaded" ? "  ·  " + T(lang(), "recover.downloaded") : "");
    info.appendChild(name);
    info.appendChild(meta);
    const dl = document.createElement("button");
    dl.className = "primary";
    dl.textContent = T(lang(), c.state === "downloaded" ? "recover.downloadAgain" : "recover.download");
    dl.addEventListener("click", () => downloadClip(c).then(refresh));
    const del = document.createElement("button");
    del.textContent = T(lang(), "recover.delete");
    del.setAttribute("aria-label", `${T(lang(), "recover.delete")}: ${c.filename || "clip.webm"}`);
    del.addEventListener("click", () => deleteClip(c.id).then(refresh));
    li.appendChild(info);
    li.appendChild(dl);
    li.appendChild(del);
    list.appendChild(li);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "clipsChanged" || sender.id !== chrome.runtime.id) return;
  sendResponse({ ok: true });
  refresh();
});

loadSettings((s) => {
  settings = s;
  applyI18n(lang());
  document.documentElement.lang = lang();
  refresh();
});
