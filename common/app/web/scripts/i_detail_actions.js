// Imagine detail actions that must not use local Build deletion
function imagineActionPostIdForItem(item) {
  const metadata = iDetailItemMetadata(item);
  const imagine = iDetailImagineMetadata(item);
  return String(
    item?.post_id
    || metadata.post_id
    || imagine.post_id
    || item?.item_id
    || item?.id
    || ""
  ).trim();
}

function imagineActionPostIdForPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  return String(
    post?.post_id
    || metadata.imagine_root_post_id
    || metadata.raw_root_post_id
    || representative?.root_post_id
    || imagineActionPostIdForItem(representative)
    || ""
  ).trim();
}

function imagineLikeTargetForItem(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const mediaUrl = String(
    item?.remote_url
    || item?.url
    || metadata.media_url
    || metadata.remote_url
    || imagine.media_url
    || "",
  ).trim();
  const assetId = String(
    item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
  return {
    id: assetId,
    asset_id: assetId,
    item_id: item?.item_id || assetId,
    post_id: item?.post_id || assetId,
    type: item?.type || imagine.media_type || "image",
    media_url: mediaUrl,
    remote_url: mediaUrl,
    external_reference: Boolean(
      metadata.external_reference
      || imagine.external_reference
      || metadata.link_source
      || imagine.link_source
      || ["discover", "link", "search"].includes(String(metadata.remote_view || imagine.remote_view || "").toLowerCase())
    ),
    metadata,
  };
}

function applyImagineLikeResultPostId(post, item, data) {
  const likedPostId = String(data?.id || data?.ids?.[0] || "").trim();
  if (!post || !likedPostId) return;
  post.post_id = likedPostId;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.imagine_root_post_id = likedPostId;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.post_id = likedPostId;
  post.metadata.imagine.root_post_id = likedPostId;
  if (!item) return;
  item.post_id = likedPostId;
  item.root_post_id = likedPostId;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.post_id = likedPostId;
  item.metadata.imagine.root_post_id = likedPostId;
}

function imaginePostActionMetadata(source) {
  const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return { metadata, imagine };
}

function isImagineDiscoverPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "discover"
    || post?.folder_path?.startsWith?.("imagine_discover/")
    || postMeta.metadata.remote_view === "discover"
    || postMeta.imagine.remote_view === "discover"
    || itemMeta.metadata.remote_view === "discover"
    || itemMeta.imagine.remote_view === "discover"
  );
}

function isImagineUnsavedPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "unsaved"
    || post?.folder_path?.startsWith?.("imagine_unsaved/")
    || postMeta.metadata.remote_view === "unsaved"
    || postMeta.imagine.remote_view === "unsaved"
    || itemMeta.metadata.remote_view === "unsaved"
    || itemMeta.imagine.remote_view === "unsaved"
  );
}

function isImagineSearchPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "search"
    || post?.folder_path?.startsWith?.("imagine_search/")
    || postMeta.metadata.remote_view === "search"
    || postMeta.imagine.remote_view === "search"
    || itemMeta.metadata.remote_view === "search"
    || itemMeta.imagine.remote_view === "search"
  );
}

function isImagineLinkSourcePost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    postMeta.metadata.link_source
    || postMeta.imagine.link_source
    || itemMeta.metadata.link_source
    || itemMeta.imagine.link_source
    || postMeta.metadata.remote_view === "link"
    || postMeta.imagine.remote_view === "link"
    || itemMeta.metadata.remote_view === "link"
    || itemMeta.imagine.remote_view === "link"
  );
}

function isImagineExternalReferenceItem(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  const target = item ? imagineLikeTargetForItem(item) : {};
  return Boolean(
    target.external_reference
    || postMeta.metadata.external_reference
    || postMeta.imagine.external_reference
    || itemMeta.metadata.external_reference
    || itemMeta.imagine.external_reference
    || itemMeta.metadata.local_heart_companion
    || itemMeta.imagine.local_heart_companion
    || isImagineLinkSourcePost(post, item)
  );
}

function imagineLinkBundleItems(post, fallbackItems = []) {
  const fallback = (fallbackItems || []).filter(Boolean);
  if (!isImagineLinkSourcePost(post, fallback[0])) return fallback;
  const items = (post?.items || []).filter(Boolean);
  return items.length ? items : fallback;
}

function imagineLinkPostIdForPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  const explicitId = String(
    postMeta.metadata.link_post_id
    || postMeta.imagine.link_post_id
    || itemMeta.metadata.link_post_id
    || itemMeta.imagine.link_post_id
    || "",
  ).trim();
  if (explicitId) return explicitId;
  return isImagineLinkSourcePost(post, item)
    ? String(imagineActionPostIdForPost(post) || "").trim()
    : "";
}

function imagineLinkRegistrationItem(post, fallbackItem = null) {
  const linkPostId = imagineLinkPostIdForPost(post, fallbackItem);
  const items = (post?.items || []).filter(Boolean);
  if (linkPostId) {
    const linkedItem = items.find((item) => imagineLikeTargetForItem(item).id === linkPostId);
    if (linkedItem) return linkedItem;
  }
  return fallbackItem || representativeItem(items, post) || items[0] || null;
}

function imagineLinkRegistrationItems(post, fallbackItem = null, wholeCard = false) {
  const fallback = imagineLinkRegistrationItem(post, fallbackItem);
  const provenance = typeof imagineSavedPostProvenance === "function"
    ? imagineSavedPostProvenance(post)
    : "";
  if (!wholeCard || provenance !== "cloned-liked") return [fallback].filter(Boolean);
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const membershipIds = new Set([
    ...(Array.isArray(metadata.liked_membership_asset_ids) ? metadata.liked_membership_asset_ids : []),
    ...(Array.isArray(imagine.liked_membership_asset_ids) ? imagine.liked_membership_asset_ids : []),
    ...(Array.isArray(metadata.official_clone_assets)
      ? metadata.official_clone_assets.map((entry) => entry?.asset_id || entry?.assetId)
      : []),
  ].map((value) => String(value || "").trim()).filter(Boolean));
  if (!membershipIds.size) {
    for (const item of post?.items || []) {
      const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
      const id = String(
        itemMetadata.official_clone_asset_id
        || itemImagine.official_clone_asset_id
        || imagineLikeTargetForItem(item).id
        || "",
      ).trim();
      if (id) membershipIds.add(id);
    }
  }
  const items = (post?.items || []).filter(Boolean);
  return Array.from(membershipIds, (id) => {
    return items.find((item) => {
      const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
      return [
        imagineLikeTargetForItem(item).id,
        itemMetadata.official_clone_asset_id,
        itemImagine.official_clone_asset_id,
      ].some((value) => String(value || "").trim() === id);
    }) || { asset_id: id, item_id: id, post_id: id, metadata: {} };
  });
}

function imaginePostLiked(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  if (item) {
    return Boolean(
      item?.liked === true
      || item?.favorite === true
      || itemMeta.metadata.liked === true
      || itemMeta.imagine.liked === true
    );
  }
  return Boolean(
    post?.liked === true
    || post?.favorite === true
    || postMeta.metadata.liked === true
    || postMeta.imagine.liked === true
  );
}

function markImaginePostLiked(post, liked) {
  if (!post) return;
  post.liked = liked;
  post.favorite = liked;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.liked = liked;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.liked = liked;
  for (const item of post.items || []) {
    item.liked = liked;
    item.favorite = liked;
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.liked = liked;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.liked = liked;
  }
}

function markImagineItemLiked(item, liked) {
  if (!item) return;
  item.liked = liked;
  item.favorite = liked;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.liked = liked;
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.liked = liked;
}

function imagineSavedGroupIdForPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const folderPath = String(post?.folder_path || "");
  return String(
    imagineLinkPostIdForPost(post)
    || metadata.local_saved_group_id
    || metadata.group_id
    || (folderPath.startsWith("imagine_unsaved/") ? folderPath.slice("imagine_unsaved/".length) : "")
    || imagineActionPostIdForPost(post)
    || "",
  ).trim();
}

function imagineLikeResultMappings(data) {
  const explicit = Array.isArray(data?.mappings)
    ? data.mappings
      .filter((mapping) => mapping && typeof mapping === "object")
      .map((mapping) => ({
        source_id: String(mapping.source_id || "").trim(),
        source_item_id: String(mapping.source_item_id || "").trim(),
        liked_id: String(mapping.liked_id || mapping.id || "").trim(),
        media_url: String(mapping.media_url || "").trim(),
        external_reference: Boolean(mapping.external_reference),
      }))
      .filter((mapping) => mapping.liked_id)
    : [];
  if (explicit.length) return explicit;
  return (Array.isArray(data?.ids) ? data.ids : [data?.id])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((likedId) => ({
      source_id: "",
      source_item_id: "",
      liked_id: likedId,
      media_url: "",
      external_reference: false,
    }));
}

function imagineOfficialCloneRecords(data) {
  const seenAssetIds = new Set();
  return (Array.isArray(data?.cloned_external) ? data.cloned_external : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      asset_id: String(entry.asset_id || entry.assetId || "").trim(),
      source_asset_id: String(
        entry.source_asset_id
        || entry.sourceAssetId
        || entry.duplicated_from_asset_id
        || "",
      ).trim(),
      conversation_id: String(entry.conversation_id || entry.conversationId || "").trim(),
      response_id: String(entry.response_id || entry.responseId || "").trim(),
      media_type: String(entry.media_type || entry.mimeType || "").trim(),
    }))
    .filter((entry) => {
      if (!entry.asset_id || !entry.source_asset_id || seenAssetIds.has(entry.asset_id)) return false;
      seenAssetIds.add(entry.asset_id);
      return true;
    });
}

function applyImagineOfficialCloneRecords(post, data, targetItems = null) {
  const records = imagineOfficialCloneRecords(data);
  if (!post || !records.length) return records;
  const items = (Array.isArray(targetItems) ? targetItems : post.items || []).filter(Boolean);
  for (const item of items) {
    const itemKeys = typeof imaginePostIdKeysForItem === "function"
      ? imaginePostIdKeysForItem(item)
      : [imagineLikeTargetForItem(item).id].filter(Boolean);
    const record = records.find((candidate) => itemKeys.includes(candidate.source_asset_id));
    if (!record) continue;
    item.official_asset_id = record.asset_id;
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.official_asset_id = record.asset_id;
    item.metadata.official_clone_asset_id = record.asset_id;
    item.metadata.official_clone_source_asset_id = record.source_asset_id;
    item.metadata.official_clone_conversation_id = record.conversation_id;
    item.metadata.official_clone_response_id = record.response_id;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object"
      ? item.metadata.imagine
      : {};
    item.metadata.imagine.official_asset_id = record.asset_id;
    item.metadata.imagine.official_clone_asset_id = record.asset_id;
    item.metadata.imagine.official_clone_source_asset_id = record.source_asset_id;
    item.metadata.imagine.official_clone_conversation_id = record.conversation_id;
    item.metadata.imagine.official_clone_response_id = record.response_id;
    // The heart has done the one thing it can do: this is now a copy the account owns.
    // Liked stamps the same mark when it lists a copy, but that only arrives on the next
    // load — set it here so the heart goes away the moment it is pressed, which is also
    // what tells a copy apart from a link that has not been taken yet.
    item.metadata.cloned_copy = true;
    item.metadata.cloned_from_asset_id = record.source_asset_id;
    item.metadata.imagine.cloned_copy = true;
    item.metadata.imagine.cloned_from_asset_id = record.source_asset_id;
  }
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.cloned_copy = true;
  post.metadata.cloned_from_asset_id = records[0]?.source_asset_id || "";
  const existing = Array.isArray(post.metadata.official_clone_assets)
    ? post.metadata.official_clone_assets
    : [];
  const recordsById = new Map(
    [...existing, ...records]
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => [String(entry.asset_id || entry.assetId || "").trim(), entry])
      .filter(([assetId]) => assetId),
  );
  post.metadata.official_clone_assets = Array.from(recordsById.values());
  return records;
}

function applyImagineLikedIdToItem(item, likedId) {
  if (!item || !likedId) return;
  item.post_id = likedId;
  item.root_post_id = likedId;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.post_id = likedId;
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.post_id = likedId;
  item.metadata.imagine.root_post_id = likedId;
}

function applyImagineUnsavedLikeResult(post, data) {
  const items = (post?.items || []).filter(Boolean);
  const mappings = imagineLikeResultMappings(data);
  if (!post || !items.length || mappings.length < items.length) {
    throw new Error(`Only ${mappings.length} of ${items.length} Unsaved media item(s) were saved.`);
  }
  const unusedItems = new Set(items);
  const applied = [];
  for (const mapping of mappings) {
    let item = items.find((candidate) => {
      if (!unusedItems.has(candidate)) return false;
      const keys = typeof imaginePostIdKeysForItem === "function"
        ? imaginePostIdKeysForItem(candidate)
        : [imagineActionPostIdForItem(candidate), candidate?.remote_url, candidate?.url];
      return (mapping.source_item_id && keys.includes(mapping.source_item_id))
        || (mapping.source_id && keys.includes(mapping.source_id))
        || (mapping.media_url && keys.includes(mapping.media_url));
    });
    if (!item) item = Array.from(unusedItems)[0];
    if (!item) continue;
    unusedItems.delete(item);
    applyImagineLikedIdToItem(item, mapping.liked_id);
    if (mapping.external_reference) {
      item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      item.metadata.external_reference = true;
      item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
      item.metadata.imagine.external_reference = true;
    }
    applied.push({
      source_id: mapping.source_id,
      source_item_id: mapping.source_item_id,
      liked_id: mapping.liked_id,
      media_url: mapping.media_url || item.remote_url || item.url || item.metadata?.media_url || "",
      external_reference: Boolean(mapping.external_reference),
    });
  }
  if (applied.length < items.length) {
    throw new Error(`Only ${applied.length} of ${items.length} Unsaved media item(s) were saved.`);
  }
  const groupId = imagineSavedGroupIdForPost(post);
  const firstLikedId = applied[0]?.liked_id || "";
  post.post_id = firstLikedId;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.local_saved_group_id = groupId || firstLikedId;
  post.metadata.saved_sync_pending = false;
  post.metadata.saved_sync_items = applied;
  delete post.metadata.saved_sync_pending_at;
  post.metadata.imagine_root_post_id = firstLikedId;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.post_id = firstLikedId;
  post.metadata.imagine.root_post_id = firstLikedId;
}

function savedImagineSingleItemPost(post, item, data, savedItems = [item]) {
  const mappings = imagineLikeResultMappings(data);
  const itemKeys = typeof imaginePostIdKeysForItem === "function"
    ? imaginePostIdKeysForItem(item)
    : [imagineActionPostIdForItem(item), item?.remote_url, item?.url].filter(Boolean);
  const mapping = mappings.find((candidate) => (
    (candidate.source_item_id && itemKeys.includes(candidate.source_item_id))
    || (candidate.source_id && itemKeys.includes(candidate.source_id))
    || (candidate.media_url && itemKeys.includes(candidate.media_url))
  )) || mappings[0];
  if (!post || !item || !mapping?.liked_id) {
    throw new Error("The selected Imagine media item was not confirmed in Saved.");
  }
  applyImagineLikedIdToItem(item, mapping.liked_id);
  if (mapping.external_reference) {
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.external_reference = true;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.external_reference = true;
  }
  item.liked = true;
  item.favorite = true;
  const items = (savedItems || []).filter(Boolean);
  for (const savedItem of items) {
    savedItem.liked = true;
    savedItem.favorite = true;
    savedItem.metadata = savedItem.metadata && typeof savedItem.metadata === "object" ? savedItem.metadata : {};
    savedItem.metadata.liked = true;
    savedItem.metadata.imagine = savedItem.metadata.imagine && typeof savedItem.metadata.imagine === "object"
      ? savedItem.metadata.imagine
      : {};
    savedItem.metadata.imagine.liked = true;
  }
  const representative = representativeItem(items, { ...post, items }) || item;
  const groupId = imagineSavedGroupIdForPost(post) || mapping.liked_id;
  const metadata = post.metadata && typeof post.metadata === "object" ? { ...post.metadata } : {};
  metadata.local_saved_group_id = groupId;
  metadata.saved_sync_pending = false;
  metadata.saved_sync_items = [{
    source_id: mapping.source_id,
    source_item_id: mapping.source_item_id,
    liked_id: mapping.liked_id,
    media_url: mapping.media_url || item.remote_url || item.url || item.metadata?.media_url || "",
    external_reference: Boolean(mapping.external_reference),
  }];
  metadata.imagine_root_post_id = mapping.liked_id;
  return {
    ...post,
    post_id: mapping.liked_id,
    items,
    representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    representative_item: representative,
    metadata,
  };
}

function savedImaginePostFromLocalPost(post) {
  if (!post) return null;
  const postId = imagineActionPostIdForPost(post);
  if (!postId) return null;
  const groupId = imagineSavedGroupIdForPost(post) || postId;
  const representative = representativeItem(post.items || [], post) || post.representative_item || post.items?.[0] || {};
  const metadata = post.metadata && typeof post.metadata === "object" ? { ...post.metadata } : {};
  metadata.liked = true;
  metadata.remote_view = "saved";
  metadata.imagine = metadata.imagine && typeof metadata.imagine === "object" ? { ...metadata.imagine } : {};
  metadata.imagine.liked = true;
  metadata.imagine.remote_view = "saved";
  return normalizeServerPost({
    ...post,
    post_id: postId,
    source: "imagine",
    mode: "saved",
    area: "imagine_remote",
    remote: true,
    liked: true,
    favorite: true,
    folder_path: `imagine_saved/${groupId}`,
    folderName: post.title || post.folderName || postId,
    representative: representative?.url || representative?.remote_url || representative?.item_id || post.representative || "",
    representative_item: representative,
    items: (post.items || []).map((item) => {
      const itemMetadata = item?.metadata && typeof item.metadata === "object" ? { ...item.metadata } : {};
      itemMetadata.liked = true;
      itemMetadata.remote_view = "saved";
      itemMetadata.imagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? { ...itemMetadata.imagine } : {};
      itemMetadata.imagine.liked = true;
      itemMetadata.imagine.remote_view = "saved";
      return {
        ...item,
        liked: true,
        favorite: true,
        metadata: itemMetadata,
      };
    }),
    metadata,
  });
}

function imagineLocalHeartSnapshot(post, items) {
  const selectedItems = (items || []).filter(Boolean);
  if (!post || !selectedItems.length) return null;
  const representative = representativeItem(selectedItems, { ...post, items: selectedItems }) || selectedItems[0];
  const snapshot = savedImaginePostFromLocalPost({
    ...post,
    items: selectedItems,
    representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    representative_item: representative,
  });
  if (!snapshot) return null;
  snapshot.metadata = snapshot.metadata && typeof snapshot.metadata === "object" ? snapshot.metadata : {};
  snapshot.metadata.local_heart = true;
  snapshot.metadata.saved_sync_pending = false;
  for (const item of snapshot.items || []) {
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.local_heart = true;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.local_heart = true;
  }
  return snapshot;
}

function addImaginePostToSavedView(post) {
  const savedPost = savedImaginePostFromLocalPost(post);
  if (!savedPost) return;
  const savedIdentity = typeof libraryPostStableIdentity === "function"
    ? libraryPostStableIdentity(savedPost)
    : String(savedPost.folder_path || "");
  if (typeof upsertImagineRemotePost === "function") {
    const existing = (library_state.imagineRemotePosts || [])
      .find((candidate) => (
        typeof libraryPostMatchesIdentity === "function"
          ? libraryPostMatchesIdentity(candidate, savedIdentity)
          : candidate?.folder_path === savedPost.folder_path
      ));
    const merged = existing && typeof mergeImagineRemotePosts === "function"
      ? mergeImagineRemotePosts([existing], [savedPost])[0]
      : savedPost;
    upsertImagineRemotePost(merged || savedPost);
  } else {
    const list = Array.isArray(library_state.imagineRemotePosts) ? library_state.imagineRemotePosts : [];
    const index = list.findIndex((candidate) => (
      typeof libraryPostMatchesIdentity === "function"
        ? libraryPostMatchesIdentity(candidate, savedIdentity)
        : candidate?.folder_path === savedPost.folder_path
    ));
    if (index >= 0) list.splice(index, 1, savedPost);
    else list.unshift(savedPost);
    library_state.imagineRemotePosts = list;
    syncImagineRemotePostsIntoLibrary();
  }
  library_state.imagineRemoteLoaded = true;
}

function refreshImagineRemoteViews() {
  syncImagineRemotePostsIntoLibrary();
  renderImagineSourceCards();
  if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
  renderDetailViews();
}

function moveImagineT2iPostOutOfSessionView(post) {
  if (!(typeof isImagineT2iPost === "function" && isImagineT2iPost(post))) return false;
  const folderPath = String(post?.folder_path || "");
  if (folderPath) library_state.sessionImagineT2iPaths?.delete(folderPath);
  return true;
}

function imagineItemsRemoveWholePost(post, removedItems) {
  const postItems = (post?.items || []).filter(Boolean);
  const removedKeys = new Set(
    (removedItems || []).filter(Boolean).flatMap((item) => imaginePostIdKeysForItem(item)),
  );
  return Boolean(postItems.length) && postItems.every((item) => (
    imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
  ));
}

function returnToImagineT2iMain() {
  library_state.selectedPostPath = "";
  library_state.selectedPostIdentity = "";
  library_state.selectedDetailItemId = "";
  library_state.selectedImagineJobId = "";
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("T2I", "t2i") : "t2i";
  if (typeof setImagineTab === "function") setImagineTab("i_t2i_btn");
  openScreen("i_main", "i_imagine_nav_btn");
}

function returnToImagineUnsavedMain() {
  library_state.selectedPostPath = "";
  library_state.selectedPostIdentity = "";
  library_state.selectedDetailItemId = "";
  library_state.selectedImagineJobId = "";
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("IMAGINE", "imagine") : "imagine";
  if (typeof setImagineTab === "function") setImagineTab("i_imagine_tab_btn");
  openScreen("i_main", "i_imagine_nav_btn");
}

function imagineListElementForScreen(screenId = screen_state.current_screen) {
  if (screenId === "i_discover_main") return document.querySelector(".i_discover_card_list");
  if (screenId === "i_main") return document.querySelector(".i_card_list");
  if (screenId === "search_main") return document.querySelector(".search_card_list");
  return null;
}

function imagineListScrollTopForScreen(screenId = screen_state.current_screen) {
  const list = imagineListElementForScreen(screenId);
  if (!list) return null;
  if (typeof virtualCardListUsesDocumentScroll === "function" && virtualCardListUsesDocumentScroll()) {
    return Math.max(0, Number(window.scrollY || document.documentElement?.scrollTop || 0));
  }
  return Math.max(0, Number(list.scrollTop || 0));
}

function restoreImagineListScrollForScreen(screenId, scrollTop) {
  if (scrollTop === null || scrollTop === undefined) return;
  const list = imagineListElementForScreen(screenId);
  if (!list) return;
  const top = Math.max(0, Number(scrollTop) || 0);
  const applyScroll = () => {
    if (typeof virtualCardListUsesDocumentScroll === "function" && virtualCardListUsesDocumentScroll()) {
      window.scrollTo(0, top);
    } else {
      list.scrollTop = top;
    }
  };
  applyScroll();
  requestAnimationFrame(applyScroll);
}

function renderImagineListForScreen(screenId = screen_state.current_screen, scrollTop = null) {
  if (screenId === "i_discover_main" && typeof renderImagineDiscoverCards === "function") {
    renderImagineDiscoverCards();
  } else if (screenId === "search_main" && typeof renderSearchResults === "function") {
    renderSearchResults();
  } else {
    renderImagineSourceCards();
  }
  restoreImagineListScrollForScreen(screenId, scrollTop);
}

// Every list a deleted post has to be taken out of, and put back into if the delete
// fails. Liked was missing, so a card deleted from there stayed on screen until the view
// was fetched again — the delete had gone through, but nothing looked like it had.
const imaginePostListNames = [
  "imagineRemotePosts",
  "imagineDiscoverPosts",
  "imagineUnsavedPosts",
  "imagineSearchPosts",
  "imagineUploadPosts",
  "imagineLikedPosts",
  "posts",
];

function imagineCardStableIdentity(post) {
  return typeof libraryPostStableIdentity === "function"
    ? libraryPostStableIdentity(post)
    : String(post?.folder_path || "");
}

function isImagineUploadPagePost(post) {
  return Boolean(
    post?.area === "imagine_upload_remote"
    || String(post?.folder_path || "").startsWith("imagine_uploads/")
  );
}

function isImagineUploadOriginBundlePost(post) {
  return Boolean(
    post?.metadata?.upload_origin_bundle === true
    && !isImagineUploadPagePost(post)
  );
}

function isImagineUploadBundleSourceItem(post, item) {
  if (!isImagineUploadOriginBundlePost(post) || !item) return false;
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const role = String(item?.role || metadata.role || imagine.role || "").trim().toLowerCase();
  const relation = String(item?.relation || metadata.relation || imagine.relation || "").trim().toLowerCase();
  const sourceId = String(post?.metadata?.upload_source_asset_id || "").trim();
  const itemId = imagineDeleteAssetIdForItem(item);
  return Boolean(
    item?.official_upload_source
    || metadata.official_upload_source
    || imagine.official_upload_source
    || role === "source"
    || role === "upload"
    || relation === "upload"
    || (sourceId && itemId === sourceId)
  );
}

function captureImaginePostRemovalSnapshot(post) {
  const folderPath = String(post?.folder_path || "");
  if (!folderPath) return null;
  const cardIdentity = imagineCardStableIdentity(post);
  return {
    folderPath,
    cardIdentity,
    selectedPostPath: library_state.selectedPostPath,
    selectedPostIdentity: library_state.selectedPostIdentity,
    selectedDetailItemId: library_state.selectedDetailItemId,
    screenId: screen_state.current_screen,
    activeButtonId: screen_state.current_i_nav_btn,
    lists: imaginePostListNames.map((listName) => ({
      listName,
      entries: (library_state[listName] || []).flatMap((candidate, index) => (
        imagineCardStableIdentity(candidate) === cardIdentity ? [{ index, post: candidate }] : []
      )),
    })).filter((snapshot) => snapshot.entries.length),
  };
}

function restoreImaginePostRemovalSnapshot(snapshot, optimisticState = {}) {
  if (!snapshot?.folderPath) return;
  for (const listSnapshot of snapshot.lists || []) {
    const current = Array.isArray(library_state[listSnapshot.listName])
      ? library_state[listSnapshot.listName].filter((candidate) => (
        imagineCardStableIdentity(candidate) !== snapshot.cardIdentity
      ))
      : [];
    for (const entry of [...listSnapshot.entries].sort((left, right) => left.index - right.index)) {
      current.splice(Math.min(entry.index, current.length), 0, entry.post);
    }
    library_state[listSnapshot.listName] = current;
  }
  syncImagineRemotePostsIntoLibrary();
  const selectionUnchanged = (
    screen_state.current_screen === optimisticState.screenId
    && library_state.selectedPostPath === optimisticState.selectedPostPath
    && library_state.selectedPostIdentity === optimisticState.selectedPostIdentity
    && library_state.selectedDetailItemId === optimisticState.selectedDetailItemId
  );
  if (selectionUnchanged) {
    library_state.selectedPostPath = snapshot.selectedPostPath;
    library_state.selectedPostIdentity = snapshot.selectedPostIdentity;
    library_state.selectedDetailItemId = snapshot.selectedDetailItemId;
  }
  if (
    selectionUnchanged
    && snapshot.screenId === "i_detail"
    && screen_state.current_screen !== "i_detail"
  ) {
    openScreen("i_detail", snapshot.activeButtonId);
  }
  renderImagineListForScreen(snapshot.screenId);
  renderDetailViews();
}

function removeImagineItemsFromPost(post, removedItems, options = {}) {
  const itemsToRemove = (Array.isArray(removedItems) ? removedItems : [removedItems]).filter(Boolean);
  if (!post?.folder_path || !itemsToRemove.length) return false;
  const screenId = options.screenId || screen_state.current_screen;
  const keepListScreen = Boolean(options.keepListScreen);
  const scrollTop = options.scrollTop;
  const removedKeys = new Set(itemsToRemove.flatMap((item) => imaginePostIdKeysForItem(item)));
  const postIdentity = imagineCardStableIdentity(post);
  const removeSharedSavedItems = !isImagineUploadPagePost(post);
  const stripPost = (candidate, matchSavedItems = false) => {
    if (!candidate) return candidate;
    const candidateItems = candidate.items || [];
    const sameCard = imagineCardStableIdentity(candidate) === postIdentity;
    const hasDeletedSavedItem = matchSavedItems && sameCard && candidateItems.some((item) => (
      imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
    ));
    if (!sameCard && !hasDeletedSavedItem) return candidate;
    const items = candidateItems.filter((item) => {
      const keys = imaginePostIdKeysForItem(item);
      return !keys.some((key) => removedKeys.has(key));
    });
    if (items.length === candidateItems.length) return candidate;
    if (!items.length) return null;
    const representative = representativeItem(items, { ...candidate, items }) || items[0];
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  for (const listName of imaginePostListNames) {
    if (!Array.isArray(library_state[listName])) continue;
    library_state[listName] = library_state[listName]
      .map((candidate) => stripPost(
        candidate,
        listName === "imagineRemotePosts" && removeSharedSavedItems,
      ))
      .filter(Boolean);
  }
  syncImagineRemotePostsIntoLibrary();
  const current = selectedLibraryPost();
  if (!current) {
    library_state.selectedPostPath = "";
    library_state.selectedPostIdentity = "";
    library_state.selectedDetailItemId = "";
    if (keepListScreen) {
      renderImagineListForScreen(screenId, scrollTop);
      renderDetailViews();
      return true;
    }
    const backTarget = typeof detailBackTarget === "function" ? detailBackTarget("imagine") : null;
    const returnScreenId = backTarget?.screenId || "i_main";
    const returnButtonId = backTarget?.activeButtonId || screen_state.current_i_nav_btn;
    const returnScrollTop = backTarget?.scrollTop ?? scrollTop;
    openScreen(returnScreenId, returnButtonId);
    renderImagineListForScreen(returnScreenId, returnScrollTop);
    return true;
  }
  const nextSelected = current.items.find((item) => mediaItemKey(item) === library_state.selectedDetailItemId)
    || detailDefaultSelectedItem(current)
    || current.items[0];
  library_state.selectedDetailItemId = mediaItemKey(nextSelected);
  renderImagineListForScreen(screenId, scrollTop);
  renderDetailViews();
  return true;
}

function removeImagineItemFromPost(post, removedItem) {
  return removeImagineItemsFromPost(post, removedItem);
}

function imagineDeleteAssetIdForItem(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return String(
    item?.official_asset_id
    || metadata.official_asset_id
    || metadata.official_clone_asset_id
    || imagine.official_asset_id
    || imagine.official_clone_asset_id
    || item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
}

function imagineDeleteConversationIdForPost(post, item = null) {
  const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
  const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const postImagine = postMetadata.imagine && typeof postMetadata.imagine === "object" ? postMetadata.imagine : {};
  const explicitId = String(
    itemMetadata.official_clone_conversation_id
    || itemImagine.official_clone_conversation_id
    || item?.conversation_id
    || itemMetadata.conversation_id
    || itemImagine.conversation_id
    || post?.conversation_id
    || postMetadata.conversation_id
    || postImagine.conversation_id
    || "",
  ).trim();
  if (explicitId) return explicitId;
  if (isImagineUnsavedPost(post, item)) return "";
  return String(
    postMetadata.imagine_root_post_id
    || postMetadata.raw_root_post_id
    || post?.root_post_id
    || post?.post_id
    || "",
  ).trim();
}

function imagineDeletePayloadForItem(post, item) {
  const postId = imagineActionPostIdForItem(item);
  const assetId = imagineDeleteAssetIdForItem(item);
  if (!postId && !assetId) {
    return null;
  }
  const uploadPage = isImagineUploadPagePost(post);
  const bundleSourceOnly = isImagineUploadBundleSourceItem(post, item);
  return {
    id: assetId || postId,
    asset_id: assetId,
    post_id: postId,
    item_id: item?.item_id || "",
    detail_post_id: imagineActionPostIdForPost(post),
    conversation_id: imagineDeleteConversationIdForPost(post, item),
    type: item?.type || "",
    media_url: item?.remote_url || item?.url || item?.metadata?.media_url || item?.metadata?.remote_url || item?.metadata?.imagine?.media_url || "",
    remote_url: item?.remote_url || item?.url || "",
    metadata: item?.metadata || {},
    account_id: iDetailAccountId(item, post),
    source_scope: uploadPage ? "upload_page" : (isImagineUploadOriginBundlePost(post) ? "imagine_bundle" : ""),
    bundle_source_only: bundleSourceOnly,
    bundle_post_id: bundleSourceOnly
      ? String(post?.metadata?.conversation_id || post?.post_id || "").trim()
      : "",
  };
}

function imagineConversationDeletePayloadForPost(post) {
  const items = (post?.items || []).filter(Boolean);
  const ownedItem = items.find((item) => !isImagineExternalReferenceItem(post, item));
  const representative = ownedItem || representativeItem(items, post) || post?.representative_item || items[0];
  const payload = imagineDeletePayloadForItem(post, representative);
  if (!payload) return null;
  return {
    ...payload,
    conversation_id: imagineDeleteConversationIdForPost(post, representative),
  };
}

async function deleteImagineRemoteItem(post, item) {
  const deletePayload = imagineDeletePayloadForItem(post, item);
  if (!deletePayload) {
    throw new Error("This Imagine item has no asset id.");
  }
  const endpoint = isImagineUnsavedPost(post, item)
    ? "/api/imagine/asset-metadata/delete"
    : "/api/imagine/asset/delete";
  const data = await qApi(endpoint, deletePayload);
  if (typeof releaseImagineGeneratedSavedSyncForDeletedItems === "function") {
    releaseImagineGeneratedSavedSyncForDeletedItems([item, deletePayload]);
  }
  return {
    deletedItems: [item],
    failures: [],
    data,
    action: endpoint.includes("asset-metadata") ? "asset-metadata-delete" : "asset-delete",
  };
}

function isImagineConversationDeleteFallbackError(error) {
  const message = String(error?.message || error || "");
  return (
    (/\bHTTP 404\b/i.test(message) && /Conversation(?:' with ID)?[^]*not found/i.test(message))
    || (
      /\bHTTP 500\b/i.test(message)
      && /GetAssetMetadataForDelete|unexpected database error/i.test(message)
    )
  );
}

async function deleteImagineCardAssets(post, items) {
  const deletedItems = [];
  const failures = [];
  const candidates = (items || []).filter(Boolean);
  const deletedAssetIds = new Set();
  const failedAssetIds = new Set();
  for (const item of candidates) {
    const payload = imagineDeletePayloadForItem(post, item);
    if (!payload) {
      failures.push(new Error("This Imagine item has no asset id."));
      continue;
    }
    const assetId = String(payload.asset_id || payload.id || "").trim();
    if (assetId && deletedAssetIds.has(assetId)) {
      deletedItems.push(item);
      continue;
    }
    if (assetId && failedAssetIds.has(assetId)) continue;
    try {
      await qApi("/api/imagine/asset/delete", payload);
      if (assetId) deletedAssetIds.add(assetId);
      deletedItems.push(item);
    } catch (error) {
      if (assetId) failedAssetIds.add(assetId);
      failures.push(error);
    }
  }
  if (deletedItems.length && typeof releaseImagineGeneratedSavedSyncForDeletedItems === "function") {
    releaseImagineGeneratedSavedSyncForDeletedItems(deletedItems);
  }
  return { deletedItems, failures };
}

async function deleteImagineCardConversation(post, items) {
  const deletedItems = (items || []).filter(Boolean);
  const representative = representativeItem(deletedItems, post) || deletedItems[0] || null;
  const payload = imagineConversationDeletePayloadForPost({
    ...post,
    items: deletedItems,
  });
  if (!payload) {
    throw new Error("This Imagine card has no deletion target.");
  }
  // A copied Liked card can carry an asset id in the old conversation-id slot.
  // Resolve the copy's real conversation on the server before deleting the card.
  if (isImagineLinkSourcePost(post, representative) && imagineLinkCardHasOwnedClone(post, deletedItems)) {
    payload.conversation_id = "";
  }
  const data = await qApi("/api/imagine/conversation/delete", payload);
  if (typeof releaseImagineGeneratedSavedSyncForDeletedItems === "function") {
    releaseImagineGeneratedSavedSyncForDeletedItems(deletedItems);
  }
  return {
    deletedItems,
    failures: [],
    data,
    action: "conversation-delete",
  };
}

function imagineLinkCardHasOwnedClone(post, items = []) {
  const candidates = [post, ...(items || [])].filter(Boolean);
  return candidates.some((candidate) => {
    const { metadata, imagine } = imaginePostActionMetadata(candidate);
    return Boolean(
      candidate?.official_asset_id
      || metadata.official_asset_id
      || metadata.official_clone_asset_id
      || imagine.official_asset_id
      || imagine.official_clone_asset_id
      || metadata.cloned_copy
      || imagine.cloned_copy
    );
  });
}

async function deleteImagineLinkCardBundle(post, items) {
  const bundleItems = (items || []).filter(Boolean);
  // A link that has not been copied belongs to someone else. Its card can only be
  // removed from this account's Liked collection; its original media is never deleted.
  const registrationItems = imagineLinkRegistrationItems(post, bundleItems[0], true);
  const requestItems = registrationItems
    .map(imagineLikeTargetForItem)
    .filter((target) => target.id);
  if (!requestItems.length) {
    throw new Error("This Imagine link card has no asset id.");
  }
  const linkPostId = imagineLinkPostIdForPost(post, bundleItems[0]);
  const data = await qApi("/api/imagine/post/unsave", {
    account_id: post?.account_id || iDetailAccountId(bundleItems[0], post),
    scope: "card",
    link_source: true,
    local_group_id: imagineSavedGroupIdForPost(post),
    link_post_id: linkPostId,
    post_id: linkPostId,
    items: requestItems,
  });
  return {
    deletedItems: bundleItems,
    failures: [],
    data,
    action: "link-card-unsave",
  };
}

async function deleteImagineRemoteCard(post) {
  const items = (post?.items || []).filter(Boolean);
  if (
    items.some((item) => imagineDeletePayloadForItem(post, item))
    && typeof invalidateImagineSavedRequestsForDelete === "function"
  ) {
    invalidateImagineSavedRequestsForDelete();
  }
  if (isImagineUnsavedPost(post)) {
    const results = await Promise.allSettled(items.map((item) => {
      const payload = imagineDeletePayloadForItem(post, item);
      if (!payload) throw new Error("This Unsaved item has no asset id.");
      return qApi("/api/imagine/asset-metadata/delete", payload);
    }));
    const deletedItems = [];
    const failures = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "fulfilled") deletedItems.push(items[index]);
      else failures.push(result.reason);
    }
    if (deletedItems.length && typeof releaseImagineGeneratedSavedSyncForDeletedItems === "function") {
      releaseImagineGeneratedSavedSyncForDeletedItems(deletedItems);
    }
    return { deletedItems, failures };
  }
  if (isImagineLinkSourcePost(post, items[0])) {
    if (imagineLinkCardHasOwnedClone(post, items)) {
      return deleteImagineCardConversation(post, items);
    }
    return deleteImagineLinkCardBundle(post, items);
  }
  try {
    return await deleteImagineCardConversation(post, items);
  } catch (error) {
    // Some legacy standalone assets have no conversation to delete as a card.
    if (!isImagineConversationDeleteFallbackError(error)) throw error;
  }
  const result = await deleteImagineCardAssets(post, items);
  return {
    ...result,
    data: {
      ok: result.failures.length === 0,
      action: "asset-delete-fallback",
    },
  };
}

function imagineCardHasDeleteTarget(post) {
  return (post?.items || []).some((item) => imagineDeletePayloadForItem(post, item));
}

async function deleteImagineSelectedDetailItem() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) {
    showErrorPanel("Delete unavailable", "Select an Imagine thumbnail to delete.");
    return;
  }
  if (!imagineDeletePayloadForItem(post, item)) {
    showErrorPanel("Delete unavailable", "This Imagine item has no asset id.");
    return;
  }
  const ok = await confirmAction({
    title: "Delete Item",
    message: "Delete this Imagine Item?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  if (typeof invalidateImagineSavedRequestsForDelete === "function") {
    invalidateImagineSavedRequestsForDelete();
  }
  const localDeleteItems = [item];
  const deleteButton = document.querySelector(".i_detail_delete");
  const deleteButtonWasDisabled = Boolean(deleteButton?.disabled);
  if (deleteButton) deleteButton.disabled = true;
  deleteButton?.setAttribute("aria-busy", "true");
  const removalSnapshot = captureImaginePostRemovalSnapshot(post);
  removeImagineItemsFromPost(post, localDeleteItems);
  const optimisticState = {
    screenId: screen_state.current_screen,
    selectedPostPath: library_state.selectedPostPath,
    selectedPostIdentity: library_state.selectedPostIdentity,
    selectedDetailItemId: library_state.selectedDetailItemId,
  };
  try {
    const result = await deleteImagineRemoteItem(post, item);
    toast("Deleted Imagine item.");
  } catch (error) {
    restoreImaginePostRemovalSnapshot(removalSnapshot, optimisticState);
    throw error;
  } finally {
    if (deleteButton) deleteButton.disabled = deleteButtonWasDisabled;
    deleteButton?.removeAttribute("aria-busy");
  }
}

// skipConfirm is for the corner X on a failed or moderated card: there is no media to
// lose, and the job card it replaces dismissed on a single click too.
async function deleteImagineCardPost(post, button = null, { skipConfirm = false } = {}) {
  const items = (post?.items || []).filter(Boolean);
  if (!post || !items.length || !imagineCardHasDeleteTarget(post)) {
    showErrorPanel("Delete unavailable", "This Imagine card has no deletion target.");
    return;
  }
  const screenId = screen_state.current_screen;
  const scrollTop = imagineListScrollTopForScreen(screenId);
  const ok = skipConfirm || await confirmAction({
    title: "Delete Post",
    message: items.length > 1 ? `Delete this Imagine post and ${items.length} media item(s)?` : "Delete this Imagine post?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  // Hiding the card element covered the press from a list, where the button sits inside
  // one. From the detail there is no card to reach, so nothing moved until grok.com had
  // answered every media delete — seconds of a button that looked dead. Take the post out
  // of the lists first, the way deleting a single item already does, and put it back from
  // the snapshot if the delete does not go through.
  const pendingCard = button?.closest?.(".card") || null;
  if (pendingCard) {
    pendingCard.hidden = true;
    pendingCard.setAttribute("aria-busy", "true");
  }
  button?.setAttribute("aria-busy", "true");
  const removalSnapshot = captureImaginePostRemovalSnapshot(post);
  const optimisticState = {
    screenId: screen_state.current_screen,
    selectedPostPath: library_state.selectedPostPath,
    selectedDetailItemId: library_state.selectedDetailItemId,
  };
  removeImagineItemsFromPost(post, items, { keepListScreen: true, screenId, scrollTop });
  const restore = () => {
    restoreImaginePostRemovalSnapshot(removalSnapshot, optimisticState);
    if (pendingCard) pendingCard.hidden = false;
  };
  try {
    const result = await deleteImagineRemoteCard(post);
    if (result.deletedItems.length) toast("Deleted Imagine post.");
    if (result.failures.length) {
      restore();
      showErrorPanel(
        "Delete failed",
        `${result.failures.length} media item(s) could not be deleted. ${result.failures[0]?.message || ""}`.trim(),
      );
    }
  } catch (error) {
    restore();
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  } finally {
    pendingCard?.removeAttribute("aria-busy");
    button?.removeAttribute("aria-busy");
  }
}

async function likeImagineCardPost(post) {
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  const unsavedPost = Boolean(post && typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post));
  if (!post || !representative || (!postId && !unsavedPost)) {
    showErrorPanel("Save unavailable", "This Imagine card has no post id.");
    return;
  }
  const returnScreenId = screen_state.current_screen === "i_unsaved_main" ? "i_unsaved_main" : "";
  const returnScrollTop = returnScreenId ? imagineListScrollTopForScreen(returnScreenId) : null;
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const linkSource = isImagineLinkSourcePost(post, representative);
  const payload = { account_id: iDetailAccountId(representative, post) };
  const selectedItems = t2iPost ? [representative] : (post.items || []);
  const localItems = linkSource ? imagineLinkBundleItems(post, selectedItems) : selectedItems;
  const registrationItems = linkSource ? localItems : selectedItems;
  payload.items = registrationItems
    .map(imagineLikeTargetForItem)
    .filter((target) => target.id);
  payload.local_group_id = imagineSavedGroupIdForPost(post);
  payload.local_post = imagineLocalHeartSnapshot(post, localItems);
  if (post.__imagineSavePending) return;
  post.__imagineSavePending = true;
  let data;
  try {
    data = await qApi("/api/imagine/post/like", payload);
  } finally {
    post.__imagineSavePending = false;
  }
  applyImagineOfficialCloneRecords(post, data, localItems);
  if (t2iPost) applyImagineLikeResultPostId(post, representative, data);
  else if (unsavedPost) applyImagineUnsavedLikeResult(post, data);
  if (typeof forgetHiddenImaginePost === "function") forgetHiddenImaginePost(post);
  markImaginePostLiked(post, true);
  addImaginePostToSavedView(post);
  library_state.imagineLikedLoaded = false;
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  if (unsavedPost) {
    const postIdentity = imagineCardStableIdentity(post);
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .filter((candidate) => imagineCardStableIdentity(candidate) !== postIdentity);
  }
  if (!linkSource) library_state.imagineRemoteLoaded = false;
  if (movedFromT2i) {
    renderImagineSourceCards();
    renderDetailViews();
  } else {
    refreshImagineRemoteViews();
  }
  if (returnScreenId) restoreImagineListScrollForScreen(returnScreenId, returnScrollTop);
  toast("Saved Imagine post.");
}

function removeImagineSavedItemsOnly(post, removedItems, scrollTop = null) {
  const removedKeys = new Set((removedItems || []).flatMap((item) => imaginePostIdKeysForItem(item)));
  const postIdentity = imagineCardStableIdentity(post);
  const updatePost = (candidate) => {
    if (!candidate || imagineCardStableIdentity(candidate) !== postIdentity) return candidate;
    const items = (candidate.items || []).filter((item) => (
      !imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
    ));
    if (!items.length) return null;
    const representative = representativeItem(items, { ...candidate, items }) || items[0];
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  library_state.imagineRemotePosts = (library_state.imagineRemotePosts || [])
    .map(updatePost)
    .filter(Boolean);
  library_state.imagineLikedPosts = (library_state.imagineLikedPosts || [])
    .map(updatePost)
    .filter(Boolean);
  syncImagineRemotePostsIntoLibrary();
  const current = selectedLibraryPost();
  if (library_state.selectedPostIdentity === postIdentity && !current) {
    library_state.selectedPostPath = "";
    library_state.selectedPostIdentity = "";
    library_state.selectedDetailItemId = "";
    openScreen("i_main", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
  } else if (current) {
    const nextItem = current.items?.[0] || current.representative_item;
    if (nextItem) library_state.selectedDetailItemId = mediaItemKey(nextItem);
  }
  renderImagineSourceCards();
  renderDetailViews();
  if (scrollTop !== null) restoreImagineListScrollForScreen("i_main", scrollTop);
}

async function unsaveImaginePost(post, { item = null } = {}) {
  const selectedTargets = (item ? [item] : (post?.items || [])).filter(Boolean);
  if (!post || !selectedTargets.length) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no media item.");
    return;
  }
  const linkSource = isImagineLinkSourcePost(post, selectedTargets[0]);
  const localTargets = linkSource ? imagineLinkBundleItems(post, selectedTargets) : selectedTargets;
  const registrationTargets = linkSource
    ? imagineLinkRegistrationItems(post, selectedTargets[0], true)
    : selectedTargets;
  const targetEntries = registrationTargets
    .map((targetItem) => ({ item: targetItem, payload: imagineLikeTargetForItem(targetItem) }))
    .filter((entry) => entry.payload.id);
  if (!targetEntries.length || targetEntries.length !== registrationTargets.length) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no asset id.");
    return;
  }
  // grok.com takes the asset out of Liked the moment the heart is pressed, with no prompt.
  // The dialog also left the button stuck on "Unsaving" while it waited for an answer.
  const accountId = post.account_id || iDetailAccountId(registrationTargets[0], post);
  const linkPostId = linkSource ? imagineLinkPostIdForPost(post, registrationTargets[0]) : "";
  await qApi("/api/imagine/post/unsave", {
    account_id: accountId,
    scope: linkSource ? "card" : (item ? "item" : "card"),
    link_source: linkSource,
    local_group_id: imagineSavedGroupIdForPost(post),
    link_post_id: linkPostId,
    items: targetEntries.map((entry) => ({
      ...entry.payload,
      detail_post_id: imagineActionPostIdForPost(post),
      conversation_id: imagineDeleteConversationIdForPost(post, entry.item),
    })),
  });
  for (const target of localTargets) {
    target.liked = false;
    target.favorite = false;
  }
  const scrollTop = screen_state.current_screen === "i_main"
    ? imagineListScrollTopForScreen("i_main")
    : null;
  removeImagineSavedItemsOnly(post, localTargets, scrollTop);
  library_state.imagineUnsavedLoaded = false;
  toast("Unsaved Imagine post.");
}

async function unsaveImagineDiscoverPost(post, item = null) {
  return unsaveImaginePost(post, { item });
}

async function unsaveImagineCardPost(post) {
  return unsaveImaginePost(post);
}

async function unsaveImagineSelectedDetailPost() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post) || post?.representative_item || post?.items?.[0];
  return unsaveImaginePost(post, { item });
}

const IMAGINE_DETAIL_HEART_PREPARE_DELAYS = [0, 350, 900, 1800];
let imagineDetailHeartPreparationPhase = "";

function renderImagineDetailHeartPreparationOverlay(media = document.querySelector(".i_detail_media")) {
  if (!media) return;
  media.querySelector(".i_detail_heart_preparation")?.remove();
  if (!imagineDetailHeartPreparationPhase) return;
  const overlay = document.createElement("div");
  overlay.className = "detail_generation_status i_detail_heart_preparation";
  overlay.setAttribute("aria-live", "polite");
  overlay.textContent = imagineDetailHeartPreparationPhase;
  media.append(overlay);
}

function setImagineDetailHeartPreparation(phase = "") {
  imagineDetailHeartPreparationPhase = String(phase || "");
  renderImagineDetailHeartPreparationOverlay();
}

function imagineDetailHeartLinkPostId(post, item = null, fallback = "") {
  return String(
    imagineLinkPostIdForPost(post, item)
    || fallback
    || String(library_state?.selectedPostPath || "").split("/").filter(Boolean).pop()
    || "",
  ).trim();
}

function imagineDetailHeartThumbsReady(items) {
  const expected = new Set((items || []).map((item) => String(mediaItemKey(item) || "")).filter(Boolean));
  if (!expected.size) return false;
  const rendered = new Set(Array.from(document.querySelectorAll(".i_detail_thumb[data-library-item-id]"))
    .map((thumb) => String(thumb.dataset.libraryItemId || ""))
    .filter(Boolean));
  return Array.from(expected).every((key) => rendered.has(key));
}

function imagineDetailHeartReadyContext(post, item = null) {
  const selectedItem = item || selectedDetailItem(post) || post?.representative_item || post?.items?.[0] || null;
  const postId = imagineActionPostIdForPost(post);
  const unsavedPost = Boolean(
    post
    && typeof isImagineUnsavedPost === "function"
    && isImagineUnsavedPost(post, selectedItem),
  );
  if (!post || !selectedItem || (!postId && !unsavedPost)) return null;
  const linkSource = isImagineLinkSourcePost(post, selectedItem);
  const localItems = linkSource ? imagineLinkBundleItems(post, [selectedItem]) : [selectedItem];
  const registrationItem = linkSource ? imagineLinkRegistrationItem(post, selectedItem) : selectedItem;
  const registrationItems = linkSource ? localItems : [registrationItem];
  const targets = registrationItems.map(imagineLikeTargetForItem).filter((target) => target.id);
  const targetIds = new Set(targets.map((target) => target.id));
  if (!localItems.length || targets.length !== registrationItems.length || targetIds.size !== targets.length) return null;
  return {
    post,
    item: selectedItem,
    linkSource,
    postId,
    localItems,
    registrationItem,
    registrationItems,
    thumbsReady: !linkSource || imagineDetailHeartThumbsReady(localItems),
  };
}

async function prepareImagineDetailHeartCopy(post, item, heart) {
  const immediate = imagineDetailHeartReadyContext(post, item);
  if (immediate && immediate.thumbsReady) return { context: immediate, prepared: false };
  const postId = imagineDetailHeartLinkPostId(post, item, heart?.dataset?.imagineHeartPostId);
  if (!postId) throw new Error("Imagine card is not ready.");
  const accountId = String(
    post?.account_id
    || heart?.dataset?.imagineHeartAccountId
    || iDetailAccountId(item, post)
    || "",
  ).trim();
  setImagineDetailHeartPreparation("Preparing");
  for (const delay of IMAGINE_DETAIL_HEART_PREPARE_DELAYS) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      const data = await qApi("/api/imagine/remote/link", {
        post_id: postId,
        account_id: accountId,
      });
      const refreshedPost = data?.post || (Array.isArray(data?.posts) ? data.posts[0] : null);
      const preferredId = String(
        heart?.dataset?.imagineHeartItemId
        || imagineLikeTargetForItem(item || {}).id
        || "",
      ).trim();
      const refreshedItem = (refreshedPost?.items || []).find((candidate) => (
        imagineLikeTargetForItem(candidate).id === preferredId
      )) || imagineLinkRegistrationItem(refreshedPost) || refreshedPost?.representative_item || refreshedPost?.items?.[0] || null;
      const context = imagineDetailHeartReadyContext(refreshedPost, refreshedItem);
      if (context) return { context, prepared: true };
    } catch (error) {
      if (delay === IMAGINE_DETAIL_HEART_PREPARE_DELAYS.at(-1)) throw error;
    }
  }
  throw new Error("Imagine card is not ready.");
}

async function likeImagineSelectedDetailPost(preparedContext = null) {
  const post = preparedContext?.post || selectedLibraryPost();
  const item = preparedContext?.item || selectedDetailItem(post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  const unsavedPost = Boolean(post && typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post, item));
  if (!post || !item || (!postId && !unsavedPost)) {
    throw new Error("Imagine post is not ready.");
  }
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const linkSource = isImagineLinkSourcePost(post, item);
  const localItems = preparedContext?.localItems || (linkSource ? imagineLinkBundleItems(post, [item]) : [item]);
  const registrationItem = preparedContext?.registrationItem || (linkSource ? imagineLinkRegistrationItem(post, item) : item);
  const payload = { account_id: post.account_id || iDetailAccountId(registrationItem, post) };
  const registrationItems = preparedContext?.registrationItems || (linkSource ? localItems : [registrationItem]);
  payload.items = registrationItems
    .map(imagineLikeTargetForItem)
    .filter((target) => target.id);
  if (!payload.items.length || payload.items.length !== registrationItems.length) {
    throw new Error("Imagine card is not ready.");
  }
  payload.local_group_id = imagineSavedGroupIdForPost(post);
  payload.local_post = imagineLocalHeartSnapshot(post, localItems);
  if (post.__imagineSavePending) return;
  post.__imagineSavePending = true;
  let data;
  try {
    data = await qApi("/api/imagine/post/like", payload);
  } finally {
    post.__imagineSavePending = false;
  }
  applyImagineOfficialCloneRecords(post, data, localItems);
  const savedItemPost = savedImagineSingleItemPost(post, registrationItem, data, localItems);
  const clonedExternal = Array.isArray(data?.cloned_external) && data.cloned_external.length > 0;
  if (t2iPost) applyImagineLikeResultPostId(savedItemPost, registrationItem, data);
  if (linkSource) markImaginePostLiked(post, true);
  else markImagineItemLiked(registrationItem, true);
  if (typeof forgetHiddenImaginePost === "function") forgetHiddenImaginePost(post);
  // The local snapshot still holds the external source ids. A clone-batch result is instead
  // hydrated as its own owned card by the server and inserted directly into app Liked below;
  // do not briefly seed the source card into Imagine main.
  if (!clonedExternal) addImaginePostToSavedView(savedItemPost);
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  const movedFromUnsaved = unsavedPost;
  if (movedFromUnsaved) {
    const selectedKeys = new Set(imaginePostIdKeysForItem(item));
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .map((candidate) => {
        if (candidate?.folder_path !== post.folder_path) return candidate;
        const items = (candidate.items || []).filter((candidateItem) => (
          !imaginePostIdKeysForItem(candidateItem).some((key) => selectedKeys.has(key))
        ));
        if (!items.length) return null;
        const representative = representativeItem(items, { ...candidate, items }) || items[0];
        return normalizeServerPost({
          ...candidate,
          items,
          representative: representative?.file || representative?.url || representative?.item_id || "",
          representative_item: representative,
        });
      })
      .filter(Boolean);
    library_state.imagineUnsavedLoaded = true;
  }
  if (!linkSource) library_state.imagineRemoteLoaded = false;
  if (movedFromT2i) {
    returnToImagineT2iMain();
    renderImagineSourceCards();
    renderDetailViews();
  } else {
    if (movedFromUnsaved) returnToImagineUnsavedMain();
    refreshImagineRemoteViews();
  }
  if (!preparedContext) toast("Saved Imagine post.");
  // The clone records the copy's own ids, which is the only way the caller can find the
  // card the copy landed on once Liked has been read back.
  return data;
}

// A clone-batch copy lands in this account's Saved feed, while this app derives its Liked
// card locally from the clone record. Read that app Liked view back and hand the detail over
// to the copy, rather than leave it on the external link. The reload also refreshes the local
// Liked cache so the copy survives a reload or account switch. Generating from the link
// re-uploads its source under a fresh id and files the result on a card of its own; the copy
// carries grok.com's own conversation, so generating from it stays on this card.
function isImagineCloneSourceCard(post, sourceIds) {
  if (!sourceIds?.size || !isImagineLinkSourcePost(post)) return false;
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const cloned = metadata.cloned_copy
    || imagine.cloned_copy
    || (post?.items || []).some((item) => {
      const itemMeta = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const itemImagine = itemMeta.imagine && typeof itemMeta.imagine === "object" ? itemMeta.imagine : {};
      return itemMeta.cloned_copy || itemImagine.cloned_copy;
    });
  if (cloned) return false;
  return (post?.items || []).some((item) => sourceIds.has(imagineLikeTargetForItem(item).id));
}

async function imagineOpenClonedDetailAfterSave(result, pressedItem) {
  const records = (result?.cloned_external || []).filter((record) => record?.asset_id);
  if (!records.length || typeof loadImagineLikedCards !== "function") return;
  const clonedIds = new Set(
    records.map((record) => String(record.asset_id || "").trim()).filter(Boolean),
  );
  const sourceIds = new Set(
    records.map((record) => String(record.source_asset_id || "").trim()).filter(Boolean),
  );
  const hydratedPosts = (Array.isArray(result?.cloned_liked_posts) ? result.cloned_liked_posts : [])
    .filter((post) => post && typeof post === "object")
    .map(normalizeServerPost);
  let card = null;
  if (hydratedPosts.length) {
    // Do not leave the external source card in app Liked beside its owned replacement.
    // Imagine main retains the source; this only changes the Liked in-memory expression.
    const retainedLikedPosts = (library_state.imagineLikedPosts || []).filter((candidate) => (
      !isImagineCloneSourceCard(candidate, sourceIds)
    ));
    const merged = typeof mergeImagineSyncedPosts === "function"
      ? mergeImagineSyncedPosts(
        retainedLikedPosts,
        hydratedPosts,
        { replacesList: false, preserveMatchedAnchors: true },
      )
      : [...hydratedPosts, ...retainedLikedPosts];
    library_state.imagineLikedPosts = typeof reconcileImagineLikedLineagePosts === "function"
      ? reconcileImagineLikedLineagePosts(merged)
      : merged;
    library_state.imagineLikedLoaded = true;
    if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
    card = (library_state.imagineLikedPosts || []).find((candidate) => (
      (candidate?.items || []).some((item) => clonedIds.has(imagineLikeTargetForItem(item).id))
    )) || null;
  }
  if (!card) {
    try {
      await loadImagineLikedCards({ force: true });
    } catch (error) {
      console.warn(error);
      return;
    }
  }
  // One clone-batch can fold into one app Liked card, so find the copied item instead of
  // guessing which clone id anchors that card.
  if (!card) {
    card = (library_state.imagineLikedPosts || []).find((candidate) => (
      (candidate?.items || []).some((item) => clonedIds.has(imagineLikeTargetForItem(item).id))
    )) || null;
  }
  if (!card) return;
  const pressedId = pressedItem ? imagineLikeTargetForItem(pressedItem).id : "";
  const pressedCloneId = String(
    records.find((record) => String(record.source_asset_id || "").trim() === pressedId)?.asset_id || "",
  ).trim();
  library_state.iMainView = imagineViewValue("LIKED", "liked");
  selectLibraryPost(card, {
    identity: typeof libraryPostStableIdentity === "function" ? libraryPostStableIdentity(card) : "",
  });
  // Land on the copy of the thumbnail that was already open, not on whichever item the card
  // happens to lead with.
  const targetItem = pressedCloneId
    ? (card.items || []).find((item) => imagineLikeTargetForItem(item).id === pressedCloneId)
    : null;
  if (targetItem) library_state.selectedDetailItemId = mediaItemKey(targetItem);
  renderImagineSourceCards();
  renderDetailViews();
}

function imagineUpscaleMediaUrlFromResult(data) {
  return String(
    data?.hd1080_media_url
    || data?.hd_media_url
    || data?.media_url
    || data?.post?.hd1080MediaUrl
    || data?.post?.hdMediaUrl
    || data?.result?.hd1080MediaUrl
    || data?.result?.hdMediaUrl
    || ""
  ).trim();
}

function imagineDetailAccountTier(item, post) {
  const store = account_state?.imagine;
  const accountId = iDetailAccountId(item, post);
  const activeId = String(store?.active_id || "");
  const account = (accountId
    ? store?.accounts?.find((candidate) => String(candidate?.id || "") === accountId)
    : null)
    || (activeId
      ? store?.accounts?.find((candidate) => String(candidate?.id || "") === activeId)
      : null);
  return normalizeAccountTier(account?.tier);
}

function imagineUpscaleTargetResolution(item, post) {
  const current = normalizeMediaResolutionLabel(mediaResolutionLabelForItem(item, post));
  if (current === "480") return "720p";
  if (current === "720" && imagineDetailAccountTier(item, post) === "heavy") return "1080p";
  return "";
}

function applyImagineUpscaleResultToItem(item, data) {
  if (!item || !data) return false;
  const mediaUrl = imagineUpscaleMediaUrlFromResult(data);
  if (!mediaUrl) return false;
  const resolution = String(data.resolution || "").toLowerCase() === "1080p" ? "1080" : "720";
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  if (resolution === "1080") {
    item.hd1080_media_url = mediaUrl;
    item.hd1080MediaUrl = mediaUrl;
    metadata.hd1080_media_url = mediaUrl;
    metadata.hd1080MediaUrl = mediaUrl;
    imagine.hd1080_media_url = mediaUrl;
    imagine.hd1080MediaUrl = mediaUrl;
  } else {
    item.hd_media_url = mediaUrl;
    item.hdMediaUrl = mediaUrl;
    metadata.hd_media_url = mediaUrl;
    metadata.hdMediaUrl = mediaUrl;
    imagine.hd_media_url = mediaUrl;
    imagine.hdMediaUrl = mediaUrl;
  }
  item.resolution_name = `${resolution}p`;
  item.resolution = `${resolution}p`;
  metadata.resolution_name = `${resolution}p`;
  metadata.resolution = `${resolution}p`;
  imagine.resolution_name = `${resolution}p`;
  imagine.resolution = `${resolution}p`;
  metadata.imagine = imagine;
  item.metadata = metadata;
  return true;
}

function updateImagineUpscaleItemInPost(post, itemKey, postId, data) {
  if (!post?.items?.length) return false;
  let changed = false;
  for (const candidate of post.items) {
    const candidateId = imagineActionPostIdForItem(candidate);
    if (mediaItemKey(candidate) === itemKey || (postId && candidateId === postId)) {
      changed = applyImagineUpscaleResultToItem(candidate, data) || changed;
    }
  }
  const representative = representativeItem(post.items, post) || post.items[0];
  post.representative_item = representative;
  post.representative = representative?.file || representative?.url || representative?.item_id || post.representative || "";
  return changed;
}

function applyImagineUpscaleResult(post, item, data) {
  const itemKey = mediaItemKey(item);
  const postId = imagineActionPostIdForItem(item);
  const postIdentity = imagineCardStableIdentity(post);
  let changed = updateImagineUpscaleItemInPost(post, itemKey, postId, data);
  for (const listName of ["imagineRemotePosts", "imagineDiscoverPosts", "imagineUnsavedPosts"]) {
    const list = Array.isArray(library_state[listName]) ? library_state[listName] : [];
    for (const candidatePost of list) {
      if (imagineCardStableIdentity(candidatePost) === postIdentity) {
        changed = updateImagineUpscaleItemInPost(candidatePost, itemKey, postId, data) || changed;
      }
    }
  }
  if (changed) syncImagineRemotePostsIntoLibrary();
  return changed;
}

async function upscaleImagineSelectedDetailVideo(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "video") {
    showErrorPanel("Upscale unavailable", "Select an Imagine video thumbnail.");
    return;
  }
  const postId = imagineActionPostIdForItem(item);
  if (!postId) {
    showErrorPanel("Upscale unavailable", "This Imagine video has no post id.");
    return;
  }
  const targetResolution = imagineUpscaleTargetResolution(item, post);
  if (!targetResolution) {
    showErrorPanel("Upscale unavailable", "This video cannot be upscaled for the selected Imagine account.");
    return;
  }
  const payload = {
    provider: "imagine",
    mode: "upscale",
    prompt: "",
    preview_url: detailPreviewUrlForItem("i", item, post) || detailVideoPreviewUrlForItem("i", item, post) || "",
    preview_type: "video",
    source_post_path: post.folder_path || "",
    source_item_id: mediaItemKey(item),
    options: {
      resolution: targetResolution,
    },
    account_id: iDetailAccountId(item, post),
    id: postId,
    post_id: postId,
    item_id: item.item_id || mediaItemKey(item),
    type: "video",
    resolution: targetResolution,
    metadata: item.metadata || {},
  };
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/start", payload);
    if (!data?.job) throw new Error("Upscale job was not created.");
    upsertImagineJob(data.job);
    selectImagineJob(data.job.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
    scheduleImagineJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

function imagineDetailAspectValue(value) {
  const text = String(value || "").trim();
  const normalized = typeof detailAspectFromValue === "function" ? detailAspectFromValue(text) : "";
  const match = String(normalized || text).match(/(\d+(?:\.\d+)?)\s*(?:\/|:|x|\u00d7)\s*(\d+(?:\.\d+)?)/i);
  return match ? `${match[1]}:${match[2]}` : "";
}

function rawImagineDetailMediaUrl(item) {
  if (typeof composerRawMediaUrlForItem === "function") return composerRawMediaUrlForItem(item);
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const candidates = [
    item?.remote_url,
    item?.url,
    item?.media_url,
    item?.mediaUrl,
    item?.object_url,
    item?.source_url,
    metadata.remote_url,
    metadata.media_url,
    imagine.media_url,
    imagine.asset_url,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    try {
      const parsed = new URL(text, window.location.origin);
      if (parsed.pathname === "/api/imagine/remote/media") return parsed.searchParams.get("url") || text;
      return text;
    } catch {
      return text;
    }
  }
  return "";
}

function imagineDetailAspectAttachment(post, item) {
  const metadata = typeof composerAttachmentMetadataForItem === "function"
    ? composerAttachmentMetadataForItem(post, item)
    : {};
  const rawUrl = rawImagineDetailMediaUrl(item);
  const mimeType = String(item?.mime_type || item?.mime || "").toLowerCase();
  return {
    name: item?.file || item?.title || `${item?.item_id || "imagine-aspect-source"}.jpg`,
    type: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    role: "source",
    raw_url: rawUrl,
    remote_url: rawUrl,
    url: rawUrl,
    aspect_ratio: typeof detailAspectFromItem === "function" ? detailAspectFromItem(item).replace(/\s*\/\s*/g, ":") : "",
    detail_auto: true,
    detail_key: typeof mediaItemKey === "function" ? mediaItemKey(item) : "",
    ...metadata,
  };
}

// The site keeps its video modes in a server list and marks the mature one
// model_generated_only, then hides it for a user-uploaded source.  We send the request
// ourselves, so let the server answer instead of hiding the button in advance.
const IMAGINE_SPICY_VIDEO_MODE = "extremely-spicy-or-crazy";

async function startImagineDetailSpicyVideo(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Spicy unavailable", "Select an Imagine image thumbnail.");
    return;
  }
  const sourcePostId = imagineActionPostIdForItem(item);
  const rawUrl = rawImagineDetailMediaUrl(item);
  if (!sourcePostId || !rawUrl) {
    showErrorPanel("Spicy unavailable", "This Imagine image has no source post.");
    return;
  }
  // The composer bar owns duration and resolution for every other video request, so read
  // the same controls here instead of letting the server fall back to its own defaults.
  const composerOptions = typeof composerRequestOptions === "function" ? composerRequestOptions() : {};
  const itemAspect = typeof detailAspectFromItem === "function"
    ? detailAspectFromItem(item).replace(/\s*\/\s*/g, ":")
    : "";
  const aspectRatio = String(composerOptions.aspect_ratio || "").trim() || itemAspect;
  const payload = {
    provider: "imagine",
    mode: "video",
    prompt: "",
    preview_url: detailPreviewUrlForItem("i", item, post) || detailMediaUrlForItem("i", item, post) || "",
    preview_type: "image",
    source_post_path: post.folder_path || "",
    source_item_id: mediaItemKey(item),
    options: {
      ...composerOptions,
      video_mode: IMAGINE_SPICY_VIDEO_MODE,
      aspect_ratio: aspectRatio,
    },
    attachments: [imagineDetailAspectAttachment(post, item)],
    account_id: iDetailAccountId(item, post),
    id: sourcePostId,
    post_id: sourcePostId,
    item_id: item.item_id || mediaItemKey(item),
    type: "video",
    metadata: item.metadata || {},
  };
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/start", payload);
    if (!data?.job) throw new Error("Spicy job was not created.");
    upsertImagineJob(data.job);
    selectImagineJob(data.job.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
    scheduleImagineJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

async function startImagineDetailAspectRatio(label, button = null) {
  const aspectRatio = imagineDetailAspectValue(label);
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!aspectRatio) {
    showErrorPanel("Aspect Ratio unavailable", "Choose an aspect ratio.");
    return;
  }
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Aspect Ratio unavailable", "Select an Imagine image thumbnail.");
    return;
  }
  const sourcePostId = imagineActionPostIdForItem(item);
  const rawUrl = rawImagineDetailMediaUrl(item);
  if (!sourcePostId || !rawUrl) {
    showErrorPanel("Aspect Ratio unavailable", "This Imagine image has no source post.");
    return;
  }
  const payload = {
    provider: "imagine",
    mode: "aspect",
    prompt: detailPromptFor(post, item) || post.prompt || "",
    preview_url: detailPreviewUrlForItem("i", item, post) || detailMediaUrlForItem("i", item, post) || "",
    preview_type: "image",
    source_post_path: post.folder_path || "",
    source_item_id: mediaItemKey(item),
    options: {
      aspect_ratio: aspectRatio,
      target_aspect_ratio: aspectRatio,
    },
    attachments: [imagineDetailAspectAttachment(post, item)],
    account_id: iDetailAccountId(item, post),
    id: sourcePostId,
    post_id: sourcePostId,
    item_id: item.item_id || mediaItemKey(item),
    type: "image",
    aspect_ratio: aspectRatio,
    target_aspect_ratio: aspectRatio,
    metadata: item.metadata || {},
  };
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/start", payload);
    if (!data?.job) throw new Error("Aspect Ratio job was not created.");
    upsertImagineJob(data.job);
    selectImagineJob(data.job.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
    scheduleImagineJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

let imagineCropOverlayState = null;

function ensureImagineCropOverlay() {
  let overlay = document.querySelector(".i_crop_overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "i_crop_overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="i_crop_panel" role="dialog" aria-modal="true" aria-label="Crop image">
      <div class="i_crop_image_frame">
        <img class="i_crop_image" alt="Crop image" draggable="false" />
        <div class="i_crop_box" data-crop-drag="move">
          <span class="i_crop_grid i_crop_grid_v i_crop_grid_v1"></span>
          <span class="i_crop_grid i_crop_grid_v i_crop_grid_v2"></span>
          <span class="i_crop_grid i_crop_grid_h i_crop_grid_h1"></span>
          <span class="i_crop_grid i_crop_grid_h i_crop_grid_h2"></span>
          <span class="i_crop_side i_crop_side_n" data-crop-handle="n"></span>
          <span class="i_crop_side i_crop_side_e" data-crop-handle="e"></span>
          <span class="i_crop_side i_crop_side_s" data-crop-handle="s"></span>
          <span class="i_crop_side i_crop_side_w" data-crop-handle="w"></span>
          <span class="i_crop_handle i_crop_handle_nw" data-crop-handle="nw"></span>
          <span class="i_crop_handle i_crop_handle_ne" data-crop-handle="ne"></span>
          <span class="i_crop_handle i_crop_handle_sw" data-crop-handle="sw"></span>
          <span class="i_crop_handle i_crop_handle_se" data-crop-handle="se"></span>
        </div>
      </div>
      <div class="i_crop_controls">
        <button class="i_crop_cancel" type="button"><span aria-hidden="true">×</span><span>Cancel</span></button>
        <button class="i_crop_confirm" type="button"><span aria-hidden="true">✓</span><span>Crop</span></button>
      </div>
    </div>`;
  document.body.append(overlay);
  overlay.querySelector(".i_crop_cancel")?.addEventListener("click", closeImagineCropOverlay);
  overlay.querySelector(".i_crop_confirm")?.addEventListener("click", () => {
    submitImagineCropOverlay().catch((error) => {
      console.warn(error);
      showErrorPanel("Crop failed", error?.message || "Crop failed.");
    });
  });
  overlay.querySelector(".i_crop_box")?.addEventListener("pointerdown", beginImagineCropPointer);
  overlay.querySelectorAll("[data-crop-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", beginImagineCropPointer);
  });
  window.addEventListener("resize", () => {
    if (!imagineCropOverlayState || overlay.hidden) return;
    layoutImagineCropOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden || event.key !== "Escape") return;
    closeImagineCropOverlay();
  });
  return overlay;
}

function closeImagineCropOverlay() {
  const overlay = document.querySelector(".i_crop_overlay");
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("i_crop_open");
  if (imagineCropOverlayState?.objectUrl) URL.revokeObjectURL(imagineCropOverlayState.objectUrl);
  imagineCropOverlayState = null;
}

function imagineCropClampRect(rect, frame) {
  const minWidth = Math.max(48, frame.width * 0.08);
  const minHeight = Math.max(48, frame.height * 0.08);
  const width = Math.min(Math.max(rect.width, minWidth), frame.width);
  const height = Math.min(Math.max(rect.height, minHeight), frame.height);
  const x = Math.min(Math.max(rect.x, 0), frame.width - width);
  const y = Math.min(Math.max(rect.y, 0), frame.height - height);
  return { x, y, width, height };
}

function setImagineCropRect(rect) {
  if (!imagineCropOverlayState) return;
  const box = document.querySelector(".i_crop_box");
  const frame = document.querySelector(".i_crop_image_frame");
  if (!box || !frame) return;
  const next = imagineCropClampRect(rect, imagineCropOverlayState.frame);
  imagineCropOverlayState.rect = next;
  box.style.left = `${next.x}px`;
  box.style.top = `${next.y}px`;
  box.style.width = `${next.width}px`;
  box.style.height = `${next.height}px`;
}

function layoutImagineCropOverlay() {
  if (!imagineCropOverlayState) return;
  const frame = document.querySelector(".i_crop_image_frame");
  const image = document.querySelector(".i_crop_image");
  if (!frame || !image) return;
  const naturalWidth = imagineCropOverlayState.naturalWidth || image.naturalWidth || 1;
  const naturalHeight = imagineCropOverlayState.naturalHeight || image.naturalHeight || 1;
  const maxWidth = Math.max(120, Math.min(window.innerWidth * 0.72, 980));
  const maxHeight = Math.max(120, window.innerHeight - 190);
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  imagineCropOverlayState.frame = { width, height };
  const previous = imagineCropOverlayState.rect;
  if (previous) {
    setImagineCropRect({
      x: previous.x * (width / Math.max(1, imagineCropOverlayState.previousFrame?.width || width)),
      y: previous.y * (height / Math.max(1, imagineCropOverlayState.previousFrame?.height || height)),
      width: previous.width * (width / Math.max(1, imagineCropOverlayState.previousFrame?.width || width)),
      height: previous.height * (height / Math.max(1, imagineCropOverlayState.previousFrame?.height || height)),
    });
  } else {
    setImagineCropRect({
      x: 0,
      y: 0,
      width,
      height,
    });
  }
  imagineCropOverlayState.previousFrame = { width, height };
}

function beginImagineCropPointer(event) {
  if (!imagineCropOverlayState || !(event.currentTarget instanceof Element)) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget.dataset.cropHandle || "";
  const box = document.querySelector(".i_crop_box");
  if (!box) return;
  box.setPointerCapture?.(event.pointerId);
  imagineCropOverlayState.drag = {
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    rect: { ...imagineCropOverlayState.rect },
  };
  window.addEventListener("pointermove", moveImagineCropPointer);
  window.addEventListener("pointerup", endImagineCropPointer, { once: true });
}

function moveImagineCropPointer(event) {
  const drag = imagineCropOverlayState?.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  let { x, y, width, height } = drag.rect;
  if (!drag.handle) {
    setImagineCropRect({ x: x + dx, y: y + dy, width, height });
    return;
  }
  if (drag.handle.includes("e")) width += dx;
  if (drag.handle.includes("s")) height += dy;
  if (drag.handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (drag.handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  setImagineCropRect({ x, y, width, height });
}

function endImagineCropPointer() {
  if (imagineCropOverlayState) imagineCropOverlayState.drag = null;
  window.removeEventListener("pointermove", moveImagineCropPointer);
}

async function loadImagineCropImage(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Crop image could not be loaded.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = document.querySelector(".i_crop_image");
  if (!(image instanceof HTMLImageElement)) throw new Error("Crop image view is missing.");
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Crop image could not be loaded."));
    image.src = objectUrl;
  });
  return {
    objectUrl,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

async function openImagineDetailCropOverlay() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Crop unavailable", "Select an Imagine image thumbnail.");
    return;
  }
  const sourcePostId = imagineActionPostIdForItem(item);
  const mediaUrl = detailMediaUrlForItem("i", item, post);
  if (!sourcePostId || !mediaUrl) {
    showErrorPanel("Crop unavailable", "This Imagine image has no source media.");
    return;
  }
  const overlay = ensureImagineCropOverlay();
  overlay.hidden = false;
  document.body.classList.add("i_crop_open");
  let loaded;
  try {
    loaded = await loadImagineCropImage(mediaUrl);
  } catch (error) {
    closeImagineCropOverlay();
    throw error;
  }
  imagineCropOverlayState = {
    post,
    item,
    sourcePostId,
    objectUrl: loaded.objectUrl,
    naturalWidth: loaded.naturalWidth,
    naturalHeight: loaded.naturalHeight,
    frame: { width: 1, height: 1 },
    previousFrame: null,
    rect: null,
    drag: null,
  };
  requestAnimationFrame(layoutImagineCropOverlay);
}

function imagineCropDataUrl() {
  const state = imagineCropOverlayState;
  const image = document.querySelector(".i_crop_image");
  if (!state || !(image instanceof HTMLImageElement) || !state.rect) {
    throw new Error("Crop selection is missing.");
  }
  const scaleX = state.naturalWidth / state.frame.width;
  const scaleY = state.naturalHeight / state.frame.height;
  const sourceX = Math.max(0, Math.floor(state.rect.x * scaleX));
  const sourceY = Math.max(0, Math.floor(state.rect.y * scaleY));
  const sourceRight = Math.min(state.naturalWidth, Math.ceil((state.rect.x + state.rect.width) * scaleX));
  const sourceBottom = Math.min(state.naturalHeight, Math.ceil((state.rect.y + state.rect.height) * scaleY));
  const sourceWidth = Math.max(1, sourceRight - sourceX);
  const sourceHeight = Math.max(1, sourceBottom - sourceY);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sourceWidth);
  canvas.height = Math.max(1, sourceHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Crop canvas is unavailable.");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const gcd = (left, right) => {
    let a = Math.round(Math.abs(left));
    let b = Math.round(Math.abs(right));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  };
  const divisor = gcd(canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    aspectRatio: `${Math.round(canvas.width / divisor)}:${Math.round(canvas.height / divisor)}`,
  };
}

function applyImagineCropResult(post, data) {
  const item = data?.item || data?.items?.[0];
  if (!post || !item) return false;
  const targetPath = String(data.source_post_path || post.folder_path || "");
  const targetIdentity = typeof libraryPostStableIdentity === "function"
    ? libraryPostStableIdentity(post)
    : "";
  let matched = false;
  const updatePost = (candidate) => {
    if (!candidate || candidate.folder_path !== targetPath) return candidate;
    if (
      targetIdentity
      && typeof libraryPostMatchesIdentity === "function"
      && !libraryPostMatchesIdentity(candidate, targetIdentity)
    ) return candidate;
    matched = true;
    if (typeof mergeImagineGeneratedItems === "function") return mergeImagineGeneratedItems(candidate, [item]);
    const items = [...(candidate.items || [])];
    const itemKey = mediaItemKey(item);
    if (!items.some((existing) => mediaItemKey(existing) === itemKey)) items.push(item);
    const representative = representativeItem(items, { ...candidate, items }) || item;
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  for (const listName of [
    "imagineRemotePosts",
    "imagineDiscoverPosts",
    "imagineUnsavedPosts",
    "imagineSearchPosts",
    "imagineUploadPosts",
    "imagineLikedPosts",
  ]) {
    const list = Array.isArray(library_state[listName]) ? library_state[listName] : [];
    library_state[listName] = list.map(updatePost);
  }
  if (!matched) return false;
  syncImagineRemotePostsIntoLibrary();
  library_state.selectedPostPath = targetPath || library_state.selectedPostPath;
  const targetPost = (library_state.posts || []).find((candidate) => (
    candidate?.folder_path === targetPath
    && (!targetIdentity || libraryPostMatchesIdentity(candidate, targetIdentity))
  ));
  library_state.selectedPostIdentity = targetPost && typeof libraryPostStableIdentity === "function"
    ? libraryPostStableIdentity(targetPost)
    : targetIdentity;
  library_state.selectedDetailItemId = mediaItemKey(item);
  refreshImagineRemoteViews();
  return true;
}

async function submitImagineCropOverlay() {
  const state = imagineCropOverlayState;
  if (!state?.post || !state?.item) return;
  const confirmButton = document.querySelector(".i_crop_confirm");
  if (confirmButton) confirmButton.disabled = true;
  try {
    const crop = imagineCropDataUrl();
    const data = await qApi("/api/imagine/image/crop", {
      image_data: crop.dataUrl,
      account_id: iDetailAccountId(state.item, state.post),
      id: state.sourcePostId,
      post_id: state.sourcePostId,
      item_id: state.item.item_id || mediaItemKey(state.item),
      source_item_id: mediaItemKey(state.item),
      source_post_path: state.post.folder_path || "",
      prompt: detailPromptFor(state.post, state.item) || state.post.prompt || "",
      aspect_ratio: crop.aspectRatio,
      crop_width: crop.width,
      crop_height: crop.height,
      metadata: state.item.metadata || {},
    });
    if (!data?.saved_verified) {
      throw new Error("Grok did not confirm the cropped image in Saved.");
    }
    closeImagineCropOverlay();
    if (!applyImagineCropResult(state.post, data)) {
      throw new Error("Crop response did not include an image.");
    }
    toast("Cropped image.");
  } finally {
    if (confirmButton) confirmButton.disabled = false;
  }
}

function applyImagineUpscaleJobResult(result) {
  if (!result) return false;
  const sourcePostPath = String(result.source_post_path || "");
  const sourceItemId = String(result.source_item_id || result.selected_item_id || "");
  const selectedPost = selectedLibraryPost();
  const post = selectedPost?.folder_path === sourcePostPath
    ? selectedPost
    : (library_state.posts || []).find((candidate) => (
      candidate?.folder_path === sourcePostPath
      && (candidate.items || []).some((item) => mediaItemKey(item) === sourceItemId)
    ));
  const item = post?.items?.find((candidate) => mediaItemKey(candidate) === sourceItemId || imagineActionPostIdForItem(candidate) === String(result.id || ""))
    || selectedDetailItem(post);
  if (!post || !item) return false;
  return applyImagineUpscaleResult(post, item, result);
}

async function upscaleImagineSelectedDetailVideoDirect(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "video") {
    showErrorPanel("Upscale unavailable", "Select an Imagine video thumbnail.");
    return;
  }
  const postId = imagineActionPostIdForItem(item);
  if (!postId) {
    showErrorPanel("Upscale unavailable", "This Imagine video has no post id.");
    return;
  }
  const targetResolution = imagineUpscaleTargetResolution(item, post);
  if (!targetResolution) {
    showErrorPanel("Upscale unavailable", "This video cannot be upscaled for the selected Imagine account.");
    return;
  }
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/video/upscale", {
      id: postId,
      post_id: postId,
      item_id: item.item_id || "",
      type: "video",
      resolution: targetResolution,
      account_id: iDetailAccountId(item, post),
      metadata: item.metadata || {},
    });
    if (!applyImagineUpscaleResult(post, item, data)) {
      throw new Error("Upscale response did not include a video URL.");
    }
    library_state.selectedDetailItemId = mediaItemKey(item);
    refreshImagineRemoteViews();
    toast("Upscaled video.");
  } finally {
    if (button) button.disabled = false;
  }
}

function imagineDetailPostIdFromAddress(address) {
  const text = String(address || "").trim();
  if (!text) return "";
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  try {
    const url = new URL(text, window.location.origin);
    const match = url.pathname.match(new RegExp(`/imagine/post/(${uuid})(?:/|$)`, "i"))
      || url.pathname.match(new RegExp(`/generated/(${uuid})(?:/|-part-)`, "i"))
      || url.pathname.match(new RegExp(`/users/${uuid}/(${uuid})(?:/|$)`, "i"));
    return match?.[1] || "";
  } catch {
    const match = text.match(new RegExp(`/imagine/post/(${uuid})(?:[/?#]|$)`, "i"))
      || text.match(new RegExp(`/generated/(${uuid})(?:/|-part-)`, "i"))
      || text.match(new RegExp(`/users/${uuid}/(${uuid})(?:[/?#]|$)`, "i"));
    return match?.[1] || "";
  }
}

function imagineDetailConversationId(post, item, address = "") {
  const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
  const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const postImagine = postMetadata.imagine && typeof postMetadata.imagine === "object" ? postMetadata.imagine : {};
  let addressConversation = "";
  try {
    addressConversation = new URL(String(address || ""), window.location.origin).searchParams.get("conversation") || "";
  } catch {
    addressConversation = "";
  }
  return String(
    addressConversation
    || item?.conversation_id
    || itemMetadata.conversation_id
    || itemImagine.conversation_id
    || post?.conversation_id
    || postMetadata.conversation_id
    || postImagine.conversation_id
    || item?.root_post_id
    || itemMetadata.root_post_id
    || itemImagine.root_post_id
    || itemMetadata.root_asset_id
    || itemImagine.root_asset_id
    || post?.root_post_id
    || postMetadata.imagine_root_post_id
    || postMetadata.raw_root_post_id
    || post?.post_id
    || ""
  ).trim();
}

async function copyImagineSelectedDetailMediaAddress() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) {
    throw new Error("Select an Imagine media item.");
  }
  const address = typeof iDetailRawMediaUrl === "function"
    ? String(iDetailRawMediaUrl(item) || "").trim()
    : "";
  if (!address) {
    throw new Error("This media has no address.");
  }
  const postId = imagineDetailPostIdFromAddress(address)
    || String(item?.asset_id || imagineActionPostIdForItem(item) || "").trim();
  const conversationId = imagineDetailConversationId(post, item, address);
  if (!postId || !conversationId) {
    throw new Error("This media has no Imagine post address.");
  }
  const postAddress = `https://grok.com/imagine/post/${encodeURIComponent(postId)}?conversation=${encodeURIComponent(conversationId)}`;
  const copied = typeof copyText === "function" && await copyText(postAddress);
  if (!copied) {
    throw new Error("Copy failed.");
  }
  toast("Imagine post address copied.");
}

function bindImagineDetailActions() {
  const heart = document.querySelector(".i_detail_heart");
  heart?.addEventListener("click", () => {
    if (heart.getAttribute("aria-busy") === "true") return;
    const post = selectedLibraryPost();
    const item = selectedDetailItem(post);
    const canSave = typeof detailCanSaveImaginePost === "function"
      && detailCanSaveImaginePost(post, item);
    const saved = typeof imaginePostLiked === "function"
      && (imaginePostLiked(post, item) || imaginePostLiked(post));
    const canPrepareMissingLink = !saved && Boolean(heart.dataset.imagineHeartPostId);
    if (!canSave && !canPrepareMissingLink) {
      syncImagineDetailHeartState(post, item);
      return;
    }
    heart.classList.add("saved");
    heart.setAttribute("aria-pressed", "true");
    heart.setAttribute("aria-label", saved ? "Unsaving" : "Saving");
    heart.setAttribute("aria-busy", "true");
    void (async () => {
      try {
        if (saved) {
          // Un-hearting takes the card out of Liked, so there is nothing left to show in the
          // detail. Reload the list and go back to it, the way grok.com drops the card.
          if (typeof loadImagineLikedCards === "function") {
            loadImagineLikedCards({ force: true }).catch((error) => console.warn(error));
          }
          if (typeof openImagineMainView === "function"
            && library_state.iMainView === "liked") {
            // The Liked button toggles, so calling it while already on Liked would bounce to
            // Imagine. Step off the view first so the call lands back on Liked.
            library_state.iMainView = "imagine";
            openImagineMainView("i_upload_image_btn");
          }
          return;
        }
        const prepared = await prepareImagineDetailHeartCopy(post, item, heart);
        if (prepared.prepared) setImagineDetailHeartPreparation("Copying");
        const result = await likeImagineSelectedDetailPost(prepared.context);
        // Saving is the same move in the other direction: the copy is what belongs on Liked
        // now, so the list has to be read back and the detail moved onto the copy. This ran
        // only for un-hearting, which left a heart press looking like it had done nothing.
        await imagineOpenClonedDetailAfterSave(result, item);
        setImagineDetailHeartPreparation("OK");
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      } catch (error) {
        console.warn(error);
        if (saved) {
          showErrorPanel("Unsave failed", error?.message || "Unsave failed.");
        } else {
          setImagineDetailHeartPreparation("Failed");
          await new Promise((resolve) => window.setTimeout(resolve, 1300));
        }
      } finally {
        setImagineDetailHeartPreparation("");
        heart.removeAttribute("aria-busy");
        const currentPost = selectedLibraryPost();
        syncImagineDetailHeartState(currentPost, selectedDetailItem(currentPost));
      }
    })();
  });
  document.querySelector(".i_detail_copy_url")?.addEventListener("click", () => {
    copyImagineSelectedDetailMediaAddress().catch((error) => {
      console.warn(error);
      showErrorPanel("Copy failed", error?.message || "Copy failed.");
    });
  });
  document.querySelector(".i_detail_delete")?.addEventListener("click", () => {
    deleteImagineSelectedDetailItem().catch((error) => {
      console.warn(error);
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    });
  });
  document.querySelector(".i_detail_spicy")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    startImagineDetailSpicyVideo(button).catch((error) => {
      console.warn(error);
      showErrorPanel("Spicy failed", error?.message || "Spicy failed.");
    });
  });
  document.querySelector(".i_detail_edit")?.addEventListener("click", () => {
    openImagineDetailImageEditor();
  });
  document.querySelector(".i_detail_crop_btn")?.addEventListener("click", () => {
    openImagineDetailCropOverlay().catch((error) => {
      console.warn(error);
      showErrorPanel("Crop failed", error?.message || "Crop failed.");
    });
  });
  document.querySelector(".i_detail_upscale_btn")?.addEventListener("click", (event) => {
    upscaleImagineSelectedDetailVideo(event.currentTarget).catch((error) => {
      console.warn(error);
      showErrorPanel("Upscale failed", error?.message || "Upscale failed.");
    });
  });
  const aspectPicker = document.querySelector(".i_detail_aspect_picker");
  const aspectButton = aspectPicker?.querySelector(".i_detail_aspect_btn");
  aspectButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (aspectPicker.hidden) return;
    aspectPicker.classList.toggle("open");
  });
  aspectPicker?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const option = event.target.closest(".custom_select_option");
    if (!option || !aspectPicker.contains(option)) return;
    event.preventDefault();
    event.stopPropagation();
    aspectPicker.classList.remove("open");
    startImagineDetailAspectRatio(option.textContent || "", option).catch((error) => {
      console.warn(error);
      showErrorPanel("Aspect Ratio failed", error?.message || "Aspect Ratio failed.");
    });
  });
  document.addEventListener("click", (event) => {
    if (!aspectPicker?.classList.contains("open")) return;
    if (event.target instanceof Element && aspectPicker.contains(event.target)) return;
    aspectPicker.classList.remove("open");
  });
}

bindImagineDetailActions();
