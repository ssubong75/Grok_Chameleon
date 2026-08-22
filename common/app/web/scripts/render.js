// Whole-library render entry point
function renderLibrary() {
  renderSourceCards("build");
  renderBuildT2iViewCards();
  renderSourceCards("imagine");
  if (typeof renderImagineDiscoverCards === "function" && screen_state.current_screen === "i_discover_main") renderImagineDiscoverCards();
  renderCollectionFolders();
  renderSecondMain();
  renderPromptCards();
  if (typeof renderSearchResults === "function" && screen_state.current_screen === "search_main") renderSearchResults();
  renderAccounts();
  if (typeof renderComposerAttachments === "function") renderComposerAttachments();
  setLibraryMessage("");
  renderDetailViews();
  syncCardSelectionControls();
  scheduleCollectionRows();
}
