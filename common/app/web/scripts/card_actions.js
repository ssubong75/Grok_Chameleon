// Shared media card selection, merge, and delete actions


  function cardPostByPath(path) {
    const target = String(path || "");
    if (!target) return null;
    return library_state.posts.find((post) => (
      typeof libraryPostMatchesIdentity === "function" && libraryPostMatchesIdentity(post, target)
    ))
      || library_state.posts.find((post) => post.folder_path === target)
      || library_state.collections.flatMap((collection) => collection.posts || [])
        .find((post) => (
          (typeof libraryPostMatchesIdentity === "function" && libraryPostMatchesIdentity(post, target))
          || post.folder_path === target
        ))
      || null;
  }


  function selectedCardPosts() {
    return Array.from(library_state.selectedItems || [])
      .map(cardPostByPath)
      .filter(Boolean);
  }

  function isSelectedImagineUnsavedPost(post) {
    return Boolean(
      (typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post))
      || String(post?.folder_path || "").startsWith("imagine_unsaved/")
    );
  }

  function cardSelectionUsesUnsavedActions() {
    return screen_state.current_screen === "i_unsaved_main";
  }

  function cardSelectionUsesImagineMoveActions() {
    return ["i_main", "i_unsaved_main"].includes(screen_state.current_screen);
  }

  function cardSelectionUsesImagineDeleteActions() {
    return ["i_main", "i_unsaved_main"].includes(screen_state.current_screen);
  }

  function syncCardSelectionControls() {
    const currentScreen = screen_state.current_screen;
    if (
      library_state.selectedItems?.size
      && library_state.cardSelectionScreen
      && library_state.cardSelectionScreen !== currentScreen
    ) {
      library_state.selectedItems.clear();
      library_state.cardSelectionScreen = "";
    }
    if (library_state.selectedItems?.size && !library_state.cardSelectionScreen) {
      library_state.cardSelectionScreen = currentScreen;
    }
    const count = library_state.selectedItems?.size || 0;
    const selectionBar = document.getElementById("selectionBar");
    const selectionCount = document.getElementById("selectionCount");
    const mergeButton = document.getElementById("selectionMergeBtn");
    const renameButton = document.getElementById("selectionRenameBtn");
    const imagineMoveActions = cardSelectionUsesImagineMoveActions();
    if (selectionBar) selectionBar.hidden = count === 0;
    if (selectionCount) selectionCount.textContent = `Selected: ${count}`;
    if (mergeButton) {
      mergeButton.textContent = imagineMoveActions ? "Move" : "Merge";
      mergeButton.dataset.selectionAction = imagineMoveActions ? "move" : "merge";
    }
    if (renameButton) {
      const selectedPost = count === 1 ? selectedCardPosts()[0] : null;
      const pathParts = String(selectedPost?.folder_path || "").split("/").filter(Boolean);
      renameButton.hidden = !(
        currentScreen === "2nd_main"
        && selectedPost?.area === "collection"
        && pathParts.length >= 4
      );
    }
    for (const card of document.querySelectorAll("[data-library-post-path]")) {
      const selected = library_state.selectedItems?.has(
        card.dataset.libraryPostIdentity || card.dataset.libraryPostPath || "",
      );
      if (card.classList.contains("card") || card.classList.contains("collection_2nd_card")) {
        card.classList.toggle("selected", Boolean(selected));
      }
      const button = card.querySelector(".card_visual_select_btn");
      button?.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }


  function toggleCardSelection(path) {
    const key = String(path || "");
    if (!key) return;
    if (
      library_state.selectedItems.size
      && library_state.cardSelectionScreen
      && library_state.cardSelectionScreen !== screen_state.current_screen
    ) {
      library_state.selectedItems.clear();
    }
    if (library_state.selectedItems.has(key)) library_state.selectedItems.delete(key);
    else library_state.selectedItems.add(key);
    library_state.cardSelectionScreen = library_state.selectedItems.size ? screen_state.current_screen : "";
    syncCardSelectionControls();
  }


  function clearCardSelection() {
    library_state.selectedItems.clear();
    library_state.cardSelectionScreen = "";
    syncCardSelectionControls();
  }

  function libraryCardListElementForScreen(screenId = screen_state.current_screen) {
    if (screenId === "b_main") return document.querySelector(".b_card_list");
    if (screenId === "b_t2i_view_main") return document.querySelector(".b_t2i_view_card_list");
    if (screenId === "i_main") return document.querySelector(".i_card_list");
    if (screenId === "i_unsaved_main") return document.querySelector(".i_unsaved_card_list");
    if (screenId === "i_discover_main") return document.querySelector(".i_discover_card_list");
    if (screenId === "2nd_main") return document.querySelector(".second_main_card_list");
    if (screenId === "search_main") return document.querySelector(".search_card_list");
    return null;
  }

  function libraryCardListUsesDocumentScroll(screenId) {
    return ["b_main", "i_main", "i_unsaved_main", "i_discover_main", "2nd_main"].includes(screenId)
      && typeof virtualCardListUsesDocumentScroll === "function"
      && virtualCardListUsesDocumentScroll();
  }

  function captureLibraryCardListScroll(screenId = screen_state.current_screen) {
    const list = libraryCardListElementForScreen(screenId);
    if (!list) return null;
    const documentScroll = libraryCardListUsesDocumentScroll(screenId);
    return {
      screenId,
      documentScroll,
      scrollTop: documentScroll
        ? Math.max(0, Number(window.scrollY || document.documentElement?.scrollTop || 0))
        : Math.max(0, Number(list.scrollTop || 0)),
    };
  }

  function restoreLibraryCardListScroll(state) {
    if (!state) return;
    const list = libraryCardListElementForScreen(state.screenId);
    if (!list) return;
    const top = Math.max(0, Number(state.scrollTop) || 0);
    const applyScroll = () => {
      if (state.documentScroll) window.scrollTo(0, top);
      else list.scrollTop = top;
    };
    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
    });
  }

  function downloadSelectedCardItems() {
    const posts = selectedCardPosts();
    return downloadLibraryItems(posts.flatMap((post) => post.items || []));
  }

  async function renameSelectedCollectionCard() {
    const posts = selectedCardPosts();
    const post = posts.length === 1 ? posts[0] : null;
    const folderPath = String(post?.folder_path || "").trim().replace(/^\/+|\/+$/g, "");
    const pathParts = folderPath.split("/").filter(Boolean);
    if (
      screen_state.current_screen !== "2nd_main"
      || post?.area !== "collection"
      || pathParts.length < 4
    ) {
      showErrorPanel("Rename unavailable", "Select one card inside the current Item folder.");
      return;
    }
    if (!library_state.apiReady) {
      setLibraryMessage("Rename needs the local app launcher.");
      return;
    }
    const currentName = pathParts[pathParts.length - 1];
    const name = await collectionActionInput({
      title: "Rename Card",
      value: currentName,
      confirmLabel: "Rename",
    });
    if (!name || name === currentName) return;
    const scrollState = captureLibraryCardListScroll("2nd_main");
    const data = await qApi("/api/library/rename-card-folder", {
      target_path: folderPath,
      name,
    });
    library_state.selectedItems.clear();
    applyLibrarySnapshot(data);
    restoreLibraryCardListScroll(scrollState);
    toast("Card folder renamed.");
  }

  async function moveSelectedImagineCardItems() {
    const unsavedOnly = cardSelectionUsesUnsavedActions();
    const posts = selectedCardPosts().filter((post) => (
      unsavedOnly
        ? isSelectedImagineUnsavedPost(post)
        : post?.source === "imagine" && post?.area === "imagine_remote"
    ));
    if (!posts.length) {
      showErrorPanel("Move unavailable", "Select one or more Imagine cards.");
      return;
    }
    openMoveToCollectionDialog({
      postPaths: posts.map((post) => post.folder_path),
      postObjects: posts,
    });
  }

  async function deleteSelectedImagineCardItems() {
    const unsavedOnly = cardSelectionUsesUnsavedActions();
    const posts = selectedCardPosts().filter((post) => (
      unsavedOnly
        ? isSelectedImagineUnsavedPost(post)
        : post?.source === "imagine" && post?.area === "imagine_remote"
    ));
    const targets = posts
      .map((post) => ({
        post,
        items: (post.items || []).filter(Boolean),
      }))
      .filter((target) => target.items.length && imagineCardHasDeleteTarget(target.post));
    if (!targets.length) {
      showErrorPanel("Delete unavailable", "The selected Imagine cards have no deletion target.");
      return;
    }
    const ok = await confirmAction({
      title: "Delete Posts",
      message: targets.length > 1
        ? `Delete ${targets.length} selected Imagine posts?`
        : "Delete the selected Imagine post?",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const screenId = screen_state.current_screen;
    const scrollTop = imagineListScrollTopForScreen(screenId);
    const pendingPaths = targets.map((target) => target.post.folder_path).filter(Boolean);
    if (typeof setRenderedCardPathsHidden === "function") {
      setRenderedCardPathsHidden(pendingPaths, true);
    }
    clearCardSelection();
    const deletedTargets = [];
    const failures = [];
    const deletedItemKeys = new Set();
    for (const target of targets) {
      const alreadyDeletedItems = target.items.filter((item) => {
        const key = imagineDeleteAssetIdForItem(item) || mediaItemKey(item);
        return key && deletedItemKeys.has(key);
      });
      const pendingItems = target.items.filter((item) => {
        const key = imagineDeleteAssetIdForItem(item) || mediaItemKey(item);
        return !key || !deletedItemKeys.has(key);
      });
      let deletedItems = [...alreadyDeletedItems];
      if (pendingItems.length) {
        try {
          const result = await deleteImagineRemoteCard({
            ...target.post,
            items: pendingItems,
          });
          deletedItems = [...deletedItems, ...(result.deletedItems || [])];
          failures.push(...(result.failures || []));
        } catch (error) {
          failures.push(error);
        }
      }
      for (const item of deletedItems) {
        const key = imagineDeleteAssetIdForItem(item) || mediaItemKey(item);
        if (key) deletedItemKeys.add(key);
      }
      if (deletedItems.length) {
        deletedTargets.push({
          ...target,
          items: deletedItems,
        });
      }
    }
    for (const target of deletedTargets) {
      removeImagineItemsFromPost(target.post, target.items, {
        keepListScreen: true,
        screenId,
        scrollTop,
      });
    }
    if (typeof setRenderedCardPathsHidden === "function") {
      setRenderedCardPathsHidden(pendingPaths, false);
    }
    if (deletedTargets.length) {
      toast(deletedTargets.length > 1 ? "Deleted Imagine posts." : "Deleted Imagine post.");
    }
    if (failures.length) {
      showErrorPanel(
        "Delete failed",
        `${failures.length} selected card(s) could not be deleted. ${failures[0]?.message || ""}`.trim(),
      );
    }
  }

  async function deleteSelectedCardItems() {
    if (cardSelectionUsesImagineDeleteActions()) {
      await deleteSelectedImagineCardItems();
      return;
    }
    const posts = selectedCardPosts().filter((post) => !postRootFolderDeleteBlocked(post));
    if (!posts.length) {
      showErrorPanel("Delete unavailable", "Select local item cards to delete.");
      return;
    }
    const ok = await confirmDeleteAction({
      title: "Delete item",
      message: posts.length > 1 ? `Delete ${posts.length} selected items?` : "Delete this local item?",
    });
    if (!ok) return;
    const pendingPaths = posts.map((post) => post.folder_path).filter(Boolean);
    if (typeof setRenderedCardPathsHidden === "function") {
      setRenderedCardPathsHidden(pendingPaths, true);
    }
    clearCardSelection();
    let data = null;
    const scrollState = captureLibraryCardListScroll();
    try {
      for (const post of posts) {
        data = await qApi("/api/library/delete-post", { post_path: post.folder_path });
        applyLibrarySnapshot(data);
      }
      if (data) {
        restoreLibraryCardListScroll(scrollState);
      }
    } catch (error) {
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    } finally {
      if (typeof setRenderedCardPathsHidden === "function") {
        setRenderedCardPathsHidden(pendingPaths, false);
      }
    }
  }


  async function mergeSelectedCardItems() {
    const selectedPaths = selectedCardPosts()
      .map((post) => String(post?.folder_path || "").trim())
      .filter(Boolean);
    if (selectedPaths.length < 2) {
      showErrorPanel("Merge unavailable", "Select two or more cards to merge.");
      return;
    }
    if (!library_state.apiReady) {
      setLibraryMessage("Merge needs the local app launcher.");
      return;
    }
    if (typeof openMergeDestinationDialog !== "function") {
      showErrorPanel("Merge unavailable", "The destination picker is unavailable.");
      return;
    }
    const targetPath = await openMergeDestinationDialog({
      postPaths: selectedPaths,
    });
    if (!targetPath) return;
    const data = await qApi("/api/library/merge-posts", {
      post_paths: selectedPaths,
      target_path: targetPath,
    });
    library_state.selectedItems.clear();
    applyLibrarySnapshot(data);
    toast("Merged items.");
  }


  function postRootFolderDeleteBlocked(post) {
    const parts = String(post?.folder_path || "").split("/").filter(Boolean);
    return parts.length < 2;
  }


  // skipConfirm is for the corner X on a failed or moderated card: there is no media to
  // lose, and the job card it replaces dismissed on a single click too.
  async function deleteLibraryPost(post, button = null, { skipConfirm = false } = {}) {
    if (!post?.folder_path) return;
    if (postRootFolderDeleteBlocked(post)) {
      showErrorPanel("Delete unavailable", "Open the detail view and delete a thumbnail.");
      return;
    }
    if (!library_state.apiReady) {
      setLibraryMessage("Delete needs the local app launcher.");
      return;
    }
    const itemCount = Math.max(1, (post.items || []).length);
    const ok = skipConfirm || await confirmDeleteAction({
      title: "Delete item",
      message: itemCount > 1 ? `Delete this post and ${itemCount} media item(s)?` : "Delete this local item?",
    });
    if (!ok) return;
    const pendingPaths = [post.folder_path];
    if (typeof setRenderedCardPathsHidden === "function") {
      setRenderedCardPathsHidden(pendingPaths, true);
    }
    button?.setAttribute("aria-busy", "true");
    const currentScreen = screen_state.current_screen;
    const currentDetailType = detailTypeForScreen();
    const backTarget = currentDetailType ? detailBackTarget(currentDetailType) : null;
    const scrollState = captureLibraryCardListScroll(currentScreen);
    try {
      const deletedCurrentPost = library_state.selectedPostPath === post.folder_path;
      const data = await qApi("/api/library/delete-post", { post_path: post.folder_path });
      applyLibrarySnapshot(data);
      restoreLibraryCardListScroll(scrollState);
      if (deletedCurrentPost && currentDetailType && backTarget) {
        openScreen(backTarget.screenId, backTarget.activeButtonId || "");
        restoreLibraryCardListScroll(captureLibraryCardListScroll(backTarget.screenId) || scrollState);
      }
      toast("Deleted local item.");
    } catch (error) {
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    } finally {
      if (typeof setRenderedCardPathsHidden === "function") {
        setRenderedCardPathsHidden(pendingPaths, false);
      }
      button?.removeAttribute("aria-busy");
    }
  }
