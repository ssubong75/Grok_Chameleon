// Composer attachments
  let composerAttachmentImagePreviewOverlay = null;
  let composerAttachmentImagePreviewResizeHandler = null;
  let composerAttachmentImagePreviewPreviousFocus = null;

  function closeComposerAttachmentImagePreview() {
    if (composerAttachmentImagePreviewResizeHandler) {
      window.removeEventListener("resize", composerAttachmentImagePreviewResizeHandler);
      composerAttachmentImagePreviewResizeHandler = null;
    }
    composerAttachmentImagePreviewOverlay?.remove();
    composerAttachmentImagePreviewOverlay = null;
    if (composerAttachmentImagePreviewPreviousFocus?.isConnected) {
      composerAttachmentImagePreviewPreviousFocus.focus({ preventScroll: true });
    }
    composerAttachmentImagePreviewPreviousFocus = null;
  }

  function composerAttachmentImagePreviewUrls(attachment) {
    return Array.from(new Set([
      attachment?.source_url,
      attachment?.raw_url,
      attachment?.data_url,
      attachment?.preview_url,
    ].map((value) => String(value || "").trim()).filter(Boolean)));
  }

  function openComposerAttachmentImagePreview(index) {
    const attachment = composerAttachments[Number(index)];
    if (!attachment || composerMediaKind(attachment) !== "image") return false;
    const urls = composerAttachmentImagePreviewUrls(attachment);
    if (!urls.length) return false;
    closeComposerAttachmentImagePreview();
    composerAttachmentImagePreviewPreviousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const overlay = document.createElement("div");
    overlay.className = "composer_attachment_image_preview_overlay";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image preview");

    const image = document.createElement("img");
    image.className = "composer_attachment_image_preview";
    image.alt = attachment.name || "Attached image";
    image.draggable = false;
    overlay.append(image);

    const syncImageSize = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const targetHeight = Math.max(1, Math.round(window.innerHeight * 0.7));
      const targetWidth = targetHeight * (image.naturalWidth / image.naturalHeight);
      const maxWidth = Math.max(1, Math.round(window.innerWidth * 0.92));
      const scale = Math.min(1, maxWidth / targetWidth);
      image.style.width = `${Math.round(targetWidth * scale)}px`;
      image.style.height = `${Math.round(targetHeight * scale)}px`;
      image.classList.add("loaded");
    };

    let urlIndex = 0;
    image.addEventListener("load", syncImageSize);
    image.addEventListener("error", () => {
      urlIndex += 1;
      if (urlIndex < urls.length) {
        image.src = urls[urlIndex];
        return;
      }
      closeComposerAttachmentImagePreview();
      showErrorPanel("Preview unavailable", "The attached image could not be opened.");
    });
    image.src = urls[urlIndex];

    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      closeComposerAttachmentImagePreview();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeComposerAttachmentImagePreview();
    });
    document.body.append(overlay);
    composerAttachmentImagePreviewOverlay = overlay;
    composerAttachmentImagePreviewResizeHandler = syncImageSize;
    window.addEventListener("resize", composerAttachmentImagePreviewResizeHandler);
    requestAnimationFrame(() => overlay.focus({ preventScroll: true }));
    return true;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsDataURL(file);
    });
  }

  function hasVideoAttachment(attachments) {
    return attachments.some((attachment) => {
      return isComposerVideoAttachment(attachment);
    });
  }

  function isComposerVideoAttachment(attachment) {
      const type = String(attachment.type || "").toLowerCase();
      const name = String(attachment.name || "").toLowerCase();
      return type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(name);
  }

  function isComposerVideoEditMode() {
    return composerState.provider === "build" && composerState.mode === "video_edit";
  }

  function currentDetailPrefixForComposer() {
    return screen_state.current_screen === "i_detail" ? "i" : "b";
  }

  function detailMediaUrlForComposer(item, post = selectedLibraryPost()) {
    return detailMediaUrlForItem(currentDetailPrefixForComposer(), item, post);
  }

  function detailPreviewUrlForComposer(item, post = selectedLibraryPost()) {
    return detailPreviewUrlForItem(currentDetailPrefixForComposer(), item, post);
  }

  function detailVideoPreviewUrlForComposer(item, post = selectedLibraryPost()) {
    return detailVideoPreviewUrlForItem(currentDetailPrefixForComposer(), item, post);
  }

  function updateComposerFileAccept() {
    const input = document.getElementById("image_files");
    const videoEdit = isComposerVideoEditMode();
    if (input) input.accept = videoEdit
      ? "image/*,video/mp4,video/webm,video/quicktime,video/*"
      : "image/*,video/mp4,video/webm,video/quicktime,video/*";
    const uploadTitle = document.querySelector("#composer_upload_box strong");
    if (uploadTitle) uploadTitle.textContent = "Image";
  }

  function pruneComposerAttachmentsForMode() {
    if (!isComposerVideoEditMode()) return;
    let keptVideo = false;
    const removeIndexes = [];
    for (let index = 0; index < composerAttachments.length; index += 1) {
      const attachment = composerAttachments[index];
      if (isComposerVideoAttachment(attachment) && !keptVideo) {
        attachment.role = "source";
        keptVideo = true;
      } else if (isComposerVideoAttachment(attachment)) {
        removeIndexes.push(index);
      } else {
        attachment.role = attachment.detail_auto ? "source" : "reference";
      }
    }
    for (const index of removeIndexes.reverse()) {
      removeComposerAttachmentAt(index, { markDismissed: false });
    }
  }

  async function detailVideoAttachmentForSourceMode(postOverride = null, itemOverride = undefined) {
    if (composerState.mode !== "extend" && composerState.mode !== "video_edit") return null;
    const post = postOverride || selectedLibraryPost();
    const item = arguments.length >= 2 ? itemOverride : detailVideoForComposer(post);
    const type = item ? composerMediaKind(item) : "";
    const sourceUrl = detailMediaUrlForComposer(item, post);
    if (type !== "video" || !sourceUrl) return null;
    const originalName = String(item.file || item.title || item.item_id || "detail-video.mp4");
    const name = /\.(mp4|mov|m4v|webm)$/i.test(originalName) ? originalName : `${fileBaseName(originalName)}.mp4`;
    if (composerState.provider === "imagine" && composerState.mode === "extend") {
      return {
        name,
        type: item.mime_type || item.mime || "video/mp4",
        size: item.size || 0,
        data_url: "",
        preview_url: detailVideoPreviewUrlForComposer(item, post) || detailPreviewUrlForComposer(item, post) || sourceUrl,
        source_url: sourceUrl,
        detail_post_path: post?.folder_path || "",
        detail_item_id: mediaItemKey(item),
        detail_key: post ? detailComposerAttachmentKey(post, item) : "",
        detail_auto: true,
        role: "source",
        aspect_ratio: composerAttachmentAspectForItem(item),
        video_duration: item?.video_duration || item?.duration || item?.duration_seconds || "",
        ...composerAttachmentMetadataForItem(post, item),
      };
    }
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error("Detail video could not be read.");
    const blob = await response.blob();
    const dataUrl = await fileToDataUrl(blob);
      return {
        name,
        type: blob.type || item.mime_type || "video/mp4",
        size: blob.size,
        data_url: dataUrl,
        preview_url: detailVideoPreviewUrlForComposer(item, post) || detailPreviewUrlForComposer(item, post) || sourceUrl,
        source_url: sourceUrl,
        detail_post_path: post?.folder_path || "",
        detail_item_id: mediaItemKey(item),
        detail_key: post ? detailComposerAttachmentKey(post, item) : "",
        detail_auto: true,
        role: "source",
        aspect_ratio: composerAttachmentAspectForItem(item),
        video_duration: item?.video_duration || item?.duration || item?.duration_seconds || "",
        resolution_name: mediaResolutionLabelForItem(item, post),
        ...composerAttachmentMetadataForItem(post, item),
      };
    }

    function releaseOwnedComposerAttachmentPreview(attachment) {
      if (!attachment || attachment.owns_preview_url !== true) return;
      const previewUrl = String(attachment.preview_url || "");
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      attachment.owns_preview_url = false;
    }

    function clearComposerAttachmentPreviews() {
      for (const attachment of composerAttachments) releaseOwnedComposerAttachmentPreview(attachment);
    }

    function canLoadImagineComposerUploads() {
      return Boolean(
        composerState.provider === "imagine"
        && library_state.apiReady
        && library_state.rootPath
        && account_state.imagine?.accounts?.length
      );
    }

    async function loadImagineComposerUploads({ force = false } = {}) {
      if (!canLoadImagineComposerUploads()) return;
      if (!force && (library_state.imagineUploadLoaded || library_state.imagineUploadLoading)) return;
      library_state.imagineUploadLoading = true;
      library_state.imagineUploadError = "";
      try {
        const data = await qApi("/api/imagine/uploads", { limit: uploadHistoryPageSize });
        const posts = Array.isArray(data.posts) ? data.posts : [];
        library_state.imagineUploadPosts = posts.map(normalizeServerPost);
        library_state.imagineUploadLoaded = true;
      } catch (error) {
        library_state.imagineUploadError = error?.message || "Imagine uploads failed.";
      } finally {
        library_state.imagineUploadLoading = false;
        renderComposerAttachments();
      }
    }

    function composerUploadSourcePosts() {
      if (library_state.libraryIndexEnabled) {
        return library_state.indexedUploadPosts || [];
      }
      const posts = [];
      for (const post of library_state.posts || []) {
        if (post.area === "upload") posts.push(post);
      }
      return posts;
    }

    function recentComposerUploadItems() {
      const items = [];
      const removedKeys = new Set(Array.isArray(library_state.library?.settings?.hidden_upload_keys)
        ? library_state.library.settings.hidden_upload_keys.map((value) => String(value || ""))
        : []);
      for (const post of composerUploadSourcePosts()) {
        for (const item of post.items || []) {
          const type = item.type || mediaTypeForName(item.file || item.url || item.object_url || "");
          if (type !== "image") continue;
          const normalizedItem = { ...item, type };
          const removeKey = composerUploadRemoveKey(post, normalizedItem);
          if (removeKey && removedKeys.has(removeKey)) continue;
          items.push({ post, item: normalizedItem });
        }
      }
      const sorted = items.sort((a, b) => {
          const aTime = detailItemTimeValue(a.item);
          const bTime = detailItemTimeValue(b.item);
          if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
          return String(b.item.file || b.item.url || "").localeCompare(String(a.item.file || a.item.url || ""), undefined, { numeric: true, sensitivity: "base" });
        });
      const seen = new Set();
      const deduped = [];
      for (const entry of sorted) {
        const key = composerUploadHistoryDedupeKey(entry.post, entry.item);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        deduped.push(entry);
        if (deduped.length >= uploadHistoryPageSize) break;
      }
      return deduped;
    }

    function composerUploadAttachmentKey(postPath, itemId) {
      return `${postPath || ""}::${itemId || ""}`;
    }

    function composerUploadHistoryDedupeKey(post, item) {
      const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      const uploadHash = String(item?.upload_hash || metadata.upload_hash || imagine.upload_hash || "").trim();
      if (uploadHash) return `upload-hash:${uploadHash}`;
      const rootAssetId = String(metadata.root_asset_id || imagine.root_asset_id || "").trim();
      if (rootAssetId) return `root-asset:${rootAssetId}`;
      const size = String(item?.size || metadata.size || "").trim();
      const title = String(item?.title || post?.title || item?.file || post?.folderName || item?.name || "").trim().toLowerCase();
      const mime = String(item?.mime_type || item?.mime || "").trim().toLowerCase();
      if (title && size && mime) return `file-signature:${title}:${size}:${mime}`;
      if (title && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(title)) {
        return `name:${title}:${mime}`;
      }
      const rawUrl = String(composerRawMediaUrlForItem(item) || item?.object_url || item?.url || "").trim();
      if (rawUrl) return `url:${rawUrl}`;
      return composerUploadAttachmentKey(post?.folder_path || "", mediaItemKey(item));
    }

    function composerUploadRemoveKey(post, item) {
      const dedupeKey = composerUploadHistoryDedupeKey(post, item);
      if (dedupeKey) return `upload-history:${dedupeKey}`;
      const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      const assetId = String(item?.asset_id || metadata.asset_id || imagine.asset_id || "").trim();
      if (assetId) return `upload-asset:${assetId}`;
      return `upload-item:${post?.folder_path || ""}::${mediaItemKey(item)}`;
    }

    async function removeComposerUploadFromList(postPath, itemId, key) {
      const removeKey = String(key || "").trim();
      if (!removeKey) return;
      library_state.library = mergeLibraryJson(library_state.library || {});
      const settings = library_state.library.settings || {};
      const removed = Array.isArray(settings.hidden_upload_keys) ? settings.hidden_upload_keys.map(String) : [];
      if (!removed.includes(removeKey)) removed.push(removeKey);
      settings.hidden_upload_keys = removed;
      library_state.library.settings = settings;
      composerAttachments
        .map((attachment, index) => ({ attachment, index }))
        .reverse()
        .filter(({ attachment }) => (
          attachment.upload_post_path === postPath
          && attachment.upload_item_id === itemId
        ))
        .forEach(({ index }) => removeComposerAttachmentAt(index, { markDismissed: false }));
      renderComposerAttachments();
      const data = await qApi("/api/uploads/remove-from-list", {
        key: removeKey,
        post_path: postPath,
        item_id: itemId,
      });
      applyLibrarySnapshot(data);
    }

    function composerAttachmentLimit() {
      if (composerState.mode === "analyze") {
        return composerAnalyzeAttachmentLimit;
      }
      if (composerState.mode === "video_edit") {
        return composerVideoAttachmentLimit;
      }
      if (composerState.mode === "image") {
        if (composerState.provider === "build" && composerAttachments.length > 0) {
          return composerBuildI2iAttachmentLimit;
        }
        return composerImageAttachmentLimit;
      }
      if (composerState.mode === "video" || composerState.mode === "extend") {
        return composerVideoAttachmentLimit;
      }
      return composerImageAttachmentLimit;
    }

    function trimComposerAttachmentsToLimit(limit = composerAttachmentLimit()) {
      while (composerAttachments.length > limit) {
        removeComposerAttachmentAt(composerAttachments.length - 1, { markDismissed: false });
      }
    }

    function composerAttachmentKey(attachment) {
      return composerUploadAttachmentKey(attachment.upload_post_path, attachment.upload_item_id);
    }

    function composerAttachmentDomKey(attachment) {
      if (!attachment) return "";
      const uploadKey = composerAttachmentKey(attachment);
      return String(
        attachment.detail_key
        || (uploadKey !== "::" ? uploadKey : "")
        || attachment.item_id
        || attachment.detail_item_id
        || attachment.upload_item_id
        || attachment.post_id
        || attachment.asset_id
        || attachment.raw_url
        || attachment.source_url
        || attachment.preview_url
        || attachment.data_url
        || `${attachment.name || ""}:${attachment.type || ""}:${attachment.size || ""}`
        || ""
      ).trim();
    }

    function composerAttachedListSignature() {
      return composerAttachments.map((attachment, index) => [
        composerAttachmentDomKey(attachment) || `index:${index}`,
        composerMediaKind(attachment),
        attachment.detail_auto ? "detail" : "manual",
        attachment.preview_url || "",
        attachment.source_url || "",
      ].join("::")).join("||");
    }

    function updateComposerAttachedThumbStates(attachedList, firstAfterDetail) {
      const buttons = Array.from(attachedList.querySelectorAll(".composer_attached_thumb"));
      if (buttons.length !== composerAttachments.length) return false;
      for (let index = 0; index < buttons.length; index += 1) {
        const button = buttons[index];
        const attachment = composerAttachments[index];
        button.dataset.attachmentIndex = String(index);
        button.classList.add("active");
        button.classList.toggle("is_detail_auto", Boolean(attachment?.detail_auto));
        button.classList.toggle("after_detail_auto", index === firstAfterDetail);
        button.querySelector(".composer_upload_check")?.remove();
      }
      return true;
    }

    function activeComposerUploadKeys() {
      return new Set(composerAttachments
        .filter((attachment) => attachment.upload_post_path && attachment.upload_item_id)
        .map(composerAttachmentKey));
    }

    function detailComposerAttachmentKey(post, item) {
      if (!post || !item) return "";
      return `detail::${composerState.provider}::${post.folder_path || ""}::${mediaItemKey(item)}`;
    }

    function composerMediaKind(source = {}) {
      const rawType = String(source.type || source.mime_type || source.mime || "").toLowerCase();
      if (rawType === "image" || rawType.startsWith("image/")) return "image";
      if (rawType === "video" || rawType.startsWith("video/")) return "video";
      return mediaTypeForName(source.name || source.file || source.url || source.object_url || "");
    }

    function itemMatchesSourceKey(item, sourceKey) {
      const key = String(sourceKey || "").trim();
      if (!item || !key) return false;
      const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      return [
        mediaItemKey(item),
        item.item_id,
        item.id,
        item.post_id,
        item.detail_item_id,
        item.asset_id,
        item.file,
        item.name,
        item.url,
        item.object_url,
        item.media_url,
        item.mediaUrl,
        item.source_url,
        item.remote_url,
        item.raw_url,
        metadata.item_id,
        metadata.post_id,
        metadata.asset_id,
        metadata.media_url,
        metadata.remote_url,
        metadata.imagine_post_id,
        metadata.imagine_media_url,
        imagine.item_id,
        imagine.post_id,
        imagine.asset_id,
        imagine.media_url,
      ].some((value) => String(value || "").trim() === key);
    }

    function detailSourceKeyForComposerItem(item) {
      if (!item) return "";
      const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      return String(
        item.source_item_id
        || item.original_post_id
        || item.parent_post_id
        || metadata.source_item_id
        || metadata.original_post_id
        || metadata.parent_post_id
        || imagine.source_item_id
        || imagine.original_post_id
        || imagine.parent_post_id
        || item.root_post_id
        || metadata.root_post_id
        || imagine.root_post_id
        || ""
      ).trim();
    }

    function composerRawMediaUrlForItem(item) {
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
        metadata.imagine_media_url,
        imagine.media_url,
        imagine.asset_url,
      ];
      for (const candidate of candidates) {
        const text = String(candidate || "").trim();
        if (!text) continue;
        try {
          const parsed = new URL(text, window.location.origin);
          if (parsed.pathname === "/api/imagine/remote/media") {
            const raw = parsed.searchParams.get("url");
            if (raw) return raw;
          }
          return text;
        } catch {
          return text;
        }
      }
      return "";
    }

    function composerSourceIsT2i(post, item) {
      const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
      const normalizeAction = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const itemActions = [
        item?.generated_action,
        metadata.generated_action,
        imagine.generated_action,
        item?.action,
        metadata.action,
        imagine.action,
      ].map(normalizeAction).filter(Boolean);
      if (itemActions.some((value) => value === "t2i" || value === "texttoimage")) return true;
      if (itemActions.length) return false;
      const postActions = [
        post?.mode,
        postMetadata.generated_action,
        postMetadata.root_generation_action,
      ].map(normalizeAction).filter(Boolean);
      return postActions.some((value) => value === "t2i" || value === "texttoimage");
    }

    function composerExternalReferenceMarker(source) {
      const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      const remoteView = String(metadata.remote_view || imagine.remote_view || "").trim().toLowerCase();
      return Boolean(
        source?.external_reference
        || metadata.external_reference
        || imagine.external_reference
        || metadata.link_source
        || imagine.link_source
        || ["discover", "link", "search"].includes(remoteView)
      );
    }

    function composerRequiresFreshImagineSource(post, item) {
      if (composerExternalReferenceMarker(item) || composerExternalReferenceMarker(post)) return true;
      return (post?.items || []).some((candidate) => composerExternalReferenceMarker(candidate));
    }

    function composerAttachmentMetadataForItem(post, item) {
      const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
      const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
      const conversationId = item?.conversation_id
        || metadata.conversation_id
        || imagine.conversation_id
        || postMetadata.conversation_id
        || "";
      const responseId = item?.response_id
        || metadata.response_id
        || imagine.response_id
        || "";
      const officialUploadSource = Boolean(
        item?.official_upload_source
        || metadata.official_upload_source
        || imagine.official_upload_source
        || String(item?.relation || metadata.relation || imagine.relation || "").toLowerCase() === "upload"
      );
      const uploadOriginBundle = postMetadata.upload_origin_bundle === true;
      const externalReference = composerExternalReferenceMarker(item);
      const freshSourceRequired = composerRequiresFreshImagineSource(post, item);
      return {
        detail_post_id: post?.post_id || "",
        detail_root_post_id: post?.metadata?.imagine_root_post_id || post?.metadata?.raw_root_post_id || "",
        item_id: item?.item_id || "",
        raw_url: composerRawMediaUrlForItem(item),
        remote_url: item?.remote_url || metadata.remote_url || "",
        post_id: item?.post_id || metadata.post_id || imagine.post_id || item?.item_id || "",
        root_post_id: item?.root_post_id || metadata.root_post_id || imagine.root_post_id || post?.post_id || "",
        original_post_id: item?.original_post_id || metadata.original_post_id || imagine.original_post_id || "",
        parent_post_id: item?.parent_post_id || metadata.parent_post_id || imagine.parent_post_id || "",
        source_item_id: item?.source_item_id || metadata.source_item_id || imagine.source_item_id || "",
        original_ref_type: item?.original_ref_type || metadata.original_ref_type || imagine.original_ref_type || "",
        asset_id: item?.asset_id || metadata.asset_id || imagine.asset_id || "",
        conversation_id: conversationId,
        response_id: responseId,
        parent_response_id: responseId,
        official_upload_source: officialUploadSource,
        upload_origin_bundle: uploadOriginBundle,
        external_reference: externalReference,
        fresh_source_required: freshSourceRequired,
        source_is_t2i: composerSourceIsT2i(post, item),
        account_id: item?.account_id || metadata.account_id || imagine.account_id || post?.account_id || "",
        account_email: item?.account_email || metadata.account_email || imagine.account_email || post?.account_email || "",
      };
    }

    function composerAttachmentAspectForItem(item) {
      const resolved = typeof detailAspectFromItem === "function" ? detailAspectFromItem(item) : "";
      if (resolved) return resolved;
      return item?.aspect_ratio || item?.aspectRatio || item?.aspect || item?.ratio || "";
    }

    function isExplicitDetailSourceImage(item) {
      if (composerMediaKind(item) !== "image" || !detailMediaUrlForComposer(item)) return false;
      const role = String(item.role || item.relation || item.source_type || item.kind || "").toLowerCase();
      return /(source|original|start|input|parent)/.test(role);
    }

    function detailImageForComposer(post, selectedOverride = undefined) {
      const selected = arguments.length >= 2 ? selectedOverride : selectedDetailItem(post);
      if (composerMediaKind(selected) === "image" && detailMediaUrlForComposer(selected, post)) return selected;
      const sourceKey = detailSourceKeyForComposerItem(selected);
      if (sourceKey) {
        const matched = detailOrderedItems(post).find((item) => (
          composerMediaKind(item) === "image"
          && detailMediaUrlForComposer(item, post)
          && itemMatchesSourceKey(item, sourceKey)
        ));
        if (matched) return matched;
      }
      const ordered = detailOrderedItems(post);
      return ordered.find(isExplicitDetailSourceImage) || null;
    }

    function detailVideoForComposer(post, selectedOverride = undefined) {
      const selected = arguments.length >= 2 ? selectedOverride : selectedDetailItem(post);
      if (composerMediaKind(selected) === "video" && detailMediaUrlForComposer(selected, post)) return selected;
      const ordered = detailOrderedItems(post);
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const item = ordered[index];
        if (composerMediaKind(item) === "video" && detailMediaUrlForComposer(item, post)) return item;
      }
      return null;
    }

    function removeComposerAttachmentAt(index, options = {}) {
      const attachment = composerAttachments[index];
      if (!attachment) return;
      if (attachment.detail_auto && attachment.detail_key && options.markDismissed !== false) {
        composerState.dismissedDetailAttachmentKey = attachment.detail_key;
      }
      releaseOwnedComposerAttachmentPreview(attachment);
      composerAttachments.splice(index, 1);
      renderComposerAttachments();
    }

    function clearDetailAutoComposerAttachments() {
      let changed = false;
      for (let index = composerAttachments.length - 1; index >= 0; index -= 1) {
        if (composerAttachments[index]?.detail_auto) {
          removeComposerAttachmentAt(index, { markDismissed: false });
          changed = true;
        }
      }
      if (changed) renderComposerAttachments();
    }

    function clearComposerAttachmentsForPostChange() {
      if (!composerAttachments.length && !composerState.dismissedDetailAttachmentKey) return;
      clearComposerAttachmentPreviews();
      composerAttachments.splice(0, composerAttachments.length);
      composerState.dismissedDetailAttachmentKey = "";
      renderComposerAttachments();
    }

    async function ensureComposerAttachmentDataUrl(attachment) {
      if (!attachment || attachment.data_url) return attachment;
      const sourceUrl = String(attachment.source_url || "").trim();
      if (!sourceUrl) throw new Error("Attachment source is missing.");
      if (!attachment.data_url_promise) {
        attachment.data_url_promise = (async () => {
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error("Attachment could not be read.");
          const blob = await response.blob();
          attachment.type = blob.type || attachment.type || "image/jpeg";
          attachment.size = blob.size || attachment.size || 0;
          attachment.data_url = await fileToDataUrl(blob);
          return attachment;
        })().finally(() => {
          attachment.data_url_promise = null;
        });
      }
      return attachment.data_url_promise;
    }

    async function ensureComposerAttachmentsReady() {
      await Promise.all(composerAttachments.map((attachment) => ensureComposerAttachmentDataUrl(attachment)));
    }

    function scheduleComposerAttachmentDataUrl(attachment) {
      if (!attachment || attachment.data_url || attachment.data_url_promise) return;
      const run = () => {
        if (!composerAttachments.includes(attachment)) return;
        ensureComposerAttachmentDataUrl(attachment).catch((error) => {
          console.warn(error);
          if (composerAttachments.includes(attachment)) setLibraryMessage("Attachment read failed.");
        });
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        window.setTimeout(run, 80);
      }
    }

    function composerSubmissionAttachment(attachment) {
      const {
        preview_url,
        data_url_promise,
        owns_preview_url,
        ...payload
      } = attachment;
      return payload;
    }

    async function saveComposerUploadAttachment(file, dataUrl, type) {
      if (!library_state.apiReady) return null;
      const data = await qApi("/api/uploads/save", {
        provider: composerState.provider,
        files: [{
          name: file.name,
          type,
          size: file.size,
          data_url: dataUrl,
        }],
      });
      applyLibrarySnapshot(data);
      const saved = Array.isArray(data?.saved) ? data.saved[0] : null;
      const post = saved?.post || null;
      const item = saved?.item || null;
      if (!saved?.folder_path || !saved?.item_id) return null;
      return {
        post,
        item,
        upload_post_path: saved.folder_path,
        upload_item_id: saved.item_id,
        source_url: item?.object_url || "",
        preview_url: mediaPreviewUrl(item || {}) || videoPreviewUrl(item || {}) || item?.object_url || "",
      };
    }

    function composerThumbButton({ attachment = null, post = null, item = null, index = 0, active = false, disabled = false, attached = false }) {
      const source = attachment || item || {};
      const type = composerMediaKind(source);
      const button = document.createElement("button");
      button.className = `composer_upload_thumb${attached ? " composer_attached_thumb" : ""}${source.preview_url || mediaPreviewUrl(source) || videoPreviewUrl(source) ? " has-preview" : ""}${active ? " active" : ""}${disabled ? " disabled" : ""}`;
      button.type = "button";
      button.disabled = disabled;
      if (disabled) button.setAttribute("aria-disabled", "true");
      button.title = source.name || source.file || source.title || post?.title || "Media";
      if (attachment) {
        button.dataset.attachmentIndex = String(index);
      } else {
        button.dataset.uploadPostPath = post?.folder_path || "";
        button.dataset.uploadItemId = mediaItemKey(item);
        button.dataset.uploadRemoveKey = composerUploadRemoveKey(post, item);
      }
      if (type === "image") {
        const img = document.createElement("img");
        img.src = source.preview_url || mediaPreviewUrl(source);
        img.alt = "";
        button.append(img);
      } else if (type === "video") {
        const video = document.createElement("video");
        video.src = source.preview_url || videoPreviewUrl(source);
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        button.append(video);
      } else {
        const label = document.createElement("span");
        label.textContent = String(source.name || source.file || "MEDIA").slice(0, 3).toUpperCase();
        button.append(label);
      }
      if (active && !attached) {
        const check = document.createElement("span");
        check.className = "composer_upload_check";
        check.textContent = "✓";
        button.append(check);
      }
      if (!attachment && !disabled) {
        const remove = document.createElement("span");
        remove.className = "composer_upload_remove";
        remove.setAttribute("aria-label", "Remove from upload list");
        remove.setAttribute("role", "button");
        remove.innerHTML = `<span class="delete_x_icon" aria-hidden="true"></span>`;
        button.append(remove);
      }
      return button;
    }

    function updateComposerUploadThumbStates() {
      const list = document.getElementById("composer_upload_thumb_list");
      if (!list) return;
      const activeKeys = activeComposerUploadKeys();
      for (const button of list.querySelectorAll(".composer_upload_thumb")) {
        const key = composerUploadAttachmentKey(button.dataset.uploadPostPath || "", button.dataset.uploadItemId || "");
        const active = activeKeys.has(key);
        button.classList.toggle("active", active);
        const check = button.querySelector(".composer_upload_check");
        if (active && !check) {
          const nextCheck = document.createElement("span");
          nextCheck.className = "composer_upload_check";
          nextCheck.textContent = "✓";
          button.append(nextCheck);
        } else if (!active && check) {
          check.remove();
        }
      }
    }

    function renderComposerUploadHistory() {
      const list = document.getElementById("composer_upload_thumb_list");
      if (!list) return;
      if (
        library_state.libraryIndexEnabled
        && !library_state.indexedUploadLoaded
        && !library_state.indexedUploadLoading
        && typeof loadIndexedUploadPosts === "function"
      ) {
        loadIndexedUploadPosts().catch((error) => console.warn(error));
      }
      const currentSignature = Array.from(list.querySelectorAll(".composer_upload_thumb"))
        .map((button) => composerUploadAttachmentKey(button.dataset.uploadPostPath || "", button.dataset.uploadItemId || ""))
        .join("||");
      const activeKeys = activeComposerUploadKeys();
      const recentButtons = recentComposerUploadItems().map(({ post, item }, index) => {
        const key = composerUploadAttachmentKey(post?.folder_path || "", mediaItemKey(item));
        const active = activeKeys.has(key);
        return composerThumbButton({
          post,
          item,
          index,
          active,
          disabled: false,
        });
      });
      const nextSignature = recentButtons
        .map((button) => composerUploadAttachmentKey(button.dataset.uploadPostPath || "", button.dataset.uploadItemId || ""))
        .join("||");
      if (currentSignature === nextSignature) {
        updateComposerUploadThumbStates();
        return;
      }
      list.replaceChildren(...recentButtons);
    }

    function renderComposerAttachments() {
      if (composerState.mode === "image" || composerState.mode === "video") renderComposerOptions();
      const attachedList = document.getElementById("composer_attached_list");
      renderComposerUploadHistory();
      if (!attachedList) return;
      const firstAfterDetail = composerAttachments.findIndex((attachment, index) => (
        index > 0 && !attachment.detail_auto && composerAttachments.slice(0, index).some((candidate) => candidate.detail_auto)
      ));
      const signature = composerAttachedListSignature();
      if (attachedList.dataset.attachmentSignature === signature && updateComposerAttachedThumbStates(attachedList, firstAfterDetail)) {
        return;
      }
      attachedList.dataset.attachmentSignature = signature;
      attachedList.replaceChildren(...composerAttachments.map((attachment, index) => {
        const button = composerThumbButton({ attachment, index, active: true, attached: true });
        if (attachment.detail_auto) button.classList.add("is_detail_auto");
        if (index === firstAfterDetail) button.classList.add("after_detail_auto");
        return button;
      }));
    }

    async function toggleComposerAttachmentFromLibraryItem(postPath, itemId) {
      const post = composerUploadSourcePosts().find((candidate) => candidate.folder_path === postPath);
      const item = post?.items?.find((candidate) => mediaItemKey(candidate) === itemId);
      if (!item?.object_url) return;
      const key = composerUploadAttachmentKey(postPath, itemId);
      const existing = composerAttachments.findIndex((attachment) => composerAttachmentKey(attachment) === key);
      if (existing >= 0) {
        removeComposerAttachmentAt(existing);
        return;
      }
      if (isComposerVideoEditMode()) {
        if (composerMediaKind(item) === "video") {
          for (let index = composerAttachments.length - 1; index >= 0; index -= 1) {
            if (isComposerVideoAttachment(composerAttachments[index])) removeComposerAttachmentAt(index, { markDismissed: false });
          }
        }
      }
      if (composerAttachments.length >= composerAttachmentLimit()) {
        setLibraryMessage("Attachment limit reached.");
        renderComposerAttachments();
        return;
      }
      const attachment = {
        name: item.file || item.title || item.item_id || "upload-media",
        type: item.mime_type || item.mime || (composerMediaKind(item) === "video" ? "video/mp4" : "image/jpeg"),
        size: item.size || 0,
        data_url: "",
        preview_url: mediaPreviewUrl(item) || videoPreviewUrl(item) || item.object_url,
        source_url: item.object_url,
        upload_post_path: postPath,
        upload_item_id: itemId,
        aspect_ratio: composerAttachmentAspectForItem(item),
        role: composerState.mode === "image" || composerState.mode === "analyze" || (isComposerVideoEditMode() && composerMediaKind(item) === "video") ? "source" : "reference",
      };
      composerAttachments.push(attachment);
      trimComposerAttachmentsToLimit();
      renderComposerAttachments();
      scheduleComposerAttachmentDataUrl(attachment);
    }

    async function syncDetailAttachmentForComposerTray(postOverride = null, itemOverride = undefined) {
      if (screen_state.current_screen !== "i_detail" && screen_state.current_screen !== "b_detail") return;
      if (!["image", "video", "extend", "video_edit", "analyze"].includes(composerState.mode)) return;
      const selectedContext = arguments.length === 0 && typeof selectedDetailSourceContext === "function"
        ? selectedDetailSourceContext()
        : null;
      const post = selectedContext?.post || postOverride || selectedLibraryPost();
      const sourceVideoMode = composerState.mode === "extend" || composerState.mode === "video_edit";
      const item = arguments.length >= 2
        ? (sourceVideoMode ? detailVideoForComposer(post, itemOverride) : detailImageForComposer(post, itemOverride))
        : (sourceVideoMode
          ? detailVideoForComposer(post, selectedContext?.item)
          : detailImageForComposer(post, selectedContext?.item));
      const manualSourceKind = sourceVideoMode ? "video" : "image";
      const hasManualSourceOverride = Boolean(
        composerState.dismissedDetailAttachmentKey
        && composerAttachments.some((attachment) => (
          !attachment.detail_auto
          && composerMediaKind(attachment) === manualSourceKind
        )),
      );
      const sourceUrl = detailMediaUrlForComposer(item, post);
      const previewUrl = sourceVideoMode
        ? (detailVideoPreviewUrlForComposer(item, post) || detailPreviewUrlForComposer(item, post))
        : detailPreviewUrlForComposer(item, post);
      const detailKey = post && sourceUrl ? detailComposerAttachmentKey(post, item) : "";
      for (let index = composerAttachments.length - 1; index >= 0; index -= 1) {
        const attachment = composerAttachments[index];
        if (attachment.detail_auto && (!detailKey || attachment.detail_key !== detailKey)) {
          removeComposerAttachmentAt(index, { markDismissed: false });
        }
      }
      if (hasManualSourceOverride) {
        renderComposerAttachments();
        return;
      }
      if (!post || !sourceUrl || !detailKey || composerState.dismissedDetailAttachmentKey === detailKey) {
        renderComposerAttachments();
        return;
      }
      const sourcePostPath = String(post.folder_path || "");
      const sourceItemId = String(mediaItemKey(item) || "");
      const existing = composerAttachments.find((attachment) => (
        attachment.detail_key === detailKey
        || (
          sourcePostPath
          && sourceItemId
          && (
            (
              String(attachment.detail_post_path || "") === sourcePostPath
              && String(attachment.detail_item_id || "") === sourceItemId
            )
            || (
              String(attachment.upload_post_path || "") === sourcePostPath
              && String(attachment.upload_item_id || "") === sourceItemId
            )
          )
        )
      ));
      if (existing) {
        renderComposerAttachments();
        return;
      }
      const limitWithDetail = composerAttachmentLimit();
      while (composerAttachments.length >= limitWithDetail) {
        const removableIndex = composerAttachments.map((attachment, index) => ({ attachment, index }))
          .reverse()
          .find(({ attachment }) => !attachment.detail_auto)?.index;
        if (typeof removableIndex !== "number") break;
        removeComposerAttachmentAt(removableIndex, { markDismissed: false });
      }
      const attachment = {
        name: item.file || item.title || item.item_id || (sourceVideoMode ? "detail-video" : "detail-image"),
        type: item.mime_type || item.mime || (sourceVideoMode ? "video/mp4" : "image/jpeg"),
        size: item.size || 0,
        data_url: String(item.data_url || item.dataUrl || "").startsWith("data:image/")
          ? String(item.data_url || item.dataUrl)
          : "",
        preview_url: previewUrl || sourceUrl,
        source_url: sourceUrl,
        detail_post_path: post.folder_path || "",
        detail_item_id: mediaItemKey(item),
        detail_key: detailKey,
        detail_auto: true,
        aspect_ratio: composerAttachmentAspectForItem(item),
        role: composerState.mode === "image" || composerState.mode === "analyze" || sourceVideoMode ? "source" : "reference",
        ...composerAttachmentMetadataForItem(post, item),
      };
      composerAttachments.unshift(attachment);
      trimComposerAttachmentsToLimit(composerAttachmentLimit());
      renderComposerAttachments();
      scheduleComposerAttachmentDataUrl(attachment);
    }

    function resetComposerAttachmentsToSelectedDetail() {
      composerAttachments.splice(0, composerAttachments.length);
      composerState.dismissedDetailAttachmentKey = "";
      syncDetailAttachmentForComposerTray().catch((error) => {
        console.warn(error);
        renderComposerAttachments();
      });
    }

  async function setComposerFiles(files) {
    for (const file of Array.from(files || [])) {
      const type = file.type || (mediaTypeForName(file.name) === "video" ? "video/mp4" : "image/jpeg");
      if (!type.startsWith("image/") && !type.startsWith("video/")) continue;
      if (isComposerVideoEditMode() && type.startsWith("video/")) {
        for (let index = composerAttachments.length - 1; index >= 0; index -= 1) {
          if (isComposerVideoAttachment(composerAttachments[index])) removeComposerAttachmentAt(index, { markDismissed: false });
        }
      }
      if (composerAttachments.length >= composerAttachmentLimit()) break;
      const dataUrl = await fileToDataUrl(file);
      const saved = await saveComposerUploadAttachment(file, dataUrl, type);
      const savedKey = saved?.upload_post_path && saved?.upload_item_id
        ? composerUploadAttachmentKey(saved.upload_post_path, saved.upload_item_id)
        : "";
      if (savedKey && composerAttachments.some((attachment) => composerAttachmentKey(attachment) === savedKey)) {
        renderComposerAttachments();
        continue;
      }
      const savedPreviewUrl = String(saved?.preview_url || "");
      composerAttachments.push({
        name: saved?.item?.file || file.name,
        type: saved?.item?.mime_type || type,
        size: saved?.item?.size || file.size,
        data_url: dataUrl,
        preview_url: savedPreviewUrl || URL.createObjectURL(file),
        owns_preview_url: !savedPreviewUrl,
        source_url: saved?.source_url || "",
        upload_post_path: saved?.upload_post_path || "",
        upload_item_id: saved?.upload_item_id || "",
        aspect_ratio: saved?.item?.aspect_ratio || "",
        role: composerState.mode === "image" || composerState.mode === "analyze" || (isComposerVideoEditMode() && type.startsWith("video/")) ? "source" : "reference",
        ...(saved?.post && saved?.item ? composerAttachmentMetadataForItem(saved.post, saved.item) : {}),
      });
    }
    trimComposerAttachmentsToLimit();
    renderComposerAttachments();
  }
