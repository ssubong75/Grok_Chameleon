// State, constants, API snapshot helpers
function normalizeNfcText(value = "") {
  return String(value ?? "").normalize("NFC");
}

// Keep Windows-only typography adjustments out of the macOS renderer.
const isWindowsRenderer = /Windows NT/i.test(String(navigator.userAgent || ""));
document.documentElement.classList.toggle("platform-windows", isWindowsRenderer);

    const screenIds = [
      "i_main",
      "b_main",
      "b_t2i_view_main",
      "search_main",
      "i_discover_main",
      "collection_main",
    "2nd_main",
    "i_detail",
    "b_detail",
    "prompt_main",
    "usage",
  ];

    const navButtonIds = [
      "i_imagine_nav_btn",
      "i_discover_nav_btn",
      "b_build_btn",
      "b_collection_nav_btn",
      "prompt_main_btn",
      "account_usage_btn",
  ];

  const screens = screenIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const navButtons = navButtonIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const appShell = document.getElementById("appShell");
  const workspace = document.querySelector(".workspace");
  const sidebarOpenBtn = document.getElementById("sidebarOpenBtn");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  const folderBtn = document.getElementById("folder_btn");
  const setLibraryPathBtn = document.getElementById("set_library_path_btn");
  const searchBtnElement = document.getElementById("search_btn");
  const searchInput = document.getElementById("searchInput");
  const imagineLinkBtn = document.getElementById("i_link_btn");
  const imagineLinkInput = document.getElementById("i_link_input");
  const topbarCollapsedInputs = document.getElementById("topbarCollapsedInputs");
  const composer = document.getElementById("composer");
  const promptSave = document.getElementById("prompt_save");
  const composerProviderBadge = document.querySelector(".composer_provider_badge");
  const composerState = {
    provider: "imagine",
    mode: "image",
    dismissedDetailAttachmentKey: "",
    optionValues: {},
  };
  const composerAttachments = [];
  const composerControls = {
    buildImageModel: document.querySelector('[data-composer-control="build-image-model"]'),
    videoModel: document.querySelector('[data-composer-control="video-model"]'),
    duration: document.querySelector('[data-composer-control="duration"]'),
    aspect: document.querySelector('[data-composer-control="aspect"]'),
    imageModel: document.querySelector('[data-composer-control="image-model"]'),
    resolution: document.querySelector('[data-composer-control="resolution"]'),
    count: document.querySelector('[data-composer-control="count"]'),
    extendMaxNote: document.querySelector('[data-composer-control="extend-max-note"]'),
    videoEditNote: document.querySelector('[data-composer-control="video-edit-note"]'),
  };
  const imageAspectOptions = ["Auto", "16:9", "9:16", "1:1", "2:3", "3:2"];
  const buildT2iAspectOptions = ["Auto", "16:9", "9:16", "1:1", "2:3", "3:2"];
  const videoAspectOptions = ["Auto", "16:9", "9:16", "1:1", "2:3", "3:2"];
  const videoModelOptions = ["M 1.5", "M 1.0"];
  const buildVideoModelOptions = ["M 1.0", "M 1.5P", "M 1.5"];
  const videoDurationOptions = ["15s", "12s", "10s", "8s", "6s", "3s"];
  const imagineVideoDurationOptions = ["15s", "12s", "10s", "6s"];
  const extensionDurationOptions = ["10s", "8s", "6s", "3s"];
  const imagineExtensionDurationOptions = ["10s", "6s"];
  const imageResolutionOptions = ["2K", "1K"];
  const buildT2iResolutionOptions = ["2K", "1K"];
  const buildImageModelOptions = ["M 2.0", "M 1.5"];
  const buildImage20OutputOptions = ["2K Med", "1K Med", "2K Low", "1K Low"];
  const buildImage20CountOptions = ["10", "8", "4", "2"];
  const videoResolutionOptions = ["1080", "720", "480"];
  const countOptions = ["Auto", "1", "2", "4", "8", "10"];
  const buildT2iCountOptions = ["10", "8", "5", "4", "1"];
  // Imagine keeps its own ladder: Grok clamps a T2I request to 12, and it has no real
  // single-image flow, so the list starts at 2 rather than reusing Build's counts.
  const imagineT2iCountOptions = ["12", "8", "4", "2"];
  const composerImageAttachmentLimit = 5;
  const composerBuildI2iAttachmentLimit = 3;
  const composerVideoAttachmentLimit = 7;
  const composerAnalyzeAttachmentLimit = 1;
  const uploadHistoryPageSize = 24;
    const libraryFolders = ["created", "upload", "collection", "prompt", "account"];
  const accountTiers = ["free", "super", "heavy"];
  const accountTierLabels = {
    free: "Free",
    super: "Super",
    heavy: "Heavy",
  };
  const imageExtensions = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
  const videoExtensions = new Set(["m4v", "mov", "mp4", "webm"]);

    const screen_state = {
      current_screen: "i_main",
      current_main: "i_main",
      account_visible: false,
    current_i_nav_btn: "i_imagine_nav_btn",
    current_b_nav_btn: "b_build_btn",
    detail_back: {
      imagine: { screenId: "i_main", activeButtonId: "i_imagine_nav_btn" },
      build: { screenId: "b_main", activeButtonId: "b_build_btn" },
    },
    historyRestoring: false,
  };
  const detail_state = {
    extendActive: false,
    extendStart: 0,
    extendUserAdjusted: false,
    extendItemId: "",
  };
  const library_state = {
    apiReady: null,
    rootPath: "",
    rootHandle: null,
    rootName: "",
    library: null,
    posts: [],
    collections: [],
    prompts: [],
    libraryIndexEnabled: false,
    libraryIndexEpoch: 0,
    libraryIndexCounts: {
      posts: 0,
      build: 0,
      build_main: 0,
      build_main_with_collections: 0,
      upload: 0,
      collection: 0,
    },
    indexedBuildPosts: [],
    indexedBuildTotal: 0,
    indexedBuildOffset: 0,
    indexedBuildHasMore: false,
    indexedBuildLoading: false,
    indexedBuildLoaded: false,
    indexedBuildKey: "",
    indexedSearchBuildPosts: [],
    indexedSearchBuildTotal: 0,
    indexedSearchBuildOffset: 0,
    indexedSearchBuildHasMore: false,
    indexedSearchBuildLoading: false,
    indexedSearchBuildLoaded: false,
    indexedSearchBuildQuery: "",
    indexedUploadPosts: [],
    indexedUploadLoading: false,
    indexedUploadLoaded: false,
    searchQuery: "",
    selectedCollectionPath: "",
    selectedCollectionPostPath: "",
    collectionActionLevel: "first",
    collectionView: "2nd_folders",
    collectionSort: "",
    collectionDraftLayout: null,
      selectedPostPath: "",
      selectedPostIdentity: "",
      selectedDetailItemId: "",
      sourcePickPending: false,
      splitPickPending: false,
      selectedItems: new Set(),
      iMainView: "imagine",
      bMainView: "build",
      buildIncludeCollections: false,
      objectUrls: [],
      lastErrorText: "",
      jobs: [],
      selectedJobId: "",
      sessionBuildT2iPaths: new Set(),
      imagineJobs: [],
      selectedImagineJobId: "",
      sessionImagineT2iPaths: new Set(),
      mainGenerationActivity: {
        imagine: [],
        build: [],
      },
      dismissedJobSlots: new Set(),
      imagineRemotePosts: [],
      imagineRemoteLoaded: false,
      imagineRemoteLoading: false,
      imagineRemoteSyncing: false,
      imagineRemoteError: "",
      imagineRemoteCursor: "",
      imagineRemoteHasMore: false,
      imagineRemoteCacheLoaded: false,
      imagineRemoteCacheOffset: 0,
      imagineRemoteCacheHasMore: false,
      imagineRemoteSyncToken: "",
      imagineRemoteAccountId: "",
      imagineRemoteRequestEpoch: 0,
      imagineRemoteRequestController: null,
      imagineRemoteSyncPromise: null,
      imagineRemoteSyncTimer: 0,
      imagineRemoteSyncTimerResolve: null,
      imagineDiscoverPosts: [],
      imagineDiscoverCacheLoaded: false,
      imagineDiscoverCacheLoading: false,
      imagineDiscoverLoaded: false,
      imagineDiscoverLoading: false,
      imagineDiscoverError: "",
      imagineDiscoverCursor: "",
      imagineDiscoverHasMore: false,
      imagineLikedPosts: [],
      imagineLikedLoaded: false,
      imagineLikedLoading: false,
      imagineLikedError: "",
      imagineLikedExclusionIds: new Set(),
      imagineLikedExclusionComplete: false,
      imagineLikedExclusionRevision: "",
      imagineLikedExclusionAccountId: "",
      imagineUnsavedPosts: [],
      imagineUnsavedLoaded: false,
      imagineUnsavedLoading: false,
      imagineUnsavedError: "",
      imagineUnsavedCursor: "",
      imagineUnsavedHasMore: false,
      imagineSearchPosts: [],
      imagineSearchQuery: "",
      imagineSearchScheduledQuery: "",
      imagineSearchLoaded: false,
      imagineSearchLoading: false,
      imagineSearchError: "",
      imagineHiddenRemotePostIds: new Set(),
      imagineUploadPosts: [],
      imagineUploadLoaded: false,
      imagineUploadLoading: false,
      imagineUploadError: "",
      imagineUploadCursor: "",
      imagineUploadHasMore: false,
  };

  function mainGenerationActivityKey(kind, id) {
    const normalizedKind = String(kind || "").trim();
    const normalizedId = String(id || "").trim();
    return normalizedKind && normalizedId ? `${normalizedKind}:${normalizedId}` : "";
  }

  function noteMainGenerationActivity(provider, kind, id) {
    const providerKey = String(provider || "").toLowerCase();
    const key = mainGenerationActivityKey(kind, id);
    if (!key || !library_state.mainGenerationActivity?.[providerKey]) return;
    const activity = library_state.mainGenerationActivity[providerKey];
    library_state.mainGenerationActivity[providerKey] = [
      key,
      ...activity.filter((candidate) => candidate !== key),
    ];
  }

  function forgetMainGenerationActivity(provider, kind, id) {
    const providerKey = String(provider || "").toLowerCase();
    const key = mainGenerationActivityKey(kind, id);
    if (!key || !library_state.mainGenerationActivity?.[providerKey]) return;
    library_state.mainGenerationActivity[providerKey] = library_state.mainGenerationActivity[providerKey]
      .filter((candidate) => candidate !== key);
  }

  function orderedMainGenerationCards(provider, entries) {
    const providerKey = String(provider || "").toLowerCase();
    const normalizedEntries = (entries || []).filter((entry) => entry?.key && Array.isArray(entry.cards));
    const byKey = new Map(normalizedEntries.map((entry) => [entry.key, entry]));
    const activity = (library_state.mainGenerationActivity?.[providerKey] || [])
      .filter((key) => byKey.has(key));
    if (library_state.mainGenerationActivity?.[providerKey]) {
      library_state.mainGenerationActivity[providerKey] = activity;
    }
    const promoted = new Set(activity);
    return [
      ...activity.map((key) => byKey.get(key)),
      ...normalizedEntries.filter((entry) => !promoted.has(entry.key)),
    ].flatMap((entry) => entry.cards);
  }

  const account_state = {
    build: { active_id: "", accounts: [] },
    imagine: { active_id: "", accounts: [] },
    buildStatuses: {},
    imagineStatuses: {},
    statusToken: 0,
    drag: null,
  };

  function setActiveInGroup(items, activeItem) {
    for (const item of items) {
      item.classList.toggle("active", item === activeItem);
    }
  }

  function syncSidebarTogglePosition() {
    // Halfway between Search and Open Folder. Both rows survive collapsing and the narrow
    // layouts — only their labels go — so the same two anchors serve every state.
    const upperRect = document.getElementById("search_btn")?.getBoundingClientRect();
    const lowerRect = document.getElementById("folder_btn")?.getBoundingClientRect();
    // On a cold load the rows can still measure zero, and the one scheduled call on startup
    // was the only one -- the button then kept whatever the stylesheet guessed. It is hidden
    // until placed now, so a missed measurement would hide it for good; keep asking until
    // the sidebar has real geometry.
    if (!upperRect || !lowerRect || upperRect.height === 0 || lowerRect.height === 0) {
      scheduleSidebarTogglePosition();
      return;
    }
    const upperCenter = upperRect.top + (upperRect.height / 2);
    const lowerCenter = lowerRect.top + (lowerRect.height / 2);
    const rawToggleTop = (upperCenter + lowerCenter) / 2;
    const rootStyle = getComputedStyle(document.documentElement);
    const toggleHalf = Number.parseFloat(rootStyle.getPropertyValue("--sidebar-toggle-half-size")) || 19;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const edgeInset = Math.max(4, Math.round(toggleHalf / 4));
    const toggleTop = Math.min(
      viewportHeight - toggleHalf - edgeInset,
      Math.max(toggleHalf + edgeInset, rawToggleTop),
    );
    document.documentElement.style.setProperty("--sidebar-toggle-top", `${toggleTop}px`);
    document.documentElement.classList.add("sidebar_toggle_placed");
  }

  function scheduleSidebarTogglePosition() {
    requestAnimationFrame(() => requestAnimationFrame(syncSidebarTogglePosition));
  }

  function setTopbarCollapsedInput(kind = "", options = {}) {
    if (!topbarCollapsedInputs) return false;
    const currentKind = String(topbarCollapsedInputs.dataset.activeInput || "");
    const onlyIf = String(options.onlyIf || "");
    if (onlyIf && currentKind !== onlyIf) return Boolean(currentKind);
    const nextKind = kind === "search" || kind === "link" ? kind : "";
    topbarCollapsedInputs.dataset.activeInput = appShell?.classList.contains("sidebar_collapsed") ? nextKind : "";
    return Boolean(topbarCollapsedInputs.dataset.activeInput);
  }

  function syncTopbarCollapsedInputs(collapsed) {
    if (!topbarCollapsedInputs) return;
    topbarCollapsedInputs.dataset.activeInput = "";
    // The paste box lives beside Liked in the Imagine header now, so it stays there
    // whether the sidebar is open or collapsed. Only the sidebar's own search box moves.
    if (collapsed) {
      if (searchInput) topbarCollapsedInputs.append(searchInput);
      return;
    }
    if (searchInput && searchBtnElement) searchBtnElement.after(searchInput);
  }

  function setSidebarCollapsed(collapsed) {
    syncTopbarCollapsedInputs(collapsed);
    appShell?.classList.toggle("sidebar_collapsed", collapsed);
    if (sidebarOpenBtn) sidebarOpenBtn.hidden = !collapsed;
    scheduleSidebarTogglePosition();
    scheduleCollectionRows();
  }

  async function qApi(path, payload = null, requestOptions = {}) {
    const options = payload === null
      ? { method: "GET" }
      : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };
    if (requestOptions?.signal) options.signal = requestOptions.signal;
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const message = data?.error || `API failed: ${path}`;
      library_state.lastErrorText = message;
      throw new Error(message);
    }
    library_state.apiReady = true;
    return data;
  }

  async function tryQApi(path, payload = null) {
    if (location.protocol === "file:") return null;
    try {
      return await qApi(path, payload);
    } catch {
      library_state.apiReady = false;
      return null;
    }
  }

  function activityTimestampValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    }
    const text = String(value || "").trim();
    if (!text) return 0;
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function postActivityTimestamp(post) {
    const values = [
      post?.activity_at,
      post?.last_activity_at,
      post?.created_at,
      post?.createdAt,
      post?.timestamp,
    ];
    for (const item of Array.isArray(post?.items) ? post.items : []) {
      values.push(
        item?.created_at,
        item?.createdAt,
        item?.updated_at,
        item?.updatedAt,
        item?.timestamp,
        item?.last_modified,
        item?.lastModified,
      );
    }
    return Math.max(0, ...values.map(activityTimestampValue));
  }

  function comparePostsByRecentActivity(left, right) {
    return postActivityTimestamp(right) - postActivityTimestamp(left)
      || String(left?.folder_path || "").localeCompare(String(right?.folder_path || ""));
  }

  // Snapshots arrive far more often than the order actually changes, and a full sort
  // walks every post each time. Checking order first is a single linear pass, so the
  // common no-op snapshot stops paying for a sort it does not need.
  function sortPostsIfNeeded(posts, compare) {
    if (!Array.isArray(posts) || posts.length < 2) return posts;
    for (let index = 1; index < posts.length; index += 1) {
      if (compare(posts[index - 1], posts[index]) > 0) {
        posts.sort(compare);
        return posts;
      }
    }
    return posts;
  }

  function normalizeServerPost(post) {
    const items = Array.isArray(post?.items) ? post.items : [];
    const representative = representativeItem(items, post)
      || post?.representative_item
      || items.find((item) => item.file === post?.representative || item.url === post?.representative || item.item_id === post?.representative)
      || representativeItem(items, post)
      || null;
    return {
      ...post,
      collection: post?.collection || null,
      items,
      representative: post?.representative || representative?.file || representative?.url || "",
      representative_item: representative,
    };
  }

  function libraryPostServerPath(postOrPath) {
    return String(
      postOrPath && typeof postOrPath === "object"
        ? postOrPath.folder_path || ""
        : postOrPath || "",
    ).trim();
  }

  function libraryPostStableIdentity(post) {
    const path = libraryPostServerPath(post);
    if (!post || !path) return path;
    const metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    const imaginePost = Boolean(
      post.source === "imagine"
      || post.remote
      || post.area === "imagine_remote"
      || post.area === "imagine_upload_remote"
      || /^imagine_(saved|discover|unsaved|search|link|upload|generated)\//.test(path)
    );
    if (!imaginePost) return path;
    const provenance = typeof imagineSavedPostProvenance === "function"
      ? imagineSavedPostProvenance(post)
      : (metadata.cloned_copy || metadata.cloned_from_asset_id
        ? "cloned-liked"
        : (metadata.link_source || metadata.local_heart || metadata.external_reference
          ? "plain-liked"
          : "normal-saved"));
    const savedAnchor = String(metadata.saved_anchor_id || imagine.saved_anchor_id || "").trim();
    const savedDisplayGroup = provenance === "normal-saved"
      ? String(metadata.saved_display_group_id || imagine.saved_display_group_id || "").trim()
      : "";
    const provenanceAnchor = provenance === "cloned-liked"
      ? (
        metadata.link_post_id
        || imagine.link_post_id
        || metadata.official_clone_asset_id
        || imagine.official_clone_asset_id
        || metadata.lineage_root_asset_id
      )
      : (provenance === "plain-liked"
        ? (
          metadata.local_saved_group_id
          || imagine.local_saved_group_id
          || metadata.link_post_id
          || imagine.link_post_id
          || metadata.lineage_root_asset_id
          || post.post_id
        )
        : (
          metadata.lineage_root_asset_id
          || metadata.local_saved_group_id
          || post.post_id
          || metadata.conversation_id
          || imagine.conversation_id
        ));
    const anchor = String(savedDisplayGroup || savedAnchor || provenanceAnchor || path).trim();
    return `imagine\u001f${provenance}\u001f${anchor}`;
  }

  function libraryPostMatchesIdentity(post, identity) {
    const target = String(identity || "").trim();
    return Boolean(target) && libraryPostStableIdentity(post) === target;
  }

  function generationSnapshotTimestamp(post) {
    for (const value of [
      post?.updated_at,
      post?.updatedAt,
      post?.created_at,
      post?.createdAt,
    ]) {
      const parsed = Date.parse(String(value || ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function mergeGenerationSnapshotPost(current, incoming, selectedItemId = "") {
    if (!current || current._indexed_summary || !incoming) return incoming || current;
    const currentTimestamp = generationSnapshotTimestamp(current);
    const incomingTimestamp = generationSnapshotTimestamp(incoming);
    if (!currentTimestamp || !incomingTimestamp || incomingTimestamp >= currentTimestamp) {
      return incoming;
    }

    const selectedKey = String(selectedItemId || "");
    if (!selectedKey) return current;
    const incomingItem = (incoming.items || []).find((item) => mediaItemKey(item) === selectedKey);
    if (!incomingItem) return current;
    const currentItems = Array.isArray(current.items) ? current.items : [];
    if (currentItems.some((item) => mediaItemKey(item) === selectedKey)) return current;
    return normalizeServerPost({
      ...current,
      items: [...currentItems, incomingItem],
    });
  }

  function applyAccountSnapshot(data) {
    if (!data) return;
    if (data.library_root) {
      library_state.rootPath = data.library_root;
      library_state.rootName = data.root_name || (library_state.rootPath.split(/[\\/]/).filter(Boolean).pop() || "");
    }
    if (data.accounts?.build) {
      account_state.build = {
        ...defaultBuildAuthJson(),
        ...data.accounts.build,
        accounts: (data.accounts.build.accounts || []).map(normalizeBuildAccount),
      };
    }
    if (data.accounts?.imagine) {
      account_state.imagine = {
        ...defaultImagineAuthJson(),
        ...data.accounts.imagine,
        accounts: (data.accounts.imagine.accounts || []).map(normalizeImagineAccount),
      };
    }
    const activeBuild = account_state.build.accounts.find((account) => account.id === account_state.build.active_id);
    if (!activeBuild || isDeniedBuildAccount(activeBuild)) {
      account_state.build.active_id = firstSelectableBuildAccountId(account_state.build.accounts);
    }
    if (account_state.imagine.active_id && !account_state.imagine.accounts.some((account) => account.id === account_state.imagine.active_id)) {
      account_state.imagine.active_id = "";
    }
  }

  function applyLibrarySnapshot(data, options = {}) {
    if (!data) return;
    library_state.rootPath = data.library_root || "";
    library_state.rootName = data.root_name || (library_state.rootPath.split(/[\\/]/).filter(Boolean).pop() || "");
    library_state.library = mergeLibraryJson(data.library || {});
    const indexed = Boolean(data.library_index?.enabled);
    if (indexed) {
      const previouslyIndexed = library_state.libraryIndexEnabled;
      library_state.libraryIndexEnabled = true;
      library_state.libraryIndexCounts = {
        ...library_state.libraryIndexCounts,
        ...(data.library_index?.counts || {}),
      };
      library_state.indexedBuildTotal = Number(
        library_state.buildIncludeCollections
          ? library_state.libraryIndexCounts.build_main_with_collections
          : library_state.libraryIndexCounts.build_main,
      ) || 0;
      if (data.index_rebuilt) {
        library_state.libraryIndexEpoch = Number(library_state.libraryIndexEpoch || 0) + 1;
      }
      if (!previouslyIndexed) {
        library_state.posts = [];
        library_state.indexedBuildPosts = [];
        library_state.indexedBuildTotal = Number(data.library_index?.counts?.build_main || 0);
        library_state.indexedBuildOffset = 0;
        library_state.indexedBuildHasMore = library_state.indexedBuildTotal > 0;
        library_state.indexedBuildLoaded = false;
        library_state.indexedBuildKey = "";
        library_state.indexedSearchBuildPosts = [];
        library_state.indexedSearchBuildTotal = 0;
        library_state.indexedSearchBuildOffset = 0;
        library_state.indexedSearchBuildHasMore = false;
        library_state.indexedSearchBuildLoaded = false;
        library_state.indexedSearchBuildQuery = "";
        library_state.indexedUploadPosts = [];
        library_state.indexedUploadLoaded = false;
      } else if (data.index_rebuilt) {
        // A rebuild changes the index revision, not the identity of every visible card.
        // Keep the last complete view on screen while each active scope revalidates.
        library_state.indexedBuildOffset = 0;
        library_state.indexedBuildHasMore = library_state.indexedBuildTotal > 0;
        library_state.indexedBuildLoading = false;
        library_state.indexedBuildLoaded = false;
        library_state.indexedSearchBuildOffset = 0;
        library_state.indexedSearchBuildHasMore = Boolean(library_state.indexedSearchBuildPosts.length);
        library_state.indexedSearchBuildLoading = false;
        library_state.indexedSearchBuildLoaded = false;
        library_state.indexedUploadLoading = false;
        library_state.indexedUploadLoaded = false;
      }
      const previousCollections = new Map(
        (library_state.collections || []).map((collection) => [collection.path, collection]),
      );
      library_state.collections = Array.isArray(data.collections)
        ? data.collections.map((collection) => {
          const previous = previousCollections.get(collection.path);
          const posts = previous?.posts || [];
          if (data.index_rebuilt) {
            for (const post of posts) {
              if (!("_indexed_children_loaded" in post)) continue;
              post._indexed_children_loaded = false;
              post._indexed_children_loading = false;
              post._indexed_children_offset = 0;
              post._indexed_children_has_more = Number(post._indexed_children_total || 0) > 0;
            }
          }
          return {
            ...collection,
            posts,
            indexed_loaded: data.index_rebuilt ? false : Boolean(previous?.indexed_loaded),
            indexed_loading: false,
            indexed_total: data.index_rebuilt
              ? Number(collection.post_count || previous?.indexed_total || 0)
              : Number(previous?.indexed_total || 0),
            indexed_offset: data.index_rebuilt ? 0 : Number(previous?.indexed_offset || 0),
            indexed_has_more: data.index_rebuilt
              ? Number(collection.post_count || previous?.indexed_total || 0) > 0
              : Boolean(previous?.indexed_has_more),
          };
        })
        : library_state.collections;
      const deletedPaths = Array.isArray(data.deleted_paths) ? data.deleted_paths : [];
      if (deletedPaths.length) {
        const deleted = (path) => deletedPaths.some((prefix) => (
          String(path || "") === String(prefix || "")
          || String(path || "").startsWith(`${String(prefix || "")}/`)
        ));
        library_state.posts = (library_state.posts || []).filter((post) => !deleted(post.folder_path));
        library_state.indexedBuildPosts = (library_state.indexedBuildPosts || []).filter((post) => !deleted(post.folder_path));
        library_state.indexedSearchBuildPosts = (library_state.indexedSearchBuildPosts || []).filter((post) => !deleted(post.folder_path));
        library_state.indexedUploadPosts = (library_state.indexedUploadPosts || []).filter((post) => !deleted(post.folder_path));
        for (const collection of library_state.collections || []) {
          collection.posts = (collection.posts || []).filter((post) => !deleted(post.folder_path));
        }
      }
      const changedPosts = Array.isArray(data.changed_posts)
        ? data.changed_posts.map(normalizeServerPost)
        : [];
      const mergePosts = (current, changed) => {
        const byPath = new Map((current || []).map((post) => [post.folder_path, post]));
        for (const post of changed || []) {
          if (!post?.folder_path) continue;
          const existing = byPath.get(post.folder_path);
          byPath.set(
            post.folder_path,
            options.generationResult
              ? mergeGenerationSnapshotPost(
                existing,
                post,
                String(post.folder_path) === String(data.selected_path || "")
                  ? data.selected_item_id
                  : "",
              )
              : post,
          );
        }
        return Array.from(byPath.values());
      };
      const replaceChangedPosts = (current, changed, predicate) => {
        const changedPaths = new Set((changed || []).map((post) => post?.folder_path).filter(Boolean));
        return mergePosts(
          options.generationResult
            ? (current || [])
            : (current || []).filter((post) => !changedPaths.has(post?.folder_path)),
          (changed || []).filter(predicate),
        );
      };
      library_state.posts = mergePosts(library_state.posts, changedPosts);
      library_state.indexedBuildPosts = replaceChangedPosts(
        library_state.indexedBuildPosts,
        changedPosts,
        (post) => (
          typeof buildMainPostVisible === "function"
            ? buildMainPostVisible(post)
            : (typeof isBuildPost !== "function" || isBuildPost(post))
        ),
      );
      sortPostsIfNeeded(library_state.indexedBuildPosts, comparePostsByRecentActivity);
      if (!data.index_rebuilt) {
        library_state.indexedBuildOffset = library_state.indexedBuildPosts.length;
        library_state.indexedBuildHasMore = (
          library_state.indexedBuildOffset < library_state.indexedBuildTotal
        );
      }
      library_state.indexedUploadPosts = replaceChangedPosts(
        library_state.indexedUploadPosts,
        changedPosts,
        (post) => post.area === "upload",
      );
      const compareUploadsByNewest = (left, right) => (
        String(right?.created_at || "").localeCompare(String(left?.created_at || ""))
      );
      library_state.indexedUploadPosts = sortPostsIfNeeded(
        library_state.indexedUploadPosts,
        compareUploadsByNewest,
      ).slice(0, uploadHistoryPageSize);
      if ((changedPosts.length || deletedPaths.length) && library_state.indexedSearchBuildQuery) {
        library_state.indexedSearchBuildQuery = "";
        library_state.indexedSearchBuildLoaded = false;
      }
      for (const collection of library_state.collections || []) {
        const collectionChanged = changedPosts.filter((post) => (
          String(post.folder_path || "") === String(collection.path || "")
          || String(post.folder_path || "").startsWith(`${String(collection.path || "")}/`)
        ));
        if (collectionChanged.length) collection.posts = mergePosts(collection.posts, collectionChanged);
      }
    } else {
      library_state.libraryIndexEnabled = false;
      library_state.posts = Array.isArray(data.posts) ? data.posts.map(normalizeServerPost) : [];
      library_state.collections = Array.isArray(data.collections)
        ? data.collections.map((collection) => ({
          ...collection,
          posts: Array.isArray(collection.posts) ? collection.posts.map(normalizeServerPost) : [],
        }))
        : [];
    }
    const selectablePosts = [
      ...library_state.posts,
      ...library_state.collections.flatMap((collection) => collection.posts || []),
    ];
    const selectablePaths = new Set([
      ...selectablePosts.map((post) => post.folder_path).filter(Boolean),
      ...selectablePosts.map(libraryPostStableIdentity).filter(Boolean),
    ]);
    for (const selectedPath of Array.from(library_state.selectedItems || [])) {
      if (!selectablePaths.has(selectedPath)) library_state.selectedItems.delete(selectedPath);
    }
    library_state.prompts = Array.isArray(data.prompts) ? data.prompts : [];
    applyAccountSnapshot(data);
    if (data.selected_path) {
      library_state.selectedPostPath = data.selected_path;
      library_state.selectedPostIdentity = "";
    }
    if (data.selected_item_id) library_state.selectedDetailItemId = data.selected_item_id;
    if ("selected_collection_path" in data) library_state.selectedCollectionPath = data.selected_collection_path || "";
    if ("selected_collection_post_path" in data) library_state.selectedCollectionPostPath = data.selected_collection_post_path || "";
    renderLibrary();
    if (indexed && typeof refreshIndexedLibraryViews === "function") {
      queueMicrotask(() => refreshIndexedLibraryViews());
    }
  }

  function isTransientImagineRemotePost(post) {
    const area = String(post?.area || "");
    const folderPath = String(post?.folder_path || "");
    return Boolean(
      area === "imagine_remote"
      || area === "imagine_upload_remote"
      || /^imagine_(saved|discover|unsaved|search|link|upload)\//.test(folderPath)
    );
  }

  let imagineRemoteLibrarySyncMemo = null;

  function syncImagineRemotePostsIntoLibrary() {
    const memo = imagineRemoteLibrarySyncMemo;
    if (
      memo
      && memo.posts === library_state.posts
      && memo.remotePosts === library_state.imagineRemotePosts
      && memo.discoverPosts === library_state.imagineDiscoverPosts
      && memo.unsavedPosts === library_state.imagineUnsavedPosts
      && memo.searchPosts === library_state.imagineSearchPosts
      && memo.uploadPosts === library_state.imagineUploadPosts
      && memo.likedPosts === library_state.imagineLikedPosts
    ) {
      return;
    }
    const localPosts = (library_state.posts || []).filter((post) => !isTransientImagineRemotePost(post));
    const remotePosts = Array.isArray(library_state.imagineRemotePosts)
      ? (typeof normalizeImagineRemotePosts === "function"
        ? normalizeImagineRemotePosts(library_state.imagineRemotePosts)
        : library_state.imagineRemotePosts.map(normalizeServerPost))
      : [];
    const savedDisplayPosts = typeof reconcileImagineSavedDisplayPosts === "function"
      ? reconcileImagineSavedDisplayPosts(remotePosts)
      : remotePosts;
    const discoverPosts = Array.isArray(library_state.imagineDiscoverPosts)
      ? (typeof normalizeImagineDiscoverPosts === "function"
        ? normalizeImagineDiscoverPosts(library_state.imagineDiscoverPosts)
        : library_state.imagineDiscoverPosts.map(normalizeServerPost))
      : [];
    const unsavedPosts = Array.isArray(library_state.imagineUnsavedPosts)
      ? (typeof normalizeImagineUnsavedPosts === "function"
        ? normalizeImagineUnsavedPosts(library_state.imagineUnsavedPosts)
        : library_state.imagineUnsavedPosts.map(normalizeServerPost))
      : [];
    const searchPosts = Array.isArray(library_state.imagineSearchPosts)
      ? (typeof normalizeImagineSearchPosts === "function"
        ? normalizeImagineSearchPosts(library_state.imagineSearchPosts)
        : library_state.imagineSearchPosts.map(normalizeServerPost))
      : [];
    const uploadPosts = Array.isArray(library_state.imagineUploadPosts)
      ? library_state.imagineUploadPosts.map(normalizeServerPost)
      : [];
    // Liked cards were left out, so a detail opened from Liked or from a link had no post in
    // library_state: selectedLibraryPost() came back empty and the heart hid itself.
    const likedPosts = Array.isArray(library_state.imagineLikedPosts)
      ? library_state.imagineLikedPosts.map(normalizeServerPost)
      : [];
    library_state.imagineRemotePosts = remotePosts;
    library_state.imagineDiscoverPosts = discoverPosts;
    library_state.imagineUnsavedPosts = unsavedPosts;
    library_state.imagineSearchPosts = searchPosts;
    library_state.imagineUploadPosts = uploadPosts;
    library_state.imagineLikedPosts = likedPosts;
    const posts = [...localPosts, ...savedDisplayPosts, ...discoverPosts, ...unsavedPosts, ...searchPosts, ...uploadPosts, ...likedPosts];
    library_state.posts = posts;
    if (library_state.selectedPostIdentity) {
      const selectedPost = posts.find((post) => (
        post.folder_path === library_state.selectedPostPath
        && libraryPostMatchesIdentity(post, library_state.selectedPostIdentity)
      ));
      if (selectedPost) library_state.selectedPostPath = selectedPost.folder_path || library_state.selectedPostPath;
    } else if (library_state.selectedPostPath) {
      const selectedPost = posts.find((post) => post.folder_path === library_state.selectedPostPath);
      if (selectedPost) library_state.selectedPostIdentity = libraryPostStableIdentity(selectedPost);
    }
    imagineRemoteLibrarySyncMemo = {
      posts,
      remotePosts,
      discoverPosts,
      unsavedPosts,
      searchPosts,
      uploadPosts,
      likedPosts,
    };
  }
