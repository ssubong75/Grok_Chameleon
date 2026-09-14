const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/composer_events.js'), 'utf8');
const start = source.indexOf('async function modifyBuildCardPrompt()');
const end = source.indexOf('\ndocument.getElementById("composer_mod")', start);

function setup() {
  const button = { disabled: false };
  const input = { value: 'New prompt\nSecond line', focus() { this.focused = true; } };
  const post = { source: 'build', folder_path: 'created/card', items: [{ item_id: 'selected' }, { item_id: 'other' }] };
  const requests = [], snapshots = [], errors = [];
  const context = vm.createContext({
    document: { getElementById: id => id === 'composer_mod' ? button : input },
    screen_state: { current_screen: 'b_detail' },
    library_state: { apiReady: true, selectedDetailItemId: 'selected' },
    normalizeNfcText: text => text.normalize('NFC'),
    selectedLibraryPost: () => post,
    mediaItemKey: item => item.item_id,
    qApi: async (url, payload) => { requests.push({ url, ...payload }); return { ok: true }; },
    applyLibrarySnapshot: data => snapshots.push(data),
    showErrorPanel: (...error) => errors.push(error),
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, button, input, post, requests, snapshots, errors, save: () => context.modifyBuildCardPrompt() };
}

test('Mod saves the exact selected item with normalized multiline text', async () => {
  const s = setup();
  s.input.value = '  ' + '수정\n내용'.normalize('NFD') + '  ';
  await s.save();
  assert.deepEqual(s.requests, [{ url: '/api/library/update-item-prompt', post_path: 'created/card', item_id: 'selected', text: '수정\n내용' }]);
  assert.equal(s.snapshots.length, 1);
  assert.equal(s.context.library_state.selectedDetailItemId, 'selected');
  assert.equal(s.context.screen_state.current_screen, 'b_detail');
  assert.equal(s.button.disabled, false);
});

test('empty input is focused without saving', async () => {
  const s = setup();
  s.input.value = '\n  ';
  await s.save();
  assert.equal(s.requests.length, 0);
  assert.equal(s.input.focused, true);
});

test('pending selection never falls back to the first saved image', async () => {
  const s = setup();
  s.context.library_state.selectedDetailItemId = 'pending-job';
  await s.save();
  assert.equal(s.requests.length, 0);
  assert.equal(s.errors.length, 1);
});

test('Mod only accepts local Build targets', async () => {
  for (const change of [
    s => { s.context.screen_state.current_screen = 'i_detail'; },
    s => { s.post.source = 'imagine'; },
    s => { s.post.folder_path = '__pending/job'; },
    s => { s.context.library_state.apiReady = false; },
  ]) {
    const s = setup(); change(s); await s.save();
    assert.equal(s.requests.length, 0);
  }
});

test('duplicate clicks are blocked and navigation during save is retained', async () => {
  const s = setup();
  let finish;
  let requests = 0;
  s.context.qApi = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const pending = s.save();
  assert.equal(s.button.disabled, true);
  await s.save();
  assert.equal(requests, 1);
  s.context.library_state.selectedDetailItemId = 'other';
  s.context.screen_state.current_screen = 'b_main';
  finish({ ok: true });
  await pending;
  assert.equal(s.context.library_state.selectedDetailItemId, 'other');
  assert.equal(s.context.screen_state.current_screen, 'b_main');
  assert.equal(s.button.disabled, false);
});

test('save errors preserve the input and allow retry', async () => {
  const s = setup();
  s.context.qApi = async () => { throw new Error('Disk unavailable'); };
  await s.save();
  assert.equal(s.errors[0][1], 'Disk unavailable');
  assert.equal(s.input.value, 'New prompt\nSecond line');
  assert.equal(s.snapshots.length, 0);
  assert.equal(s.button.disabled, false);
});
