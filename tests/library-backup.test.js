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

test("same-size mutable metadata changed after review is detected when mtime is preserved", async (t) => {
  const { local, external } = tempPair(t);
  const fixedTime = new Date("2026-09-02T01:00:00.000Z");
  const accountPath = path.join(local, "account", "build.json");
  fs.utimesSync(accountPath, fixedTime, fixedTime);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");

  write(path.join(local, "created", "first", "image.txt"), "planned-change");
  const analysis = await engine.analyze("to-external");
  write(accountPath, "{\"accounts\":[2]}\n");
  fs.utimesSync(accountPath, fixedTime, fixedTime);

  await assert.rejects(
    () => engine.execute(analysis),
    (error) => error?.code === "PLAN_CHANGED" && /Nothing was copied/i.test(error.message),
  );
  assert.equal(fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"), "image-one");
  assert.equal(fs.readFileSync(path.join(external, "account", "build.json"), "utf8"), "{\"accounts\":[1]}\n");
});

test("a file added after review is rejected before the destination is changed", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");

  write(path.join(local, "created", "first", "image.txt"), "planned-change");
  const analysis = await engine.analyze("to-external");
  write(path.join(local, "prompt", "added-after-review.json"), "{\"prompt\":\"new\"}\n");

  await assert.rejects(() => engine.execute(analysis), (error) => error?.code === "PLAN_CHANGED");
  assert.equal(fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"), "image-one");
  assert.equal(fs.existsSync(path.join(external, "prompt", "added-after-review.json")), false);
});

test("Local source changes after review are included in the refreshed backup plan", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  const reviewed = await engine.analyze("to-external");
  write(path.join(local, "cache", "card-previews", "late-preview.jpg"), "late-preview");

  const refreshed = await engine.refreshPlan(reviewed);
  await engine.execute(refreshed);

  assert.equal(
    fs.readFileSync(path.join(external, "cache", "card-previews", "late-preview.jpg"), "utf8"),
    "late-preview",
  );
});

test("External source changes after review are included in the refreshed restore plan", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");
  const reviewed = await engine.analyze("to-local");
  write(path.join(external, "created", "late", "post.json"), "{\"title\":\"late\"}\n");

  const refreshed = await engine.refreshPlan(reviewed);
  await engine.execute(refreshed);

  assert.equal(
    fs.readFileSync(path.join(local, "created", "late", "post.json"), "utf8"),
    "{\"title\":\"late\"}\n",
  );
});

test("destination content changes after review are still blocked", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");
  write(path.join(local, "created", "first", "image.txt"), "local-change");
  const reviewed = await engine.analyze("to-external");
  write(path.join(external, "created", "first", "image.txt"), "external-change-after-review");

  await assert.rejects(
    () => engine.refreshPlan(reviewed),
    (error) => error?.code === "PLAN_CHANGED" && /destination library changed/i.test(error.message),
  );
  assert.equal(
    fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"),
    "external-change-after-review",
  );
});

test("library.json user settings are protected while regenerated fields remain replaceable", async (t) => {
  const { local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");

  const libraryPath = path.join(local, "library.json");
  const library = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  library.updated_at = "2026-09-03T00:00:00.000Z";
  write(libraryPath, `${JSON.stringify(library)}\n`);
  const regeneratedOnly = await engine.analyze("to-local");
  assert.equal(regeneratedOnly.summary.update, 1);

  library.settings = { hidden_upload_keys: ["private-item"] };
  write(libraryPath, `${JSON.stringify(library)}\n`);
  await assert.rejects(() => engine.analyze("to-local"), (error) => error?.code === "LOCAL_UNSYNCED");
});

test("final verification failure rolls back every applied destination change", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-library-backup-final-verify-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const control = path.join(root, ".control");
  makeLibrary(source, "2026-09-02T00:00:00.000Z");
  fs.cpSync(source, destination, { recursive: true });
  write(path.join(source, "created", "first", "image.txt"), "new-value");
  write(path.join(source, "created", "first", "new.txt"), "new-file");
  fs.unlinkSync(path.join(source, "account", "build.json"));
  const sourceManifest = await scanLibrary(source);
  const destinationManifest = await scanLibrary(destination);
  const changes = buildChangePlan(sourceManifest, destinationManifest);

  await assert.rejects(
    () => applyChanges(source, destination, changes, control, {
      verify: async () => {
        throw new Error("simulated final verification failure");
      },
    }),
    /simulated final verification failure/,
  );
  assert.equal(fs.readFileSync(path.join(destination, "created", "first", "image.txt"), "utf8"), "image-one");
  assert.equal(fs.existsSync(path.join(destination, "created", "first", "new.txt")), false);
  assert.equal(fs.readFileSync(path.join(destination, "account", "build.json"), "utf8"), "{\"accounts\":[1]}\n");
});

test("a control-record write failure rolls back files and both manifests", async (t) => {
  const { root, local, external } = tempPair(t);
  const engine = new LibraryBackup({ localRoot: local, externalRoot: external, machineId: "mac-a" });
  await run(engine, "to-external");

  const controlFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (["manifest.json", "baseline.json"].includes(entry.name)) controlFiles.push(entryPath);
    }
  };
  walk(root);
  const externalManifestPath = controlFiles.find((filePath) => path.basename(filePath) === "manifest.json");
  const localBaselinePath = controlFiles.find((filePath) => path.basename(filePath) === "baseline.json");
  const manifestBefore = fs.readFileSync(externalManifestPath, "utf8");
  const baselineBefore = fs.readFileSync(localBaselinePath, "utf8");

  write(path.join(local, "created", "first", "image.txt"), "new-value");
  const analysis = await engine.analyze("to-external");
  const originalRename = fs.renameSync;
  let failOnce = true;
  fs.renameSync = (from, to) => {
    if (failOnce && path.resolve(to) === path.resolve(localBaselinePath) && String(from).endsWith(".tmp")) {
      failOnce = false;
      throw new Error("simulated receipt write failure");
    }
    return originalRename(from, to);
  };
  try {
    await assert.rejects(() => engine.execute(analysis), /simulated receipt write failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(path.join(external, "created", "first", "image.txt"), "utf8"), "image-one");
  assert.equal(fs.readFileSync(externalManifestPath, "utf8"), manifestBefore);
  assert.equal(fs.readFileSync(localBaselinePath, "utf8"), baselineBefore);
});

test("three cross-computer round trips preserve generations and latest content", async (t) => {
  const { root, local: localA, external } = tempPair(t);
  const localB = path.join(root, "local-b");
  fs.mkdirSync(localB);
  const computerA = new LibraryBackup({ localRoot: localA, externalRoot: external, machineId: "computer-a" });
  const computerB = new LibraryBackup({ localRoot: localB, externalRoot: external, machineId: "computer-b" });

  const first = await run(computerA, "to-external");
  assert.equal(first.result.generation, 1);
  await run(computerB, "to-local");
  write(path.join(localB, "created", "first", "image.txt"), "change-from-b");
  const second = await run(computerB, "to-external");
  assert.equal(second.result.generation, 2);

  const restoredA = await run(computerA, "to-local");
  assert.equal(restoredA.result.generation, 2);
  assert.equal(fs.readFileSync(path.join(localA, "created", "first", "image.txt"), "utf8"), "change-from-b");
  write(path.join(localA, "created", "first", "image.txt"), "change-from-a");
  const third = await run(computerA, "to-external");
  assert.equal(third.result.generation, 3);

  const restoredB = await run(computerB, "to-local");
  assert.equal(restoredB.result.generation, 3);
  assert.equal(fs.readFileSync(path.join(localB, "created", "first", "image.txt"), "utf8"), "change-from-a");
});
