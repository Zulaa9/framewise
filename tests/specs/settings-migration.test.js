// Migraciones de ajustes: datos guardados por la 1.0.0 (formato actual de deltas) y por versiones
// anteriores (objeto "actions" completo en sync, "pausedDomains" en local) deben seguir funcionando
// tras actualizar, sin pérdidas y de forma idempotente.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../helpers");

let ext, page;

test.before(async () => {
  ext = await h.launch();
  page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
});
test.after(async () => {
  await ext.close();
});

async function seed(sync, local) {
  await page.evaluate(
    ([sync, local]) =>
      new Promise((r) =>
        chrome.storage.sync.clear(() =>
          chrome.storage.local.clear(() => chrome.storage.sync.set(sync, () => chrome.storage.local.set(local, r)))
        )
      ),
    [sync, local]
  );
}
const load = () => page.evaluate(() => new Promise((r) => loadSettings(r)));
const raw = () =>
  page.evaluate(
    () => new Promise((r) => chrome.storage.sync.get(null, (s) => chrome.storage.local.get(null, (l) => r({ sync: s, local: l }))))
  );

// Lo que guardaba la 1.0.0 publicada (b0526e0): sin "lang", atajos como deltas.
const V100_SYNC = {
  fps: 25,
  speedStep: 0.5,
  seekSeconds: 10,
  multiFrameCount: 3,
  showOverlay: false,
  frameStepAudio: false,
  wheelSpeedControl: false,
  rememberSpeedPerDomain: true,
  volumeMax: 400,
  volumeStep: 20,
  rememberVolumePerDomain: false,
  speedPresets: [0.5, 1, 1.5, 2, 3],
  domainOverrides: { "www.youtube.com": { togglePlay: "", frameForward: "Alt+." } },
  shortcuts: { screenshot: "Ctrl+Shift+P", toggleMute: "" },
  pausedDomains: { "www.twitch.tv": true }
};
const V100_LOCAL = {
  domainSpeeds: { "www.youtube.com": 1.75 },
  domainFps: { "www.crunchyroll.com": 23.976 },
  domainVolumes: { "www.youtube.com": 150 }
};

test("ajustes de la 1.0.0: se cargan tal cual y no se reescribe nada al cargar", async () => {
  await seed(V100_SYNC, V100_LOCAL);
  const before = await raw();
  const s = await load();
  for (const [k, v] of Object.entries(V100_SYNC)) assert.deepEqual(s[k], v, k);
  for (const [k, v] of Object.entries(V100_LOCAL)) assert.deepEqual(s[k], v, k);
  assert.equal(s.lang, null, "sin idioma elegido: sigue al navegador");
  assert.equal(effectiveGlobalShortcutIn(s, "screenshot"), "Ctrl+Shift+P");
  await load();
  assert.deepEqual(await raw(), before, "cargar no modifica storage (idempotente)");
});

function effectiveGlobalShortcutIn(s, id) {
  return Object.prototype.hasOwnProperty.call(s.shortcuts, id) ? s.shortcuts[id] : null;
}

test("formato legacy de actions: se migra a deltas una sola vez y sin perder personalizaciones", async () => {
  await seed(
    {
      fps: 30,
      actions: {
        frameBack: { label: "Retroceder 1 fotograma", shortcut: ",", repeatable: true }, // default antiguo
        frameForward: { label: "x", shortcut: "Ctrl+.", repeatable: true }, // default actual
        speedUp: { label: "x", shortcut: "Shift+]", repeatable: false }, // personalizado
        screenshot: { label: "x", shortcut: "Ctrl+Shift+S", repeatable: false }, // default intermedio
        recordClip: { label: "x", shortcut: "Ctrl+Alt+R", repeatable: false }, // default intermedio
        toggleMute: { label: "x", shortcut: "", repeatable: false } // "" era default: no personalización
      }
    },
    { pausedDomains: { "legacy.example": true }, domainSpeeds: { "a.example": 2 } }
  );
  const s = await load();
  assert.deepEqual(s.shortcuts, { speedUp: "Shift+]" });
  assert.deepEqual(s.pausedDomains, { "legacy.example": true });
  assert.equal(s.fps, 30);
  assert.deepEqual(s.domainSpeeds, { "a.example": 2 });
  const after = await raw();
  assert.equal(after.sync.actions, undefined, "actions eliminado de sync");
  assert.deepEqual(after.sync.shortcuts, { speedUp: "Shift+]" });
  assert.deepEqual(after.sync.pausedDomains, { "legacy.example": true });
  assert.equal(after.local.pausedDomains, undefined, "pausedDomains legacy eliminado de local");
  // Idempotente: una segunda carga no cambia nada más.
  await load();
  assert.deepEqual(await raw(), after);
});

test("legacy + deltas ya existentes: el delta nuevo gana sobre el antiguo", async () => {
  await seed(
    { actions: { speedUp: { shortcut: "Shift+]" } }, shortcuts: { speedUp: "Alt+U" } },
    {}
  );
  const s = await load();
  assert.equal(s.shortcuts.speedUp, "Alt+U");
});

test("valores imposibles guardados no rompen nada: se acotan solo en memoria", async () => {
  await seed({ fps: 0, multiFrameCount: -3, speedPresets: "no", volumeMax: 1e9 }, {});
  const s = await load();
  assert.equal(s.fps, 1);
  assert.equal(s.multiFrameCount, 1);
  assert.ok(Array.isArray(s.speedPresets) && s.speedPresets.length > 0);
  assert.equal(s.volumeMax, 1000);
  const after = await raw();
  assert.equal(after.sync.fps, 0, "lo guardado no se reescribe al cargar");
});

test("sin errores de JavaScript", () => {
  assert.deepEqual(ext.errors, []);
});
