const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '../common/app/web/scripts', file), 'utf8');

function harness(api = async () => ({})) {
  const state = { rootPath: '/test-library', apiReady: true, posts: [], iMainView: 'liked' };
  const screen = { current_screen: 'i_main', detail_back: { imagine: { screenId: 'i_main' } } };
  const context = vm.createContext({
    library_state: state, screen_state: screen, document: { querySelector: () => null },
    bindVirtualCardListScroll() {}, normalizeServerPost: (post) => post,
    comparePostsByRecentActivity: () => 0, imagineViewValue: (_, fallback) => fallback,
    toast() {}, qApi: api,
  });
  vm.runInContext(read('reference.js'), context);
  return { context, state, screen };
}

const card = { post_id: 'card', source: 'imagine', remote: true, area: 'imagine_remote',
  folder_path: 'imagine_saved/card', items: [{ item_id: 'one' }, { item_id: 'two' }] };
const local = { post_id: 'card', area: 'reference', folder_path: '레퍼런스/card', items: card.items };

test('Reference is not populated until save response returns a local card', async () => {
  let finish;
  let payload;
  const h = harness((route, body) => { payload = body; return new Promise((resolve) => { finish = resolve; }); });
  h.state.posts = [card];
  const pending = h.context.saveLikedCardsToReference([card]);
  await Promise.resolve();
  assert.equal(h.state.posts.length, 1);
  assert.equal(payload.source_post.items.length, 2);
  finish({ post: local });
  await pending;
  assert.equal(h.state.posts[0], card);
  assert.equal(h.state.posts[1], local);
});

test('late list response cannot erase a saved card', async () => {
  let finishList;
  const h = harness((route) => route.endsWith('/list')
    ? new Promise((resolve) => { finishList = resolve; }) : Promise.resolve({ post: local }));
  const loading = h.context.loadReferenceCards();
  await h.context.saveLikedCardsToReference([card]);
  finishList({ posts: [] });
  await loading;
  assert.equal(h.state.posts[0], local);
});

test('two saves run in order and failure does not block the next card', async () => {
  let rejectFirst;
  const calls = [];
  const h = harness((route, payload) => {
    calls.push(payload.source_post.post_id);
    return calls.length === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve({ post: local });
  });
  const first = h.context.saveLikedCardsToReference([card]);
  const rejected = assert.rejects(first, /failed/);
  const second = h.context.saveLikedCardsToReference([{ ...card, post_id: 'second' }]);
  await Promise.resolve();
  assert.deepEqual(calls, ['card']);
  rejectFirst(new Error('failed'));
  await rejected;
  await second;
  assert.deepEqual(calls, ['card', 'second']);
});

test('Liked card, bulk and detail entry points save whole cards; Imagine and Discover keep Collection routing', () => {
  const h = harness();
  const moved = [];
  h.context.closeMoveToCollectionDialog = () => {};
  h.context.moveDialogPost = () => card;
  h.context.saveLikedCardsToReference = (posts) => { moved.push(posts); return Promise.resolve(); };
  const code = read('collection_actions.js');
  const start = code.indexOf('  function openMoveToCollectionDialog(');
  const end = code.indexOf('    let selectedPrimaryPath', start);
  vm.runInContext(code.slice(start, end) + '\n return "collection";\n}', h.context);
  const run = h.context.openMoveToCollectionDialog;
  run({ postObject: card });
  run({ postObjects: [card, { ...card, folder_path: 'imagine_saved/second' }] });
  h.screen.current_screen = 'i_detail';
  run({ postObject: card, itemKey: 'one' });
  assert.equal(moved.length, 3);
  assert.equal(moved[1].length, 2);
  assert.equal(moved[2][0].items.length, 2);
  h.state.iMainView = 'imagine';
  assert.equal(run({ postObject: card }), 'collection');
  h.state.iMainView = 'liked';
  h.screen.current_screen = 'i_discover_main';
  assert.equal(run({ postObject: card }), 'collection');
});

test('Reference main and its local detail use Build and local media', () => {
  const h = harness();
  vm.runInContext(read('composer_provider.js'), h.context);
  vm.runInContext(read('b_detail_media.js'), h.context);
  assert.equal(h.context.providerForScreen('reference_main', 'reference_nav_btn'), 'build');
  assert.equal(h.context.providerForScreen('b_detail', 'reference_nav_btn'), 'build');
  assert.equal(h.context.bDetailMediaUrl({ object_url: '/media/local.png', media_url: 'https://example.test/remote.png' }), '/media/local.png');
});
