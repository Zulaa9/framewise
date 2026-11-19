// El ZIP que se sube a las tiendas contiene solo la extensión y carga y funciona por sí solo.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const h = require("../helpers");

// Extrae el ZIP generado por pack.js (lector mínimo: solo entradas deflate sin cifrar).
function unzip(file, dest) {
  const buf = fs.readFileSync(file);
  const names = [];
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const start = off + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + size);
    const out = path.join(dest, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(data) : data);
    names.push(name);
    off = start + size;
  }
  return names;
}

test("pack.js genera un ZIP solo con la extensión, que carga y funciona", async () => {
  execFileSync(process.execPath, [path.join(__dirname, "..", "pack.js")]);
  const manifest = require("../../manifest.json");
  const zipFile = path.join(__dirname, "..", "..", "dist", `framewise-${manifest.version}.zip`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-pkg-"));
  const names = unzip(zipFile, dir);
  assert.ok(names.includes("manifest.json"));
  assert.ok(!names.some((n) => n.startsWith("tests/") || n.startsWith("dist/") || n === "README.md"));

  const srv = await h.startServer();
  const ext = await h.launch({ extensionDir: dir });
  try {
    const page = await h.openFixture(ext, srv.originA + "/single.html");
    const tabId = await h.tabIdOf(ext, page);
    const st = await h.sendToTab(ext, tabId, { type: "getState" });
    assert.equal(st.ok, true);
    await page.keyboard.press("k");
    assert.equal(await h.waitFor(() => page.$eval("#v", (v) => !v.paused)), true);
    assert.deepEqual(ext.errors, []);
  } finally {
    await ext.close();
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
