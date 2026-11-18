(() => {
  let media = null;
  window.externalMedia.onState(state => {
    if (!state || !state.url) return;
    if (!media || media.dataset.source !== state.url || media.dataset.kind !== state.type) {
      media = document.createElement(state.type === "video" ? "video" : "img");
      media.dataset.source = state.url;
      media.dataset.kind = state.type;
      if (state.type === "video") { media.muted = true; media.loop = true; media.playsInline = true; }
      media.src = state.url;
      document.body.replaceChildren(media);
    }
    if (state.type !== "video") return;
    media.playbackRate = state.rate || 1;
    if (Math.abs(media.currentTime - state.time) > 0.15) {
      try { media.currentTime = state.time; } catch (_) {}
    }
    if (state.paused) media.pause();
    else if (media.paused) media.play().catch(() => {});
  });
  document.addEventListener("dblclick", () => window.externalMedia.close());
  document.addEventListener("keydown", event => { if (event.key === "Escape") window.externalMedia.close(); });
})();
