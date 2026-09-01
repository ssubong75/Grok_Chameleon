const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  LibraryBackup,
  applyChanges,
  buildChangePlan,
  scanLibrary,
} = require("../common/app/electron/library-backup");

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function makeLibrary(root, stamp = "2026-09-01T00:00:00.000Z") {
  fs.mkdirSync(root, { recursive: true });
  write(path.join(root, "library.json"), `${JSON.stringify({ version: 1, created_at: stamp, updated_at: stamp })}\n`);
  write(path.join(root, "created", "first", "post.json"), "{\"title\":\"first\"}\n");
  write(path.join(root, "created", "first", "image.txt"), "image-one");
  write(path.join(root, "account", "build.json"), "{\"accounts\":[1]}\n");
  write(path.join(root, "cache", "preview.bin"), "cached-preview");
  write(path.join(root, "sql_data", "library_index.sqlite3"), "index-data");
  write(path.join(root, "runtime_data", "logs", "ignored.log"), "do-not-copy");
}

function tempPair(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-library-backup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local-library");
  const external = path.join(root, "external-library");
  makeLibrary(local);
  fs.mkdirSync(external);
  return { root, local, external };
}

async function run(engine, direction) {
  const analysis = await engine.analyze(direction);
  return { analysis, result: await engine.execute(analysis) };
}

test("initial Local to External copies supported data and excludes runtime files", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  const { analysis, result } = await run(engine, "to-external");

  assert.equal(analysis.summary.add, 6);
  assert.equal(result.generation, 1);
  assert.equal(fs.readFileSync(path.join(external, "account", "build.json"), "utf8"), "{\"accounts\":[1]}\n");
  assert.equal(fs.readFileSync(path.join(external, "cache", "preview.bin"), "utf8"), "cached-preview");
  assert.equal(fs.existsSync(path.join(external, "runtime_data")), false);
});

test("updates, deletes, and renames are mirrored and previous files go to history", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");

  write(path.join(local, "created", "first", "image.txt"), "image-two");
  fs.renameSync(
    path.join(local, "created", "first", "post.json"),
    path.join(local, "created", "first", "renamed.json"),
  );
  fs.unlinkSync(path.join(local, "cache", "preview.bin"));

  const { analysis, result } = await run(engine, "to-external");
  assert.equal(analysis.summary.update, 1);
  assert.equal(analysis.summary.add, 1);
  assert.equal(analysis.summary.delete, 2);
  assert.equal(fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"), "image-two");
  assert.equal(fs.existsSync(path.join(external, "created", "first", "post.json")), false);
  assert.equal(fs.existsSync(path.join(external, "created", "first", "renamed.json")), true);
  assert.equal(fs.existsSync(path.join(external, "cache", "preview.bin")), false);
  assert.equal(Boolean(result.historyPath), true);
  assert.equal(fs.existsSync(path.join(result.historyPath, "created", "first", "image.txt")), true);
  assert.equal(fs.existsSync(path.join(result.historyPath, "created", "first", "post.json")), true);
});

test("External to Local creates a checkout and blocks another computer", async (t) => {
  const { root, local, external } = tempPair(t);
  const mac = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(mac, "to-external");

  const restored = path.join(root, "restored-library");
  fs.mkdirSync(restored);
  const windows = new LibraryBackup({ localRoot: restored, externalRoot: external, machineId: "windows-b" });
  const restoreResult = await run(windows, "to-local");
  assert.equal(restoreResult.result.generation, 1);
  assert.equal(fs.readFileSync(path.join(restored, "created", "first", "image.txt"), "utf8"), "image-one");

  const otherLocal = path.join(root, "other-library");
  fs.mkdirSync(otherLocal);
  const other = new LibraryBackup({ localRoot: otherLocal, externalRoot: external, machineId: "mac-c" });
  await assert.rejects(() => other.analyze("to-local"), /another computer/i);
});

test("direct External changes during a checkout are not overwritten", async (t) => {
  const { root, local, external } = tempPair(t);
  const first = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(first, "to-external");

  const restored = path.join(root, "restored-library");
  fs.mkdirSync(restored);
  const second = new LibraryBackup({ localRoot: restored, externalRoot: external, machineId: "windows-b" });
  await run(second, "to-local");
  write(path.join(restored, "created", "first", "image.txt"), "local-change");
  write(path.join(external, "created", "first", "image.txt"), "external-change");

  await assert.rejects(() => second.analyze("to-external"), /changed directly/i);
  assert.equal(fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"), "external-change");
});

test("automatic External metadata refresh does not cause a false conflict", async (t) => {
  const { root, local, external } = tempPair(t);
  const first = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(first, "to-external");

  const restored = path.join(root, "restored-library");
  fs.mkdirSync(restored);
  const second = new LibraryBackup({ localRoot: restored, externalRoot: external, machineId: "windows-b" });
  await run(second, "to-local");
  const externalLibrary = JSON.parse(fs.readFileSync(path.join(external, "library.json"), "utf8"));
  externalLibrary.updated_at = "2026-09-03T00:00:00.000Z";
  write(path.join(external, "library.json"), `${JSON.stringify(externalLibrary)}\n`);
  write(path.join(restored, "created", "first", "image.txt"), "local-change");

  const analysis = await second.analyze("to-external");
  assert.equal(analysis.summary.update >= 1, true);
});

test("case-insensitive filename collisions are rejected", async (t) => {
  const { local, external } = tempPair(t);
  write(path.join(local, "prompt", "Name.json"), "one");
  write(path.join(local, "prompt", "name.json"), "two");
  if (fs.readdirSync(path.join(local, "prompt")).length < 2) {
    t.skip("The current filesystem is case-insensitive.");
    return;
  }
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await assert.rejects(() => engine.analyze("to-external"), /collision/i);
});

test("a failed atomic replacement restores the previous destination file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-library-backup-rollback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const control = path.join(root, ".control");
  makeLibrary(source, "2026-09-02T00:00:00.000Z");
  fs.cpSync(source, destination, { recursive: true });
  write(path.join(source, "created", "first", "image.txt"), "new-value");
  const sourceManifest = await scanLibrary(source);
  const destinationManifest = await scanLibrary(destination);
  const changes = buildChangePlan(sourceManifest, destinationManifest);
  assert.equal(changes.length, 1);

  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(from).includes(`${path.sep}staging${path.sep}`) && path.resolve(to) === path.resolve(destination, "created", "first", "image.txt")) {
      throw new Error("simulated replacement failure");
    }
    return originalRename(from, to);
  };
  try {
    await assert.rejects(() => applyChanges(source, destination, changes, control), /simulated replacement failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(path.join(destination, "created", "first", "image.txt"), "utf8"), "image-one");
});
