// Build/Imagine source render dispatchers

function renderSourceCards(source) {
  if (source === "imagine") {
    renderImagineSourceCards();
    return;
  }
  renderBuildSourceCards();
}
