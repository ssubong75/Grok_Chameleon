// Shared media card selection, merge, and delete actions


  function cardPostByPath(path) {
    const target = String(path || "");
    if (!target) return null;
    return library_state.posts.find((post) => post.folder_path === target)
      || library_state.collections.flatMap((collection) => collection.posts || [])
        .find((post) => post.folder_path === target)
      || null;
  }


  function selectedCardPosts() {
    return Array.from(library_state.selectedItems || [])
      .map(cardPostByPath)
      .filter(Boolean);
  }


  function syncCardSelectionControls() {
    const count = library_state.selectedItems?.size || 0;
    const selectionBar = document.getElementById("selectionBar");
    const selectionCount = document.getElementById("selectionCount");
    if (selectionBar) selectionBar.hidden = count === 0;
    if (selectionCount) selectionCount.textContent = `Selected: ${count}`;
    for (const card of document.querySelectorAll("[data-library-post-path]")) {
      const selected = library_state.selectedItems?.has(card.dataset.libraryPostPath || "");
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
    if (library_state.selectedItems.has(key)) library_state.selectedItems.delete(key);
    else library_state.selectedItems.add(key);
    syncCardSelectionControls();
  }


  function clearCardSelection() {
    library_state.selectedItems.clear();
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


  async function deleteSelectedCardItems() {
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
    let data = null;
    const scrollState = captureLibraryCardListScroll();
    try {
      for (const post of posts) {
        data = await qApi("/api/library/delete-post", { post_path: post.folder_path });
      }
      library_state.selectedItems.clear();
      if (data) {
        applyLibrarySnapshot(data);
        restoreLibraryCardListScroll(scrollState);
      }
    } catch (error) {
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    }
  }


  async function mergeSelectedCardItems() {
    const selectedPaths = Array.from(library_state.selectedItems || [])
      .map((path) => String(path || "").trim())
      .filter(Boolean);
    if (selectedPaths.length < 2) {
      showErrorPanel("Merge unavailable", "Select two or more cards to merge.");
      return;
    }
    if (!library_state.apiReady) {
      setLibraryMessage("Merge needs the local app launcher.");
      return;
    }
    const ok = typeof openGalleryActionDialog === "function"
      ? await openGalleryActionDialog({
        title: "Merge Items",
        message: "Merge selected cards into one Item.",
        confirmLabel: "Merge",
        cancelLabel: "Cancel",
      })
      : window.confirm("Merge selected cards into one Item?");
    if (!ok) return;
    const data = await qApi("/api/library/merge-posts", {
      post_paths: selectedPaths,
    });
    library_state.selectedItems.clear();
    applyLibrarySnapshot(data);
    toast("Merged items.");
  }


  function postRootFolderDeleteBlocked(post) {
    const parts = String(post?.folder_path || "").split("/").filter(Boolean);
    return parts.length < 2;
  }


  async function deleteLibraryPost(post, button = null) {
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
    const ok = await confirmDeleteAction({
      title: "Delete item",
      message: itemCount > 1 ? `Delete this post and ${itemCount} media item(s)?` : "Delete this local item?",
    });
    if (!ok) return;
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
      } else if (
        currentScreen === "2nd_main"
        && !(typeof selectedCollectionFolderPost === "function" && selectedCollectionFolderPost())
      ) {
        openScreen("collection_main", "b_collection_nav_btn");
      }
      toast("Deleted local item.");
    } catch (error) {
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    } finally {
      button?.removeAttribute("aria-busy");
    }
  }
