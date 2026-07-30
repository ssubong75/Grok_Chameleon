// Collection category, item grid, and second-level main rendering
  const COLLECTION_SECOND_MAIN_VIRTUAL_LIST_KEY = "collection-second-main";

  function selectedCollectionPost() {
    if (!library_state.selectedCollectionPostPath) return null;
    return library_state.posts.find((post) => post.folder_path === library_state.selectedCollectionPostPath)
      || library_state.collections.flatMap((collection) => collection.posts || [])
        .find((post) => post.folder_path === library_state.selectedCollectionPostPath)
      || null;
  }


  function collectionDirectPosts(collection) {
    if (!collection) return [];
    const baseDepth = String(collection.path || "").split("/").filter(Boolean).length;
    return (collection.posts || []).filter((post) => (
      String(post.folder_path || "").split("/").filter(Boolean).length === baseDepth + 1
    ));
  }


  function collectionChildPosts(collection, parentPath) {
    const parent = String(parentPath || "");
    if (!collection || !parent) return [];
    const parentDepth = parent.split("/").filter(Boolean).length;
    return (collection.posts || []).filter((post) => {
      const path = String(post.folder_path || "");
      return path.startsWith(`${parent}/`) && path.split("/").filter(Boolean).length === parentDepth + 1;
    });
  }


  function secondMainPostsFor(post = selectedCollectionPost()) {
    if (!post) return [];
    const collection = library_state.collections.find((item) => String(post.folder_path || "").startsWith(`${item.path}/`));
    const childPosts = collectionChildPosts(collection, post.folder_path)
      .filter((item) => Array.isArray(item.items) && item.items.length);
    const selfPosts = Array.isArray(post.items) && post.items.length ? [post] : [];
    return [...selfPosts, ...childPosts];
  }


  function renderSecondMain(post = selectedCollectionPost()) {
    const title = document.querySelector(".second_main_header h2");
    const list = document.querySelector(".second_main_card_list");
    if (!list) return;
    if (
      post
      && library_state.libraryIndexEnabled
      && (post._indexed_summary || !post._indexed_children_loaded)
    ) {
      if (!post._indexed_children_loading && typeof loadIndexedCollectionPostContents === "function") {
        loadIndexedCollectionPostContents(post.folder_path).catch((error) => console.warn(error));
      }
      if (title) title.textContent = post.title || readableName(post.folderName);
      disableVirtualCardList(COLLECTION_SECOND_MAIN_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
      return;
    }
    const posts = secondMainPostsFor(post);
    if (!posts.length) {
      if (title) title.textContent = "Item";
      disableVirtualCardList(COLLECTION_SECOND_MAIN_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("No items."));
      return;
    }
    if (title) title.textContent = post.title || readableName(post.folderName);
    renderVirtualCardList(COLLECTION_SECOND_MAIN_VIRTUAL_LIST_KEY, list, posts.map((item) => virtualCardRenderSpecForPost(item, "collection_media_card", {
        screenId: "2nd_main",
        activeButtonId: "b_collection_nav_btn",
    })), {
      loading: Boolean(post?._indexed_children_loading),
    });
  }


  function maybeLoadMoreCollectionSecondMain() {
    const list = document.querySelector(".second_main_card_list");
    const post = selectedCollectionPost();
    if (
      !list
      || !post?._indexed_children_has_more
      || post._indexed_children_loading
      || virtualCardListRemaining(list) > 240
      || typeof loadIndexedCollectionPostContents !== "function"
    ) {
      return;
    }
    loadIndexedCollectionPostContents(post.folder_path, { append: true })
      .catch((error) => console.warn(error));
  }


  function maybeLoadMoreCollectionFolders() {
    const grid = document.querySelector(".collection_2nd_card_grid");
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (
      !grid
      || !collection?.indexed_has_more
      || collection.indexed_loading
      || grid.scrollHeight - grid.scrollTop - grid.clientHeight > 180
      || typeof loadIndexedCollectionPosts !== "function"
    ) {
      return;
    }
    loadIndexedCollectionPosts(collection.path, { append: true })
      .catch((error) => console.warn(error));
  }


  function collectionOrderIndex() {
    const order = library_state.library?.settings?.collection_order;
    return new Map((Array.isArray(order) ? order : []).map((path, index) => [String(path), index]));
  }


  function collectionSortMap() {
    const sort = library_state.library?.settings?.collection_sort;
    return sort && typeof sort === "object" ? sort : {};
  }


  function sortedCollections() {
    const order = collectionOrderIndex();
    return [...library_state.collections].sort((a, b) => (
      (order.get(a.path) ?? Number(a.order ?? 10000)) - (order.get(b.path) ?? Number(b.order ?? 10000))
      || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true })
    ));
  }


  function collectionSortModeFor(path) {
    return library_state.collectionDraftLayout?.collectionPath === path
      ? library_state.collectionDraftLayout.sortMode || ""
      : collectionSortMap()[path] || "";
  }


  function dataTransferHasType(event, type) {
    const types = event?.dataTransfer?.types;
    if (!types) return false;
    if (typeof types.includes === "function") return types.includes(type);
    if (typeof types.contains === "function") return types.contains(type);
    return Array.from(types).includes(type);
  }


  function collectionGridRenderedMaxSlot(grid) {
    return Math.max(0, ...Array.from(grid.querySelectorAll("[data-grid-slot]"))
      .map((node) => Number(node.dataset.gridSlot))
      .filter(Number.isFinite));
  }


  function collectionGridSlotFromPointer(grid, event) {
    const direct = event.target?.closest?.("[data-grid-slot]");
    if (direct && grid.contains(direct)) return Math.max(0, Number(direct.dataset.gridSlot) || 0);
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(" ").filter((value) => value && value !== "none").length || 1;
    const columnGap = parseFloat(style.columnGap || style.gap) || 0;
    const rowGap = parseFloat(style.rowGap || style.gap) || 0;
    const rowHeight = parseFloat(style.gridAutoRows) || 50;
    const columnWidth = Math.max(1, (grid.clientWidth - columnGap * Math.max(0, columns - 1)) / columns);
    const x = Math.max(0, event.clientX - rect.left + grid.scrollLeft);
    const y = Math.max(0, event.clientY - rect.top + grid.scrollTop);
    const column = Math.min(columns - 1, Math.floor(x / (columnWidth + columnGap)));
    const row = Math.max(0, Math.floor(y / (rowHeight + rowGap)));
    return Math.min(row * columns + column, collectionGridRenderedMaxSlot(grid));
  }


  function markCollectionDropSlot(grid, slotNumber) {
    grid.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    const target = Array.from(grid.querySelectorAll("[data-grid-slot]"))
      .find((node) => Number(node.dataset.gridSlot) === Number(slotNumber));
    target?.classList.add("drop-target");
  }


  function collectionPostsWithSlots(collection) {
    if (!collection) return [];
    const draft = library_state.collectionDraftLayout?.collectionPath === collection.path
      ? library_state.collectionDraftLayout.slots
      : null;
    const posts = collectionDirectPosts(collection).map((post, index) => ({
      ...post,
      order: Number.isFinite(Number(post.order)) ? Number(post.order) : index,
      grid_slot: draft && Object.hasOwn(draft, post.folder_path)
        ? Number(draft[post.folder_path])
        : (Number.isFinite(Number(post.grid_slot)) ? Math.max(0, Math.floor(Number(post.grid_slot))) : index),
    }));
    return normalizeCollectionSlotPosts(posts);
  }


  function normalizeCollectionSlotPosts(posts) {
    const sorted = (posts || []).slice().sort((a, b) => (
      Number(a.grid_slot) - Number(b.grid_slot)
      || Number(a.order) - Number(b.order)
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
      || String(a.folder_path || "").localeCompare(String(b.folder_path || ""))
    ));
    const occupied = new Set();
    let nextSlot = 0;
    const normalized = sorted.map((post, index) => {
      let slot = Number(post.grid_slot);
      if (!Number.isFinite(slot) || slot < 0) slot = -1;
      slot = Math.floor(slot);
      if (slot < 0 || occupied.has(slot)) {
        while (occupied.has(nextSlot)) nextSlot += 1;
        slot = nextSlot;
      }
      occupied.add(slot);
      nextSlot = Math.max(nextSlot, slot + 1);
      return {
        ...post,
        order: Number.isFinite(Number(post.order)) ? Number(post.order) : index,
        grid_slot: slot,
      };
    });
    return normalized.sort((a, b) => (
      Number(a.grid_slot) - Number(b.grid_slot)
      || Number(a.order) - Number(b.order)
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
      || String(a.folder_path || "").localeCompare(String(b.folder_path || ""))
    ));
  }


  function collectionSlotEntries(posts) {
    return (posts || []).map((post, index) => ({
      path: post.folder_path,
      order: index,
      grid_slot: Number.isFinite(Number(post.grid_slot)) ? Math.max(0, Math.floor(Number(post.grid_slot))) : index,
    })).filter((entry) => entry.path);
  }


  async function saveCollectionLayout(payload) {
    if (!library_state.apiReady) {
      setLibraryMessage("Collection layout needs the local app launcher.");
      return;
    }
    const data = await qApi("/api/collection/layout", payload);
    applyLibrarySnapshot(data);
  }


  async function reorderCollectionPrimary(draggedPath, targetPath) {
    if (!draggedPath || !targetPath || draggedPath === targetPath) return;
    const collections = sortedCollections();
    const from = collections.findIndex((collection) => collection.path === draggedPath);
    const to = collections.findIndex((collection) => collection.path === targetPath);
    if (from < 0 || to < 0) return;
    const [dragged] = collections.splice(from, 1);
    collections.splice(to, 0, dragged);
    await saveCollectionLayout({ primary_order: collections.map((collection) => collection.path) });
  }


  async function moveCollectionPostToSlot(postPath, rawSlot) {
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (!collection || !postPath) return;
    const slot = Math.max(0, Number(rawSlot) || 0);
    const posts = collectionPostsWithSlots(collection);
    const dragged = posts.find((post) => post.folder_path === postPath);
    if (!dragged) return;
    const occupied = posts.find((post) => post.folder_path !== postPath && Number(post.grid_slot) === slot);
    const oldSlot = Math.max(0, Number(dragged.grid_slot) || 0);
    dragged.grid_slot = slot;
    if (occupied) occupied.grid_slot = oldSlot;
    const entries = collectionSlotEntries(posts.sort((a, b) => (
      Number(a.grid_slot) - Number(b.grid_slot)
      || Number(a.order) - Number(b.order)
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    )));
    library_state.collectionSort = "";
    library_state.collectionDraftLayout = null;
    await saveCollectionLayout({
      collection_path: collection.path,
      selected_collection_post_path: library_state.selectedCollectionPostPath,
      sort_mode: "",
      posts: entries,
    });
    renderCollectionFolders();
  }


  function sortCollectionFolders(mode) {
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (!collection) {
      setLibraryMessage("Select a category.");
      return;
    }
    const locale = mode === "ko" ? "ko-KR" : "en-US";
    const sorted = collectionPostsWithSlots(collection)
      .slice()
      .sort((a, b) => String(readableName(a.folderName) || a.title || "").localeCompare(
        String(readableName(b.folderName) || b.title || ""),
        locale,
        { numeric: true },
      ));
    library_state.collectionSort = mode;
    library_state.collectionDraftLayout = {
      collectionPath: collection.path,
      sortMode: mode,
      slots: Object.fromEntries(sorted.map((post, index) => [post.folder_path, index])),
    };
    renderCollectionFolders();
  }


  async function saveCurrentCollectionSort() {
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (!collection) {
      setLibraryMessage("Select a category.");
      return;
    }
    const posts = collectionSlotEntries(collectionPostsWithSlots(collection));
    await saveCollectionLayout({
      collection_path: collection.path,
      selected_collection_post_path: library_state.selectedCollectionPostPath,
      sort_mode: library_state.collectionSort || collectionSortModeFor(collection.path),
      posts,
    });
    library_state.collectionDraftLayout = null;
    renderCollectionFolders();
  }


  function renderCollectionFolders() {
    const firstList = document.querySelector(".collection_1st_card_list");
    if (!firstList) return;
    if (!library_state.collections.length) {
      library_state.selectedCollectionPath = "";
      library_state.selectedCollectionPostPath = "";
      firstList.replaceChildren(emptyLibraryNode("No category yet."));
      renderCollectionPosts(null);
      renderSecondMain(null);
      return;
    }
    if (!library_state.collections.some((collection) => collection.path === library_state.selectedCollectionPath)) {
      library_state.selectedCollectionPath = "";
      library_state.selectedCollectionPostPath = "";
    }
    firstList.replaceChildren(...sortedCollections().map((collection) => {
      const card = document.createElement("button");
      card.className = `collection_1st_card${collection.path === library_state.selectedCollectionPath ? " active" : ""}`;
      card.type = "button";
      card.draggable = true;
      card.dataset.collectionPath = collection.path;
      card.innerHTML = `
        <span class="collection_folder_copy"><strong></strong></span>
      `;
      card.querySelector("strong").textContent = collection.name;
      card.addEventListener("click", () => {
        const nextPath = library_state.selectedCollectionPath === collection.path ? "" : collection.path;
        library_state.selectedCollectionPath = nextPath;
        library_state.selectedCollectionPostPath = "";
        library_state.collectionActionLevel = "first";
        library_state.collectionSort = nextPath ? collectionSortModeFor(nextPath) : "";
        library_state.collectionDraftLayout = null;
        library_state.collectionView = "2nd_folders";
        renderCollectionFolders();
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-grok-q-collection", collection.path);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (event) => {
        if (!dataTransferHasType(event, "application/x-grok-q-collection")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        reorderCollectionPrimary(
          event.dataTransfer.getData("application/x-grok-q-collection"),
          collection.path,
        ).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
      });
      return card;
    }));
    renderCollectionPosts(library_state.collections.find((collection) => collection.path === library_state.selectedCollectionPath));
  }


  function renderCollectionPosts(collection) {
    const grid = document.querySelector(".collection_2nd_card_grid");
    const heading = document.querySelector(".collection_2nd_heading strong");
    if (!grid) return;
    if (heading) heading.textContent = "";
    document.querySelectorAll("[data-collection-sort]").forEach((button) => {
      button.classList.toggle("active", Boolean(collection) && button.dataset.collectionSort === collectionSortModeFor(collection.path));
    });
    document.querySelector(".collection_title_btn")?.classList.toggle("active", library_state.collectionActionLevel !== "second");
    document.querySelector(".collection_item_title_btn")?.classList.toggle("active", library_state.collectionActionLevel === "second");
    if (!collection) {
      grid.replaceChildren(emptyLibraryNode(""));
      return;
    }
    if (library_state.libraryIndexEnabled && !collection.indexed_loaded) {
      if (!collection.indexed_loading && typeof loadIndexedCollectionPosts === "function") {
        loadIndexedCollectionPosts(collection.path).catch((error) => console.warn(error));
      }
      grid.replaceChildren(emptyLibraryNode("Loading . . ."));
      return;
    }
    const directPosts = collectionDirectPosts(collection);
    if (!directPosts.length) {
      library_state.selectedCollectionPostPath = "";
      grid.replaceChildren(emptyLibraryNode("No items yet."));
      return;
    }
    if (!directPosts.some((post) => post.folder_path === library_state.selectedCollectionPostPath)) {
      library_state.selectedCollectionPostPath = "";
    }
    library_state.collectionView = "2nd_folders";
    const posts = collectionPostsWithSlots(collection);
    const maxSlot = Math.max(11, ...posts.map((post) => Number(post.grid_slot) || 0)) + 8;
    const postBySlot = new Map(posts.map((post) => [Number(post.grid_slot) || 0, post]));
    const slots = Array.from({ length: maxSlot + 1 }, (_, slot) => {
      const post = postBySlot.get(slot);
      if (!post) {
        const emptySlot = document.createElement("button");
        emptySlot.className = "collection_2nd_slot";
        emptySlot.type = "button";
        emptySlot.tabIndex = -1;
        emptySlot.dataset.gridSlot = String(slot);
        emptySlot.setAttribute("aria-label", "Empty folder position");
        return emptySlot;
      }
      const card = document.createElement("article");
      card.className = `collection_2nd_card${post.folder_path === library_state.selectedCollectionPostPath ? " active" : ""}`;
      if (library_state.selectedItems.has(post.folder_path || "")) card.classList.add("selected");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.draggable = true;
      card.dataset.libraryPostPath = post.folder_path;
      card.dataset.gridSlot = String(slot);
      const title = document.createElement("strong");
      title.textContent = readableName(post.folderName) || post.title || "Folder";
      card.append(title);
      card.addEventListener("click", () => {
        library_state.selectedCollectionPostPath = library_state.selectedCollectionPostPath === post.folder_path ? "" : post.folder_path;
        library_state.collectionActionLevel = "second";
        document.querySelector(".collection_title_btn")?.classList.remove("active");
        document.querySelector(".collection_item_title_btn")?.classList.add("active");
        for (const item of grid.querySelectorAll(".collection_2nd_card")) {
          item.classList.toggle("active", item.dataset.libraryPostPath === library_state.selectedCollectionPostPath);
        }
      });
      card.addEventListener("dblclick", () => {
        library_state.selectedCollectionPostPath = post.folder_path;
        library_state.collectionActionLevel = "second";
        selectLibraryPost(post.folder_path);
        renderSecondMain(post);
        openScreen("2nd_main", "b_collection_nav_btn");
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("button")) return;
        event.preventDefault();
        library_state.selectedCollectionPostPath = post.folder_path;
        library_state.collectionActionLevel = "second";
        selectLibraryPost(post.folder_path);
        renderSecondMain(post);
        openScreen("2nd_main", "b_collection_nav_btn");
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-grok-q-collection-post", post.folder_path);
        library_state.draggingCollectionPostPath = post.folder_path;
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        library_state.draggingCollectionPostPath = "";
        card.classList.remove("dragging");
      });
      return card;
    });
    grid.replaceChildren(...slots);
    grid.ondragover = (event) => {
      if (!library_state.draggingCollectionPostPath && !dataTransferHasType(event, "application/x-grok-q-collection-post")) return;
      event.preventDefault();
      const slotNumber = collectionGridSlotFromPointer(grid, event);
      markCollectionDropSlot(grid, slotNumber);
      event.dataTransfer.dropEffect = "move";
    };
    grid.ondragleave = (event) => {
      if (event.relatedTarget && grid.contains(event.relatedTarget)) return;
      grid.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    };
    grid.ondrop = (event) => {
      if (!library_state.draggingCollectionPostPath && !dataTransferHasType(event, "application/x-grok-q-collection-post")) return;
      event.preventDefault();
      const slotNumber = collectionGridSlotFromPointer(grid, event);
      const draggedPath = event.dataTransfer.getData("application/x-grok-q-collection-post") || library_state.draggingCollectionPostPath;
      library_state.draggingCollectionPostPath = "";
      grid.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
      moveCollectionPostToSlot(
        draggedPath,
        slotNumber,
      ).catch((error) => showErrorPanel("Move failed", error?.message || "Move failed."));
    };
  }


  document.querySelector(".collection_2nd_card_grid")?.addEventListener(
    "scroll",
    maybeLoadMoreCollectionFolders,
    { passive: true },
  );
  bindVirtualCardListScroll(
    COLLECTION_SECOND_MAIN_VIRTUAL_LIST_KEY,
    document.querySelector(".second_main_card_list"),
    maybeLoadMoreCollectionSecondMain,
  );
