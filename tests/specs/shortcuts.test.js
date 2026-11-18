// Atajos de teclado: j/k/l sin modificador, atajos con Ctrl y Ctrl+Shift (incluidos los que
// cambian de carácter con Shift), no dispararse al escribir, override por dominio y pausa por dominio.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../helpers");

let srv, ext, page, tabId;

test.before(async () => {
  srv = await h.startServer();
  ext = await h.launch();
  page = await h.openFixture(ext, srv.originA + "/single.html");
  tabId = await h.tabIdOf(ext, page);
});
test.after(async () => {
  await ext.close();
  await srv.close();
});

const video = (fn, arg) => page.$eval("#v", fn, arg);
async function resetVideo(t = 2) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await video((v, t) => { v.pause(); v.currentTime = t; }, t);
  await h.waitFor(() => video((v) => !v.seeking));
}

test("k (sin modificador) alterna reproducción/pausa", async () => {
  await resetVideo();
  await page.keyboard.press("k");
  assert.equal(await h.waitFor(() => video((v) => !v.paused)), true, "k debería reproducir");
  await page.keyboard.press("k");
  assert.equal(await h.waitFor(() => video((v) => v.paused)), true, "k debería pausar");
});

test("j y l saltan los segundos configurados (5 s)", async () => {
  await resetVideo(6);
  await page.keyboard.press("l");
  await h.waitFor(() => video((v) => Math.abs(v.currentTime - 11) < 0.05 && !v.seeking));
  await h.sleep(300);
  assert.ok(Math.abs((await video((v) => v.currentTime)) - 11) < 0.05);
  await page.keyboard.press("j");
  await h.waitFor(() => video((v) => Math.abs(v.currentTime - 6) < 0.05));
  const t = await video((v) => v.currentTime);
  assert.ok(Math.abs(t - 6) < 0.05, `j: ${t}`);
});

test("Ctrl+. y Ctrl+, avanzan y retroceden un fotograma", async () => {
  await resetVideo(2);
  await page.keyboard.press("Control+Period");
  await h.sleep(900);
  const fwd = await video((v) => v.currentTime);
  assert.ok(fwd > 2.02 && fwd < 2.06, `adelante: ${fwd}`);
  await page.keyboard.press("Control+Comma");
  await h.sleep(900);
  const back = await video((v) => v.currentTime);
  assert.ok(Math.abs(back - 2) < 0.01, `atrás: ${back}`);
});

test("Ctrl+Shift+. / Ctrl+Shift+, (Shift cambia el carácter) mueven N fotogramas", async () => {
  await resetVideo(3);
  await page.keyboard.press("Control+Shift+Period"); // e.key llega como ">" en teclado US
  await h.sleep(1500);
  const t1 = await video((v) => v.currentTime);
  assert.ok(t1 > 3.15, `debería avanzar 5 fotogramas: ${t1}`);
  await page.keyboard.press("Control+Shift+Comma");
  await h.sleep(1200);
  const t2 = await video((v) => v.currentTime);
  assert.ok(Math.abs(t2 - 3) < 0.02, `debería volver: ${t2}`);
});

test("los atajos no se disparan al escribir (input, textarea, select, contenteditable, shadow DOM)", async () => {
  for (const sel of ["#txt", "#area", "#editable", "#inner"]) {
    await resetVideo(4);
    await page.locator(sel).click();
    await page.keyboard.type("kkljl");
    await h.sleep(300);
    const st = await video((v) => ({ paused: v.paused, t: v.currentTime }));
    assert.equal(st.paused, true, `${sel}: no debería reproducir`);
    assert.ok(Math.abs(st.t - 4) < 0.01, `${sel}: no debería saltar (${st.t})`);
  }
  await resetVideo(4);
  await page.locator("#sel").focus();
  await page.keyboard.press("l");
  await h.sleep(300);
  assert.ok(Math.abs((await video((v) => v.currentTime)) - 4) < 0.01, "select");
  // Ctrl+. dentro de un input tampoco
  await page.locator("#txt").click();
  await page.keyboard.press("Control+Period");
  await h.sleep(500);
  assert.ok(Math.abs((await video((v) => v.currentTime)) - 4) < 0.01, "Ctrl+. en input");
});

test("velocidad: Ctrl+] / Ctrl+[ / Ctrl+\\ y badge del icono", async () => {
  await resetVideo();
  await page.keyboard.press("Control+BracketRight");
  await h.sleep(200);
  assert.equal(await video((v) => v.playbackRate), 1.25);
  const badge = await h.waitFor(() =>
    ext.sw.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), tabId).then((b) => (b ? b : null))
  );
  assert.equal(badge, "1.25x");
  await page.keyboard.press("Control+BracketLeft");
  await page.keyboard.press("Control+BracketLeft");
  await h.sleep(200);
  assert.equal(await video((v) => v.playbackRate), 0.75);
  await page.keyboard.press("Control+Backslash");
  await h.sleep(200);
  assert.equal(await video((v) => v.playbackRate), 1);
});

test("volumen: Ctrl+Shift+↑/↓ y Ctrl+Shift+\\ (reset)", async () => {
  await resetVideo();
  await page.mouse.click(5, 400); // gesto de usuario en la página
  await page.keyboard.press("Control+Shift+ArrowUp");
  await h.sleep(200);
  let st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.volume, 110);
  await page.keyboard.press("Control+Shift+Backslash"); // e.key llega como "|"
  await h.sleep(200);
  st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.volume, 100);
  await page.keyboard.press("Control+Shift+ArrowDown");
  await h.sleep(200);
  st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.volume, 90);
  await h.sendToTab(ext, tabId, { type: "setVolume", percent: 100 });
});

test("override por dominio gana sobre el global y una acción vacía queda desactivada", async () => {
  await ext.sw.evaluate(() =>
    chrome.storage.sync.set({ domainOverrides: { localhost: { frameForward: "Alt+X", togglePlay: "" } } })
  );
  await h.sleep(400);
  await resetVideo(2);
  await page.keyboard.press("Control+Period"); // global: ya no aplica aquí
  await h.sleep(700);
  assert.ok(Math.abs((await video((v) => v.currentTime)) - 2) < 0.01, "el global no debe aplicar");
  await page.keyboard.press("Alt+x");
  await h.sleep(900);
  assert.ok((await video((v) => v.currentTime)) > 2.02, "el override sí");
  await page.keyboard.press("k");
  await h.sleep(300);
  assert.equal(await video((v) => v.paused), true, "togglePlay desactivado en el dominio");
  await ext.sw.evaluate(() => chrome.storage.sync.set({ domainOverrides: {} }));
  await h.sleep(300);
});

test("pausa por dominio: atajos de teclado off, botones del popup siguen funcionando", async () => {
  await ext.sw.evaluate(() => chrome.storage.sync.set({ pausedDomains: { localhost: true } }));
  await h.sleep(400);
  await resetVideo(2);
  await page.keyboard.press("k");
  await h.sleep(300);
  assert.equal(await video((v) => v.paused), true);
  const r = await h.sendToTab(ext, tabId, { type: "runAction", id: "togglePlay" });
  assert.equal(r.ok, true);
  assert.equal(await h.waitFor(() => video((v) => !v.paused)), true);
  await ext.sw.evaluate(() => chrome.storage.sync.set({ pausedDomains: {} }));
  await h.sleep(300);
});

test("mensajes con datos inválidos se rechazan sin romper nada", async () => {
  assert.equal((await h.sendToTab(ext, tabId, { type: "runAction", id: "__proto__" })).ok, false);
  assert.equal((await h.sendToTab(ext, tabId, { type: "setSpeed", speed: "rápido" })).ok, false);
  assert.equal((await h.sendToTab(ext, tabId, { type: "setVolume", percent: NaN })).ok, false);
  assert.equal((await h.sendToTab(ext, tabId, { type: "getState" })).ok, true);
});

test("sin errores de JavaScript en las páginas", () => {
  assert.deepEqual(ext.errors, []);
});
