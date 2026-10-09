const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { snapshotPreviews, syncPreviewSnapshots, previewPaths } = require('../common/app/electron/preview-sync');
const appRoot = process.env.SYNC_TEST_APP_ROOT;
if (!appRoot) throw new Error('SYNC_TEST_APP_ROOT must point to the complete assembled app runtime.');
const { LibraryBackup: RuntimeLibraryBackup } = require(path.join(appRoot, 'electron/library-backup'));
class LibraryBackup extends RuntimeLibraryBackup {
  constructor(options) {
    const sandbox = path.dirname(options.localRoot);
    super({ ...options,
      pythonPath: process.env.SYNC_TEST_PYTHON || 'python3',
      pythonEnv: { ...process.env,
        GROK_CHAMELEON_RUNTIME_DIR: path.join(sandbox, 'test-runtime'),
        GROK_CHAMELEON_PORTABLE_ROOT: sandbox,
        GROK_CHAMELEON_LIBRARY_POINTER_PATH: path.join(sandbox, '.library_path.json'),
        GROK_CHAMELEON_PLATFORM_KEY: process.platform === 'win32' ? 'windows' : 'macos',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
  }
}
function write(root, relative, data) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file;
}
function pair(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const left = path.join(root, 'left'), right = path.join(root, 'right');
  for (const dir of [left, right]) { fs.mkdirSync(dir); write(dir, 'cache/card-preview-render-revision', 'card-640-v1\n'); }
  return { left, right };
}
function records(root, relative) {
  const stat = fs.statSync(path.join(root, relative));
  return new Map([[relative.normalize('NFC').toLowerCase(), { relativePath: relative.normalize('NFC'), diskRelativePath: relative, size: stat.size, mtimeMs: stat.mtimeMs, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex') }]]);
}
function previews(root, relative, kinds = [0, 1]) {
  const names = previewPaths(relative, fs.statSync(path.join(root, relative), { bigint: true }));
  for (const kind of kinds) write(root, names[kind], `synthetic-preview-${kind}`);
  return names;
}
test('both directions reuse caches despite differing timestamps; repetition copies nothing', async t => {
  const { left, right } = pair(t); const rel = 'collection/1차/2차/영상.mp4';
  write(left, rel, 'synthetic-media'); const file = write(right, rel, 'synthetic-media'); fs.utimesSync(file, 1700000000, 1700000000);
  const leftNames = previews(left, rel, [0]), rightNames = previews(right, rel, [1]);
  assert.notEqual(leftNames[0], rightNames[0]);
  const final = records(left, rel);
  const result = await syncPreviewSnapshots(snapshotPreviews(left, final), snapshotPreviews(right, records(right, rel)), final);
  assert.equal(result.copied, 2);
  assert.equal(fs.readFileSync(path.join(right, rightNames[0]), 'utf8'), 'synthetic-preview-0');
  assert.equal(fs.readFileSync(path.join(left, leftNames[1]), 'utf8'), 'synthetic-preview-1');
  assert.equal((await syncPreviewSnapshots(snapshotPreviews(left, final), snapshotPreviews(right, records(right, rel)), final)).copied, 0);
});
test('changed or conflicted originals never receive older build previews', async t => {
  const { left, right } = pair(t); const rel = 'reference/card/image.png';
  write(left, rel, 'old-content'); write(right, rel, 'new-content'); previews(left, rel);
  const original = snapshotPreviews(left, records(left, rel)); const final = records(right, rel);
  assert.equal((await syncPreviewSnapshots(original, snapshotPreviews(right, final), final)).copied, 0);
  const oldFinal = records(left, rel);
  assert.equal((await syncPreviewSnapshots(original, snapshotPreviews(right, final), oldFinal, { conflictKeys: new Set(oldFinal.keys()) })).copied, 0);
});
test('remote preview cache merges by addition; unrelated cache files stay local', async t => {
  const { left, right } = pair(t); const a = 'cache/card-previews/' + 'a'.repeat(64) + '.jpg', b = 'cache/card-previews/' + 'b'.repeat(64) + '.jpg';
  write(left, a, 'synthetic-a'); write(right, b, 'synthetic-b'); write(left, 'cache/account-secret.json', '{}');
  const final = new Map();
  assert.equal((await syncPreviewSnapshots(snapshotPreviews(left, final), snapshotPreviews(right, final), final)).copied, 2);
  assert(fs.existsSync(path.join(left, b))); assert(fs.existsSync(path.join(right, a))); assert(!fs.existsSync(path.join(right, 'cache/account-secret.json')));
});
test('incompatible revision is not imported or overwritten', async t => {
  const { left, right } = pair(t); write(right, 'cache/card-preview-render-revision', 'older-revision');
  write(left, 'cache/card-previews/' + 'a'.repeat(64) + '.jpg', 'synthetic');
  assert.equal((await syncPreviewSnapshots(snapshotPreviews(left, new Map()), snapshotPreviews(right, new Map()), new Map())).copied, 0);
  assert.equal(fs.readFileSync(path.join(right, 'cache/card-preview-render-revision'), 'utf8'), 'older-revision');
});
test('full Library Sync transfers thumbnails for newly copied media in both directions', async t => {
  const { left, right } = pair(t);
  for (const root of [left, right]) write(root, 'library.json', JSON.stringify({ version: 1, created_at: '2026-10-07T00:00:00Z' }));
  const leftRel = 'created/local/a.png', rightRel = 'reference/external/b.mp4';
  write(left, leftRel, 'synthetic-left'); write(right, rightRel, 'synthetic-right'); previews(left, leftRel); previews(right, rightRel);
  const engine = new LibraryBackup({ localRoot: left, externalRoot: right, machineId: 'preview-test' });
  const result = await engine.execute(await engine.analyze('sync'));
  assert.equal(result.previewsCopied, 4);
  for (const [root, rel] of [[right, leftRel], [left, rightRel]]) for (const name of previewPaths(rel, fs.statSync(path.join(root, rel), { bigint: true }))) assert(fs.existsSync(path.join(root, name)));
  const again = await engine.execute(await engine.analyze('sync')); assert.equal(again.previewsCopied, 0);
});
test('deleting media on either computer propagates and cached previews never restore it', async t => {
  for (const deletionSide of ['left', 'right']) {
    const { left, right } = pair(t);
    for (const root of [left, right]) write(root, 'library.json', JSON.stringify({ version: 1, created_at: '2026-10-07T00:00:00Z' }));
    const rel = 'created/deleted/card.png';
    write(left, rel, 'synthetic-delete-test'); previews(left, rel);
    write(left, 'created/retained/keep.png', 'synthetic-retained-item');
    const engine = new LibraryBackup({ localRoot: left, externalRoot: right, machineId: 'deletion-test' });
    await engine.execute(await engine.analyze('sync'));
    const deletedRoot = deletionSide === 'left' ? left : right;
    fs.unlinkSync(path.join(deletedRoot, rel));
    const result = await engine.execute(await engine.analyze('sync'));
    assert.equal(result.previewsCopied, 0);
    assert(!fs.existsSync(path.join(left, rel))); assert(!fs.existsSync(path.join(right, rel)));
    const repeated = await engine.execute(await engine.analyze('sync'));
    assert.equal(repeated.previewsCopied, 0);
    assert(!fs.existsSync(path.join(left, rel))); assert(!fs.existsSync(path.join(right, rel)));
    assert.equal(result.index_invalidated, false);
    assert.equal(result.index_prepared, true);
  }
});
