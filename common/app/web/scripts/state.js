// State, constants, API snapshot helpers
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
  const searchInput = document.getElementById("searchInput");
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
    videoModel: document.querySelector('[data-composer-control="video-model"]'),
    duration: document.querySelector('[data-composer-control="duration"]'),
    aspect: document.querySelector('[data-composer-control="aspect"]'),
    imageModel: document.querySelector('[data-composer-control="image-model"]'),
    resolution: document.querySelector('[data-composer-control="resolution"]'),
    count: document.querySelector('[data-composer-control="count"]'),
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
  const videoResolutionOptions = ["1080", "720", "480"];
  const countOptions = ["Auto", "1", "2", "4", "8", "10"];
  const buildT2iCountOptions = ["10", "8", "5", "4", "1"];
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
      imagineDiscoverPosts: [],
      imagineDiscoverLoaded: false,
      imagineDiscoverLoading: false,
      imagineDiscoverError: "",
      imagineDiscoverCursor: "",
      imagineDiscoverHasMore: false,
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
  };
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
    const linkRect = document.getElementById("i_link_btn")?.getBoundingClientRect();
    const folderRect = folderBtn?.getBoundingClientRect();
    if (!linkRect || !folderRect || linkRect.height === 0 || folderRect.height === 0) return;
    const linkCenter = linkRect.top + (linkRect.height / 2);
    const folderCenter = folderRect.top + (folderRect.height / 2);
    const toggleTop = (linkCenter + folderCenter) / 2;
    document.documentElement.style.setProperty("--sidebar-toggle-top", `${toggleTop}px`);
  }

  function scheduleSidebarTogglePosition() {
    requestAnimationFrame(() => requestAnimationFrame(syncSidebarTogglePosition));
  }

  function setSidebarCollapsed(collapsed) {
    if (collapsed) syncSidebarTogglePosition();
    appShell?.classList.toggle("sidebar_collapsed", collapsed);
    if (sidebarOpenBtn) sidebarOpenBtn.hidden = !collapsed;
    if (!collapsed) scheduleSidebarTogglePosition();
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
    if (typeof warmActiveImagineUsage === "function") warmActiveImagineUsage();
  }

  function applyLibrarySnapshot(data) {
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
      if (data.index_rebuilt || !previouslyIndexed) {
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
      }
      const previousCollections = new Map(
        (library_state.collections || []).map((collection) => [collection.path, collection]),
      );
      library_state.collections = Array.isArray(data.collections)
        ? data.collections.map((collection) => ({
          ...collection,
          posts: previousCollections.get(collection.path)?.posts || [],
          indexed_loaded: Boolean(previousCollections.get(collection.path)?.indexed_loaded),
          indexed_loading: false,
          indexed_total: Number(previousCollections.get(collection.path)?.indexed_total || 0),
          indexed_offset: Number(previousCollections.get(collection.path)?.indexed_offset || 0),
          indexed_has_more: Boolean(previousCollections.get(collection.path)?.indexed_has_more),
        }))
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
          if (post?.folder_path) byPath.set(post.folder_path, post);
        }
        return Array.from(byPath.values());
      };
      const replaceChangedPosts = (current, changed, predicate) => {
        const changedPaths = new Set((changed || []).map((post) => post?.folder_path).filter(Boolean));
        return mergePosts(
          (current || []).filter((post) => !changedPaths.has(post?.folder_path)),
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
      library_state.indexedBuildPosts.sort((left, right) => (
        String(right?.created_at || "").localeCompare(String(left?.created_at || ""))
        || String(left?.folder_path || "").localeCompare(String(right?.folder_path || ""))
      ));
      library_state.indexedBuildOffset = library_state.indexedBuildPosts.length;
      library_state.indexedBuildHasMore = (
        library_state.indexedBuildOffset < library_state.indexedBuildTotal
      );
      library_state.indexedUploadPosts = replaceChangedPosts(
        library_state.indexedUploadPosts,
        changedPosts,
        (post) => post.area === "upload",
      );
      library_state.indexedUploadPosts = library_state.indexedUploadPosts
        .sort((left, right) => String(right?.created_at || "").localeCompare(String(left?.created_at || "")))
        .slice(0, uploadHistoryPageSize);
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
    const selectablePaths = new Set([
      ...library_state.posts.map((post) => post.folder_path).filter(Boolean),
      ...library_state.collections.flatMap((collection) => (collection.posts || []).map((post) => post.folder_path)).filter(Boolean),
    ]);
    for (const selectedPath of Array.from(library_state.selectedItems || [])) {
      if (!selectablePaths.has(selectedPath)) library_state.selectedItems.delete(selectedPath);
    }
    library_state.prompts = Array.isArray(data.prompts) ? data.prompts : [];
    applyAccountSnapshot(data);
    if (data.selected_path) library_state.selectedPostPath = data.selected_path;
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

  function syncImagineRemotePostsIntoLibrary() {
    const localPosts = (library_state.posts || []).filter((post) => !isTransientImagineRemotePost(post));
    const remotePosts = Array.isArray(library_state.imagineRemotePosts)
      ? (typeof normalizeImagineRemotePosts === "function"
        ? normalizeImagineRemotePosts(library_state.imagineRemotePosts)
        : library_state.imagineRemotePosts.map(normalizeServerPost))
      : [];
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
    library_state.imagineRemotePosts = remotePosts;
    library_state.imagineDiscoverPosts = discoverPosts;
    library_state.imagineUnsavedPosts = unsavedPosts;
    library_state.imagineSearchPosts = searchPosts;
    library_state.posts = [...localPosts, ...remotePosts, ...discoverPosts, ...unsavedPosts, ...searchPosts];
  }
