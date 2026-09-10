const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/i_source_render.js'), 'utf8');
const code = source.slice(source.indexOf('function reconcileImagineLikedLineagePosts('), source.indexOf('function reconcileImagineSavedDisplayPosts('));
const card = (anchor, id, parent = '', provenance = 'cloned-liked') => ({
  post_id: anchor, metadata: { saved_anchor_id: anchor, saved_provenance: provenance },
  items: [{ item_id: id, source_item_id: parent }],
});
function run(posts) {
  const context = vm.createContext({
    posts, normalizeServerPost: (post) => post,
    imagineSavedPostProvenance: (post) => post.metadata.saved_provenance,
    imagineSavedCardAnchor: (post) => post.metadata.saved_anchor_id,
    imagineSavedItemAssetId: (item) => item.item_id,
    imagineSavedItemSourceIds: (item) => item.source_item_id ? [item.source_item_id] : [],
    representativeItem: (items) => items[0],
  });
  return vm.runInContext(code + '\nreconcileImagineLikedLineagePosts(posts)', context, { timeout: 1000 });
}
test('cyclic Liked references terminate; parents, siblings and children join', () => {
  const result = run([card('a', 'image', 'video'), card('b', 'video', 'image'),
    card('c', 'sibling', 'image'), card('d', 'extend', 'video'),
    card('normal', 'normal', '', 'normal-saved')]);
  assert.equal(result.length, 2);
  assert.deepEqual(Array.from(result[0].items, i => i.item_id).sort(), ['extend', 'image', 'sibling', 'video']);
  assert.equal(result[1].metadata.saved_provenance, 'normal-saved');
});
test('same conversation or missing shared foreign original is not a merge edge', () => {
  const posts = [card('a', 'copy-a', 'foreign'), card('b', 'copy-b', 'foreign')];
  posts.forEach(post => post.metadata.conversation_id = 'same');
  assert.equal(run(posts).length, 2);
});
