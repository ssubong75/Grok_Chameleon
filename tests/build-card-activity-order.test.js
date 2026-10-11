const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runtime() {
  const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/state.js'), 'utf8');
  const start = source.indexOf('  function mainGenerationActivityKey(');
  const end = source.indexOf('  const account_state =', start);
  assert.ok(start >= 0 && end > start);
  const state = { mainGenerationActivity: { build: [], imagine: [] } };
  const context = vm.createContext({ library_state: state });
  vm.runInContext(source.slice(start, end), context);
  return { state, context, render(entries) {
    context.entries = entries;
    return Array.from(vm.runInContext('orderedMainGenerationCards("build", entries)', context));
  }, promote(id) {
    context.id = id;
    vm.runInContext('noteMainGenerationActivity("build", "post", id)', context);
  }};
}
const card = id => ({ key: 'post:' + id, cards: [id] });
test('Build generation priority survives a temporarily empty index and filtered page', () => {
  const app = runtime();
  app.promote('generated');
  assert.deepEqual(app.render([]), []);
  assert.deepEqual(app.render([card('older')]), ['older']);
  assert.deepEqual(app.render([card('older'), card('generated')]), ['generated', 'older']);
  app.promote('extended');
  assert.deepEqual(app.render([card('older'), card('generated'), card('extended')]), ['extended', 'generated', 'older']);
});
test('Unpromoted cards retain their original order and explicit removal still works', () => {
  const app = runtime();
  const entries = [card('first'), card('second'), card('third')];
  assert.deepEqual(app.render(entries), ['first', 'second', 'third']);
  app.promote('third');
  assert.deepEqual(app.render(entries), ['third', 'first', 'second']);
  vm.runInContext('forgetMainGenerationActivity("build", "post", "third")', app.context);
  assert.deepEqual(app.render(entries), ['first', 'second', 'third']);
});
