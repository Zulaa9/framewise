// Fotogramas, FPS, velocidad recordada, volumen y política de autoplay, varios vídeos, iframes y
// shadow DOM.
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

const state = (tabId, frameId) => h.sendToTab(ext, tabId, { type: "getState" }, frameId);

test("FPS detectado en vivo (~30) y paso de fotograma exacto tras un salto en reproducción", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  const v = (fn, a) => page.$eval("#v", fn, a);
  await v((v) => v.play());
  await h.sleep(1500);
  let st = await state(tabId);
  assert.ok(st.detectedFps && Math.abs(st.detectedFps - 30) < 1, `fps detectado: ${st.detectedFps}`);
  // Salto con "l" en plena reproducción, pausa inmediata y paso de fotograma: con la media antigua,
  // el salto de 5 s contaminaba la ventana de muestras y el paso avanzaba muchos fotogramas.
  await page.keyboard.press("l");
  await h.sleep(250);
  await v((v) => v.pause());
  await h.sleep(300);
  st = await state(tabId);
  assert.ok(st.detectedFps && Math.abs(st.detectedFps - 30) < 1, `fps tras salto: ${st.detectedFps}`);
  const before = await v((v) => v.currentTime);
  await page.keyboard.press("Control+Period");
  await h.sleep(900);
  const after = await v((v) => v.currentTime);
  assert.ok(Math.abs(after - before - 1 / 30) < 0.01, `paso: ${after - before}`);
  await page.close();
});

test("FPS por dominio: fijar el detectado y quitarlo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => v.play());
  await h.sleep(1200);
  const r = await h.sendToTab(ext, tabId, { type: "useDetectedFpsForDomain" });
  assert.ok(r.fps && Math.abs(r.fps - 30) < 1);
  await h.sleep(300);
  let st = await state(tabId);
  assert.ok(st.domainFps && Math.abs(st.domainFps - 30) < 1);
  await h.sendToTab(ext, tabId, { type: "clearDomainFps" });
  await h.sleep(300);
  st = await state(tabId);
  assert.equal(st.domainFps, null);
  await page.close();
});

test("la velocidad recordada se aplica al cargar la página y al cambiar de fuente", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1.5 });
  await h.sleep(300);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#v").readyState >= 1);
  const rate = await h.waitFor(() => page.$eval("#v", (v) => (v.playbackRate === 1.5 ? 1.5 : null)));
  assert.equal(rate, 1.5, "velocidad recordada tras recargar");
  // Misma etiqueta <video>, fuente nueva (SPA): el estándar reinicia playbackRate.
  await page.$eval("#v", (v) => { v.src = "sample-24fps.webm"; });
  const rate2 = await h.waitFor(() => page.$eval("#v", (v) => (v.readyState >= 1 && v.playbackRate === 1.5 ? 1.5 : null)));
  assert.equal(rate2, 1.5, "velocidad recordada tras cambiar de fuente");
  const tabId2 = await h.tabIdOf(ext, page);
  await h.sendToTab(ext, tabId2, { type: "setSpeed", speed: 1 });
  await page.close();
});

test("dos vídeos: se controla el que se está reproduciendo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/two.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#small", (v) => v.play());
  await h.sleep(400);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 2 });
  await h.sleep(200);
  assert.equal(await page.$eval("#small", (v) => v.playbackRate), 2);
  assert.equal(await page.$eval("#big", (v) => v.playbackRate), 1);
  // Ninguno reproduciéndose: el más grande.
  await page.$eval("#small", (v) => v.pause());
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 0.5 });
  await h.sleep(200);
  assert.equal(await page.$eval("#big", (v) => v.playbackRate), 0.5);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1 });
  await page.close();
});

test("vídeo dentro de un iframe de otro origen: el popup lo encuentra y lo controla", async () => {
  const page = await h.openFixture(ext, `${srv.originA}/iframe.html?otherPort=${srv.portB}`, null);
  const frame = await h.waitFor(() => page.frames().find((f) => f.url().includes("single.html")));
  await frame.waitForFunction(() => document.querySelector("#v") && document.querySelector("#v").readyState >= 2);
  await h.sleep(500);
  const tabId = await h.tabIdOf(ext, page);
  const popup = await h.openPopupFor(ext, tabId, "localhost");
  await popup.waitForSelector("#controls:not(.hidden)", { timeout: 8000 });
  await popup.click("#frameForward");
  await h.sleep(900);
  const t = await frame.$eval("#v", (v) => v.currentTime);
  assert.ok(t > 0.02, `el paso de fotograma llega al iframe: ${t}`);
  await popup.close();
  await page.close();
});

test("vídeo dentro de shadow DOM abierto: detectado y controlable con atajos", async () => {
  const page = await h.openFixture(ext, srv.originA + "/shadow.html");
  const tabId = await h.tabIdOf(ext, page);
  const st = await h.waitFor(async () => {
    const s = await state(tabId);
    return s && s.ok ? s : null;
  });
  assert.ok(st && st.ok, "getState encuentra el vídeo");
  await page.keyboard.press("Control+BracketRight");
  await h.sleep(300);
  const rate = await page.locator("video-player video").evaluate((v) => v.playbackRate);
  assert.equal(rate, 1.25);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1 });
  await page.close();
});

test("vídeo añadido después de abrir el popup: el popup lo detecta solo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/empty.html", null);
  const tabId = await h.tabIdOf(ext, page);
  const popup = await h.openPopupFor(ext, tabId, "localhost");
  await popup.waitForSelector("#noVideo:not(.hidden)", { timeout: 8000 });
  await page.evaluate(() => {
    const v = document.createElement("video");
    v.src = "sample-30fps.webm";
    v.id = "late";
    document.body.appendChild(v);
  });
  await popup.waitForSelector("#controls:not(.hidden)", { timeout: 8000 });
  await popup.close();
  await page.close();
});

test("el bucle nativo de un vídeo del sitio no se toca; el de Framewise es manual", async () => {
  const page = await h.openFixture(ext, srv.originA + "/native-loop.html");
  const tabId = await h.tabIdOf(ext, page);
  assert.equal(await page.$eval("#v", (v) => v.loop), true, "el atributo loop del sitio se conserva");
  let st = await state(tabId);
  assert.equal(st.loop, true, "el popup lo muestra como en bucle");
  await h.sendToTab(ext, tabId, { type: "runAction", id: "toggleLoop" }); // desactivar
  st = await state(tabId);
  assert.equal(st.loop, false);
  assert.equal(await page.$eval("#v", (v) => v.loop), false);
  await h.sendToTab(ext, tabId, { type: "runAction", id: "toggleLoop" }); // bucle manual
  st = await state(tabId);
  assert.equal(st.loop, true);
  assert.equal(await page.$eval("#v", (v) => v.loop), false, "el bucle de Framewise no usa el atributo");
  // Llega al final y vuelve a empezar por el bucle manual.
  await page.$eval("#v", (v) => { v.currentTime = v.duration - 0.3; return v.play(); });
  const restarted = await h.waitFor(() => page.$eval("#v", (v) => (!v.paused && v.currentTime < 2 ? true : null)), { timeout: 6000 });
  assert.equal(restarted, true, "reinicia tras 'ended'");
  await page.close();
});

test("sin errores de JavaScript en las páginas", () => {
  assert.deepEqual(ext.errors, []);
});
