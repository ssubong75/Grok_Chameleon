// Shared detail download and move actions
function confirmDeleteAction({ title, message }) {
  if (typeof confirmAction === "function") {
    return confirmAction({ title, message, confirmLabel: "Delete" });
  }
  return Promise.resolve(window.confirm(message));
}

function downloadFileNameFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    const sourceUrl = parsed.searchParams.get("url");
    if (sourceUrl) return downloadFileNameFromUrl(sourceUrl);
    const mediaPath = parsed.pathname === "/api/media" ? parsed.searchParams.get("path") : "";
    const segments = decodeURIComponent(mediaPath || parsed.pathname).split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    // Every generated asset is served as .../generated/<assetId>/image.jpg, so the last
    // segment names the file the same way for all of them and a folder of downloads came out
    // as image.jpg, image-1.jpg and so on. The id is the segment before it.
    const parent = segments[segments.length - 2] || "";
    if (parent && /^[0-9a-f-]{32,36}$/i.test(parent)) {
      const dot = last.lastIndexOf(".");
      return sanitizeDownloadName(dot > 0 ? `${parent}${last.slice(dot)}` : parent);
    }
    return sanitizeDownloadName(last);
  } catch {
    const name = decodeURIComponent(raw.split("?")[0].split("/").filter(Boolean).pop() || "");
    return sanitizeDownloadName(name);
  }
}

function sanitizeDownloadName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "");
}

function downloadUrlForItem(item) {
  return item?.object_url || item?.local_url || item?.url || item?.media_url || item?.mediaUrl || "";
}

function downloadName(item) {
  const url = downloadUrlForItem(item);
  const name = sanitizeDownloadName(item?.file || downloadFileNameFromUrl(url) || item?.title || item?.item_id || "grok-media");
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const type = String(item?.type || "").toLowerCase();
  return `${name}.${type === "video" ? "mp4" : "jpg"}`;
}

function sameOriginDownloadUrl(url) {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function uniqueDownloadItems(items = []) {
  const unique = new Map();
  for (const item of items || []) {
    const url = downloadUrlForItem(item);
    if (!url) continue;
    const key = mediaItemKey(item) || url;
    if (!unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

function browserDownloadItem(item) {
  const url = downloadUrlForItem(item);
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadName(item);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadLibraryItems(items = []) {
  const unique = uniqueDownloadItems(items);
  if (!unique.length) {
    showErrorPanel("Download unavailable", "No downloadable media.");
    return;
  }
  const localItems = unique.filter((item) => sameOriginDownloadUrl(downloadUrlForItem(item)));
  const remoteItems = unique.filter((item) => !sameOriginDownloadUrl(downloadUrlForItem(item)));
  localItems.forEach((item, index) => {
    window.setTimeout(() => browserDownloadItem(item), index * 120);
  });
  if (!remoteItems.length) return;
  const data = await qApi("/api/library/download-items", {
    items: remoteItems.map((item) => ({
      id: mediaItemKey(item),
      item_id: item.item_id || mediaItemKey(item),
      type: item.type || mediaTypeForName(item.file || item.url || "") || "image",
      file: item.file || "",
      title: item.title || "",
      url: downloadUrlForItem(item),
    })),
    current: localStorage.getItem("grokStudioDownloadFolder") || "",
  });
  if (data.cancelled) return;
  if (data.folder) localStorage.setItem("grokStudioDownloadFolder", data.folder);
  if (Number(data.failed_count || 0) > 0) {
    showErrorPanel("Download failed", `Downloaded ${Number(data.count || 0)} item(s), ${Number(data.failed_count || 0)} failed.`);
  }
}

function downloadLibraryCardPost(post) {
  return downloadLibraryItems(post?.items || []);
}

function downloadSelectedDetailItem() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  return downloadLibraryItems(item ? [item] : []);
}

function moveSelectedDetailItemToCollection() {
  try {
    openMoveToCollectionDialogForDetail();
  } catch (error) {
    console.warn(error);
    setLibraryMessage("Move failed.");
  }
}

function bindDetailCommonActions() {
  for (const selector of [".i_detail_move", ".b_detail_move"]) {
    document.querySelector(selector)?.addEventListener("click", moveSelectedDetailItemToCollection);
  }
  for (const selector of [".i_detail_download", ".b_detail_download"]) {
    document.querySelector(selector)?.addEventListener("click", () => {
      downloadSelectedDetailItem().catch((error) => {
        console.warn(error);
        showErrorPanel("Download failed", error?.message || "Download failed.");
      });
    });
  }
}

bindDetailCommonActions();
