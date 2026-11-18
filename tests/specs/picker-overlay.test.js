// Selector manual de vídeo y aislamiento del aviso en pantalla respecto al CSS/JS de la página.
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

test("selector manual: el vídeo pulsado pasa a ser el controlado aunque no sea el más grande", async () => {
  const page = await h.openFixture(ext, srv.originA + "/two.html");
  const tabId = await h.tabIdOf(ext, page);
  await h.sendToTab(ext, tabId, { type: "startVideoPicker" });
  await h.sleep(200);
  const box = await page.locator("#small").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await h.sleep(300);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 2 });
  await h.sleep(200);
  assert.equal(await page.$eval("#small", (v) => v.playbackRate), 2);
  assert.equal(await page.$eval("#big", (v) => v.playbackRate), 1);
  // El resaltado del selector no deja estilos inline residuales en la página.
  assert.equal(await page.$eval("#small", (v) => v.getAttribute("style")), "");
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1 });
  await page.close();
});

test("selector manual: Escape cancela sin cambiar nada", async () => {
  const page = await h.openFixture(ext, srv.originA + "/two.html");
  const tabId = await h.tabIdOf(ext, page);
  await h.sendToTab(ext, tabId, { type: "startVideoPicker" });
  await h.sleep(200);
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await h.sleep(200);
  await page.keyboard.press("Control+BracketRight"); // los atajos vuelven a funcionar
  await h.sleep(200);
  assert.equal(await page.$eval("#big", (v) => v.playbackRate), 1.25);
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1 });
  await page.close();
});

test("aviso en pantalla: visible aunque la página oculte todos los div, y cerrado a sus scripts", async () => {
  const page = await h.openFixture(ext, srv.originA + "/hostile-css.html");
  await page.keyboard.press("Control+BracketRight");
  await h.sleep(200);
  const info = await page.evaluate(() => {
    const host = document.getElementById("__fsc_ui_host__");
    return host && { display: getComputedStyle(host).display, shadowVisibleToPage: host.shadowRoot !== null };
  });
  assert.ok(info, "existe el anfitrión del aviso");
  assert.equal(info.display, "block");
  assert.equal(info.shadowVisibleToPage, false, "shadow root cerrado");
  await page.close();
});

test("sin errores de JavaScript en las páginas", () => {
  assert.deepEqual(ext.errors, []);
});
