// Paridad de textos es/en (i18n.js y _locales) — no necesita navegador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const ctx = { chrome: { i18n: { getUILanguage: () => "es" } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8") + "\nthis.STRINGS = STRINGS;", ctx);
const { STRINGS } = ctx;

test("i18n.js: mismas claves en es y en", () => {
  const es = Object.keys(STRINGS.es).sort();
  const en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(es.filter((k) => !en.includes(k)), [], "faltan en en");
  assert.deepEqual(en.filter((k) => !es.includes(k)), [], "faltan en es");
});

test("i18n.js: mismas variables {x} en cada traducción", () => {
  for (const key of Object.keys(STRINGS.es)) {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    assert.equal(vars(STRINGS.en[key]), vars(STRINGS.es[key]), key);
  }
});

test("todas las claves usadas en HTML y JS existen", () => {
  const files = ["popup.html", "options.html", "popup.js", "options.js", "content.js", "settings.js"];
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/data-i18n(?:-title|-placeholder|-html|-aria-label)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/T\([^,]+,\s*"([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !Object.prototype.hasOwnProperty.call(STRINGS.es, k));
  assert.deepEqual(missing, []);
});

test("_locales: es y en con las mismas claves y descripción corta (<=132)", () => {
  const es = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales/es/messages.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales/en/messages.json"), "utf8"));
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const loc of [es, en]) assert.ok(loc.extDescription.message.length <= 132);
});
