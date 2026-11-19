// Captura PNG, grabación WebM y volumen con la política de autoplay real (sin gesto del usuario).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("captura PNG: descarga un PNG válido con las dimensiones del vídeo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  await page.$eval("#v", (v) => { v.currentTime = 1; });
  await h.sleep(400);
  const dl = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+F");
  const download = await dl;
  assert.match(download.suggestedFilename(), /^frame_\d+ms\.png$/);
  const buf = fs.readFileSync(await download.path());
  assert.equal(buf.subarray(1, 4).toString(), "PNG");
  assert.equal(buf.readUInt32BE(16), 320, "ancho");
  assert.equal(buf.readUInt32BE(20), 180, "alto");
  await page.close();
});

test("grabación de clip: iniciar, parar y descargar un WebM no vacío", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => v.play());
  await h.sleep(300);
  await page.keyboard.press("Control+Shift+G");
  await h.sleep(300);
  let st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.recording, true);
  await h.sleep(1500);
  const dl = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+G");
  const download = await dl;
  assert.match(download.suggestedFilename(), /^clip_\d+ms\.webm$/);
  const buf = fs.readFileSync(await download.path());
  assert.ok(buf.length > 2000, `tamaño: ${buf.length}`);
  assert.equal(buf.readUInt32BE(0), 0x1a45dfa3, "cabecera EBML (WebM)");
  st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.recording, false);
  await page.close();
});

test("grabación: si el vídeo cambia de fuente se cierra y guarda el clip", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => v.play());
  await h.sleep(300);
  await h.sendToTab(ext, tabId, { type: "runAction", id: "recordClip" });
  await h.sleep(1200);
  const dl = page.waitForEvent("download", { timeout: 8000 });
  await page.$eval("#v", (v) => { v.src = "sample-24fps.webm"; });
  const download = await dl;
  assert.match(download.suggestedFilename(), /\.webm$/);
  const st = await h.waitFor(async () => {
    const s = await h.sendToTab(ext, tabId, { type: "getState" });
    return s && s.ok && !s.recording ? s : null;
  });
  assert.ok(st, "deja de grabar");
  await page.close();
});

test("captura sin imagen todavía: aviso en vez de error", async () => {
  const page = await h.openFixture(ext, srv.originA + "/empty.html", null);
  await page.evaluate(() => {
    const v = document.createElement("video");
    v.id = "nodata";
    v.preload = "none";
    v.src = "sample-30fps.webm";
    document.body.appendChild(v);
  });
  await h.sleep(500);
  const tabId = await h.tabIdOf(ext, page);
  const r = await h.sendToTab(ext, tabId, { type: "runAction", id: "screenshot" });
  assert.equal(r.ok, true);
  await h.sleep(300);
  assert.deepEqual(ext.errors, []);
  await page.close();
});
