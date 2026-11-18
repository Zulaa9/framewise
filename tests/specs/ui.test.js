// Popup y Opciones: estados, controles, grabación de atajos, cambios sin guardar, exportar/importar
// (incluido JSON malicioso o incompleto) y restablecer.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

const optionsUrl = () => `chrome-extension://${ext.extensionId}/options.html`;
const storage = (page) =>
  page.evaluate(
    () => new Promise((r) => chrome.storage.sync.get(null, (s) => chrome.storage.local.get(null, (l) => r({ sync: s, local: l }))))
  );

test("popup: muestra 'buscando', luego los controles, y sus botones actúan sobre el vídeo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  const popup = await h.openPopupFor(ext, tabId, "localhost");
  await popup.waitForSelector("#controls:not(.hidden)", { timeout: 8000 });
  assert.equal(await popup.isVisible("#loadingHint"), false);
  assert.equal(await popup.isVisible("#noVideo"), false);

  await page.$eval("#v", (v) => { v.pause(); v.currentTime = 2; });
  await h.sleep(300);
  await popup.click("#frameForward");
  await h.sleep(900);
  assert.ok((await page.$eval("#v", (v) => v.currentTime)) > 2.02);

  await popup.locator("#speedPresets button", { hasText: "1.5x" }).click();
  await h.sleep(300);
  assert.equal(await page.$eval("#v", (v) => v.playbackRate), 1.5);
  await popup.click("#speedDown");
  await h.sleep(300);
  assert.equal(await page.$eval("#v", (v) => v.playbackRate), 1.25);

  // Accesibilidad básica: botones de solo icono con nombre accesible, sliders con etiqueta.
  assert.ok(await popup.getAttribute("#togglePlay", "aria-label"));
  assert.ok(await popup.getAttribute("#speedSlider", "aria-label"));
  assert.ok(await popup.getAttribute("#volumeUp", "aria-label"));

  // Pausa por dominio desde el popup.
  await popup.click("#pauseBtn");
  await h.sleep(300);
  const st = await storage(popup);
  assert.deepEqual(st.sync.pausedDomains, { localhost: true });
  assert.equal(await popup.getAttribute("#pauseBtn", "aria-pressed"), "true");
  await popup.click("#pauseBtn");
  await h.sleep(200);

  // Cambio de idioma.
  await popup.click("#langToggle");
  await h.sleep(200);
  const txt = await popup.textContent("#frameForward");
  assert.ok(/Frame|Fotograma/.test(txt));
  await h.sendToTab(ext, tabId, { type: "setSpeed", speed: 1 });
  await popup.close();
  await page.close();
});

test("popup: sin vídeo muestra el aviso con reintento; 'Marcar vídeo' no cierra la ventana aparte", async () => {
  const page = await h.openFixture(ext, srv.originA + "/empty.html", null);
  const tabId = await h.tabIdOf(ext, page);
  const popup = await h.openPopupFor(ext, tabId, "localhost");
  await popup.waitForSelector("#noVideo:not(.hidden)", { timeout: 8000 });
  await popup.click("#pickVideoBtn");
  await h.sleep(300);
  assert.equal(popup.isClosed(), false);
  await popup.close();
  await page.close();
});

test("Opciones: grabar un atajo, aviso de combinación reservada, cambios sin guardar y Guardar", async () => {
  const opt = await ext.context.newPage();
  await opt.goto(optionsUrl());
  await opt.waitForSelector(".shortcut-row");
  assert.equal(await opt.isVisible("#unsavedMsg"), false);
  const row = opt.locator('.shortcut-row[data-action="screenshot"]');
  await row.locator("button").first().click();
  await opt.keyboard.press("Control+Alt+P");
  await opt.waitForSelector('.shortcut-row[data-action="screenshot"] .warn');
  assert.match(await row.locator(".warn").textContent(), /Ctrl\+Alt/);
  assert.equal(await opt.isVisible("#unsavedMsg"), true);

  // Mientras hay cambios sin guardar, otra pestaña guarda la velocidad recordada de un sitio: antes
  // esto recargaba todo y descartaba el atajo recién grabado.
  await opt.evaluate(() => chrome.storage.local.set({ domainSpeeds: { "x.example": 1.75 } }));
  await h.sleep(400);
  assert.match(await row.locator(".keycap").textContent(), /Ctrl\+Alt\+P/);

  await opt.click("#save");
  await h.sleep(400);
  const st = await storage(opt);
  assert.equal(st.sync.shortcuts.screenshot, "Ctrl+Alt+P");
  assert.deepEqual(st.local.domainSpeeds, { "x.example": 1.75 }, "Guardar no pisa lo recordado por otras pestañas");
  assert.equal(await opt.isVisible("#unsavedMsg"), false);

  // Valor imposible en un campo: se acota al guardar.
  await opt.fill("#fps", "0");
  await opt.click("#save");
  await h.sleep(300);
  assert.equal((await storage(opt)).sync.fps, 1);
  await opt.close();
});

test("Opciones: exportar e importar (ida y vuelta, incluye pausas por dominio)", async () => {
  const opt = await ext.context.newPage();
  await opt.goto(optionsUrl());
  await opt.evaluate(
    () =>
      new Promise((r) =>
        chrome.storage.sync.set(
          { pausedDomains: { "paused.example": true }, shortcuts: { toggleMute: "Ctrl+Shift+M" }, fps: 30 },
          r
        )
      )
  );
  await opt.reload();
  await opt.waitForSelector(".shortcut-row");
  const dl = opt.waitForEvent("download");
  await opt.click("#exportBtn");
  const file = await (await dl).path();
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(exported.pausedDomains, { "paused.example": true });

  // Reset completo (doble confirmación) y luego importar lo exportado.
  await opt.click("#resetAllBtn");
  await opt.click("#resetAllBtn");
  await h.sleep(400);
  assert.deepEqual((await storage(opt)).sync.pausedDomains, {});
  opt.on("dialog", (d) => d.accept());
  await opt.setInputFiles("#importFile", file);
  await h.sleep(400);
  await opt.click("#save");
  await h.sleep(400);
  const st = await storage(opt);
  assert.deepEqual(st.sync.pausedDomains, { "paused.example": true });
  assert.equal(st.sync.shortcuts.toggleMute, "Ctrl+Shift+M");
  assert.equal(st.sync.fps, 30);
  await opt.close();
});

test("Opciones: importar JSON inválido o malicioso", async () => {
  const opt = await ext.context.newPage();
  await opt.goto(optionsUrl());
  await opt.waitForSelector(".shortcut-row");
  const dialogs = [];
  opt.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-import-"));
  const write = (name, content) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const before = await storage(opt);

  await opt.setInputFiles("#importFile", write("roto.json", "{ esto no es json"));
  await h.sleep(300);
  await opt.setInputFiles("#importFile", write("tipos.json", JSON.stringify({ speedPresets: "rápido" })));
  await h.sleep(300);
  assert.equal(dialogs.length, 2);
  assert.equal(await opt.isVisible("#unsavedMsg"), false, "un archivo rechazado no deja nada aplicado");
  assert.deepEqual(await storage(opt), before);

  const evil = {
    fps: -5,
    multiFrameCount: 1e9,
    seekSeconds: "<img src=x onerror=alert(1)>",
    speedPresets: [1, 1, 99, -1, 2],
    shortcuts: { togglePlay: "Ctrl+Shift+K", "<script>": "x", screenshot: 5 },
    domainOverrides: { "__proto__": { togglePlay: "x" }, "<b>evil</b>": { togglePlay: "y" }, "ok.example": { togglePlay: "Alt+K" } },
    domainSpeeds: { "a.example": 1e9, "b.example": 2 },
    domainVolumes: { "a.example": -50, "b.example": 120 },
    domainFps: { "a.example": 0, "b.example": 25 },
    pausedDomains: { "p.example": true, "q.example": "sí" }
  };
  await opt.setInputFiles("#importFile", write("evil.json", JSON.stringify(evil)));
  await h.sleep(300);
  await opt.click("#save");
  await h.sleep(400);
  const st = await storage(opt);
  assert.equal(st.sync.fps, 1);
  assert.equal(st.sync.multiFrameCount, 500);
  assert.equal(st.sync.seekSeconds, 5);
  assert.deepEqual(st.sync.speedPresets, [1, 2]);
  assert.deepEqual(st.sync.shortcuts, { togglePlay: "Ctrl+Shift+K" });
  assert.deepEqual(Object.keys(st.sync.domainOverrides), ["ok.example"]);
  assert.deepEqual(st.local.domainSpeeds, { "b.example": 2 });
  assert.deepEqual(st.local.domainVolumes, { "b.example": 120 });
  assert.deepEqual(st.local.domainFps, { "b.example": 25 });
  assert.deepEqual(st.sync.pausedDomains, { "p.example": true });
  // El texto del archivo nunca se interpreta como HTML.
  assert.equal(await opt.locator("img").count() <= 1, true);
  await opt.close();
});

test("sin errores de JavaScript en las páginas", () => {
  assert.deepEqual(ext.errors, []);
});
