const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/prompt_account.js'), 'utf8');
function setup() {
  const state = Object.fromEntries(['build', 'imagine'].map(p => [p, {
    active_id: `${p}1`, accounts: [1, 2].map(n => ({ id: `${p}${n}`, email: `user${n}@test.invalid` })),
  }]));
  const changes = [], notices = [];
  const c = vm.createContext({ account_state: state, library_state: { apiReady: true },
    qApi: async (url, { id }) => { await Promise.resolve(); return { p: url.includes('/imagine/') ? 'imagine' : 'build', id }; },
    applyAccountSnapshot: data => { state[data.p].active_id = data.id; },
    isDeniedBuildAccount: a => a.status === 'oauth_error', sortAccountCardsByPriority() {},
    clearImagineAccountScopedCache: id => changes.push(id), activateImagineAccountTab() {},
    setComposerProvider() {}, renderAccounts() {}, toast: s => notices.push(s), persistAccountFiles: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf('  let imagineSelectionQueue'), source.indexOf('  async function deleteAccount(')), c);
  return { c, state, changes, notices };
}
for (const p of ['build', 'imagine']) test(`${p} selection updates both and cache`, async () => {
  const { c, state, changes } = setup();
  await c.selectAccount(p, `${p}2`);
  assert.equal(state.build.active_id, 'build2');
  assert.equal(state.imagine.active_id, 'imagine2');
  assert.deepEqual(changes, ['imagine2']);
});
test('already-selected account repairs mismatched peer', async () => {
  const { c, state } = setup(); state.build.active_id = 'build2';
  await c.selectAccount('build', 'build2');
  assert.equal(state.imagine.active_id, 'imagine2');
});
test('rapid mixed-provider selection is ordered', async () => {
  const { c, state } = setup();
  await Promise.all([c.selectAccount('build', 'build2'), c.selectAccount('imagine', 'imagine1')]);
  assert.equal(state.build.active_id, 'build1'); assert.equal(state.imagine.active_id, 'imagine1');
});
for (const reason of ['missing', 'ambiguous', 'denied']) test(`unusable peer: ${reason}`, async () => {
  const { c, state, notices } = setup();
  if (reason === 'missing') state.build.accounts.pop();
  if (reason === 'ambiguous') state.build.accounts.push({ id: 'duplicate', email: 'user2@test.invalid' });
  if (reason === 'denied') state.build.accounts[1].status = 'oauth_error';
  await c.selectAccount('imagine', 'imagine2');
  assert.equal(state.build.active_id, 'build1'); assert.equal(state.imagine.active_id, 'imagine2');
  assert.equal(notices.length, 1);
});
