(() => {
  const native = window.grokChameleonNative;
  if (!native?.openExternalMedia) return;
  let active = null;
  let timer = 0;
  let suppressClick = false;
  document.addEventListener("click", event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const stop = (close) => {
    if (timer) clearInterval(timer);
    timer = 0;
    active = null;
    if (close) native.closeExternalMedia();
  };
  native.onExternalMediaClosed(() => stop(false));
  document.addEventListener("pointerdown", event => {
    if (event.button !== 0 || document.fullscreenElement || !(event.target instanceof Element)) return;
    const object = event.target.closest(".detail_media_object");
    const surface = object?.closest(".i_detail_media, .b_detail_media");
    if (!surface || object.classList.contains("detail_media_zoomed")) return;
    const startX = event.screenX, startY = event.screenY;
    let moved = false;
    let opening = null;
    const id = event.pointerId;
    const type = object.tagName === "VIDEO" ? "video" : object.tagName === "IMG" ? "image" : "";
    const url = object.currentSrc || object.src;
    if (!type || !url) return;
    const state = () => ({ type, url, time: object.currentTime || 0, paused: type !== "video" || object.paused, rate: object.playbackRate || 1 });
    try { object.setPointerCapture(id); } catch (_) { return; }
    const move = e => {
      if (e.pointerId !== id || moved || Math.hypot(e.screenX - startX, e.screenY - startY) <= 8) return;
      moved = true;
      opening = native.openExternalMedia(state());
    };
    const cleanup = () => {
      object.removeEventListener("pointermove", move);
      object.removeEventListener("pointerup", finish);
      object.removeEventListener("pointercancel", cancel);
    };
    const finish = async e => {
      if (e.pointerId !== id) return;
      cleanup();
      if (!moved) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      try {
        if (!await opening) return;
        if (!object.isConnected || !await native.finishExternalMediaDrag({ x: e.screenX, y: e.screenY })) return;
        stop(false);
        active = object;
        timer = setInterval(() => {
          if (!active?.isConnected || active !== object || (object.currentSrc || object.src) !== url) return stop(true);
          native.updateExternalMedia(state());
        }, 100);
      } catch (error) { console.error("External media display:", error); }
    };
    const cancel = e => {
      if (e.pointerId !== id) return;
      cleanup();
      if (opening) opening.then(() => native.closeExternalMedia()).catch(() => {});
    };
    object.addEventListener("pointermove", move);
    object.addEventListener("pointerup", finish);
    object.addEventListener("pointercancel", cancel);
  }, true);
})();
