const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const scripts = path.join(__dirname, '../common/app/web/scripts');
function extract(file, name, indent) {
  const source = fs.readFileSync(path.join(scripts, file), 'utf8');
  const match = source.match(new RegExp(`${indent}(?:async )?function ${name}\\([^]*?\\n${indent}}`));
  assert.ok(match, name);
  return match[0];
}

test('image dimensions: landscape, portrait and failed decode', async () => {
  for (const [width, height] of [[1920, 1080], [900, 1600], [0, 0]]) {
    const context = vm.createContext({ window: { setTimeout, clearTimeout }, Image: class {
      set src(value) {
        this.naturalWidth = width; this.naturalHeight = height;
        queueMicrotask(() => width ? this.onload() : this.onerror());
      }
    } });
    vm.runInContext(extract('composer_attachments.js', 'readComposerImageDimensions', '    '), context);
    const value = await context.readComposerImageDimensions('data:image/png;base64,test');
    assert.equal(value.aspect_ratio || '', width ? `${width}:${height}` : '');
  }
});

test('preview fallback only changes an attached Auto Build preview', () => {
  for (const scenario of ['auto', 'explicit', 'known-auto', 'detached', 'imagine']) {
    const calls = [];
    const image = { naturalWidth: 1600, naturalHeight: 900, complete: true, addEventListener() {} };
    const media = { querySelector: () => image, contains: () => scenario !== 'detached', classList: { contains: () => true } };
    const job = { context: {
      provider: scenario === 'imagine' ? 'imagine' : 'build',
      display_aspect_auto: scenario !== 'explicit',
      aspect_ratio: ['explicit', 'known-auto'].includes(scenario) ? '1:1' : '',
    } };
    const context = vm.createContext({
      generationJobProvider: j => j.context.provider, detailAspectFromValue: v => v,
      setDetailMediaAspect: (prefix, aspect) => calls.push(aspect),
    });
    vm.runInContext(extract('build_main.js', 'bindBuildAutoPreviewAspect', '  '), context);
    context.bindBuildAutoPreviewAspect('b', media, job);
    assert.deepEqual(calls, scenario === 'auto' ? ['1600 / 900'] : [], scenario);
  }
});
