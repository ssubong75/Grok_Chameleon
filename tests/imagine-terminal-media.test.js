const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../common/app/electron/preload-bridge.js'), 'utf8');
const context = vm.createContext({});
for (const name of ['isTemporaryImageUrl', 'hasFinalStoreMediaEvent', 'isTerminalVideoModerationEvent', 'isTerminalImageModerationEvent', 'isTerminalModerationEvent']) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}
for (const action of ['i2i', 'i2v', 'extend']) {
  const type = action === 'i2i' ? 'image' : 'video';
  const urlKey = `${type}Url`;
  test(`${action}: partial URL -> terminal moderation`, () => {
    const preview = { progress: 50, moderated: false, [urlKey]: 'https://example.invalid/result-part-0' };
    assert.equal(context.hasFinalStoreMediaEvent(preview, type), false);
    const verdict = { progress: 100, moderated: true, [urlKey]: '' };
    assert.equal(context.isTerminalModerationEvent(verdict, type), true);
    assert.equal(context.hasFinalStoreMediaEvent(verdict, type), false);
    assert.equal(context.hasFinalStoreMediaEvent({ ...verdict, [urlKey]: preview[urlKey] }, type), false);
  });
  test(`${action}: provisional moderation -> successful final media`, () => {
    const early = { progress: 10, moderated: true, [urlKey]: 'https://example.invalid/preview' };
    assert.equal(context.isTerminalModerationEvent(early, type), false);
    assert.equal(context.hasFinalStoreMediaEvent(early, type), false);
    const final = { progress: 100, moderated: false, [urlKey]: 'https://example.invalid/final' };
    assert.equal(context.hasFinalStoreMediaEvent(final, type), true);
    for (const progress of [undefined, null, 0, 50, 99, 'bad']) {
      assert.equal(context.hasFinalStoreMediaEvent({ ...final, progress }, type), false);
    }
    assert.equal(context.hasFinalStoreMediaEvent({ ...final, progress: undefined, grokChameleonTerminalResponse: true }, type), true);
  });
}
test('image data URL remains temporary even at 100 percent', () => {
  assert.equal(context.hasFinalStoreMediaEvent({ progress: 100, imageUrl: 'data:image/jpeg;base64,test' }, 'image'), false);
});
