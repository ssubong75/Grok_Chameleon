(() => {
  if (window.__grokStudioQSplitLoaderStarted) return;
  window.__grokStudioQSplitLoaderStarted = true;

  const scripts = [
    "state.js",
    "library_utils.js",
    "ui_feedback.js",
    "dialog.js",
    "library_core.js",
    "prompt_translate.js",
    "account_core.js",
    "composer_options.js",
    "composer_provider.js",
    "detail_media.js",
    "b_detail_media.js",
    "i_detail_media.js",
    "detail_video_player.js",
    "detail_common_actions.js",
    "b_detail_actions.js",
    "i_detail_actions.js",
    "detail_state.js",
    "detail_navigation.js",
    "detail_render.js",
    "library_scan.js",
    "render.js",
    "build_main.js",
    "b_composer_submit.js",
    "i_composer_submit.js",
    "composer_submit.js",
    "card_render.js",
    "source_filter.js",
    "b_source_render.js",
    "i_source_render.js",
    "source_render.js",
    "navigation_history.js",
    "screen_router.js",
    "image_editor_flow.js",
    "imagine_main.js",
    "card_actions.js",
    "collection_render.js",
    "prompt_render.js",
    "prompt_account.js",
    "collection_utils.js",
    "collection_actions.js",
    "composer_attachments.js",
    "detail_events.js",
    "composer_events.js",
    "sidebar_events.js",
    "prompt_events.js",
    "collection_events.js",
    "screen_events.js",
  ];

  const alreadyLoaded = scripts.some((name) => (
    document.querySelector(`script[src$="/${name}"], script[src$="./${name}"], script[src$="scripts/${name}"]`)
  ));
  if (alreadyLoaded) return;

  const loadScript = (name) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `./scripts/${name}?split=20260711`;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${name}`));
    document.head.append(script);
  });

  scripts
    .reduce((chain, name) => chain.then(() => loadScript(name)), Promise.resolve())
    .catch((error) => {
      console.error("[Grok Chameleon] split loader failed", error);
    });
})();
