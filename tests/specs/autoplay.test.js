// Volumen con la política de autoplay real del navegador: sin ningún gesto en la página, el
// AudioContext nace suspendido. Conectar el vídeo en ese estado lo dejaba mudo hasta recargar.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../helpers");

let srv, ext;

test.before(async () => {
  srv = await h.startServer();
  ext = await h.launch({ autoplay: false });
});
test.after(async () => {
  await ext.close();
  await srv.close();
});

test("sin gesto: no se conecta el audio (aviso); tras un clic en la página, sí", async () => {
  // Ni page.evaluate ni waitForFunction: Playwright los ejecuta como gesto de usuario y la página
  // dejaría de estar "sin activar". Se espera al vídeo preguntando al content script.
  const page = await ext.context.newPage();
  await page.goto(srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await h.waitFor(async () => {
    const s = await h.sendToTab(ext, tabId, { type: "getState" });
    return s && s.ok && s.duration > 0 ? s : null;
  });
  // Cambio desde el popup: no cuenta como gesto en la página.
  await h.sendToTab(ext, tabId, { type: "setVolume", percent: 150 });
  let st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.volume, 100, "sin gesto no se crea el grafo");
  // Primer gesto real en la página.
  await page.mouse.click(5, 400);
  await h.sendToTab(ext, tabId, { type: "setVolume", percent: 150 });
  st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.volume, 150);
  // Y el vídeo se sigue pudiendo reproducir con el audio pasando por el grafo.
  await page.$eval("#v", (v) => v.play());
  await h.sleep(500);
  assert.equal(await page.$eval("#v", (v) => !v.paused), true);
  assert.deepEqual(ext.errors, []);
  await page.close();
});
