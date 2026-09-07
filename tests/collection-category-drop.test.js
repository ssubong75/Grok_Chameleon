const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/collection_render.js'), 'utf8');
function setup(fail = false) {
  const calls = [], snapshots = [];
  const post = { folder_path: 'collection/a/item' };
  const state = { apiReady: true, collections: [
    { path: 'collection/a', posts: [post] }, { path: 'collection/b', posts: [] },
  ], selectedItems: new Set([post.folder_path]) };
  const context = vm.createContext({
    library_state: state, collectionDirectPosts: c => c.posts,
    qApi: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      if (fail) throw Error('move failed');
      return { selected_path: 'collection/b/item' };
    },
    applyLibrarySnapshot: data => snapshots.push(data),
    collectionSortModeFor: () => '', replaceCurrentBrowserHistoryState() {},
    renderCollectionFolders() {}, toast() {}, setLibraryMessage() {},
  });
  vm.runInContext('let collectionCategoryMovePending = false; let collectionFolderGridStablePosts = [];\n'
    + source.match(/  async function moveCollectionCardToCategory\([^]*?\n  }/)[0], context);
  return { context, state, calls, snapshots };
}
test('drop moves whole card through existing endpoint and retires old path', async () => {
  const env = setup();
  await env.context.moveCollectionCardToCategory('collection/a/item', 'collection/b');
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].endpoint, '/api/collection/move-post');
  assert.equal(env.calls[0].payload.collection_path, 'collection/b');
  assert.equal(env.calls[0].payload.target_parent_path, '');
  assert.equal(env.snapshots[0].deleted_paths[0], 'collection/a/item');
  assert.equal(env.state.selectedCollectionPath, 'collection/b');
});
test('same category and foreign paths do not issue moves', async () => {
  const env = setup();
  await env.context.moveCollectionCardToCategory('collection/a/item', 'collection/a');
  await env.context.moveCollectionCardToCategory('created/other', 'collection/b');
  await env.context.moveCollectionCardToCategory('collection/a/item', 'collection/missing');
  assert.equal(env.calls.length, 0);
});
test('failed move retains source and releases request guard', async () => {
  const env = setup(true);
  for (let i = 0; i < 2; i++) {
    await assert.rejects(env.context.moveCollectionCardToCategory('collection/a/item', 'collection/b'));
  }
  assert.equal(env.calls.length, 2);
  assert.equal(env.snapshots.length, 0);
  assert.equal(env.state.selectedItems.has('collection/a/item'), true);
});
