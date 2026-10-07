const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../common/app/web/scripts/detail_media.js', 'utf8');
const start = source.indexOf('function mediaResolutionLabelFromDimensions(');
const context = vm.createContext({ URL, detailItemType: item => item.type, location: { origin: 'http://localhost' } });
vm.runInContext(source.slice(start, source.indexOf('function setDetailMediaAspect(', start)), context);
test('file version, filenames and URLs do not invent a resolution', () => {
  for (const field of ['object_url', 'url', 'remote_url', 'media_url', 'thumbnail_url']) {
    const item = { type: 'video', [field]: '/api/media?path=created/card/480.mp4&v=18db480791ddddea-75e8df' };
    assert.equal(context.mediaResolutionLabelForItem(item, {}), '');
  }
  for (const value of ['18db480791ddddea', '1480123', 'x720abc', '10801234']) assert.equal(context.normalizeMediaResolutionLabel(value), '');
});
test('explicit resolution labels and actual dimensions still work', () => {
  for (const [value, expected] of [['480', '480'], ['720p', '720'], ['1080p', '1080'], ['SD', '480'], ['full HD', '1080'], ['upscale_target_resolution_1080p', '1080']]) {
    assert.equal(context.mediaResolutionLabelForItem({ type: 'video', resolution_name: value }, {}), expected);
  }
  assert.equal(context.mediaResolutionLabelForItem({ type: 'video', width: 1920, height: 1080 }, {}), '1080');
  assert.equal(context.mediaResolutionLabelForItem({ type: 'video', width: 1376, height: 768 }, {}), '768');
});
test('official HD-specific fields preserve labels without parsing URL tokens', () => {
  assert.equal(context.mediaResolutionLabelForItem({ type: 'video', metadata: { hd1080_media_url: 'https://example.test/random' } }, {}), '1080');
  assert.equal(context.mediaResolutionLabelForItem({ type: 'video', metadata: { imagine: { hd_media_url: 'https://example.test/clip480' } } }, {}), '720');
  assert.equal(context.mediaResolutionLabelForItem({ type: 'image', resolution: '480' }, {}), '');
});

test('actual dimensions override inherited metadata and preserve arbitrary short sides', () => {
  for (const [width, height, expected] of [[1376, 768, '768'], [960, 540, '540'], [480, 854, '480'], [1920, 1080, '1080']]) {
    assert.equal(context.mediaResolutionLabelForItem({ type: 'video', _actual_video_dimensions: { width, height } }, { resolution: '480' }), expected);
  }
  assert.equal(context.mediaResolutionLabelForItem({ type: 'video', object_url: '/api/media?path=created/a.mp4' }, { resolution: '480' }), '');
});
test('local dimension reads deduplicate requests and remote videos use actual metadata', async () => {
  let reads = 0;
  context.library_state = { apiReady: true };
  context.qApi = async () => { reads++; return { width: 1376, height: 768 }; };
  const item = { type: 'video', object_url: '/api/media?path=created/test.mp4&v=fixture' };
  const result = await Promise.all([context.readActualVideoDimensions(item), context.readActualVideoDimensions(item)]);
  assert.equal(reads, 1);
  assert.equal(result[0].height, 768);
  context.setTimeout = setTimeout; context.clearTimeout = clearTimeout;
  context.document = { createElement: () => {
    const events = {};
    return { videoWidth: 960, videoHeight: 540, addEventListener(type, handler) { events[type] = handler; }, removeAttribute() {}, load() {}, set src(value) { queueMicrotask(() => events.loadedmetadata()); } };
  } };
  const remote = await context.readActualVideoDimensions({ type: 'video', object_url: 'https://example.test/synthetic.mp4' });
  assert.equal(remote.width, 960); assert.equal(remote.height, 540);
});
