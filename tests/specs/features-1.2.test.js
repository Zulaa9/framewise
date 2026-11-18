// Novedades de la 1.2.0: atajos alternativos para teclados con AltGr, volumen recordado distinto
// de 100 % con activación del usuario, aviso al cerrar Opciones con cambios, límite de duración y
// recuperación de clips, soporte de <audio> y saltos j/l acumulados.
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

const setStorage = (area, items) => ext.sw.evaluate(([a, i]) => chrome.storage[a].set(i), [area, items]);
const removeStorage = (area, keys) => ext.sw.evaluate(([a, k]) => chrome.storage[a].remove(k), [area, keys]);
const getState = (tabId) => h.sendToTab(ext, tabId, { type: "getState" });
const isWebm = (buf) => buf.length > 1000 && buf.readUInt32BE(0) === 0x1a45dfa3;

test("j/l: pulsaciones rápidas se acumulan en vez de perderse", async () => {
  await setStorage("sync", { seekSeconds: 3 });
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  await page.$eval("#v", (v) => { v.pause(); v.currentTime = 1; });
  await h.waitFor(() => page.$eval("#v", (v) => !v.seeking));
  await page.mouse.click(5, 400);
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await h.waitFor(() => page.$eval("#v", (v) => Math.abs(v.currentTime - 10) < 0.05 && !v.seeking), { timeout: 6000 });
  await h.sleep(400);
  const t = await page.$eval("#v", (v) => v.currentTime);
  assert.ok(Math.abs(t - 10) < 0.05, `3 × l desde 1 s con saltos de 3 s: ${t}`);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await h.waitFor(() => page.$eval("#v", (v) => Math.abs(v.currentTime - 4) < 0.05 && !v.seeking), { timeout: 6000 });
  await h.sleep(400);
  const t2 = await page.$eval("#v", (v) => v.currentTime);
  assert.ok(Math.abs(t2 - 4) < 0.05, `2 × j: ${t2}`);
  await removeStorage("sync", ["seekSeconds"]);
  await page.close();
});

test("Opciones: atajos alternativos para AltGr, sin pisar lo personalizado", async () => {
  await setStorage("sync", { shortcuts: { speedReset: "Ctrl+Shift+Y" } });
  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await options.waitForSelector(".shortcut-row");
  await options.click("#altLayoutBtn");
  assert.equal(await options.textContent("#keycap-speedUp"), "Ctrl+Shift+ArrowRight");
  assert.equal(await options.textContent("#keycap-speedDown"), "Ctrl+Shift+ArrowLeft");
  assert.equal(await options.textContent("#keycap-volumeReset"), "Ctrl+Shift+Backspace");
  assert.equal(await options.textContent("#keycap-speedReset"), "Ctrl+Shift+Y", "personalizado: se respeta");
  assert.match(await options.textContent("#altLayoutMsg"), /3/);
  assert.equal(await options.isVisible("#unsavedMsg"), true, "queda como cambio sin guardar");
  await options.click("#save");
  await h.sleep(300);

  const page = await h.openFixture(ext, srv.originA + "/single.html");
  await page.mouse.click(5, 400);
  await page.keyboard.press("Control+Shift+ArrowRight");
  await h.waitFor(() => page.$eval("#v", (v) => Math.abs(v.playbackRate - 1.25) < 0.001));
  assert.equal(await page.$eval("#v", (v) => v.playbackRate), 1.25);
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await h.waitFor(() => page.$eval("#v", (v) => Math.abs(v.playbackRate - 1) < 0.001));
  assert.equal(await page.$eval("#v", (v) => v.playbackRate), 1);
  await page.close();
  await options.close();
  await removeStorage("sync", ["shortcuts"]);
  await removeStorage("local", ["domainSpeeds"]);
});

test("Opciones: el navegador avisa al cerrar con cambios sin guardar (y no sin ellos)", async () => {
  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await options.waitForSelector(".shortcut-row");
  let dialogs = [];
  options.on("dialog", (d) => {
    dialogs.push(d.type());
    d.dismiss(); // "Quedarse": la página sigue abierta
  });
  await options.fill("#fps", "30");
  await options.mouse.click(5, 5); // activación de usuario: sin ella Chrome no muestra el aviso
  await options.close({ runBeforeUnload: true });
  await h.sleep(500);
  assert.deepEqual(dialogs, ["beforeunload"]);
  assert.equal(options.isClosed(), false, "sigue abierta tras cancelar");
  await options.click("#save");
  await h.sleep(300);
  dialogs = [];
  await options.close({ runBeforeUnload: true });
  await h.waitFor(() => options.isClosed());
  assert.deepEqual(dialogs, []);
  assert.equal(options.isClosed(), true);
  await removeStorage("sync", ["fps"]);
});

test("volumen recordado ≠ 100 %: espera al primer gesto y entonces se aplica", async () => {
  await setStorage("local", { domainVolumes: { localhost: 200 } });
  // Sin openFixture/evaluate: Playwright concede activación de usuario al evaluar en la página.
  const page = await ext.context.newPage();
  await page.goto(srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  const st = await h.waitFor(async () => {
    const s = await getState(tabId);
    return s && s.ok ? s : null;
  });
  await h.sleep(500);
  assert.equal((await getState(tabId)).volume, 100, "sin gesto: no se conecta nada (el vídeo sigue sonando)");
  assert.ok(st);
  await page.mouse.click(5, 400);
  const after = await h.waitFor(async () => {
    const s = await getState(tabId);
    return s && s.volume === 200 ? s : null;
  });
  assert.ok(after, "tras el clic se restaura el 200 %");
  await page.close();

  // Con la página ya activada (clic previo), un vídeo nuevo recibe el volumen al momento.
  const page2 = await ext.context.newPage();
  await page2.goto(srv.originA + "/empty.html");
  await page2.mouse.click(5, 5);
  await page2.evaluate(() => {
    const v = document.createElement("video");
    v.id = "late";
    v.src = "sample-30fps.webm";
    document.body.appendChild(v);
  });
  const tab2 = await h.tabIdOf(ext, page2);
  const late = await h.waitFor(async () => {
    const s = await getState(tab2);
    return s && s.volume === 200 ? s : null;
  });
  assert.ok(late, "vídeo añadido tras la activación");
  await page2.close();
  await removeStorage("local", ["domainVolumes"]);
});

test("clip: al llegar a la duración máxima se para y se guarda solo", async () => {
  await setStorage("sync", { clipMaxMinutes: 0.05 }); // 3 s
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => { v.loop = true; return v.play(); });
  await h.sleep(300);
  const dl = page.waitForEvent("download", { timeout: 10000 });
  await h.sendToTab(ext, tabId, { type: "runAction", id: "recordClip" });
  const download = await dl;
  assert.ok(isWebm(fs.readFileSync(await download.path())));
  const st = await getState(tabId);
  assert.equal(st.recording, false);
  await removeStorage("sync", ["clipMaxMinutes"]);
  await page.close();
});

async function recordThen(action) {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => { v.loop = true; return v.play(); });
  await h.sleep(300);
  await h.sendToTab(ext, tabId, { type: "runAction", id: "recordClip" });
  await h.sleep(2600);
  const recoverPage = ext.context.waitForEvent("page", {
    predicate: (p) => p.url().endsWith("/recover.html"),
    timeout: 10000
  });
  await action(page);
  const rp = await recoverPage;
  const download = await rp.waitForEvent("download", { timeout: 10000 });
  const buf = fs.readFileSync(await download.path());
  return { rp, download, buf };
}

test("clip: si la pestaña navega a mitad de grabación, se recupera", async () => {
  const { rp, download, buf } = await recordThen((page) => page.goto(srv.originA + "/empty.html"));
  assert.match(download.suggestedFilename(), /^clip_\d+ms\.webm$/);
  assert.ok(isWebm(buf), `WebM recuperado (${buf.length} bytes)`);
  await rp.waitForSelector("#clipList li");
  assert.equal(await rp.locator("#clipList li").count(), 1);
  // Eliminar lo quita de la lista y de la base de datos.
  await rp.click("#clipList li button:not(.primary)");
  await rp.waitForSelector("#emptyMsg:not(.hidden)");
  await rp.close();
});

test("clip: si la pestaña se cierra a mitad de grabación, se recupera", async () => {
  const { rp, buf } = await recordThen((page) => page.close());
  assert.ok(isWebm(buf));
  await rp.waitForSelector("#clipList li");
  await rp.click("#clipList li button:not(.primary)");
  await rp.waitForSelector("#emptyMsg:not(.hidden)");
  await rp.close();
});

test("clip terminado con normalidad: no queda copia ni se abre la recuperación", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#v", (v) => { v.loop = true; return v.play(); });
  await h.sleep(300);
  await h.sendToTab(ext, tabId, { type: "runAction", id: "recordClip" });
  await h.sleep(1500);
  const dl = page.waitForEvent("download");
  await h.sendToTab(ext, tabId, { type: "runAction", id: "recordClip" });
  await dl;
  let opened = false;
  const onPage = (p) => { if (p.url().includes("recover.html")) opened = true; };
  ext.context.on("page", onPage);
  await h.sleep(800);
  await page.close();
  await h.sleep(2500);
  ext.context.off("page", onPage);
  assert.equal(opened, false);
  const left = await ext.sw.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.open("framewise-clips", 1);
        req.onsuccess = () => {
          const g = req.result.transaction("clips").objectStore("clips").getAll();
          g.onsuccess = () => r(g.result.length);
        };
      })
  );
  assert.equal(left, 0);
});

test("<audio>: sin vídeo en la página se controla el audio (j/k/l, velocidad, popup)", async () => {
  const page = await h.openFixture(ext, srv.originA + "/audio.html", "audio");
  const tabId = await h.tabIdOf(ext, page);
  const audio = (fn) => page.$eval("#a", fn);
  await page.mouse.click(5, 400);
  await page.keyboard.press("k");
  assert.equal(await h.waitFor(() => audio((a) => !a.paused)), true, "k reproduce");
  await page.keyboard.press("k");
  await h.waitFor(() => audio((a) => a.paused));
  await audio((a) => { a.currentTime = 10; });
  await h.waitFor(() => audio((a) => !a.seeking));
  await page.keyboard.press("l");
  await h.waitFor(() => audio((a) => Math.abs(a.currentTime - 15) < 0.1 && !a.seeking));
  assert.ok(Math.abs((await audio((a) => a.currentTime)) - 15) < 0.1);
  await page.keyboard.press("Control+BracketRight");
  await h.waitFor(() => audio((a) => a.playbackRate > 1.2));
  assert.equal(await audio((a) => a.playbackRate), 1.25);
  // Paso de fotograma: no aplica, no mueve nada.
  const before = await audio((a) => a.currentTime);
  await page.keyboard.press("Control+Period");
  await h.sleep(500);
  assert.equal(await audio((a) => a.currentTime), before);

  const st = await getState(tabId);
  assert.equal(st.kind, "audio");
  const popup = await h.openPopupFor(ext, tabId, "localhost");
  await popup.waitForSelector("#controls:not(.hidden)", { timeout: 8000 });
  assert.equal(await popup.isDisabled("#frameForward"), true);
  assert.equal(await popup.isDisabled("#screenshot"), true);
  assert.equal(await popup.isDisabled("#recordClip"), true);
  assert.equal(await popup.isDisabled("#togglePip"), true);
  assert.equal(await popup.isVisible(".fps-row"), false);
  assert.match(await popup.textContent("#stateBadge"), /Audio/);
  await popup.click("#seekBack");
  await h.waitFor(async () => Math.abs((await audio((a) => a.currentTime)) - (before - 5)) < 0.1);
  assert.ok(Math.abs((await audio((a) => a.currentTime)) - (before - 5)) < 0.1, "botón del popup");
  await popup.close();
  await page.close();
  await removeStorage("local", ["domainSpeeds"]);
});

test("<audio>: un sonido corto de la interfaz no se toma como contenido (j/k/l siguen siendo del sitio)", async () => {
  const page = await h.openFixture(ext, srv.originA + "/notification-audio.html", null);
  const tabId = await h.tabIdOf(ext, page);
  await page.$eval("#blip", (a) => a.play());
  await h.sleep(2600); // ya sonó entero
  await page.mouse.click(5, 400);
  await page.keyboard.press("k");
  await page.keyboard.press("j");
  await h.sleep(300);
  assert.deepEqual(await page.evaluate(() => window.keys), ["k", "j"], "las teclas llegan a la página");
  const st = await h.sendToTab(ext, tabId, { type: "getState" });
  assert.equal(st.ok, false);
  assert.equal(st.error, "no-video");
  await page.close();
});

test("<audio> con un <video> en la página: manda el vídeo", async () => {
  const page = await h.openFixture(ext, srv.originA + "/single.html");
  const tabId = await h.tabIdOf(ext, page);
  await page.evaluate(() => {
    const a = document.createElement("audio");
    a.src = "sample-tone-45s.webm";
    a.controls = true;
    document.body.appendChild(a);
  });
  await h.sleep(500);
  const st = await getState(tabId);
  assert.equal(st.kind, "video");
  await page.close();
});
