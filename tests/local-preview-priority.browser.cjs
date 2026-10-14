// Synthetic HTTP media only. Never opens the user's library or official Grok APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const scripts = path.join(__dirname, '../common/app/web/scripts');
const read = name => fs.readFileSync(path.join(scripts, name), 'utf8');
const waitUntil = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'timed out waiting for synthetic server requests');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const core = read('library_core.js');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>';
let records, misses, delay, thumbnailDelay, videoDelay, aborted, active, maximum;
const reset = () => {
  records = []; misses = new Set(); delay = 0; thumbnailDelay = 0; videoDelay = 0;
  aborted = 0; active = 0; maximum = 0;
};
reset();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.end('<style>.card_list{height:300px;overflow:auto}.card{display:inline-block;width:80px;height:70px}.card_preview{width:70px;height:60px}.b_detail_thumb,.i_detail_thumb{width:50px;height:50px}.b_detail_thumb_fill,.i_detail_thumb_fill{display:block;width:45px;height:45px;background-size:cover}</style><section id="main"><div class="card_list"></div></section><section id="detail" hidden><div id="thumbs"></div></section>');
    return;
  }
  const kind = url.searchParams.get('kind');
  records.push({ url: req.url, method: req.method, kind });
  const video = url.pathname === '/api/media' && /\.mp4$/.test(url.searchParams.get('path') || '');
  const slow = video ? videoDelay
    : url.pathname === '/api/build-preview' ? (kind === 'card' ? delay : thumbnailDelay) : 0;
  if (kind === 'card') { active++; maximum = Math.max(maximum, active); }
  res.on('close', () => {
    if (kind === 'card') active--;
    if (!res.writableFinished) aborted++;
  });
  const send = () => {
    if (res.destroyed) return;
    res.writeHead(misses.has(req.url) ? 404 : 200, { 'Content-Type': 'image/svg+xml' });
    res.end(req.method === 'HEAD' ? '' : svg);
  };
  if (slow) setTimeout(send, slow).unref();
  else send();
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const setup = async () => {
      reset();
      const page = await browser.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.addScriptTag({ content: core.slice(core.indexOf('  function mediaItemKey(')) });
      for (const name of ['detail_media.js', 'b_detail_media.js', 'i_detail_media.js', 'card_render.js', 'detail_render.js']) {
        await page.addScriptTag({ content: read(name) });
      }
      await page.evaluate(() => {
        window.library_state = { apiReady: true, bMainView: 'all' };
        window.mediaTypeForName = name => /\.mp4/.test(name) ? 'video' : 'image';
        window.nativeCalls = [];
        window.grokChameleonNative = { cardPreview: async payload => {
          nativeCalls.push(payload);
          return { url: '/generated.svg' };
        } };
        window.itemFor = (id, area = 'created', type = 'image') => ({
          item_id: id, type, object_url: `/api/media?path=${area}/${id}.${type === 'video' ? 'mp4' : 'png'}&v=1234-20`,
        });
        window.addCards = (count, area = 'created', type = 'image') => {
          for (let index = 0; index < count; index++) {
            const card = document.createElement('article'); card.className = 'card b_card';
            const media = document.createElement('div'); media.className = 'card_media';
            card.append(media); document.querySelector('.card_list').append(card);
            const item = cardDisplayItemForContext({}, itemFor(`${area}-${index}`, area, type), 'b_card');
            appendMediaPreview(card, media, item, type);
            media.querySelector('img').cardPreviewLoad();
          }
        };
        window.addThumbs = (prefix = 'b', count = 8, activeIndex = 5, type = 'image') => {
          const thumbs = Array.from({ length: count }, (_, index) =>
            detailThumbButtonForItem(prefix, itemFor(`detail-${index}`, 'created', type), {}, { active: index === activeIndex }));
          document.getElementById('thumbs').append(...thumbs);
          startDetailThumbCacheLoads(thumbs);
        };
        window.revoked = [];
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
      });
      return page;
    };

    // Images, first-frame video caches, Reference and Collection all use one GET.
    let page = await setup();
    await page.evaluate(() => {
      addCards(2); addCards(2, 'reference'); addCards(2, 'collection', 'video');
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.card_preview')].every(img => img.naturalWidth > 0));
    assert.equal(records.filter(r => r.kind === 'card').length, 6);
    assert.equal(records.filter(r => r.method === 'HEAD').length, 0);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    assert(maximum <= 3);
    await page.evaluate(() => {
      for (const card of document.querySelectorAll('.card')) { disposeCardPreviewNode(card); card.remove(); }
    });
    assert.equal(await page.evaluate(() => revoked.length), 6);
    await page.close();
    console.log('PASS: local image/video caches, bounded reads, object URL disposal');

    // A slow grid cannot occupy detail's slots; hidden grid requests are aborted.
    page = await setup(); delay = 2000;
    await page.evaluate(() => addCards(30));
    await page.waitForFunction(() => fastLocalPreviewActive.card === 3);
    await waitUntil(() => records.filter(r => r.kind === 'card').length >= 3);
    const selectedUrl = await page.evaluate(() => deterministicBuildCardPreviewUrl(itemFor('detail-5').object_url, 'thumbnail'));
    const started = Date.now();
    await page.evaluate(() => {
      addThumbs();
      document.getElementById('main').hidden = true;
      document.getElementById('detail').hidden = false;
      syncFastLocalPreviewVisibility();
    });
    await page.waitForFunction(() => document.querySelector('.b_detail_thumb.active span').style.backgroundImage.includes('blob:'));
    assert(Date.now() - started < 1500, 'detail waited for slow grid requests');
    assert.equal(records.find(r => r.kind === 'thumbnail').url, selectedUrl);
    await page.waitForFunction(() => fastLocalPreviewActive.card === 0);
    assert.equal(records.filter(r => r.kind === 'card').length, 3, 'hidden queued cards started');
    assert(aborted >= 3);
    delay = 0;
    await page.evaluate(() => {
      document.getElementById('detail').hidden = true;
      document.getElementById('main').hidden = false;
      syncFastLocalPreviewVisibility();
    });
    await page.waitForFunction(() => document.querySelector('.card_preview').naturalWidth > 0);
    await page.close();
    console.log('PASS: selected detail first, grid abort, returning to grid resumes');

    // Disposing cards before hashing/fetching must not generate or read their files.
    page = await setup();
    await page.evaluate(() => {
      addCards(20);
      for (const card of document.querySelectorAll('.card')) { disposeCardPreviewNode(card); card.remove(); }
    });
    await page.waitForFunction(() => fastLocalPreviewActive.card === 0 && fastLocalPreviewQueue.length === 0);
    assert.equal(records.filter(r => r.kind === 'card').length, 0);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.close();
    console.log('PASS: fast-scroll disposal cancels queued and hashing requests');

    // Mounted overscan is not permission to keep obsolete reads alive. Visible cards
    // must jump ahead of the old queue, then cancelled cards must work on return.
    page = await setup(); delay = 2500;
    await page.evaluate(() => {
      document.querySelector('.card_list').style.cssText = 'width:450px;height:160px;overflow:auto';
      addCards(120);
    });
    await waitUntil(() => records.filter(r => r.kind === 'card').length === 3);
    delay = 0;
    const scrollStarted = Date.now();
    await page.evaluate(() => { document.querySelector('.card_list').scrollTop = 1100; });
    await page.waitForFunction(() => [...fastLocalPreviewBindings.keys()]
      .filter(img => localCardPreviewDistance(img) === 0)
      .every(img => img.naturalWidth > 0 && img.classList.contains('card_preview_loaded')));
    assert(Date.now() - scrollStarted < 1500, 'visible cards waited for obsolete reads');
    assert(aborted >= 3, 'mounted offscreen reads were not aborted');
    const visibleUrls = await page.evaluate(async () => Promise.all([...fastLocalPreviewBindings.keys()]
      .filter(img => localCardPreviewDistance(img) === 0)
      .map(img => deterministicBuildCardPreviewUrl(itemFor(`created-${[...document.querySelectorAll('.card_preview')].indexOf(img)}`).object_url))));
    assert(records.filter(r => r.kind === 'card').slice(3, 6).every(r => visibleUrls.includes(r.url)),
      'overscan requests ran before visible posters');
    await page.evaluate(() => { document.querySelector('.card_list').scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('.card_preview').naturalWidth > 0);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.close();
    console.log('PASS: mounted offscreen reads abort, visible priority, scroll-back resumes');

    // Five quick wheel bursts must not start an MP4 for every card under the cursor.
    page = await setup(); videoDelay = 3000;
    await page.evaluate(() => {
      document.querySelector('.card_list').style.cssText = 'width:450px;height:160px;overflow:auto';
      addCards(60, 'collection', 'video');
    });
    await page.waitForFunction(() => [...fastLocalPreviewBindings.keys()]
      .filter(img => localCardPreviewDistance(img) === 0).every(img => img.naturalWidth > 0));
    await page.mouse.move(40, 50);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(30);
      assert.equal(await page.locator('video').count(), 0, 'transient hover started a video during scrolling');
    }
    // Deliberate hover after the wheel burst (some Chromium builds defer hit-testing
    // under a stationary cursor until the next pointer move).
    await page.waitForTimeout(230);
    await page.mouse.move(700, 500);
    await page.mouse.move(41, 51);
    await waitUntil(() => records.some(r => r.url.startsWith('/api/media?')));
    assert.equal(await page.locator('video').count(), 1);
    assert.equal(records.filter(r => r.url.startsWith('/api/media?')).length, 1);
    const beforeLeave = aborted;
    await page.mouse.move(700, 500);
    await page.waitForFunction(() => document.querySelectorAll('video').length === 0);
    await waitUntil(() => aborted > beforeLeave);
    assert.equal(await page.locator('img.card_preview[hidden]').count(), 0);
    await page.mouse.move(40, 50);
    await waitUntil(() => records.filter(r => r.url.startsWith('/api/media?')).length === 2);
    const previousVideoUrl = records.filter(r => r.url.startsWith('/api/media?')).at(-1).url;
    await page.evaluate(() => { document.querySelector('.card_list').scrollTop += 120; });
    await page.waitForFunction(() => document.querySelectorAll('video').length === 0);
    await page.waitForTimeout(450);
    assert(await page.locator('video').count() <= 1);
    assert.notEqual(await page.evaluate(() => document.querySelector('video')?.getAttribute('src')), previousVideoUrl,
      'scroll resumed the previous card under a stationary cursor');
    const beforeManualHover = records.filter(r => r.url.startsWith('/api/media?')).length;
    await page.mouse.move(700, 500);
    await page.mouse.move(40, 50);
    await waitUntil(() => records.filter(r => r.url.startsWith('/api/media?')).length === beforeManualHover + 1);
    await page.evaluate(() => {
      document.getElementById('main').hidden = true;
      syncFastLocalPreviewVisibility();
    });
    assert.equal(await page.locator('video').count(), 0, 'hidden grid retained hover playback');
    await page.close();
    console.log('PASS: five rapid scrolls suppress MP4s, intentional hover loads one, leave/scroll/hidden aborts');

    // Non-opted-in (Imagine/remote) hover keeps its immediate legacy behaviour.
    page = await setup(); videoDelay = 3000;
    const legacyHover = await page.evaluate(() => {
      const host = document.createElement('article');
      const media = document.createElement('div');
      const poster = document.createElement('img');
      host.append(media); media.append(poster); document.querySelector('.card_list').append(host);
      bindLazyHoverVideoPreview(host, media, poster, '/poster.svg', itemFor('legacy', 'created', 'video').object_url, {});
      host.dispatchEvent(new MouseEvent('mouseenter'));
      const entered = Boolean(media.querySelector('video')?.getAttribute('src'));
      host.dispatchEvent(new MouseEvent('mouseleave'));
      const retained = Boolean(media.querySelector('video')?.getAttribute('src'));
      disposeCardPreviewNode(host); host.remove();
      return { entered, retained };
    });
    assert.deepEqual(legacyHover, { entered: true, retained: true });
    await page.close();
    console.log('PASS: Imagine/remote hover behaviour remains unchanged');

    // An absent cached file retains a usable source and native preview fallback.
    page = await setup();
    misses.add(await page.evaluate(() => deterministicBuildCardPreviewUrl(itemFor('created-0').object_url)));
    await page.evaluate(() => addCards(1));
    await page.waitForFunction(() => nativeCalls.length === 1 && document.querySelector('.card_preview').naturalWidth > 0);
    assert.equal(await page.locator('.card_media_failed').count(), 0);
    assert.equal(records.filter(r => r.method === 'HEAD').length, 0);
    await page.close();
    console.log('PASS: absent cache does not mark valid media unavailable');

    // Video version strips read the cached first frame, without loading the MP4.
    page = await setup();
    await page.evaluate(() => {
      document.getElementById('detail').hidden = false;
      addThumbs('b', 2, 1, 'video');
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.b_detail_thumb_fill')].every(fill => fill.style.backgroundImage.includes('blob:')));
    assert.equal(records.filter(r => r.kind === 'thumbnail').length, 2);
    assert.equal(records.filter(r => r.url.startsWith('/api/media?')).length, 0);
    assert.equal(records.filter(r => r.method === 'HEAD').length, 0);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.close();
    console.log('PASS: detail video first frames reuse persisted thumbnails');

    page = await setup();
    misses.add(await page.evaluate(() => deterministicBuildCardPreviewUrl(itemFor('detail-0').object_url, 'thumbnail')));
    await page.evaluate(() => {
      document.getElementById('detail').hidden = false;
      addThumbs('b', 1, 0);
    });
    await page.waitForFunction(() => document.querySelector('.b_detail_thumb_fill').style.backgroundImage.includes('/generated.svg'));
    assert.equal(await page.evaluate(() => nativeCalls.length), 1);
    assert.equal(await page.evaluate(() => nativeCalls[0].kind), 'thumbnail');
    await page.close();
    console.log('PASS: missing detail cache retains generation fallback');

    page = await setup(); thumbnailDelay = 2000;
    await page.evaluate(() => {
      document.getElementById('detail').hidden = false;
      addThumbs('b', 20);
    });
    await waitUntil(() => records.filter(r => r.kind === 'thumbnail').length >= 4);
    await page.evaluate(() => {
      for (const thumb of document.querySelectorAll('.b_detail_thumb')) { disposeCardPreviewNode(thumb); thumb.remove(); }
    });
    await page.waitForFunction(() => fastLocalPreviewActive.thumbnail === 0 && fastLocalPreviewQueue.length === 0);
    assert.equal(records.filter(r => r.kind === 'thumbnail').length, 4);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.close();
    console.log('PASS: changing detail cancels discarded version-strip requests');

    // Imagine (including local sources in that view) retains the original path.
    page = await setup();
    await page.evaluate(() => {
      for (const className of ['b_card', 'b_t2i_card', 'collection_media_card']) {
        if (!cardDisplayItemForContext({}, itemFor('local'), className).card_fast_local_preview) throw Error(className);
      }
      if (cardDisplayItemForContext({}, itemFor('local'), 'i_card').card_fast_local_preview) throw Error('Imagine changed');
      if (cardDisplayItemForContext({ remote: true }, itemFor('remote'), 'b_card').card_fast_local_preview) throw Error('Remote changed');
      document.getElementById('detail').hidden = false;
      addThumbs('i', 1, 0);
    });
    await page.waitForFunction(() => document.querySelector('.i_detail_thumb span').style.backgroundImage.includes('/api/build-preview'));
    assert.equal(records.filter(r => r.method === 'HEAD').length, 1);
    assert.equal(await page.evaluate(() => fastLocalPreviewBindings.size), 0);
    await page.close();
    console.log('PASS: Imagine path remains unchanged');

    page = await setup();
    await page.evaluate(() => {
      document.getElementById('detail').hidden = false;
      const thumb = detailThumbButtonForItem('i', { type: 'image', item_id: 'synthetic-remote',
        object_url: '/api/imagine/remote/media?url=https%3A%2F%2Fexample.test%2Fsynthetic.png' }, {});
      document.getElementById('thumbs').append(thumb);
      startDetailThumbCacheLoads([thumb]);
    });
    await page.waitForFunction(() => document.querySelector('.i_detail_thumb_fill').style.backgroundImage.includes('blob:'));
    assert.equal(records.filter(r => r.url.startsWith('/api/card-preview') && r.method === 'HEAD').length, 0);
    assert.equal(await page.evaluate(() => fastLocalPreviewBindings.size), 1);
    await page.close();
    console.log('PASS: official-media proxy decodes cached bytes without a separate HEAD');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
