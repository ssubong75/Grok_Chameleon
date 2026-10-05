const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/i_composer_submit.js'), 'utf8');
function contextFor(outcome) {
  let reads = 0, timer;
  const context = vm.createContext({
    composerMediaKind: a => a.type,
    window: { setTimeout: callback => { timer = callback; return 1; }, clearTimeout() {} },
    Image: class {
      set src(value) {
        reads++;
        if (outcome === 'success') {
          this.naturalWidth = 1920; this.naturalHeight = 1080;
          queueMicrotask(() => this.onload());
        } else if (outcome === 'error') queueMicrotask(() => this.onerror());
      }
    },
  });
  for (const name of ['imagineImageAspectFromAttachment', 'imagineAttachmentsWithMeasuredImageAspects', 'imagineReducedImageAspect']) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return { context, reads: () => reads, timeout: () => timer() };
}
for (const outcome of ['success', 'error', 'timeout']) {
  test(`measured aspect reuse and fallback: ${outcome}`, async () => {
    const env = contextFor(outcome);
    const pending = env.context.imagineAttachmentsWithMeasuredImageAspects([
      { type: 'image', data_url: 'test', aspect_ratio: '900 / 1600' },
    ]);
    if (outcome === 'timeout') env.timeout();
    const [attachment] = await pending;
    assert.equal(attachment.aspect_ratio, outcome === 'success' ? '1920 / 1080' : '900 / 1600');
    assert.equal(env.context.imagineReducedImageAspect(attachment), outcome === 'success' ? '16:9' : '9:16');
    assert.equal(env.reads(), 1);
  });
}
test('submission measures and sets preview before creating Preparing card', () => {
  const submit = source.slice(source.indexOf('async function submitImagineComposer('));
  const measured = submit.indexOf('await imagineAttachmentsWithMeasuredImageAspects(attachments)');
  const preview = submit.indexOf('preview.aspect_ratio = requestOptions.aspect_ratio');
  const pending = submit.indexOf('pendingJob = createPendingImagineJob(');
  assert.ok(measured >= 0 && preview > measured && pending > preview);
  assert.ok(!submit.includes('new Image()'), 'no second image decode in submission');
});
