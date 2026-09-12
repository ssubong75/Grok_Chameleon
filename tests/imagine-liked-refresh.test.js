const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/i_source_render.js'), 'utf8');
const code = source.slice(source.indexOf('async function loadImagineLikedCards('),
  source.indexOf('async function loadImagineSavedCacheCards('));
const post = (...ids) => ({ items: ids.map(item_id => ({ item_id })) });

function loader({ cached = [post('video')], live = { posts: [post('image', 'video')], complete: true },
  loaded = false, existing = [], current = true } = {}) {
  const requests = [];
  let detailsRendered = 0;
  const state = { imagineLikedPosts: existing, imagineLikedLoaded: loaded };
  const context = vm.createContext({
    library_state: state, screen_state: { current_screen: 'i_detail' }, console,
    canLoadImagineSavedList: () => true,
    imaginePendingSavedAccountId: () => 'account',
    imagineAccountResponseIsCurrent: () => current,
    renderImagineSourceCards: () => {},
    applyImagineLikedExclusionSnapshot: () => {}, normalizeServerPost: p => p,
    reconcileImagineLikedLineagePosts: posts => posts,
    mergeImagineSyncedPosts: (old, fresh, options) => options.replacesList ? fresh : [...old, ...fresh],
    syncImagineRemotePostsIntoLibrary: () => {},
    renderDetailViews: () => { detailsRendered++; },
    removeImagineConfirmedDeletedPendingItems: (posts, deleted) => posts.map(p => ({
      ...p, items: p.items.filter(i => !deleted.has(i.item_id)),
    })).filter(p => p.items.length),
    qApi: async endpoint => {
      requests.push(endpoint);
      if (endpoint.endsWith('/cache')) return { posts: cached };
      if (live instanceof Error) throw live;
      return live;
    },
  });
  vm.runInContext(code, context);
  return { load: options => context.loadImagineLikedCards(options), state, requests,
    detailsRendered: () => detailsRendered };
}

test('startup displays cache, then reads official state and refreshes open detail', async () => {
  const run = loader();
  await run.load({ force: false });
  assert.deepEqual(run.requests, ['/api/imagine/liked/cache', '/api/imagine/liked']);
  assert.deepEqual(Array.from(run.state.imagineLikedPosts[0].items, i => i.item_id), ['image', 'video']);
  assert.equal(run.detailsRendered(), 1);
});

test('explicit refresh revalidates a previously loaded list', async () => {
  const run = loader({ loaded: true, existing: [post('video')] });
  await run.load({ force: true });
  assert.deepEqual(run.requests, ['/api/imagine/liked']);
  assert.deepEqual(Array.from(run.state.imagineLikedPosts[0].items, i => i.item_id), ['image', 'video']);
});

test('network failure preserves existing media and reports failure', async () => {
  const previous = [post('image', 'video')];
  const run = loader({ existing: previous, live: new Error('offline') });
  await run.load({ force: true });
  assert.equal(run.state.imagineLikedPosts, previous);
  assert.equal(run.state.imagineLikedError, 'offline');
});

test('partial detail failure is visible and only explicit deleted ids leave the old list', async () => {
  const run = loader({ existing: [post('image', 'deleted', 'video')], live: {
    posts: [], complete: false, errors: [{ error: 'timeout' }], confirmed_deleted_asset_ids: ['deleted'],
  } });
  await run.load({ force: true });
  assert.deepEqual(Array.from(run.state.imagineLikedPosts[0].items, i => i.item_id), ['image', 'video']);
  assert.match(run.state.imagineLikedError, /could not be verified/);
});

test('an old account response cannot replace the current account', async () => {
  const previous = [post('current-account-image')];
  const run = loader({ existing: previous, current: false });
  await run.load({ force: true });
  assert.equal(run.state.imagineLikedPosts, previous);
  assert.equal(run.detailsRendered(), 0);
});
