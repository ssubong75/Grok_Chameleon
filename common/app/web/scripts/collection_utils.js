// Collection helpers for folder actions, move, and merge
async function uniqueDirectoryName(parentHandle, preferredName) {
  const base = preferredName.replace(/[/:\\]/g, "-").trim() || "post";
  let name = base;
  let index = 2;
  while (await getOptionalDirectory(parentHandle, name)) {
    name = `${base}-${index}`;
    index += 1;
  }
  return name;
}

function collectionFolderCardIconHtml() {
  return `<span class="folder-card-icon" aria-hidden="true"><span></span></span>`;
}

function moveDialogEmptyNode(message) {
  const empty = emptyLibraryNode(message);
  empty.classList.add("folder-gallery-empty");
  return empty;
}

async function collectionActionInput({ title, value = "", confirmLabel = "Save" }) {
  if (typeof openGalleryActionDialog === "function") {
    const result = await openGalleryActionDialog({ title, value, confirmLabel });
    return result === null ? "" : String(result).trim();
  }
  return String(window.prompt(title, value) || "").trim();
}

async function collectionActionConfirm({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", messageBox = false }) {
  if (typeof openGalleryActionDialog === "function") {
    return Boolean(await openGalleryActionDialog({ title, message, confirmLabel, cancelLabel, messageBox }));
  }
  return window.confirm(message);
}

function collectionKindLabel(level) {
  return level === "second" ? "Item" : "Category";
}

function collectionNameFromPath(path = "") {
  return readableName(String(path || "").split("/").filter(Boolean).pop() || "");
}

function collectionTargetName(target = {}) {
  return target.name || collectionNameFromPath(target.path) || "";
}

async function copyFileToDirectory(sourceDirHandle, fileName, targetDirHandle) {
  if (!fileName) return "";
  const sourceFileHandle = await getOptionalFile(sourceDirHandle, fileName);
  if (!sourceFileHandle) return "";
  const file = await sourceFileHandle.getFile();
  const extension = extensionFor(fileName);
  const targetName = await uniqueFileName(targetDirHandle, fileBaseName(fileName), extension || "bin");
  const targetFileHandle = await targetDirHandle.getFileHandle(targetName, { create: true });
  const writable = await targetFileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return targetName;
}

function serializableMediaItem(item) {
  const data = {
    item_id: item.item_id || mediaItemKey(item),
    type: item.type || mediaTypeForName(item.file || item.url) || "image",
    file: item.file || "",
    mime_type: item.mime_type || "",
    role: item.role || "result",
    url: item.url || null,
  };
  if (item.thumbnail) data.thumbnail = item.thumbnail;
  return data;
}

function postJsonFromPost(post, overrides = {}) {
  const items = overrides.items || post.items || [];
  const representative = overrides.representative
    || post.representative
    || items[0]?.file
    || items[0]?.url
    || "";
  return {
    post_id: overrides.post_id ?? post.post_id,
    source: overrides.source ?? post.source,
    mode: overrides.mode ?? post.mode,
    title: overrides.title ?? post.title,
    prompt: overrides.prompt ?? post.prompt,
    original_prompt: overrides.original_prompt ?? post.original_prompt,
    created_at: overrides.created_at ?? post.created_at,
    updated_at: libraryNow(),
    model: overrides.model ?? post.model,
    group_id: overrides.group_id ?? post.group_id ?? "",
    parent_id: overrides.parent_id ?? post.parent_id ?? "",
    root_post_id: overrides.root_post_id ?? post.root_post_id ?? "",
    original_post_id: overrides.original_post_id ?? post.original_post_id ?? "",
    source_post_id: overrides.source_post_id ?? post.source_post_id ?? "",
    split_from_post_id: overrides.split_from_post_id ?? post.split_from_post_id ?? "",
    account_id: overrides.account_id ?? post.account_id ?? "",
    account_email: overrides.account_email ?? post.account_email ?? "",
    folder_path: overrides.folder_path ?? post.folder_path,
    collection: overrides.collection ?? post.collection ?? null,
    representative,
    items: items.map(serializableMediaItem),
  };
}

function collectionMergeCandidates(collection, sourcePost) {
  const originKey = postOriginKey(sourcePost);
  if (!originKey) return [];
  return (collection?.posts || []).filter((post) => {
    return post.folder_path !== sourcePost.folder_path && postHasOrigin(post, originKey);
  });
}

async function writeSplitTargetPost({ sourcePost, selectedItem, collection, mergePost = null }) {
  const originKey = postOriginKey(sourcePost);
  const selectedKey = mediaItemKey(selectedItem);
  if (mergePost?.items?.some((item) => mediaItemKey(item) === selectedKey)) {
    const postJson = postJsonFromPost(mergePost);
    await writeJsonFile(mergePost.directoryHandle, "post.json", postJson);
    return postJson;
  }
  const targetHandle = mergePost
    ? mergePost.directoryHandle
    : await collection.handle.getDirectoryHandle(
      await uniqueDirectoryName(collection.handle, `${sourcePost.post_id || originKey}-split`),
      { create: true },
    );
  const copiedFile = selectedItem.file
    ? await copyFileToDirectory(sourcePost.directoryHandle, selectedItem.file, targetHandle)
    : "";
  if (selectedItem.file && !copiedFile && !selectedItem.url) {
    throw new Error("Selected media file was not found.");
  }
  const movedItem = serializableMediaItem({
    ...selectedItem,
    file: copiedFile || selectedItem.file || "",
  });

  if (mergePost) {
    const mergedItems = [
      ...(mergePost.items || []).map(serializableMediaItem),
      movedItem,
    ].filter((item, index, list) => {
      const key = mediaItemKey(item);
      return key && list.findIndex((candidate) => mediaItemKey(candidate) === key) === index;
    });
    const postJson = postJsonFromPost(mergePost, {
      items: mergedItems,
      representative: mergePost.representative || movedItem.file || movedItem.url,
    });
    await writeJsonFile(targetHandle, "post.json", postJson);
    return postJson;
  }

  const targetName = targetHandle.name;
  const targetPath = `${collection.path}/${targetName}`;
  const postJson = postJsonFromPost(sourcePost, {
    post_id: targetName,
    folder_path: targetPath,
    collection: collection.id,
    items: [movedItem],
    representative: movedItem.file || movedItem.url,
    original_post_id: sourcePost.original_post_id || sourcePost.post_id,
    source_post_id: sourcePost.post_id,
    split_from_post_id: originKey,
    group_id: sourcePost.group_id || originKey,
  });
  await writeJsonFile(targetHandle, "post.json", postJson);
  return postJson;
}

async function removeItemFromSourcePost(post, selectedItem) {
  const selectedKey = mediaItemKey(selectedItem);
  const remainingItems = (post.items || []).filter((item) => mediaItemKey(item) !== selectedKey);
  const stillUsesFile = remainingItems.some((item) => item.file && item.file === selectedItem.file);
  if (selectedItem.file && !stillUsesFile) {
    try {
      await post.directoryHandle.removeEntry(selectedItem.file);
    } catch {
      // The post json is still updated even if the file was already gone.
    }
  }
  if (!remainingItems.length) {
    await post.parentHandle.removeEntry(post.folderName, { recursive: true });
    return;
  }
  await writeJsonFile(post.directoryHandle, "post.json", postJsonFromPost(post, {
    items: remainingItems,
    representative: remainingItems[0]?.file || remainingItems[0]?.url || "",
  }));
}

async function copyDirectory(sourceHandle, targetParentHandle, targetName) {
  const targetHandle = await targetParentHandle.getDirectoryHandle(targetName, { create: true });
  for (const entry of await sortedDirectoryEntries(sourceHandle)) {
    if (entry.kind === "directory") {
      await copyDirectory(entry, targetHandle, entry.name);
    } else {
      const file = await entry.getFile();
      const fileHandle = await targetHandle.getFileHandle(entry.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    }
  }
  return targetHandle;
}
