// Run with: node tests/sync-index-roundtrip.cjs /absolute/path/to/python
// The actual sync engine runs exclusively against a freshly-created temporary tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const appRoot = process.env.SYNC_TEST_APP_ROOT;
if (!appRoot) throw new Error('SYNC_TEST_APP_ROOT must point to the complete assembled app runtime.');
const { LibraryBackup } = require(path.join(appRoot, 'electron/library-backup'));
const { previewPaths } = require(path.join(appRoot, 'electron/preview-sync'));

async function main() {
  const python = path.resolve(process.argv[2]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-sync-roundtrip-'));
  const local = path.join(temporary, 'mac');
  const external = path.join(temporary, 'usb');
  const env = { ...process.env,
    GROK_CHAMELEON_RUNTIME_DIR: path.join(temporary, 'runtime'),
    GROK_CHAMELEON_PORTABLE_ROOT: temporary,
    GROK_CHAMELEON_LIBRARY_POINTER_PATH: path.join(temporary, '.library_path.json'),
    GROK_CHAMELEON_PLATFORM_KEY: 'macos', PYTHONDONTWRITEBYTECODE: '1',
  };
  const put = (root, relative, data) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };
  try {
    fs.mkdirSync(external);
    put(local, 'library.json', JSON.stringify({ version: 1, library_id: 'test-sync-index' }));
    for (const name of ['keep', 'delete']) {
      put(local, `collection/test/${name}/post.json`, JSON.stringify({ title: name, source: 'build' }));
      put(local, `collection/test/${name}/image.jpg`, 'synthetic-image');
    }
    const relative = 'collection/test/keep/image.jpg';
    const previews = previewPaths(relative, fs.statSync(path.join(local, relative), { bigint: true }));
    put(local, 'cache/card-preview-render-revision', 'card-640-v1');
    for (const preview of previews) put(local, preview, 'synthetic-preview');
    const engine = new LibraryBackup({ localRoot: local, externalRoot: external,
      machineId: 'test-mac', pythonPath: python, pythonEnv: env });
    let result = await engine.execute(await engine.analyze('sync'));
    assert.equal(result.index_prepared, true);
    assert.equal(result.index_invalidated, false);
    assert.ok(result.previewsCopied >= 2);
    const check = (root, count) => {
      execFileSync(python, ['-B', '-c',
        'import sys; sys.path.insert(0,sys.argv[1]); import library_index; from pathlib import Path; r=Path(sys.argv[2]); assert library_index.ready(r); assert len(library_index.all_posts(r)) == int(sys.argv[3])',
        path.join(appRoot, 'runtime'), root, String(count)], { env });
      assert.equal(fs.existsSync(path.join(root, 'sql_data/.library-index-rebuild.json')), false);
    };
    check(local, 2); check(external, 2);
    const next = await engine.analyze('sync');
    assert.equal(next.summary.total, 0, 'Index preparation must not modify synced originals');
    // Work directly on USB, then sync back to the original machine.
    fs.rmSync(path.join(external, 'collection/test/delete'), { recursive: true });
    put(external, 'collection/test/keep/post.json', JSON.stringify({ title: 'USB edit', source: 'build' }));
    result = await engine.execute(await engine.analyze('sync'));
    assert.equal(result.index_prepared, true);
    check(local, 1); check(external, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(local, 'collection/test/keep/post.json'))).title, 'USB edit');
    assert.equal((await engine.analyze('sync')).summary.total, 0);
    // A failed preparation must leave both indexes invalid, never falsely report ready.
    const broken = new LibraryBackup({ localRoot: local, externalRoot: external,
      machineId: 'test-mac', pythonPath: path.join(temporary, 'missing-python'), pythonEnv: env });
    await assert.rejects(() => broken.executeSync(next));
    for (const root of [local, external]) assert.ok(fs.existsSync(path.join(root, 'sql_data/.library-index-rebuild.json')));
    console.log('PASS: sync roundtrip, preview copy, deletion, ready indexes, no manifest drift, failure markers');
  } finally {
    // Only the literal directory returned by mkdtemp is eligible for cleanup.
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('grok-sync-roundtrip-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
