const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../common/app/web/scripts', file), 'utf8');

function harness(failConversation = '') {
  const calls = [];
  const released = [];
  const context = vm.createContext({
    Map, Set,
    imagineDeletePayloadForItem: (post, item) => ({ account_id: 'account', asset_id: item.id, conversation_id: item.conversation }),
    isImagineExternalReferenceItem: (post, item) => !!item.external,
    isImagineLinkSourcePost: () => false,
    imagineLinkCardHasOwnedClone: () => false,
    isImagineConversationDeleteFallbackError: () => false,
    qApi: async (route, payload) => {
      calls.push(payload.conversation_id);
      if (payload.conversation_id === failConversation) throw new Error('HTTP 403');
      return { ok: true };
    },
    deleteImagineCardAssets: async (post, items) => ({ deletedItems: items, failures: [] }),
    releaseImagineGeneratedSavedSyncForDeletedItems: (items) => released.push(...items),
  });
  const source = read('i_detail_actions.js');
  vm.runInContext(source.slice(source.indexOf('async function deleteImagineCardConversation('), source.indexOf('function imagineLinkCardHasOwnedClone(')), context);
  return { context, calls, released };
}

const items = [{ id: 'image', conversation: 'A' }, { id: 'video', conversation: 'A' }, { id: 'edit', conversation: 'B' }];
test('a grouped card deletes all its conversations once', async () => {
  const h = harness();
  const result = await h.context.deleteImagineCardConversation({}, items);
  assert.deepEqual(h.calls, ['A', 'B']);
  assert.equal(result.deletedItems.length, 3);
  assert.equal(result.failures.length, 0);
});

test('failure of one conversation does not mark its items deleted or stop the other conversation', async () => {
  const h = harness('A');
  const result = await h.context.deleteImagineCardConversation({}, items);
  assert.deepEqual(h.calls, ['A', 'B']);
  assert.deepEqual(Array.from(result.deletedItems, (i) => i.id), ['edit']);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(h.released.map((i) => i.id), ['edit']);
});

test('an external original is not deleted as an owned conversation', async () => {
  const h = harness();
  await h.context.deleteImagineCardConversation({}, [...items, { id: 'foreign', conversation: 'foreign-conversation', external: true }]);
  assert.deepEqual(h.calls, ['A', 'B']);
});

test('cached thumbnail restores scaling after temporary video fallback', () => {
  const classes = new Set(['detail_thumb_video_preview']);
  const fill = { isConnected: true, style: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, replaceChildren() {} };
  const source = read('detail_render.js');
  const start = source.indexOf('const showCachedPreview =');
  const end = source.indexOf('const remoteImagineSource', start);
  vm.runInNewContext(source.slice(start, end) + '\nshowCachedPreview("/local-thumbnail.jpg");', { fill });
  assert.equal(classes.has('detail_thumb_preview'), true);
  assert.equal(classes.has('detail_thumb_video_preview'), false);
});

test('confirmed deleted upload result removes only the empty generated card', () => {
  const source = read('i_source_render.js');
  const start = source.indexOf('function removeImagineConfirmedDeletedPendingItems(');
  const end = source.indexOf('function applyImagineConfirmedDeletedPendingAssets(', start);
  const context = vm.createContext({
    imagineSavedItemAssetId: (i) => i.item_id,
    imagineSavedItemIsUploadSource: (i) => i.role === 'source',
    representativeItem: (items) => items.at(-1),
  });
  vm.runInContext(source.slice(start, end), context);
  const upload = { item_id: 'upload', role: 'source' };
  const result = { item_id: 'result' };
  const survivor = { item_id: 'survivor' };
  const posts = [{ items: [upload, result] }, { items: [upload, result, survivor] }, { items: [upload] }];
  const filtered = context.removeImagineConfirmedDeletedPendingItems(posts, new Set(['result']));
  assert.equal(filtered.length, 2);
  assert.deepEqual(Array.from(filtered[0].items, (i) => i.item_id), ['upload', 'survivor']);
  assert.equal(filtered[1], posts[2]);
});
