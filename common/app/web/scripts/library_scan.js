// Library scanning and path restore
  function mergeMediaItemsWithMeta(mediaItems, metaItems) {
    if (!mediaItems.length || !metaItems.length) return mediaItems;
    const usedItemIds = new Set();
    return mediaItems.map((mediaItem) => {
      const metaItem = metaItems.find((item) => item.file && item.file === mediaItem.file)
        || metaItems.find((item) => item.url && item.url === mediaItem.url)
        || metaItems.find((item) => item.item_id && item.item_id === mediaItem.item_id);
      const mergedItem = metaItem
        ? {
          ...metaItem,
          ...mediaItem,
          role: metaItem.role || mediaItem.role,
          relation: metaItem.relation || mediaItem.relation || "",
          prompt: metaItem.prompt || mediaItem.prompt || "",
          title: metaItem.title || mediaItem.title || "",
        }
        : { ...mediaItem };
      mergedItem.item_id = claimUniqueMediaItemId(
        metaItem?.item_id || mediaItem.item_id || fileBaseName(mergedItem.file || ""),
        usedItemIds,
      );
      return mergedItem;
    });
  }

  function postOriginKey(post) {
    return String(
      post?.split_from_post_id
      || post?.source_post_id
      || post?.group_id
      || post?.root_post_id
      || post?.original_post_id
      || post?.post_id
      || ""
    );
  }

  function postHasOrigin(post, originKey) {
    if (!originKey) return false;
    return [
      post?.split_from_post_id,
      post?.source_post_id,
      post?.group_id,
      post?.root_post_id,
      post?.original_post_id,
      post?.post_id,
    ].some((value) => String(value || "") === String(originKey));
  }

  function representativeItemTimeValue(item, fallbackIndex) {
    const candidates = [
      item?.created_at,
      item?.createdAt,
      item?.timestamp,
      item?.updated_at,
      item?.updatedAt,
      item?.last_modified,
      item?.lastModified,
    ];
    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      const parsed = Date.parse(String(value || ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    const file = String(item?.file || item?.url || item?.item_id || "");
    const stamp = file.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})?[-_]?(\d{2})?[-_]?(\d{2})?/);
    if (stamp) {
      const [, year, month, day, hour = "00", minute = "00", second = "00"] = stamp;
      const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallbackIndex;
  }

  function representativeResultItem(item) {
    const role = String(item?.role || item?.relation || item?.source_type || item?.kind || "").toLowerCase();
    return !/(original|source|start|input|parent|reference|ref)/.test(role);
  }

  function representativeNestedValue(item, ...keys) {
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    for (const source of [item, metadata, imagine]) {
      for (const key of keys) {
        const value = source?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return "";
  }

  function representativeMediaUrl(item, type) {
    return representativeNestedValue(
      item,
      type === "video" ? "hd1080_media_url" : "",
      type === "video" ? "hd1080MediaUrl" : "",
      type === "video" ? "hd_media_url" : "",
      type === "video" ? "hdMediaUrl" : "",
      "object_url",
      "url",
      "media_url",
      "mediaUrl",
      "remote_url",
      "source_url",
      type === "video" ? "imagine_video_media_url" : "imagine_media_url",
    );
  }

  function representativePreviewUrl(item, type) {
    return representativeNestedValue(
      item,
      "thumbnail_url",
      "thumbnailUrl",
      "poster_url",
      "posterUrl",
      "preview_url",
      "previewUrl",
      "primary_poster_url",
      "primaryPosterUrl",
    ) || (type === "image" ? representativeMediaUrl(item, type) : "");
  }

  function representativeRemoteDiscover(meta) {
    const metadata = meta?.metadata && typeof meta.metadata === "object" ? meta.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    const mode = String(meta?.mode || metadata.remote_view || imagine.remote_view || "").toLowerCase();
    return Boolean((meta?.remote || meta?.area === "imagine_remote") && mode === "discover");
  }

  function representativeUsableCandidate(item, type, meta) {
    if (!item || item.type !== type) return false;
    if (type === "image") return Boolean(representativePreviewUrl(item, type));
    const mediaUrl = representativeMediaUrl(item, type);
    if (!mediaUrl) return false;
    if (representativeRemoteDiscover(meta)) return Boolean(representativePreviewUrl(item, type));
    return true;
  }

  function latestRepresentativeCandidate(items, type, requireResult = true, meta = null) {
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => representativeUsableCandidate(item, type, meta) && (!requireResult || representativeResultItem(item)));
    if (!candidates.length) return null;
    return candidates.reduce((latest, candidate) => {
      const latestTime = representativeItemTimeValue(latest.item, latest.index);
      const candidateTime = representativeItemTimeValue(candidate.item, candidate.index);
      if (candidateTime !== latestTime) return candidateTime > latestTime ? candidate : latest;
      return candidate.index > latest.index ? candidate : latest;
    }).item;
  }

  function representativeItem(items, meta) {
    const list = Array.isArray(items) ? items : [];
    const wanted = meta?.representative || meta?.representative_file || "";
    return latestRepresentativeCandidate(list, "video", true, meta)
      || latestRepresentativeCandidate(list, "image", true, meta)
      || latestRepresentativeCandidate(list, "video", false, meta)
      || latestRepresentativeCandidate(list, "image", false, meta)
      || (wanted ? list.find((item) => item.file === wanted || item.url === wanted || item.item_id === wanted) : null)
      || list[0]
      || null;
  }

  async function postFromFolder(dirHandle, context) {
    const meta = await readJsonFile(dirHandle, "post.json");
    const mediaItems = await mediaItemsInFolder(dirHandle);
    const metaItems = mediaItemsFromMeta(meta);
    const remoteItem = meta ? remoteItemFromMeta(meta) : null;
    const items = mediaItems.length ? mergeMediaItemsWithMeta(mediaItems, metaItems) : (metaItems.length ? metaItems : (remoteItem ? [remoteItem] : []));
    if (!meta && !items.length) return null;
    const representative = representativeItem(items, meta);
    const createdAt = meta?.created_at
      || postField(meta, "createTime")
      || postField(meta, "created_at")
      || (items[0]?.last_modified ? new Date(items[0].last_modified).toISOString() : libraryNow());
    const source = meta?.source
      || (postField(meta, "provider") === "imagine" || postField(meta, "imagine_post_id") ? "imagine" : "")
      || context.source
      || "local";
    return {
      post_id: meta?.post_id || postField(meta, "imagine_post_id") || postField(meta, "id") || context.folderName,
      source,
      mode: meta?.mode || context.mode || "",
      title: meta?.title || postField(meta, "title") || postField(meta, "prompt") || readableName(context.folderName),
      prompt: meta?.prompt || postField(meta, "prompt") || postField(meta, "full_prompt") || "",
      original_prompt: meta?.original_prompt || postField(meta, "originalPrompt") || "",
      created_at: createdAt,
      model: meta?.model || postField(meta, "model") || postField(meta, "modelName") || postField(meta, "model_name") || "",
      group_id: meta?.group_id || postField(meta, "group_id") || "",
      parent_id: meta?.parent_id || postField(meta, "parent_id") || "",
      root_post_id: meta?.root_post_id || postField(meta, "root_post_id") || "",
      original_post_id: meta?.original_post_id || "",
      source_post_id: meta?.source_post_id || "",
      split_from_post_id: meta?.split_from_post_id || "",
      account_id: meta?.account_id || postField(meta, "imagine_account_id") || "",
      account_email: meta?.account_email || postField(meta, "imagine_account_email") || "",
      folder_path: context.path,
      collection: context.collection || null,
      area: context.area,
      folderName: context.folderName,
      parentHandle: context.parentHandle,
      directoryHandle: dirHandle,
      representative: representative?.file || representative?.url || "",
      representative_item: representative,
      items,
    };
  }

  async function scanPostTree(dirHandle, context, depth = 0) {
    if (depth > 5) return [];
    const posts = [];
    const post = await postFromFolder(dirHandle, context);
    if (post) posts.push(post);
    for (const entry of await sortedDirectoryEntries(dirHandle)) {
      if (entry.kind !== "directory") continue;
      posts.push(...await scanPostTree(entry, {
        ...context,
        path: `${context.path}/${entry.name}`,
        folderName: entry.name,
        parentHandle: dirHandle,
      }, depth + 1));
    }
    return posts;
  }

    async function scanCreatedArea(rootHandle, area, logicalArea = area) {
      const areaHandle = await getOptionalDirectory(rootHandle, area);
      if (!areaHandle) return [];
      const posts = [];
      if (logicalArea === "upload") {
        const rootPost = await postFromFolder(areaHandle, {
          area: logicalArea,
          path: area,
          folderName: area,
          parentHandle: rootHandle,
          collection: null,
          source: "local",
        });
        if (rootPost) posts.push(rootPost);
      }
      for (const entry of await sortedDirectoryEntries(areaHandle)) {
      if (entry.kind !== "directory") continue;
      posts.push(...await scanPostTree(entry, {
          area: logicalArea,
          path: `${area}/${entry.name}`,
        folderName: entry.name,
        parentHandle: areaHandle,
        collection: null,
          source: logicalArea === "upload" ? "local" : "",
      }));
    }
    return posts;
  }

  async function postFromUnsavedJson(fileHandle, context) {
    let meta = null;
    try {
      const text = await (await fileHandle.getFile()).text();
      meta = text.trim() ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (!meta || typeof meta !== "object") return null;
    const items = mediaItemsFromMeta(meta);
    const remoteItem = remoteItemFromMeta(meta);
    if (remoteItem && !items.length) items.push(remoteItem);
    const representative = representativeItem(items, meta);
    return {
      post_id: meta.post_id || postField(meta, "imagine_post_id") || postField(meta, "id") || fileBaseName(fileHandle.name),
      source: meta.source || (postField(meta, "provider") === "imagine" ? "imagine" : "build"),
      mode: meta.mode || "t2i",
      status: meta.status || "unsaved",
      title: meta.title || meta.prompt || readableName(fileHandle.name),
      prompt: meta.prompt || postField(meta, "prompt") || "",
      original_prompt: meta.original_prompt || postField(meta, "originalPrompt") || "",
      created_at: meta.created_at || postField(meta, "createTime") || libraryNow(),
      model: meta.model || postField(meta, "model") || postField(meta, "modelName") || "",
      group_id: meta.group_id || postField(meta, "group_id") || "",
      parent_id: meta.parent_id || postField(meta, "parent_id") || "",
      root_post_id: meta.root_post_id || postField(meta, "root_post_id") || "",
      original_post_id: meta.original_post_id || "",
      source_post_id: meta.source_post_id || "",
      split_from_post_id: meta.split_from_post_id || "",
      account_id: meta.account_id || postField(meta, "imagine_account_id") || "",
      account_email: meta.account_email || postField(meta, "imagine_account_email") || "",
      folder_path: context.path,
      collection: null,
      area: "unsaved",
      folderName: fileBaseName(fileHandle.name),
      parentHandle: context.parentHandle,
      directoryHandle: context.parentHandle,
      representative: representative?.file || representative?.url || "",
      representative_item: representative,
      items,
    };
  }

  async function scanUnsavedArea(rootHandle) {
    const unsavedHandle = await getOptionalDirectory(rootHandle, "unsaved");
    if (!unsavedHandle) return [];
    const posts = [];
    async function walk(dirHandle, path, depth = 0) {
      if (depth > 5) return;
      const folderPost = await postFromFolder(dirHandle, {
        area: "unsaved",
        path,
        folderName: path.split("/").pop() || "unsaved",
        parentHandle: dirHandle,
        collection: null,
      });
      if (folderPost) posts.push(folderPost);
      for (const entry of await sortedDirectoryEntries(dirHandle)) {
        if (entry.kind === "directory") {
          await walk(entry, `${path}/${entry.name}`, depth + 1);
        } else if (extensionFor(entry.name) === "json" && entry.name !== "post.json") {
          const post = await postFromUnsavedJson(entry, {
            path: `${path}/${entry.name}`,
            parentHandle: dirHandle,
          });
          if (post) posts.push(post);
        }
      }
    }
    await walk(unsavedHandle, "unsaved");
    return posts;
  }

  async function scanCollectionFolders(rootHandle) {
    const collectionRoot = await getOptionalDirectory(rootHandle, "collection");
    if (!collectionRoot) return [];
    const collections = [];
    for (const entry of await sortedDirectoryEntries(collectionRoot)) {
      if (entry.kind !== "directory") continue;
      const collection = {
        id: entry.name,
        name: readableName(entry.name),
        path: `collection/${entry.name}`,
        handle: entry,
        posts: [],
      };
      const directPost = await postFromFolder(entry, {
        area: "collection",
        path: collection.path,
        folderName: entry.name,
        parentHandle: collectionRoot,
        collection: entry.name,
      });
      if (directPost) collection.posts.push(directPost);
      for (const child of await sortedDirectoryEntries(entry)) {
        if (child.kind !== "directory") continue;
        collection.posts.push(...await scanPostTree(child, {
          area: "collection",
          path: `${collection.path}/${child.name}`,
          folderName: child.name,
          parentHandle: entry,
          collection: entry.name,
        }));
      }
      collections.push(collection);
    }
    return collections;
  }

  async function scanPromptFiles(rootHandle) {
    const promptHandle = await getOptionalDirectory(rootHandle, "prompt");
    if (!promptHandle) return [];
    const prompts = [];
    for (const entry of await sortedDirectoryEntries(promptHandle)) {
      if (entry.kind !== "file" || extensionFor(entry.name) !== "txt") continue;
      const file = await entry.getFile();
      const text = await file.text();
      prompts.push({
        id: fileBaseName(entry.name),
        title: readableName(entry.name),
        file_name: entry.name,
        path: `prompt/${entry.name}`,
        text,
        updated_at: new Date(file.lastModified).toISOString(),
      });
    }
    return prompts.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  function postSummary(post) {
    return {
      post_id: post.post_id,
      source: post.source,
      mode: post.mode,
      title: post.title,
      prompt: post.prompt || "",
      path: post.folder_path,
      collection: post.collection,
      representative: post.representative,
      created_at: post.created_at,
      group_id: post.group_id || "",
      parent_id: post.parent_id || "",
      root_post_id: post.root_post_id || "",
      original_post_id: post.original_post_id || "",
      source_post_id: post.source_post_id || "",
      split_from_post_id: post.split_from_post_id || "",
      item_count: post.items.length,
    };
  }

  function collectionSummary(collection) {
    return {
      id: collection.id,
      name: collection.name,
      path: collection.path,
      post_count: collection.posts.length,
    };
  }

  function promptSummary(prompt) {
    return {
      id: prompt.id,
      title: prompt.title,
      path: prompt.path,
      updated_at: prompt.updated_at,
    };
  }

  async function scanLibrary() {
    if (library_state.apiReady) {
      const data = await qApi("/api/library/scan", {});
      applyLibrarySnapshot(data);
      return;
    }
    if (!library_state.rootHandle) return;
    revokeLibraryObjectUrls();
    const collections = await scanCollectionFolders(library_state.rootHandle);
    const posts = [
        ...await scanCreatedArea(library_state.rootHandle, "created"),
        ...await scanCreatedArea(library_state.rootHandle, "upload"),
      ...collections.flatMap((collection) => collection.posts),
    ].sort(comparePostsByRecentActivity);
    const prompts = await scanPromptFiles(library_state.rootHandle);
    library_state.posts = posts;
    library_state.collections = collections;
    library_state.prompts = prompts;
    library_state.library = mergeLibraryJson(library_state.library || {});
    library_state.library.updated_at = libraryNow();
    library_state.library.posts = posts.map(postSummary);
    library_state.library.collections = collections.map(collectionSummary);
    library_state.library.prompts = prompts.map(promptSummary);
    await writeJsonFile(library_state.rootHandle, "library.json", library_state.library);
    renderLibrary();
  }

  async function setLibraryRoot(rootHandle, { saveHandle = true, askPermission = true } = {}) {
    if (askPermission && !await hasLibraryPermission(rootHandle, "readwrite")) {
      setLibraryMessage("Library permission is needed.");
      return;
    }
    library_state.rootHandle = rootHandle;
    library_state.rootName = rootHandle.name || "Grok Studio Library";
    library_state.library = await ensureLibraryRoot(rootHandle);
    await loadAccountFiles();
    if (saveHandle && window.indexedDB) {
      try {
        await saveLibraryHandle(rootHandle);
      } catch {
        // The selected handle can still be used for this session.
      }
    }
    await scanLibrary();
  }

  async function chooseLibraryPath() {
    const apiData = await tryQApi("/api/choose-library-folder", { current: library_state.rootPath });
    if (apiData) {
      if (!apiData.cancelled) applyLibrarySnapshot(apiData);
      return;
    }
    if (!window.showDirectoryPicker) {
      setLibraryMessage("Open with the local app launcher to set the library path.");
      return;
    }
    try {
      const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      await setLibraryRoot(rootHandle);
    } catch (error) {
      if (error?.name !== "AbortError") setLibraryMessage("Library path was not set.");
    }
  }

  async function restoreLibraryRoot() {
    const apiData = await tryQApi("/api/state");
    if (apiData) {
      applyLibrarySnapshot(apiData);
      return;
    }
    if (!window.indexedDB) return;
    try {
      const rootHandle = await loadLibraryHandle();
      if (!rootHandle) return;
      if (await rootHandle.queryPermission?.({ mode: "readwrite" }) === "granted") {
        await setLibraryRoot(rootHandle, { saveHandle: false, askPermission: false });
      }
    } catch {
      setLibraryMessage("");
    }
  }

  const INDEXED_CACHED_CARD_LIST_SIZE = 5000;
  const INDEXED_COLLECTION_PAGE_SIZE = INDEXED_CACHED_CARD_LIST_SIZE;
  const INDEXED_COLLECTION_CONTENT_PAGE_SIZE = INDEXED_CACHED_CARD_LIST_SIZE;
  const indexedPostRequests = new Map();
  const indexedCollectionContentRequests = new Map();
  let indexedBuildRequestToken = 0;
  let indexedBuildLoadingKey = "";
  let indexedBuildRefreshScope = null;
  let indexedCollectionRequestToken = 0;
  const indexedCollectionRequestTokens = new Map();
  const indexedCollectionRefreshScopes = new Map();
  let indexedCollectionContentRequestToken = 0;
  const indexedCollectionContentRequestTokens = new Map();
  const indexedCollectionContentRefreshScopes = new Map();

  function indexedLibraryRequestEpoch() {
    return Number(library_state.libraryIndexEpoch || 0);
  }

  function indexedLibraryPath(value) {
    return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function indexedLibraryParentPath(value) {
    const parts = indexedLibraryPath(value).split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }

  function indexedPostIsDirectChild(post, parentPath) {
    const path = indexedLibraryPath(post?.folder_path);
    return Boolean(path && indexedLibraryParentPath(path) === indexedLibraryPath(parentPath));
  }

  function indexedCollectionForPath(path) {
    const normalizedPath = indexedLibraryPath(path);
    return (library_state.collections || [])
      .filter((collection) => {
        const collectionPath = indexedLibraryPath(collection?.path);
        return collectionPath && (
          normalizedPath === collectionPath
          || normalizedPath.startsWith(`${collectionPath}/`)
        );
      })
      .sort((left, right) => indexedLibraryPath(right?.path).length - indexedLibraryPath(left?.path).length)[0]
      || null;
  }

  function indexedPostInstances(path) {
    const normalizedPath = indexedLibraryPath(path);
    if (!normalizedPath) return [];
    const matches = new Set();
    for (const post of library_state.posts || []) {
      if (indexedLibraryPath(post?.folder_path) === normalizedPath) matches.add(post);
    }
    for (const collection of library_state.collections || []) {
      for (const post of collection.posts || []) {
        if (indexedLibraryPath(post?.folder_path) === normalizedPath) matches.add(post);
      }
    }
    return Array.from(matches);
  }

  function indexedPostForPath(path) {
    return indexedPostInstances(path)[0] || null;
  }

  function setIndexedChildPagingState(path, values) {
    for (const post of indexedPostInstances(path)) Object.assign(post, values);
  }

  function mergeIndexedPostRecord(current, incoming) {
    if (!incoming) return current || null;
    if (!current) return incoming;
    if (incoming._indexed_summary) {
      // Keep already-loaded detail items available while applying fresh list fields such as
      // title, slot and representative media. Mark the record stale so the next detail open
      // still reloads the complete post instead of treating this merged summary as current.
      const currentItems = Array.isArray(current.items) ? current.items : [];
      const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
      const currentMetadata = current.metadata && typeof current.metadata === "object"
        ? current.metadata
        : {};
      const incomingMetadata = incoming.metadata && typeof incoming.metadata === "object"
        ? incoming.metadata
        : {};
      Object.assign(current, incoming);
      if (currentItems.length > incomingItems.length) current.items = currentItems;
      current.metadata = { ...currentMetadata, ...incomingMetadata };
      current._indexed_summary = true;
      return current;
    }
    Object.assign(current, incoming);
    if (!incoming._indexed_summary) delete current._indexed_summary;
    return current;
  }

  function mergeIndexedPostList(current, posts) {
    const byPath = new Map((current || []).map((post) => [post.folder_path, post]));
    const merged = [];
    for (const post of posts || []) {
      const path = post?.folder_path || "";
      if (!path) continue;
      const value = mergeIndexedPostRecord(byPath.get(path), post);
      byPath.set(path, value);
      merged.push(value);
    }
    return { posts: Array.from(byPath.values()), merged };
  }

  function restrictIndexedPostListToPaths(posts, paths) {
    const keep = paths instanceof Set ? paths : new Set(paths || []);
    return (posts || []).filter((post) => keep.has(indexedLibraryPath(post?.folder_path)));
  }

  function mergeIndexedPostPage(current, posts, { authoritativePaths = null } = {}) {
    const result = mergeIndexedPostList(current, posts);
    return {
      posts: authoritativePaths
        ? restrictIndexedPostListToPaths(result.posts, authoritativePaths)
        : result.posts,
      merged: result.merged,
    };
  }

  function mergeIndexedPostsIntoWorkingSet(posts) {
    const normalized = (Array.isArray(posts) ? posts : []).map(normalizeServerPost);
    const result = mergeIndexedPostList(library_state.posts, normalized);
    library_state.posts = result.posts;
    return result.merged;
  }

  function mergeIndexedPostsIntoCollection(collection, posts, options = {}) {
    if (!collection) return [];
    const parentPath = indexedLibraryPath(options.parentPath || "");
    const normalized = (Array.isArray(posts) ? posts : [])
      .map(normalizeServerPost)
      .filter((post) => !parentPath || indexedPostIsDirectChild(post, parentPath));
    const result = mergeIndexedPostList(collection.posts, normalized);
    const authoritativePaths = options.authoritativePaths instanceof Set
      ? options.authoritativePaths
      : null;
    if (parentPath && authoritativePaths) {
      collection.posts = result.posts.filter((post) => (
        !indexedPostIsDirectChild(post, parentPath)
        || authoritativePaths.has(indexedLibraryPath(post?.folder_path))
      ));
    } else {
      collection.posts = result.posts;
    }
    return result.merged;
  }

  function pruneIndexedWorkingSetDirectChildren(parentPath, authoritativePaths) {
    if (!(authoritativePaths instanceof Set)) return;
    library_state.posts = (library_state.posts || []).filter((post) => (
      !indexedPostIsDirectChild(post, parentPath)
      || authoritativePaths.has(indexedLibraryPath(post?.folder_path))
    ));
  }

  function advanceIndexedRefreshScope(current, { epoch, scope, reset, posts, hasMore }) {
    const sameRefresh = Boolean(
      current
      && current.epoch === epoch
      && current.scope === scope
    );
    const refresh = reset || !sameRefresh
      ? { epoch, scope, paths: new Set(), coversHead: Boolean(reset) }
      : current;
    for (const post of posts || []) {
      const path = indexedLibraryPath(post?.folder_path);
      if (path) refresh.paths.add(path);
    }
    return {
      refresh,
      authoritativePaths: !hasMore && refresh.coversHead ? refresh.paths : null,
    };
  }

  function indexedBuildQueryKey() {
    return library_state.buildIncludeCollections ? "with-collections" : "without-collections";
  }

  async function loadIndexedBuildPosts({ append = false, force = false } = {}) {
    const key = indexedBuildQueryKey();
    if (!library_state.libraryIndexEnabled || !library_state.apiReady) return;
    if (library_state.indexedBuildLoading && indexedBuildLoadingKey === key) return;
    const epoch = indexedLibraryRequestEpoch();
    const sameScope = library_state.indexedBuildKey === key;
    const reset = force || !append || !sameScope;
    if (!reset && !library_state.indexedBuildHasMore) return;
    const requestToken = ++indexedBuildRequestToken;
    const requestOffset = reset ? 0 : Number(library_state.indexedBuildOffset || 0);
    library_state.indexedBuildLoading = true;
    indexedBuildLoadingKey = key;
    if (reset) {
      library_state.indexedBuildKey = key;
      library_state.indexedBuildOffset = 0;
      library_state.indexedBuildHasMore = true;
      if (!sameScope && key === "without-collections") {
        // The old `with` scope contains the entire new `without` scope plus collection
        // cards. Filtering those cards is safe and keeps the remaining view mounted while
        // the exact new snapshot is fetched. Switching the other way is already a safe
        // subset, so it can remain visible unchanged.
        library_state.indexedBuildPosts = (library_state.indexedBuildPosts || [])
          .filter((post) => String(post?.area || "") !== "collection");
      }
    }
    try {
      const data = await qApi("/api/library/posts", {
        scope: "build_main",
        include_collections: key === "with-collections",
        offset: requestOffset,
        limit: INDEXED_CACHED_CARD_LIST_SIZE,
      });
      if (
        requestToken !== indexedBuildRequestToken
        || epoch !== indexedLibraryRequestEpoch()
        || key !== indexedBuildQueryKey()
        || library_state.indexedBuildKey !== key
      ) {
        return;
      }
      const posts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
      const refreshResult = advanceIndexedRefreshScope(indexedBuildRefreshScope, {
        epoch,
        scope: key,
        reset,
        posts,
        hasMore: Boolean(data.has_more),
      });
      indexedBuildRefreshScope = refreshResult.refresh;
      const result = mergeIndexedPostPage(library_state.indexedBuildPosts, posts, {
        authoritativePaths: refreshResult.authoritativePaths,
      });
      library_state.indexedBuildPosts = result.posts;
      library_state.indexedBuildTotal = Number(data.total || 0);
      library_state.indexedBuildOffset = Number(data.next_offset ?? (requestOffset + posts.length));
      library_state.indexedBuildHasMore = Boolean(data.has_more);
      library_state.indexedBuildLoaded = true;
      mergeIndexedPostsIntoWorkingSet(result.merged);
      if (refreshResult.authoritativePaths) indexedBuildRefreshScope = null;
    } finally {
      if (requestToken === indexedBuildRequestToken) {
        library_state.indexedBuildLoading = false;
        indexedBuildLoadingKey = "";
        if (typeof renderBuildSourceCards === "function") renderBuildSourceCards();
        if (typeof updateDetailPostNavigationButtons === "function") updateDetailPostNavigationButtons();
      }
    }
  }

  async function loadIndexedCollectionPosts(collectionPath, { append = false, force = false } = {}) {
    const normalizedCollectionPath = indexedLibraryPath(collectionPath);
    if (!library_state.libraryIndexEnabled || !library_state.apiReady || !normalizedCollectionPath) return;
    const collection = library_state.collections.find((item) => indexedLibraryPath(item.path) === normalizedCollectionPath);
    if (!collection || collection.indexed_loading) return;
    const epoch = indexedLibraryRequestEpoch();
    const reset = force || !append;
    if (!force && !append && collection.indexed_loaded) return;
    if (append && !collection.indexed_has_more) return;
    const requestToken = ++indexedCollectionRequestToken;
    indexedCollectionRequestTokens.set(normalizedCollectionPath, requestToken);
    const requestOffset = reset ? 0 : Number(collection.indexed_offset || 0);
    collection.indexed_loading = true;
    try {
      const data = await qApi("/api/library/posts", {
        scope: "collection",
        parent_path: normalizedCollectionPath,
        recursive: false,
        offset: requestOffset,
        limit: INDEXED_COLLECTION_PAGE_SIZE,
      });
      if (
        indexedCollectionRequestTokens.get(normalizedCollectionPath) !== requestToken
        || epoch !== indexedLibraryRequestEpoch()
      ) {
        return;
      }
      const liveCollection = library_state.collections.find((item) => (
        indexedLibraryPath(item.path) === normalizedCollectionPath
      ));
      if (!liveCollection) return;
      const responsePosts = (Array.isArray(data.posts) ? data.posts : [])
        .map(normalizeServerPost)
        .filter((post) => indexedPostIsDirectChild(post, normalizedCollectionPath));
      const previousRefresh = indexedCollectionRefreshScopes.get(normalizedCollectionPath) || null;
      const refreshResult = advanceIndexedRefreshScope(previousRefresh, {
        epoch,
        scope: normalizedCollectionPath,
        reset,
        posts: responsePosts,
        hasMore: Boolean(data.has_more),
      });
      indexedCollectionRefreshScopes.set(normalizedCollectionPath, refreshResult.refresh);
      const posts = mergeIndexedPostsIntoCollection(
        liveCollection,
        responsePosts,
        {
          parentPath: normalizedCollectionPath,
          authoritativePaths: refreshResult.authoritativePaths,
        },
      );
      liveCollection.indexed_loaded = true;
      liveCollection.indexed_total = Number(data.total || 0);
      liveCollection.indexed_offset = Number(data.next_offset ?? (requestOffset + responsePosts.length));
      liveCollection.indexed_has_more = Boolean(data.has_more);
      mergeIndexedPostsIntoWorkingSet(posts);
      if (refreshResult.authoritativePaths) {
        pruneIndexedWorkingSetDirectChildren(normalizedCollectionPath, refreshResult.authoritativePaths);
      }
      if (refreshResult.authoritativePaths) indexedCollectionRefreshScopes.delete(normalizedCollectionPath);
    } finally {
      collection.indexed_loading = false;
      if (indexedCollectionRequestTokens.get(normalizedCollectionPath) === requestToken) {
        indexedCollectionRequestTokens.delete(normalizedCollectionPath);
        const liveCollection = library_state.collections.find((item) => (
          indexedLibraryPath(item.path) === normalizedCollectionPath
        ));
        if (liveCollection) liveCollection.indexed_loading = false;
        if (typeof renderCollectionFolders === "function") renderCollectionFolders();
        if (typeof renderSecondMain === "function") renderSecondMain();
        if (typeof updateDetailPostNavigationButtons === "function") updateDetailPostNavigationButtons();
      }
    }
  }

  async function loadIndexedCollectionPostContents(postPath, { append = false, force = false } = {}) {
    const normalizedPath = indexedLibraryPath(postPath);
    if (!library_state.libraryIndexEnabled || !library_state.apiReady || !normalizedPath) return null;
    const epoch = indexedLibraryRequestEpoch();
    const requestKey = `${epoch}\u001f${normalizedPath}\u001f${append ? "append" : "initial"}`;
    if (indexedCollectionContentRequests.has(requestKey)) {
      return indexedCollectionContentRequests.get(requestKey);
    }
    const request = (async () => {
      const loadedParent = indexedPostForPath(normalizedPath) || await loadIndexedPost(normalizedPath);
      if (epoch !== indexedLibraryRequestEpoch()) return null;
      const parent = indexedPostForPath(normalizedPath) || loadedParent;
      if (!parent) return null;
      if (!force && !append && parent._indexed_children_loaded) return parent;
      if (append && (!parent._indexed_children_has_more || parent._indexed_children_loading)) return parent;
      const reset = force || !append;
      const requestOffset = reset ? 0 : Number(parent._indexed_children_offset || 0);
      const requestToken = ++indexedCollectionContentRequestToken;
      indexedCollectionContentRequestTokens.set(normalizedPath, requestToken);
      setIndexedChildPagingState(normalizedPath, { _indexed_children_loading: true });
      try {
        const data = await qApi("/api/library/posts", {
          scope: "collection",
          parent_path: normalizedPath,
          recursive: false,
          recent_first: true,
          full: false,
          offset: requestOffset,
          limit: INDEXED_COLLECTION_CONTENT_PAGE_SIZE,
        });
        if (
          indexedCollectionContentRequestTokens.get(normalizedPath) !== requestToken
          || epoch !== indexedLibraryRequestEpoch()
        ) {
          return null;
        }
        const liveParent = indexedPostForPath(normalizedPath);
        if (!liveParent) return null;
        const responsePosts = (Array.isArray(data.posts) ? data.posts : [])
          .map(normalizeServerPost)
          .filter((post) => indexedPostIsDirectChild(post, normalizedPath));
        const previousRefresh = indexedCollectionContentRefreshScopes.get(normalizedPath) || null;
        const refreshResult = advanceIndexedRefreshScope(previousRefresh, {
          epoch,
          scope: normalizedPath,
          reset,
          posts: responsePosts,
          hasMore: Boolean(data.has_more),
        });
        indexedCollectionContentRefreshScopes.set(normalizedPath, refreshResult.refresh);
        const childPosts = mergeIndexedPostsIntoWorkingSet(responsePosts);
        if (refreshResult.authoritativePaths) {
          pruneIndexedWorkingSetDirectChildren(normalizedPath, refreshResult.authoritativePaths);
        }
        const collection = indexedCollectionForPath(normalizedPath);
        if (collection) {
          mergeIndexedPostsIntoCollection(collection, childPosts, {
            parentPath: normalizedPath,
            authoritativePaths: refreshResult.authoritativePaths,
          });
        }
        setIndexedChildPagingState(normalizedPath, {
          _indexed_children_loaded: true,
          _indexed_children_total: Number(data.total || 0),
          _indexed_children_offset: Number(data.next_offset ?? (requestOffset + responsePosts.length)),
          _indexed_children_has_more: Boolean(data.has_more),
        });
        if (refreshResult.authoritativePaths) {
          indexedCollectionContentRefreshScopes.delete(normalizedPath);
        }
        return indexedPostForPath(normalizedPath) || liveParent;
      } finally {
        parent._indexed_children_loading = false;
        if (indexedCollectionContentRequestTokens.get(normalizedPath) === requestToken) {
          indexedCollectionContentRequestTokens.delete(normalizedPath);
          setIndexedChildPagingState(normalizedPath, { _indexed_children_loading: false });
          if (
            typeof renderSecondMain === "function"
            && indexedLibraryPath(library_state.selectedCollectionPostPath) === normalizedPath
          ) {
            renderSecondMain();
          }
        }
      }
    })();
    indexedCollectionContentRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      indexedCollectionContentRequests.delete(requestKey);
    }
  }

  async function loadIndexedUploadPosts({ force = false } = {}) {
    if (!library_state.libraryIndexEnabled || !library_state.apiReady || library_state.indexedUploadLoading) return;
    if (!force && library_state.indexedUploadLoaded) return;
    library_state.indexedUploadLoading = true;
    try {
      const data = await qApi("/api/library/posts", {
        scope: "upload",
        full: true,
        offset: 0,
        limit: uploadHistoryPageSize,
      });
      library_state.indexedUploadPosts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
      library_state.indexedUploadLoaded = true;
      mergeIndexedPostsIntoWorkingSet(library_state.indexedUploadPosts);
    } finally {
      library_state.indexedUploadLoading = false;
      if (typeof renderComposerAttachments === "function") renderComposerAttachments();
    }
  }

  async function loadIndexedSearchBuildPosts(query, { append = false, force = false } = {}) {
    const normalizedQuery = String(query || "").trim();
    if (!library_state.libraryIndexEnabled || !library_state.apiReady || !normalizedQuery || library_state.indexedSearchBuildLoading) return;
    const reset = force || !append || library_state.indexedSearchBuildQuery !== normalizedQuery;
    if (!reset && !library_state.indexedSearchBuildHasMore) return;
    library_state.indexedSearchBuildLoading = true;
    if (reset) {
      library_state.indexedSearchBuildQuery = normalizedQuery;
      library_state.indexedSearchBuildPosts = [];
      library_state.indexedSearchBuildOffset = 0;
      library_state.indexedSearchBuildHasMore = true;
    }
    try {
      const data = await qApi("/api/library/posts", {
        scope: "build",
        include_collections: true,
        query: normalizedQuery,
        offset: reset ? 0 : library_state.indexedSearchBuildOffset,
        limit: 100,
      });
      if (normalizedQuery !== String(library_state.searchQuery || "").trim()) return;
      const posts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
      const byPath = new Map((reset ? [] : library_state.indexedSearchBuildPosts).map((post) => [post.folder_path, post]));
      for (const post of posts) {
        if (post?.folder_path) byPath.set(post.folder_path, post);
      }
      library_state.indexedSearchBuildPosts = Array.from(byPath.values());
      library_state.indexedSearchBuildTotal = Number(data.total || 0);
      library_state.indexedSearchBuildOffset = Number(data.next_offset || library_state.indexedSearchBuildPosts.length);
      library_state.indexedSearchBuildHasMore = Boolean(data.has_more);
      library_state.indexedSearchBuildLoaded = true;
      mergeIndexedPostsIntoWorkingSet(posts);
    } finally {
      library_state.indexedSearchBuildLoading = false;
      if (typeof renderSearchResults === "function" && screen_state.current_screen === "search_main") renderSearchResults();
      if (typeof updateDetailPostNavigationButtons === "function") updateDetailPostNavigationButtons();
    }
  }

  async function loadIndexedPost(path) {
    const normalizedPath = indexedLibraryPath(path);
    if (!library_state.libraryIndexEnabled || !library_state.apiReady || !normalizedPath) return null;
    const existing = indexedPostForPath(normalizedPath);
    if (existing && !existing._indexed_summary) return existing;
    const epoch = indexedLibraryRequestEpoch();
    const requestKey = `${epoch}\u001f${normalizedPath}`;
    if (indexedPostRequests.has(requestKey)) return indexedPostRequests.get(requestKey);
    const request = (async () => {
      const data = await qApi("/api/library/post", { path: normalizedPath });
      if (epoch !== indexedLibraryRequestEpoch()) return null;
      const post = data?.post ? normalizeServerPost(data.post) : null;
      if (!post) return null;
      const merged = mergeIndexedPostsIntoWorkingSet([post])[0] || post;
      const collection = indexedCollectionForPath(normalizedPath);
      if (collection) mergeIndexedPostsIntoCollection(collection, [merged]);
      return merged;
    })();
    indexedPostRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      indexedPostRequests.delete(requestKey);
    }
  }

  function refreshIndexedLibraryViews() {
    if (!library_state.libraryIndexEnabled || !library_state.apiReady) return;
    if (!library_state.indexedBuildLoaded) {
      loadIndexedBuildPosts().catch((error) => console.warn(error));
    }
    if (library_state.selectedCollectionPath) {
      loadIndexedCollectionPosts(library_state.selectedCollectionPath).catch((error) => console.warn(error));
    }
    if (String(library_state.searchQuery || "").trim()) {
      loadIndexedSearchBuildPosts(library_state.searchQuery).catch((error) => console.warn(error));
    }
    if (!library_state.indexedUploadLoaded) {
      loadIndexedUploadPosts().catch((error) => console.warn(error));
    }
  }
