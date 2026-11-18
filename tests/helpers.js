// Utilidades compartidas por las pruebas: servidor local de páginas de prueba (dos puertos = dos
// orígenes, para probar iframes de origen cruzado), arranque de Chromium con la extensión
// descomprimida cargada y atajos para hablar con el content script a través del service worker.
//
// Solo desarrollo: nada de esta carpeta forma parte del paquete que se sube a las tiendas.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".webm": "video/webm",
  ".js": "text/javascript",
  ".json": "application/json"
};

// Servidor estático mínimo con soporte de Range (sin él, Chromium no puede hacer seek en el vídeo).
function startServer() {
  const handler = (req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.join(FIXTURES_DIR, path.normalize(url.pathname).replace(/^([/\\])+/, ""));
    if (!file.startsWith(FIXTURES_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const size = fs.statSync(file).size;
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    // Las páginas con ?cors=1 sirven el vídeo con CORS, para poder probar el caso con y sin él.
    if (req.headers.origin) headers["Access-Control-Allow-Origin"] = "*";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? parseInt(range[2], 10) : size - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": size });
    fs.createReadStream(file).pipe(res);
  };
  return new Promise((resolve) => {
    const a = http.createServer(handler);
    const b = http.createServer(handler);
    a.listen(0, "127.0.0.1", () => {
      b.listen(0, "127.0.0.1", () => {
        resolve({
          // "localhost" y "127.0.0.1" son orígenes (y hostnames) distintos para el navegador.
          originA: `http://localhost:${a.address().port}`,
          originB: `http://127.0.0.1:${b.address().port}`,
          portB: b.address().port,
          close: () => Promise.all([new Promise((r) => a.close(r)), new Promise((r) => b.close(r))])
        });
      });
    });
  });
}

async function launch(opts = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "framewise-test-"));
  const downloadsPath = fs.mkdtempSync(path.join(os.tmpdir(), "framewise-dl-"));
  const extDir = opts.extensionDir || EXTENSION_DIR;
  const args = [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--mute-audio"
  ];
  if (opts.autoplay !== false) args.push("--autoplay-policy=no-user-gesture-required");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium", // el headless "nuevo" (Chromium completo) es el único que carga extensiones
    headless: process.env.HEADED ? false : true,
    acceptDownloads: true,
    downloadsPath,
    locale: opts.locale || "en-US",
    args
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const extensionId = new URL(sw.url()).host;
  const errors = [];
  context.on("weberror", (e) => errors.push(String(e.error())));
  return {
    context,
    extensionId,
    errors,
    get sw() {
      return context.serviceWorkers()[0] || sw;
    },
    async close() {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  };
}

// Id de pestaña (chrome.tabs) de una Page de Playwright, preguntando al service worker por la URL.
async function tabIdOf(ext, page) {
  const url = page.url();
  return ext.sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url === u);
    return t ? t.id : null;
  }, url);
}

// Envía un mensaje al content script de una pestaña (todos los frames, o uno concreto).
async function sendToTab(ext, tabId, msg, frameId) {
  return ext.sw.evaluate(
    ([tabId, msg, frameId]) =>
      new Promise((resolve) => {
        const cb = (resp) => resolve(chrome.runtime.lastError ? { lastError: chrome.runtime.lastError.message } : resp);
        if (typeof frameId === "number") chrome.tabs.sendMessage(tabId, msg, { frameId }, cb);
        else chrome.tabs.sendMessage(tabId, msg, cb);
      }),
    [tabId, msg, frameId]
  );
}

// Abre una página de prueba y espera a que el vídeo tenga datos y el content script esté listo.
async function openFixture(ext, url, selector = "video") {
  const page = await ext.context.newPage();
  await page.goto(url);
  if (selector) {
    await page.waitForFunction(
      (sel) => {
        const find = (root) => {
          const v = root.querySelector(sel);
          if (v) return v;
          for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { const r = find(el.shadowRoot); if (r) return r; }
          return null;
        };
        const v = find(document);
        return v && v.readyState >= 2;
      },
      selector,
      { timeout: 15000 }
    ).catch(() => {});
  }
  // Margen para que el content script cargue sus ajustes (asíncrono) tras document_idle.
  await page.waitForTimeout(400);
  return page;
}

async function openPopupFor(ext, tabId, hostname) {
  const popup = await ext.context.newPage();
  await popup.goto(
    `chrome-extension://${ext.extensionId}/popup.html?tabId=${tabId}&hostname=${encodeURIComponent(hostname || "")}`
  );
  return popup;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 5000, interval = 100 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  return last;
}

module.exports = { startServer, launch, tabIdOf, sendToTab, openFixture, openPopupFor, sleep, waitFor, EXTENSION_DIR };
