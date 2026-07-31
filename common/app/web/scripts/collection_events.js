// Collection navigation and folder action events
document.getElementById("b_collection_nav_btn")?.addEventListener("click", () => {
  if (typeof clearSidebarSearchQuery === "function") clearSidebarSearchQuery();
  clearCollectionSelection();
  openScreen("collection_main", "b_collection_nav_btn");
  renderCollectionFolders();
});

document.querySelector(".second_main_back_btn")?.addEventListener("click", () => {
  if (typeof clearSidebarSearchQuery === "function") clearSidebarSearchQuery();
  openScreen("collection_main", "b_collection_nav_btn");
});

document.querySelector(".collection_title_btn")?.addEventListener("click", () => {
  library_state.collectionActionLevel = "first";
  library_state.selectedCollectionPostPath = "";
  renderCollectionFolders();
});

document.querySelector(".collection_item_title_btn")?.addEventListener("click", () => {
  if (!library_state.selectedCollectionPath) {
    setLibraryMessage("Select a category.");
    return;
  }
  library_state.collectionActionLevel = "second";
  renderCollectionFolders();
});

document.querySelector(".collection_make_btn")?.addEventListener("click", () => {
  makeCollectionFolder();
});

document.querySelector(".collection_rename_btn")?.addEventListener("click", () => {
  renameCollectionFolder();
});

document.querySelector(".collection_delete_btn")?.addEventListener("click", () => {
  deleteCollectionFolder();
});

document.querySelectorAll("[data-collection-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    sortCollectionFolders(button.dataset.collectionSort || "abc");
  });
});

document.querySelector(".collection_sort_save_btn")?.addEventListener("click", () => {
  saveCurrentCollectionSort().catch((error) => showErrorPanel("Save failed", error?.message || "Save failed."));
});

window.addEventListener("resize", () => {
  scheduleCollectionRows();
});
