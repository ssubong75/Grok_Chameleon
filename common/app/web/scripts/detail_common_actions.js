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

let detailFrameCaptureBusy = false;

async function captureSelectedDetailFrame() {
  if (detailFrameCaptureBusy) return;
  const screen = screen_state.current_screen;
  if (!["i_detail", "b_detail"].includes(screen)) return;
  const { post, item } = selectedDetailSourceContext();
  const video = currentDetailVideoElement();
  if (!library_state.apiReady || detailItemType(item) !== "video" || !video) {
    throw new Error("Select a playable video first.");
  }
  const selectedPath = library_state.selectedPostPath;
  const selectedId = library_state.selectedDetailItemId;
  const stillSelected = () => screen_state.current_screen === screen
    && library_state.selectedPostPath === selectedPath
    && library_state.selectedDetailItemId === selectedId;
  const buttons = document.querySelectorAll(".i_detail_capture_frame, .b_detail_capture_frame");
  detailFrameCaptureBusy = true;
  buttons.forEach((button) => { button.disabled = true; });
  try {
    video.pause();
    // A scrub can still be decoding when the user clicks the capture button.
    if (video.seeking || video.readyState < 2) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          window.clearTimeout(timer);
          ["seeked", "loadeddata", "canplay"].forEach((event) => video.removeEventListener(event, ready));
          video.removeEventListener("error", failed);
          error ? reject(error) : resolve();
        };
        const ready = () => { if (!video.seeking && video.readyState >= 2) finish(); };
        const failed = () => finish(new Error("The video frame could not be loaded."));
        const timer = window.setTimeout(failed, 10000);
        ["seeked", "loadeddata", "canplay"].forEach((event) => video.addEventListener(event, ready));
        video.addEventListener("error", failed);
        ready();
      });
    }
    if (!stillSelected() || currentDetailVideoElement() !== video) {
      throw new Error("The selected video changed. Please capture the frame again.");
    }
    video.pause();
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height || video.readyState < 2) throw new Error("The video frame is not ready yet.");
    const time = video.currentTime;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Frame capture is unavailable.");
    context.drawImage(video, 0, 0, width, height);
    const image = canvas.toDataURL("image/png");
    const name = `${sanitizeDownloadName(item.file || item.item_id || "video").replace(/\.[^.]+$/, "")}_frame_${time.toFixed(3).replace(".", "-")}.png`;
    const imagine = screen === "i_detail";
    const data = await qApi(imagine ? "/api/uploads/save" : "/api/library/capture-frame", imagine ? {
      provider: "imagine",
      to_card: false,
      files: [{ name, type: "image/png", data_url: image }],
    } : {
      post_path: post.folder_path,
      item_key: mediaItemKey(item),
      image,
      time,
    });
    // Snapshot rendering normally recreates and autoplays the player. Keep the current
    // player so saving a frame does not lose its paused position or interrupt a new view.
    const retainedPlayer = stillSelected() ? currentDetailVideoPlayer() : null;
    applyLibrarySnapshot(data);
    if (retainedPlayer && stillSelected()) {
      const replacement = currentDetailVideoPlayer();
      if (replacement && replacement !== retainedPlayer) {
        replacement.querySelector("video")?.pause();
        replacement.replaceWith(retainedPlayer);
      }
    }
    if (imagine) {
      const saved = data.saved?.[0];
      if (!saved?.item || !saved?.folder_path || !saved?.item_id) {
        throw new Error("The saved frame could not be added to the upload list.");
      }
      const key = composerUploadAttachmentKey(saved.folder_path, saved.item_id);
      if (stillSelected() && composerState.provider === "imagine"
        && composerAttachments.length < composerAttachmentLimit()
        && !composerAttachments.some((attachment) => composerAttachmentKey(attachment) === key)) {
        composerAttachments.push({
          name: saved.item.file || name,
          type: "image/png",
          size: saved.item.size || 0,
          data_url: image,
          preview_url: saved.item.object_url,
          source_url: saved.item.object_url,
          upload_post_path: saved.folder_path,
          upload_item_id: saved.item_id,
          aspect_ratio: `${width}:${height}`,
          role: ["image", "analyze"].includes(composerState.mode) ? "source" : "reference",
        });
      }
      renderComposerAttachments();
    }
    toast(imagine ? "Frame saved to uploads." : "Frame saved to this folder.");
  } finally {
    detailFrameCaptureBusy = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

let detailAudioExtractionBusy = false;
async function extractSelectedDetailAudio(prefix) {
  if (detailAudioExtractionBusy) return;
  let post = selectedLibraryPost();
  if (post?.is_job_post) post = post.base_post;
  const item = selectedDetailItem(post);
  if (!item || detailItemType(item) !== "video") return;
  const url = detailMediaUrlForItem(prefix, item, post);
  if (!url) throw new Error("선택한 영상 파일을 찾을 수 없습니다.");
  if (!window.grokChameleonNative?.extractAudio) throw new Error("오디오 추출 기능을 사용하려면 앱을 다시 실행해 주세요.");
  const buttons = document.querySelectorAll(".i_detail_extract_audio, .b_detail_extract_audio");
  detailAudioExtractionBusy = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await window.grokChameleonNative.extractAudio({
      provider: prefix === "i" ? "imagine" : "build", url,
      name: item.file || item.title || post.title || "video",
    });
    if (!result.cancelled) toast(`오디오 저장 완료: ${result.path}`);
  } finally {
    detailAudioExtractionBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

function bindDetailCommonActions() {
  for (const prefix of ["i", "b"]) {
    document.querySelector(`.${prefix}_detail_extract_audio`)?.addEventListener("click", () => {
      extractSelectedDetailAudio(prefix).catch(error => showErrorPanel("오디오 추출 실패", error.message));
    });
  }
  for (const selector of [".i_detail_capture_frame", ".b_detail_capture_frame"]) {
    document.querySelector(selector)?.addEventListener("click", () => {
      captureSelectedDetailFrame().catch((error) => {
        console.warn(error);
        showErrorPanel("Frame capture failed", error?.message || "Frame capture failed.");
      });
    });
  }
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
