// Synthetic cards only: exercises real browser pointer/click ordering, no library/API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const scripts = path.join(__dirname, '../common/app/web/scripts');
const render = fs.readFileSync(path.join(scripts, 'card_render.js'), 'utf8');
const buttonCode = render.slice(render.indexOf('function cardVisualSelectButton('),
  render.indexOf('// A stored failed or moderated card'));
const actions = fs.readFileSync(path.join(scripts, 'card_actions.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const setup = async (screen, view = '') => {
      await page.goto('about:blank');
      await page.setContent(`<style>
        .card_list {display:grid;grid-template-columns:repeat(4,140px);gap:12px;
          width:610px;height:340px;overflow:auto;padding:8px}
        .card {position:relative;height:120px;background:#333;color:white}
        .card_visual_select_btn {position:absolute;right:6px;top:6px;width:28px;height:28px}
        .action {position:absolute;bottom:4px;right:4px}
        .selected {outline:2px solid cyan}
      </style><div id="selectionBar"><span id="selectionCount"></span></div>
      <div class="card_list"></div>`);
      await page.evaluate(({ screen, view }) => {
        window.screen_state = { current_screen: screen };
        window.library_state = { selectedItems: new Set(), cardSelectionScreen: '',
          iMainView: view, posts: [], collections: [] };
        window.opens = 0;
        window.actionClicks = 0;
        window.stopVisualCardAction = event => { event.preventDefault(); event.stopPropagation(); };
        const classes = { i_main: 'i_card_list', b_main: 'b_card_list',
          '2nd_main': 'second_main_card_list', reference_main: 'reference_card_list' };
        document.querySelector('.card_list').classList.add(classes[screen]);
      }, { screen, view });
      await page.addScriptTag({ content: actions + '\n' + buttonCode });
      await page.evaluate(() => {
        const list = document.querySelector('.card_list');
        for (let index = 0; index < 24; index++) {
          const card = document.createElement('article');
          card.className = 'card';
          card.dataset.libraryPostPath = 'card-' + index;
          card.textContent = 'Card ' + index;
          card.addEventListener('click', () => opens++);
          if (index !== 7) card.append(cardVisualSelectButton({ folder_path: 'card-' + index }));
          const action = document.createElement('button');
          action.className = 'action';
          action.textContent = 'Delete';
          action.addEventListener('click', event => { event.stopPropagation(); actionClicks++; });
          card.append(action);
          list.append(card);
        }
      });
    };
    const selected = () => page.evaluate(() => [...library_state.selectedItems].sort());
    const center = async selector => {
      const rect = await page.locator(selector).boundingBox();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    const control = index => `[data-library-post-path="card-${index}"].card .card_visual_select_btn`;
    const card = index => `[data-library-post-path="card-${index}"].card`;
    const move = point => page.mouse.move(point.x, point.y);
    const start = async index => { await move(await center(control(index))); await page.mouse.down(); };
    for (const [screen, view] of [['i_main', 'imagine'], ['i_main', 'liked'],
      ['b_main', 'build'], ['2nd_main', ''], ['reference_main', '']]) {
      await setup(screen, view);
      await page.locator(control(0)).click();
      assert.deepEqual(await selected(), ['card-0'], 'single click selects once');
      await page.locator(control(0)).click();
      assert.deepEqual(await selected(), [], 'single click deselects once');
      await page.locator(control(4)).click();
      await start(0);
      // One fast move crosses two cards; neither may be skipped.
      const first = await center(control(0));
      const third = await center(control(2));
      await move({ x: third.x, y: first.y });
      await move(first);
      await page.mouse.up();
      assert.deepEqual(await selected(), ['card-0', 'card-1', 'card-2', 'card-4']);
      assert.equal(await page.evaluate(() => opens + actionClicks), 0);
      // Next real click must not be swallowed by drag cleanup.
      await page.locator(control(2)).click();
      assert.deepEqual(await selected(), ['card-0', 'card-1', 'card-4']);
      await page.locator(control(2)).focus();
      await page.keyboard.press('Space');
      assert.ok((await selected()).includes('card-2'), 'keyboard selection remains available');
      console.log('PASS', screen, view, 'click / drag / revisit / keyboard');
    }
    await setup('b_main');
    await start(0);
    await move(await center(card(1) + ' .action'));
    await page.mouse.up();
    assert.equal(await page.evaluate(() => opens + actionClicks), 0, 'release never deletes or opens');
    await page.locator(card(3)).click({ position: { x: 30, y: 65 } });
    assert.equal(await page.evaluate(() => opens), 1, 'body click still opens');
    await move(await center(card(4)));
    await page.mouse.down();
    await move(await center(card(5)));
    await page.mouse.up();
    assert.ok(!(await selected()).includes('card-5'), 'body drag never selects');

    await setup('b_main');
    await start(0);
    await move(await center(control(1)));
    await page.keyboard.press('Escape');
    await move(await center(control(2)));
    await page.mouse.up();
    assert.deepEqual(await selected(), ['card-0', 'card-1'], 'Escape ends the gesture');
    await start(0);
    await move(await center(control(1)));
    await page.evaluate(() => { library_state.bMainView = 'upload'; });
    await move(await center(control(2)));
    await page.mouse.up();
    assert.ok(!(await selected()).includes('card-2'), 'view change ends gesture');

    await setup('b_main');
    await start(0);
    await move(await center(control(1)));
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(100);
    await page.mouse.up();
    assert.ok((await selected()).length > 2, 'scrolling while held selects newly reached cards');
    assert.equal(await page.evaluate(() => document.querySelector('.card_list').style.userSelect), '');

    for (const cancelType of ['pointercancel', 'blur']) {
      await setup('i_main', 'liked');
      await start(0);
      await move(await center(control(1)));
      await page.evaluate(type => {
        if (type === 'blur') window.dispatchEvent(new Event('blur'));
        else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      }, cancelType);
      await move(await center(control(2)));
      await page.mouse.up();
      assert.deepEqual(await selected(), ['card-0', 'card-1'], cancelType + ' releases gesture');
    }
    await setup('reference_main');
    await start(4);
    await move(await center(card(7)));
    await page.mouse.up();
    assert.deepEqual(await selected(), ['card-4', 'card-5', 'card-6'], 'cards without a select control are skipped');
    await page.locator(control(0)).click({ button: 'right' });
    assert.ok(!(await selected()).includes('card-0'), 'right click is not selection');

    await setup('b_main');
    await start(0);
    await move(await center(control(1)));
    await page.evaluate(() => {
      // Virtual rendering may remove the original button while the mouse stays down.
      document.querySelector('.card').remove();
    });
    await move(await center(control(3)));
    await page.mouse.up();
    assert.ok((await selected()).includes('card-3'), 'stable list capture survives card replacement');
    assert.deepEqual(errors, []);
    console.log('PASS release actions / body gestures / Escape / view change / scroll / cleanup');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
