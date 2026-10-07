// Fixed-size scroll handles live in the gutter outside the card lists.
(() => {
  const selector = '.card_list, .collection_1st_card_list, .collection_2nd_card_grid, .primary-folder-list, .secondary-folder-grid';
  const HANDLE_WIDTH = 8;
  const HANDLE_HEIGHT = 30;
  const handles = new Map();
  let scheduled = false;
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  }
  function attach(list) {
    const rail = document.createElement('div');
    rail.className = 'list_scrollbar_rail';
    rail.hidden = true;
    const thumb = document.createElement('div');
    thumb.className = 'list_scrollbar_thumb';
    thumb.tabIndex = 0;
    thumb.setAttribute('role', 'scrollbar');
    thumb.setAttribute('aria-orientation', 'vertical');
    thumb.setAttribute('aria-label', `Scroll ${list.getAttribute('aria-label') || 'card list'}`);
    if (!list.id) list.id = `scrollable_card_list_${handles.size + 1}`;
    thumb.setAttribute('aria-controls', list.id);
    rail.append(thumb);
    document.body.append(rail);
    const entry = { rail, thumb, top: 0, travel: 0, max: 0, drag: null };
    handles.set(list, entry);
    list.addEventListener('scroll', schedule, { passive: true });
    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      thumb.setPointerCapture(event.pointerId);
      entry.drag = { pointer: event.pointerId, y: event.clientY, scroll: list.scrollTop };
    });
    thumb.addEventListener('pointermove', event => {
      const drag = entry.drag;
      if (!drag || drag.pointer !== event.pointerId || entry.travel <= 0) return;
      list.scrollTop = Math.max(0, Math.min(entry.max, drag.scroll + (event.clientY - drag.y) * entry.max / entry.travel));
      schedule();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) thumb.addEventListener(type, () => { entry.drag = null; });
    rail.addEventListener('pointerdown', event => {
      if (event.target !== rail || entry.travel <= 0 || event.button !== 0) return;
      list.scrollTop = Math.max(0, Math.min(entry.max, (event.clientY - entry.top - HANDLE_HEIGHT / 2) * entry.max / entry.travel));
      schedule();
    });
    rail.addEventListener('wheel', event => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? list.clientHeight : 1;
      list.scrollTop = Math.max(0, Math.min(entry.max, list.scrollTop + event.deltaY * scale));
      schedule();
    }, { passive: false });
    thumb.addEventListener('keydown', event => {
      const steps = { ArrowDown: 40, ArrowUp: -40, PageDown: list.clientHeight, PageUp: -list.clientHeight };
      if (event.key === 'Home') list.scrollTop = 0;
      else if (event.key === 'End') list.scrollTop = entry.max;
      else if (Object.hasOwn(steps, event.key)) list.scrollTop = Math.max(0, Math.min(entry.max, list.scrollTop + steps[event.key]));
      else return;
      event.preventDefault();
      schedule();
    });
    resize?.observe(list);
  }
  function update() {
    workspace.querySelectorAll(selector).forEach(list => { if (!handles.has(list)) attach(list); });
    for (const [list, entry] of handles) {
      if (!list.isConnected) { entry.rail.remove(); resize?.unobserve(list); handles.delete(list); continue; }
      const outer = list.closest('.workspace > section');
      const overflow = getComputedStyle(list).overflowY;
      if (!outer || list.closest('[hidden]') || !list.getClientRects().length || !['auto', 'scroll'].includes(overflow)) { entry.rail.hidden = true; continue; }
      const rect = list.getBoundingClientRect();
      const bounds = outer.getBoundingClientRect();
      const top = Math.max(0, rect.top, bounds.top);
      const bottom = Math.min(window.innerHeight, rect.bottom, bounds.bottom);
      entry.max = Math.max(0, list.scrollHeight - list.clientHeight);
      entry.top = top;
      entry.travel = bottom - top - HANDLE_HEIGHT;
      if (entry.max === 0 || entry.travel <= 0) { entry.rail.hidden = true; continue; }
      entry.rail.hidden = false;
      entry.rail.style.left = `${(rect.right + bounds.right - 1) / 2 - HANDLE_WIDTH / 2}px`;
      entry.rail.style.top = `${top}px`;
      entry.rail.style.height = `${bottom - top}px`;
      entry.thumb.style.top = `${Math.max(0, Math.min(1, list.scrollTop / entry.max)) * entry.travel}px`;
      entry.thumb.setAttribute('aria-valuemin', '0');
      entry.thumb.setAttribute('aria-valuemax', String(entry.max));
      entry.thumb.setAttribute('aria-valuenow', String(Math.round(list.scrollTop)));
    }
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(workspace);
  new MutationObserver(schedule).observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', schedule);
  schedule();
})();
