// Collection move, merge, and folder actions

  async function moveSelectedCreatedPostToCollection() {
    const post = library_state.posts.find((item) => item.folder_path === library_state.selectedPostPath);
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (!post || !collection || post.area !== "created") {
      setLibraryMessage("Select a created post and a collection.");
      return;
    }
    if (library_state.apiReady) {
      const data = await qApi("/api/collection/move-post", {
        post_path: post.folder_path,
        collection_path: collection.path,
      });
      applyLibrarySnapshot(data);
      return;
    }
    const targetName = await uniqueDirectoryName(collection.handle, post.folderName);
    const targetHandle = await copyDirectory(post.directoryHandle, collection.handle, targetName);
    const postJson = postJsonFromPost(post, {
      folder_path: `${collection.path}/${targetName}`,
      collection: collection.id,
    });
    await writeJsonFile(targetHandle, "post.json", postJson);
    await post.parentHandle.removeEntry(post.folderName, { recursive: true });
    library_state.selectedPostPath = postJson.folder_path;
    await scanLibrary();
  }

  async function moveSelectedDetailItemToCollection() {
    const post = selectedLibraryPost();
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    const selectedItem = selectedDetailItem(post);
    if (!post || !collection || !selectedItem) {
      setLibraryMessage("Select a post, item, and collection.");
      return;
    }
    if (post.area !== "created") {
      setLibraryMessage("Only created posts can be moved for now.");
      return;
    }

    const candidates = collectionMergeCandidates(collection, post);
    let mergePost = null;
    if (candidates.length) {
      const merge = await collectionActionConfirm({
        title: "Merge post",
        message: "같은 원본 묶음에서 가져온 항목이 이 컬렉션에 있습니다.",
        confirmLabel: "Merge",
        cancelLabel: "New",
      });
      if (merge) mergePost = candidates[0];
    }

    if (library_state.apiReady) {
      const data = await qApi("/api/collection/move-item", {
        post_path: post.folder_path,
        item_key: mediaItemKey(selectedItem),
        collection_path: collection.path,
        merge_path: mergePost?.folder_path || "",
      });
      applyLibrarySnapshot(data);
      return;
    }

    const targetPostJson = await writeSplitTargetPost({
      sourcePost: post,
      selectedItem,
      collection,
      mergePost,
    });
    await removeItemFromSourcePost(post, selectedItem);
    library_state.selectedPostPath = targetPostJson.folder_path;
    library_state.selectedDetailItemId = mediaItemKey(selectedItem);
    await scanLibrary();
  }

  function selectedCollectionFolder() {
    return library_state.collections.find((item) => item.path === library_state.selectedCollectionPath) || null;
  }

  function selectedCollectionFolderPost() {
    if (!library_state.selectedCollectionPostPath) return null;
    return library_state.posts.find((post) => post.folder_path === library_state.selectedCollectionPostPath)
      || library_state.collections.flatMap((collection) => collection.posts || [])
        .find((post) => post.folder_path === library_state.selectedCollectionPostPath)
      || null;
  }

  function clearCollectionSelection() {
    library_state.selectedCollectionPath = "";
    library_state.selectedCollectionPostPath = "";
    library_state.collectionActionLevel = "first";
  }

  function selectedCollectionActionTarget() {
    const post = selectedCollectionFolderPost();
    if (library_state.collectionActionLevel === "second") {
      const collection = (post
        ? library_state.collections.find((item) => post.folder_path.startsWith(`${item.path}/`))
        : null)
        || selectedCollectionFolder();
      return {
        level: "second",
        path: post?.folder_path || "",
        name: post ? readableName(post.folderName) || post.title || "" : "",
        post,
        collection,
      };
    }
    const collection = selectedCollectionFolder();
    if (collection) {
      return {
        level: "first",
        path: collection.path,
        name: collection.name || readableName(collection.id),
        collection,
      };
    }
    return { level: "first", path: "", name: "", collection: null };
  }

  let moveToCollectionOverlay = null;
  let moveToCollectionRequestPending = false;

  function closeMoveToCollectionDialog() {
    moveToCollectionOverlay?.remove();
    moveToCollectionOverlay = null;
  }

  function collectionForPostPath(postPath) {
    return library_state.collections.find((collection) => (
      String(postPath || "").startsWith(`${collection.path}/`)
    )) || null;
  }

  function firstMoveCollectionPath() {
    return library_state.collections[0]?.path || "";
  }

  function moveDialogPost(postPath) {
    return library_state.posts.find((post) => post.folder_path === postPath)
      || library_state.collections.flatMap((collection) => collection.posts || [])
        .find((post) => post.folder_path === postPath)
      || null;
  }

  async function moveToCollectionTarget({ sourcePost, itemKey = "", targetCollectionPath = "", targetPostPath = "" }) {
    if (!sourcePost?.folder_path) return;
    if (!library_state.apiReady) {
      setLibraryMessage("Move needs the local app launcher.");
      return;
    }
    if (!targetCollectionPath) {
      setLibraryMessage("Select a category.");
      return;
    }
    if (moveToCollectionRequestPending) return;
    moveToCollectionRequestPending = true;
    try {
      const endpoint = itemKey ? "/api/collection/move-item" : "/api/collection/move-post";
      const payload = {
        post_path: sourcePost.folder_path,
        collection_path: targetCollectionPath,
        target_parent_path: targetPostPath || "",
      };
      if (sourcePost.remote || sourcePost.area === "imagine_remote" || sourcePost.area === "imagine_upload_remote") {
        payload.source_post = sourcePost;
      }
      if (itemKey) payload.item_key = itemKey;
      const data = await qApi(endpoint, payload);
      closeMoveToCollectionDialog();
      applyLibrarySnapshot(data);
      toast("Moved to Collection.");
    } finally {
      moveToCollectionRequestPending = false;
    }
  }

  function openMoveToCollectionDialog({ postPath = "", itemKey = "" } = {}) {
    closeMoveToCollectionDialog();
    const sourcePost = moveDialogPost(postPath);
    if (!sourcePost) {
      setLibraryMessage("Select a post to move.");
      return;
    }
    let selectedPrimaryPath = library_state.selectedCollectionPath
      || collectionForPostPath(sourcePost.folder_path)?.path
      || firstMoveCollectionPath();
    let selectedSecondPath = "";
    let collectionSelected = !selectedPrimaryPath;

    const overlay = document.createElement("div");
    overlay.className = "move-gallery-overlay";
    overlay.innerHTML = `
      <section class="move-gallery-modal" role="dialog" aria-modal="true" aria-label="Move to Collection" tabindex="-1">
        <header>
          <div><span>Selected Items</span><h3>Choose a Category or Item</h3></div>
        </header>
        <div class="move-gallery-layout">
          <section class="move-gallery-primary-panel primary-folder-panel" aria-label="First folders">
            <div class="folder-panel-heading">
              <button class="collection-heading-button move-gallery-collection" type="button" aria-pressed="false">Category</button>
            </div>
            <div class="move-gallery-primary-list primary-folder-list"></div>
          </section>
          <section class="move-gallery-secondary-panel secondary-folder-panel" aria-label="Second folders">
            <div class="folder-panel-heading move-gallery-secondary-heading">
              <button class="collection-heading-button move-gallery-item" type="button" aria-pressed="false">Item</button>
              <div class="collection_sort_center move-gallery-sort-center" aria-label="Sort second-level folders">
                <button type="button" data-move-gallery-sort="ko">가나다</button>
                <button type="button" data-move-gallery-sort="abc">ABC</button>
              </div>
              <button class="collection_sort_save_btn move-gallery-sort-save" type="button">Save</button>
              <div class="move-gallery-actions">
                <button class="make-folder-button move-gallery-make" type="button"><span aria-hidden="true">+</span> Make</button>
                <button class="rename-folder-button move-gallery-rename" type="button"><span aria-hidden="true">=</span> Rename</button>
                <button class="delete-folder-button move-gallery-delete" type="button"><span aria-hidden="true">-</span> Delete</button>
              </div>
            </div>
            <div class="move-gallery-secondary-list secondary-folder-grid"></div>
          </section>
        </div>
      </section>
    `;
    document.body.append(overlay);
    moveToCollectionOverlay = overlay;

    const primaryList = overlay.querySelector(".move-gallery-primary-list");
    const secondaryList = overlay.querySelector(".move-gallery-secondary-list");
    const collectionButton = overlay.querySelector(".move-gallery-collection");
    const itemButton = overlay.querySelector(".move-gallery-item");
    const makeButton = overlay.querySelector(".move-gallery-make");
    const renameButton = overlay.querySelector(".move-gallery-rename");
    const deleteButton = overlay.querySelector(".move-gallery-delete");
    const sortButtons = Array.from(overlay.querySelectorAll("[data-move-gallery-sort]"));
    const saveSortButton = overlay.querySelector(".move-gallery-sort-save");

    const selectedCollection = () => library_state.collections.find((collection) => collection.path === selectedPrimaryPath) || null;
    const selectedSecondPost = () => selectedCollection()?.posts?.find((post) => post.folder_path === selectedSecondPath) || null;
    const dialogCollections = () => typeof sortedCollections === "function" ? sortedCollections() : library_state.collections;
    const dialogSortModeFor = (path) => {
      const sort = library_state.library?.settings?.collection_sort;
      return sort && typeof sort === "object" ? sort[path] || "" : "";
    };
    const dialogActiveSortModeFor = (path) => (
      library_state.collectionDraftLayout?.collectionPath === path
        ? library_state.collectionDraftLayout.sortMode || ""
        : dialogSortModeFor(path)
    );
    const dialogPosts = (collection) => typeof collectionPostsWithSlots === "function"
      ? collectionPostsWithSlots(collection)
      : (collection?.posts || []).map((post, index) => ({ ...post, grid_slot: index, order: index }));
    const syncActions = () => {
      collectionButton?.classList.toggle("active", collectionSelected);
      collectionButton?.setAttribute("aria-pressed", collectionSelected ? "true" : "false");
      itemButton?.classList.toggle("active", !collectionSelected);
      itemButton?.setAttribute("aria-pressed", collectionSelected ? "false" : "true");
      if (itemButton) itemButton.disabled = !selectedPrimaryPath;
      if (makeButton) makeButton.disabled = !collectionSelected && !selectedPrimaryPath;
      const actionPath = collectionSelected ? selectedPrimaryPath : selectedSecondPath;
      if (renameButton) renameButton.disabled = !actionPath;
      if (deleteButton) deleteButton.disabled = !actionPath;
      sortButtons.forEach((button) => {
        button.disabled = !selectedPrimaryPath;
        button.classList.toggle("active", Boolean(selectedPrimaryPath) && button.dataset.moveGallerySort === dialogActiveSortModeFor(selectedPrimaryPath));
      });
      if (saveSortButton) saveSortButton.disabled = !selectedPrimaryPath;
    };
    const reorderPrimaryInDialog = async (draggedPath, targetPath) => {
      if (!draggedPath || !targetPath || draggedPath === targetPath) return;
      const collections = dialogCollections();
      const from = collections.findIndex((collection) => collection.path === draggedPath);
      const to = collections.findIndex((collection) => collection.path === targetPath);
      if (from < 0 || to < 0) return;
      const [dragged] = collections.splice(from, 1);
      collections.splice(to, 0, dragged);
      const data = await qApi("/api/collection/layout", {
        primary_order: collections.map((collection) => collection.path),
      });
      refreshAfterFolderAction(data);
    };
    const moveSecondaryInDialog = async (postPath, rawSlot) => {
      const collection = selectedCollection();
      if (!collection || !postPath) return;
      const slot = Math.max(0, Number(rawSlot) || 0);
      const posts = dialogPosts(collection);
      const dragged = posts.find((post) => post.folder_path === postPath);
      if (!dragged) return;
      const occupied = posts.find((post) => post.folder_path !== postPath && Number(post.grid_slot) === slot);
      const oldSlot = Math.max(0, Number(dragged.grid_slot) || 0);
      dragged.grid_slot = slot;
      if (occupied) occupied.grid_slot = oldSlot;
      const orderedPosts = posts.sort((a, b) => (
        Number(a.grid_slot) - Number(b.grid_slot)
        || Number(a.order) - Number(b.order)
        || String(a.created_at || "").localeCompare(String(b.created_at || ""))
      ));
      const entries = typeof collectionSlotEntries === "function"
        ? collectionSlotEntries(orderedPosts)
        : orderedPosts.map((post, index) => ({
          path: post.folder_path,
          order: index,
          grid_slot: Number.isFinite(Number(post.grid_slot)) ? Math.max(0, Math.floor(Number(post.grid_slot))) : index,
        }));
      const data = await qApi("/api/collection/layout", {
        collection_path: collection.path,
        selected_collection_post_path: selectedSecondPath,
        sort_mode: "",
        posts: entries,
      });
      library_state.collectionDraftLayout = null;
      refreshAfterFolderAction(data);
    };
    const sortSecondaryInDialog = (mode) => {
      const collection = selectedCollection();
      if (!collection) {
        showErrorPanel("Sort unavailable", "Select a category.");
        return;
      }
      const locale = mode === "ko" ? "ko-KR" : "en-US";
      const sorted = dialogPosts(collection)
        .slice()
        .sort((a, b) => String(readableName(a.folderName) || a.title || "").localeCompare(
          String(readableName(b.folderName) || b.title || ""),
          locale,
          { numeric: true },
        ));
      library_state.collectionDraftLayout = {
        collectionPath: collection.path,
        sortMode: mode,
        slots: Object.fromEntries(sorted.map((post, index) => [post.folder_path, index])),
      };
      renderSecondary();
    };
    const saveSecondarySortInDialog = async () => {
      const collection = selectedCollection();
      if (!collection) {
        showErrorPanel("Save failed", "Select a category.");
        return;
      }
      const posts = dialogPosts(collection);
      const entries = typeof collectionSlotEntries === "function"
        ? collectionSlotEntries(posts)
        : posts.map((post, index) => ({
          path: post.folder_path,
          order: index,
          grid_slot: Number.isFinite(Number(post.grid_slot)) ? Math.max(0, Math.floor(Number(post.grid_slot))) : index,
        }));
      const data = await qApi("/api/collection/layout", {
        collection_path: collection.path,
        selected_collection_post_path: selectedSecondPath,
        sort_mode: library_state.collectionDraftLayout?.collectionPath === collection.path
          ? library_state.collectionDraftLayout.sortMode || ""
          : dialogSortModeFor(collection.path),
        posts: entries,
      });
      library_state.collectionDraftLayout = null;
      refreshAfterFolderAction(data);
    };
    const renderSecondary = () => {
      const collection = selectedCollection();
      const posts = dialogPosts(collection);
      if (!posts.some((post) => post.folder_path === selectedSecondPath)) selectedSecondPath = "";
      secondaryList.replaceChildren();
      if (!collection) {
        secondaryList.append(moveDialogEmptyNode("Select a category."));
        syncActions();
        return;
      }
      if (!posts.length) {
        secondaryList.append(moveDialogEmptyNode("No items yet."));
        syncActions();
        return;
      }
      const maxSlot = Math.max(11, ...posts.map((post) => Number(post.grid_slot) || 0)) + 8;
      const slots = Array.from({ length: maxSlot + 1 }, (_, slot) => {
        const post = posts.find((candidate) => Number(candidate.grid_slot) === slot) || null;
        if (!post) {
          const emptySlot = document.createElement("button");
          emptySlot.className = "secondary-folder-slot";
          emptySlot.type = "button";
          emptySlot.tabIndex = -1;
          emptySlot.setAttribute("aria-label", "Empty folder position");
          emptySlot.dataset.gridSlot = String(slot);
          return emptySlot;
        }
        const card = document.createElement("button");
        card.className = `secondary-folder-card${post.folder_path === selectedSecondPath ? " active" : ""}`;
        card.type = "button";
        card.draggable = true;
        card.dataset.libraryPostPath = post.folder_path;
        card.dataset.gridSlot = String(slot);
        card.innerHTML = `${collectionFolderCardIconHtml()}<strong></strong>`;
        card.querySelector("strong").textContent = readableName(post.folderName) || post.title || "Folder";
        card.addEventListener("click", () => {
          selectedSecondPath = post.folder_path;
          collectionSelected = false;
          renderSecondary();
        });
        card.addEventListener("dblclick", () => {
          selectedSecondPath = post.folder_path;
          collectionSelected = false;
          moveToCollectionTarget({
            sourcePost,
            itemKey,
            targetCollectionPath: selectedPrimaryPath,
            targetPostPath: post.folder_path,
          }).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
        });
        card.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-grok-q-move-collection-post", post.folder_path);
          library_state.draggingMoveCollectionPostPath = post.folder_path;
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => {
          library_state.draggingMoveCollectionPostPath = "";
          card.classList.remove("dragging");
        });
        return card;
      });
      secondaryList.append(...slots);
      secondaryList.ondragover = (event) => {
        if (!library_state.draggingMoveCollectionPostPath && !dataTransferHasType(event, "application/x-grok-q-move-collection-post")) return;
        event.preventDefault();
        const slotNumber = collectionGridSlotFromPointer(secondaryList, event);
        markCollectionDropSlot(secondaryList, slotNumber);
        event.dataTransfer.dropEffect = "move";
      };
      secondaryList.ondragleave = (event) => {
        if (event.relatedTarget && secondaryList.contains(event.relatedTarget)) return;
        secondaryList.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
      };
      secondaryList.ondrop = (event) => {
        if (!library_state.draggingMoveCollectionPostPath && !dataTransferHasType(event, "application/x-grok-q-move-collection-post")) return;
        event.preventDefault();
        const slotNumber = collectionGridSlotFromPointer(secondaryList, event);
        const draggedPath = event.dataTransfer.getData("application/x-grok-q-move-collection-post") || library_state.draggingMoveCollectionPostPath;
        library_state.draggingMoveCollectionPostPath = "";
        secondaryList.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
        moveSecondaryInDialog(
          draggedPath,
          slotNumber,
        ).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
      };
      syncActions();
    };
    const renderPrimary = () => {
      primaryList.replaceChildren();
      if (!library_state.collections.length) {
        primaryList.append(moveDialogEmptyNode("No category yet."));
        renderSecondary();
        return;
      }
      if (!library_state.collections.some((collection) => collection.path === selectedPrimaryPath)) {
        selectedPrimaryPath = firstMoveCollectionPath();
      }
      for (const collection of dialogCollections()) {
        const card = document.createElement("button");
        card.className = `primary-folder-card${collection.path === selectedPrimaryPath ? " active" : ""}`;
        card.type = "button";
        card.draggable = true;
        card.dataset.collectionPath = collection.path;
        card.innerHTML = `${collectionFolderCardIconHtml()}<span class="folder-card-copy"><strong></strong></span>`;
        card.querySelector("strong").textContent = collection.name || readableName(collection.id);
        card.addEventListener("click", () => {
          selectedPrimaryPath = collection.path;
          selectedSecondPath = "";
          collectionSelected = false;
          renderPrimary();
          renderSecondary();
        });
        card.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-grok-q-move-collection", collection.path);
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("dragover", (event) => {
          if (!dataTransferHasType(event, "application/x-grok-q-move-collection")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        });
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          reorderPrimaryInDialog(
            event.dataTransfer.getData("application/x-grok-q-move-collection"),
            collection.path,
          ).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
        });
        primaryList.append(card);
      }
      syncActions();
    };
    const refreshAfterFolderAction = (data) => {
      applyLibrarySnapshot(data);
      selectedPrimaryPath = data?.selected_collection_path || selectedPrimaryPath || firstMoveCollectionPath();
      selectedSecondPath = data?.selected_collection_post_path || selectedSecondPath || "";
      collectionSelected = !selectedSecondPath;
      renderPrimary();
      renderSecondary();
    };

    collectionButton?.addEventListener("click", () => {
      collectionSelected = true;
      selectedSecondPath = "";
      renderPrimary();
      renderSecondary();
    });
    itemButton?.addEventListener("click", () => {
      if (!selectedPrimaryPath) return;
      collectionSelected = false;
      renderSecondary();
    });
    sortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sortSecondaryInDialog(button.dataset.moveGallerySort || "abc");
      });
    });
    saveSortButton?.addEventListener("click", () => {
      saveSecondarySortInDialog().catch((error) => showErrorPanel("Save failed", error?.message || "Save failed."));
    });
    makeButton?.addEventListener("click", async () => {
      const folderName = await collectionActionInput({
        title: collectionSelected ? "New Category" : "New Item",
        value: "",
        confirmLabel: "Make",
      });
      if (!folderName) return;
      qApi("/api/collection/create", {
        name: folderName,
        parent_path: collectionSelected ? "" : selectedPrimaryPath,
      }).then(refreshAfterFolderAction).catch((error) => showErrorPanel("Make failed", error?.message || "Make failed."));
    });
    renameButton?.addEventListener("click", async () => {
      const targetPost = selectedSecondPost();
      const targetPath = collectionSelected ? selectedPrimaryPath : selectedSecondPath;
      const currentName = collectionSelected
        ? selectedCollection()?.name || ""
        : readableName(targetPost?.folderName) || targetPost?.title || "";
      const name = await collectionActionInput({
        title: collectionSelected ? "Rename Category" : "Rename Item",
        value: currentName,
        confirmLabel: "Rename",
      });
      if (!targetPath || !name) return;
      qApi("/api/collection/rename", { target_path: targetPath, name })
        .then(refreshAfterFolderAction)
        .catch((error) => showErrorPanel("Rename failed", error?.message || "Rename failed."));
    });
    deleteButton?.addEventListener("click", async () => {
      const targetPath = collectionSelected ? selectedPrimaryPath : selectedSecondPath;
      if (!targetPath) return;
      const targetName = collectionSelected
        ? selectedCollection()?.name || collectionNameFromPath(targetPath)
        : readableName(selectedSecondPost()?.folderName) || selectedSecondPost()?.title || collectionNameFromPath(targetPath);
      const ok = await collectionActionConfirm({
        title: collectionSelected ? "Delete Category" : "Delete Item",
        message: targetName,
        confirmLabel: "Delete",
        messageBox: true,
      });
      if (!ok) return;
      qApi("/api/collection/delete", { target_path: targetPath })
        .then(refreshAfterFolderAction)
        .catch((error) => showErrorPanel("Delete failed", error?.message || "Delete failed."));
    });
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeMoveToCollectionDialog();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMoveToCollectionDialog();
      if (event.key === "Enter" && selectedSecondPath) {
        moveToCollectionTarget({
          sourcePost,
          itemKey,
          targetCollectionPath: selectedPrimaryPath,
          targetPostPath: selectedSecondPath,
        }).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
      }
    });
    renderPrimary();
    renderSecondary();
    overlay.querySelector(".move-gallery-modal")?.focus?.();
  }

  function openMoveToCollectionDialogForDetail() {
    const post = selectedLibraryPost();
    const item = selectedDetailItem(post);
    if (!post || !item) {
      setLibraryMessage("Select a post and item.");
      return;
    }
    openMoveToCollectionDialog({
      postPath: post.folder_path,
      itemKey: mediaItemKey(item),
    });
  }

  async function makeCollectionFolder() {
    const target = selectedCollectionActionTarget();
    const label = collectionKindLabel(target.level);
    const name = await collectionActionInput({
      title: `New ${label}`,
      value: "",
      confirmLabel: "Make",
    });
    if (!name) return;
    if (library_state.apiReady) {
      if (!library_state.rootPath) {
        await chooseLibraryPath();
        if (!library_state.rootPath) return;
      }
      const data = await qApi("/api/collection/create", {
        name,
        parent_path: target.level === "second" ? target.collection?.path || library_state.selectedCollectionPath : "",
      });
      applyLibrarySnapshot(data);
      return;
    }
    if (!library_state.rootHandle) {
      await chooseLibraryPath();
      return;
    }
    const folderName = name.trim().replace(/[/:\\]/g, "-");
    if (target.level === "second" && target.collection?.handle) {
      const secondHandle = await target.collection.handle.getDirectoryHandle(folderName, { create: true });
      const folderPath = `${target.collection.path}/${folderName}`;
      await writeJsonFile(secondHandle, "post.json", {
        post_id: folderName,
        source: "local",
        mode: "",
        title: readableName(folderName),
        prompt: "",
        created_at: libraryNow(),
        updated_at: libraryNow(),
        folder_path: folderPath,
        collection: target.collection.id,
        representative: "",
        items: [],
      });
      library_state.selectedCollectionPostPath = folderPath;
    } else {
      const collectionRoot = await library_state.rootHandle.getDirectoryHandle("collection", { create: true });
      await collectionRoot.getDirectoryHandle(folderName, { create: true });
      library_state.selectedCollectionPath = `collection/${folderName}`;
      library_state.selectedCollectionPostPath = "";
    }
    await scanLibrary();
  }

  async function renameCollectionFolder() {
    const target = selectedCollectionActionTarget();
    if (!target.path) {
      setLibraryMessage("Select a category or item.");
      return;
    }
    const label = collectionKindLabel(target.level);
    const name = await collectionActionInput({
      title: `Rename ${label}`,
      value: collectionTargetName(target),
      confirmLabel: "Rename",
    });
    if (!name) return;
    if (library_state.apiReady) {
      const data = await qApi("/api/collection/rename", {
        target_path: target.path,
        name,
      });
      applyLibrarySnapshot(data);
      return;
    }
    setLibraryMessage("Rename needs the local app launcher.");
  }

  async function deleteCollectionFolder() {
    const target = selectedCollectionActionTarget();
    if (!target.path) {
      setLibraryMessage("Select a category or item.");
      return;
    }
    const label = collectionKindLabel(target.level);
    const ok = await collectionActionConfirm({
      title: `Delete ${label}`,
      message: collectionTargetName(target),
      confirmLabel: "Delete",
      messageBox: true,
    });
    if (!ok) return;
    if (library_state.apiReady) {
      const data = await qApi("/api/collection/delete", { target_path: target.path });
      applyLibrarySnapshot(data);
      return;
    }
    setLibraryMessage("Delete needs the local app launcher.");
  }
