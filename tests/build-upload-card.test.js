const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scripts = path.join(__dirname, '../common/app/web/scripts');
function setup(indexed = true) {
  const upload = { area: 'upload', folder_path: 'upload/source', items: [{}] };
  const result = { area: 'created', source: 'build', folder_path: 'created/result', items: [{}] };
  const state = {
    libraryIndexEnabled: indexed, indexedBuildKey: 'scope',
    indexedBuildPosts: [upload, result], posts: [upload, result], jobs: [],
  };
  const context = vm.createContext({
    library_state: state, indexedBuildQueryKey: () => 'scope',
    isSessionBuildT2iPost: () => false, comparePostsByRecentActivity: () => 0,
    bDetailMediaUrl: () => 'media',
    bindVirtualCardListScroll: () => {},
    document: { querySelector: () => null },
  });
  const main = fs.readFileSync(path.join(scripts, 'build_main.js'), 'utf8');
  for (const name of ['buildJobStatus', 'generationJobProvider', 'generationJobSourcePostPath', 'generationJobMatchesPost', 'buildMainPostVisible']) {
    const body = main.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
    assert.ok(body, name);
    vm.runInContext(body[0], context);
  }
  vm.runInContext(fs.readFileSync(path.join(scripts, 'b_source_render.js'), 'utf8'), context);
  return { state, upload, cards: () => Array.from(context.buildSourcePosts(), p => p.folder_path) };
}

for (const indexed of [true, false]) {
  test(`upload visibility follows jobs, indexed=${indexed}`, () => {
    const { state, upload, cards } = setup(indexed);
    const job = status => ({ status, context: { provider: 'build', source_post_path: upload.folder_path } });
    for (const status of ['running', 'failed', 'moderated']) {
      state.jobs = [job(status)];
      assert.equal(cards().length, 2, status);
    }
    for (const status of ['done', 'cancelled', 'canceled']) {
      state.jobs = [job(status)];
      assert.deepEqual(cards(), ['created/result'], status);
    }
    state.jobs = [job('done'), job('running')];
    assert.equal(cards().length, 2, 'concurrent job keeps source');
    state.jobs = [];
    assert.deepEqual(cards(), ['created/result'], 'stale cached source is hidden');
    assert.equal(state.indexedBuildPosts.length, 2, 'no source data is deleted');
    upload.build_job_failed = true;
    assert.equal(cards().length, 2, 'persisted failure remains after restart');
  });
}
