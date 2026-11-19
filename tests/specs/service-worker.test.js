// Service worker MV3: el registro de frames con vídeo sobrevive a que el worker se duerma, y la
// extensión carga sin errores (worker, páginas, content scripts).
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../helpers");

let srv, ext;

test.before(async () => {
  srv = await h.startServer();
  ext = await h.launch();
});
test.after(async () => {
  await ext.close();
  await srv.close();
});

async function askFrame(page, tabId) {
  return page.evaluate(
    (tabId) => new Promise((r) => chrome.runtime.sendMessage({ type: "getVideoFrame", tabId }, (resp) => r(resp))),
    tabId
  );
}

test("el registro del iframe con vídeo sobrevive a la parada del service worker", async () => {
  const page = await h.openFixture(ext, `${srv.originA}/iframe.html?otherPort=${srv.portB}`, null);
  const frame = await h.waitFor(() => page.frames().find((f) => f.url().includes("single.html")));
  await frame.waitForFunction(() => document.querySelector("#v") && document.querySelector("#v").readyState >= 2);
  await h.sleep(800);
  const tabId = await h.tabIdOf(ext, page);
  const ctl = await ext.context.newPage();
  await ctl.goto(`chrome-extension://${ext.extensionId}/popup.html?tabId=${tabId}`);
  const before = await askFrame(ctl, tabId);
  assert.equal(typeof before.frameId, "number");
  assert.notEqual(before.frameId, 0, "el vídeo está en el iframe, no en el frame principal");

  // Parar todos los service workers (lo mismo que hace Chrome tras ~30 s de inactividad).
  const cdp = await ext.context.newCDPSession(ctl);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await h.sleep(800);

  const after = await askFrame(ctl, tabId); // despierta un worker nuevo, con la memoria vacía
  assert.equal(after.frameId, before.frameId, "tras despertar sigue sabiendo en qué frame está el vídeo");
  await ctl.close();
  await page.close();
});

test("la extensión carga sin errores en chrome://extensions (worker y content scripts)", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  await h.sleep(500);
  const ep = await ext.context.newPage();
  await ep.goto("chrome://extensions");
  const info = await ep.evaluate(
    (id) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(id, (i) => r(i))),
    ext.extensionId
  );
  assert.equal(info.state, "ENABLED");
  assert.deepEqual(info.manifestErrors, [], "errores de manifest");
  assert.deepEqual(info.runtimeErrors, [], "errores de ejecución registrados por Chrome");
  assert.deepEqual(ext.errors, [], "errores JS en páginas");
  await ep.close();
  await page.close();
});

test("manifest: mismos permisos que la 1.0.0 y versión nueva", async () => {
  const manifest = require("../../manifest.json");
  assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.notEqual(manifest.version, "1.0.0");
});
