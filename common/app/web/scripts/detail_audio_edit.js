let detailAudioEditor = null;

function detailAudioClipId() {
  return Math.random().toString(36).slice(2, 10);
}

function detailAudioNative() {
  return window.grokChameleonNative;
}

function closeDetailAudioEditor() {
  const editor = detailAudioEditor;
  if (!editor) return;
  detailAudioEditor = null;
  cancelAnimationFrame(editor.frame || 0);
  editor.video?.removeEventListener("timeupdate", editor.onTime);
  editor.video?.removeEventListener("seeked", editor.onTime);
  editor.video?.removeEventListener("play", editor.onPlay);
  editor.player?.removeEventListener("click", editor.onPlayClick, true);
  const seek = editor.player?.querySelector(".video-seek");
  seek?.removeEventListener("input", editor.onSeek, true);
  seek?.removeEventListener("change", editor.onSeek, true);
  if (editor.video && editor.previousLoop != null) editor.video.loop = editor.previousLoop;
  document.removeEventListener("pointermove", editor.onPointerMove);
  document.removeEventListener("pointerup", editor.onPointerUp);
  document.removeEventListener("keydown", editor.onKey);
  editor.previewNodes?.forEach((node) => {
    node.element.pause();
    node.element.src = "";
  });
  editor.blobUrls?.forEach((url) => URL.revokeObjectURL(url));
  editor.audioContext?.close().catch(() => {});
  editor.picture?.pause();
  editor.picture?.remove();
  editor.video?.classList.remove("audio_edit_source_hidden");
  editor.black?.remove();
  editor.panel?.remove();
  document.querySelectorAll(".i_detail_extract_audio, .b_detail_extract_audio").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
  });
  if (editor.video) editor.video.muted = editor.previousMuted;
}

function retainedDetailAudioPlayer(prefix, item) {
  const editor = detailAudioEditor;
  const player = editor?.player;
  if (!player || editor.prefix !== prefix) return null;
  const key = typeof mediaItemKey === "function" ? mediaItemKey(item) : "";
  const openKey = typeof mediaItemKey === "function" ? mediaItemKey(editor.payload?.item) : "";
  if (!key || key !== openKey) return null;
  return player;
}

function releaseDetailAudioEditorIfHost(media) {
  const player = detailAudioEditor?.player;
  if (!player || !media?.contains(player)) return;
  closeDetailAudioEditor();
}

function detailAudioPayload(prefix) {
  let post = selectedLibraryPost();
  if (post?.is_job_post) post = post.base_post;
  const item = selectedDetailItem(post);
  if (!item || detailItemType(item) !== "video") throw new Error("영상을 연 뒤에 사용할 수 있습니다.");
  const url = detailMediaUrlForItem(prefix, item, post);
  if (!url) throw new Error("선택한 영상 파일을 찾을 수 없습니다.");
  return {
    provider: prefix === "i" ? "imagine" : "build",
    url,
    post,
    item,
    name: item.file || item.title || post?.title || "video",
  };
}

async function openDetailAudioEditor(prefix) {
  const player = document.querySelector(`.${prefix}_detail_media .video-player`);
  const video = player?.querySelector("video");
  if (!player || !video) throw new Error("재생 중인 영상이 없습니다.");
  if (detailAudioEditor?.video === video) {
    closeDetailAudioEditor();
    return;
  }
  closeDetailAudioEditor();
  if (!detailAudioNative()?.audioPeaks) throw new Error("비디오 편집을 쓰려면 앱을 다시 실행해 주세요.");
  const payload = detailAudioPayload(prefix);
  const button = document.querySelector(`.${prefix}_detail_extract_audio`);
  if (button) button.setAttribute("aria-pressed", "true");
  const panel = document.createElement("section");
  panel.className = "audio_edit";
  panel.innerHTML = `
    <div class="audio_edit_bar">
      <div class="audio_edit_target">
        <button type="button" data-target="both" class="is-selected">Both</button>
        <button type="button" data-target="audio">Audio</button>
        <button type="button" data-target="video">Video</button>
      </div>
      <div class="audio_edit_tools">
        <button class="audio_edit_magnetic" type="button" aria-pressed="true">Magnetic<span class="audio_edit_check" aria-hidden="true"></span></button>
        <button class="audio_edit_add" type="button" aria-label="Add audio" title="Add audio"></button>
        <button class="audio_edit_extract" type="button" aria-label="Audio Extract" title="Audio Extract">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6"></path><path d="M11 6h7v7"></path></svg>
        </button>
        <button class="audio_edit_save" type="button" aria-label="Save" title="Save"><span>save</span></button>
      </div>
    </div>
    <div class="audio_edit_shield"></div>
    <canvas class="audio_edit_wave"></canvas>
  `;
  const black = document.createElement("div");
  black.className = "audio_edit_black";
  black.hidden = true;
  const picture = document.createElement("video");
  picture.className = "audio_edit_picture";
  picture.playsInline = true;
  picture.muted = true;
  picture.preload = "auto";
  player.append(black, picture, panel);
  const editor = {
    prefix,
    payload,
    player,
    video,
    panel,
    canvas: panel.querySelector("canvas"),
    previousMuted: video.muted,
    duration: Number(video.duration) || 0,
    magnetic: true,
    target: "both",
    selection: null,
    audioClips: [],
    videoClips: [],
    clipboard: null,
    gesture: null,
    previewNodes: [],
    blobUrls: [],
    black,
    picture,
    mediaUrl: video.currentSrc || video.src,
    time: Number(video.currentTime) || 0,
    running: false,
  };
  detailAudioEditor = editor;
  editor.onTime = () => {
    if (detailAudioEditor !== editor) return;
    if (!detailTimelineCustom(editor)) editor.time = editor.video.currentTime || 0;
    syncDetailAudioPreview();
    drawDetailAudioEditor();
    paintDetailTimelineChrome(editor);
  };
  editor.onPointerMove = (event) => moveDetailAudioGesture(event);
  editor.onPointerUp = (event) => finishDetailAudioGesture(event);
  editor.onKey = (event) => handleDetailAudioKey(event);
  video.addEventListener("timeupdate", editor.onTime);
  video.addEventListener("seeked", editor.onTime);
  editor.onPlay = () => {
    if (detailAudioEditor !== editor) return;
    editor.holdClock = false;
  };
  video.addEventListener("play", editor.onPlay);
  document.addEventListener("pointermove", editor.onPointerMove);
  document.addEventListener("pointerup", editor.onPointerUp);
  document.addEventListener("keydown", editor.onKey);
  bindDetailAudioEditor(editor);
  if (!editor.duration || !Number.isFinite(editor.duration)) {
    await new Promise((resolve) => {
      if (video.duration) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    editor.duration = Number(video.duration) || 0;
  }
  editor.mediaDuration = editor.duration;
  editor.videoClips = [makeDetailVideoClip(0, 0, editor.duration, "original", editor.duration)];
  drawDetailAudioEditor();
  const info = await detailAudioNative().audioPeaks(payload);
  if (detailAudioEditor !== editor) return;
  editor.duration = Number(info.duration) || editor.duration;
  editor.mediaDuration = editor.duration;
  editor.info = info;
  editor.audioClips = info.hasAudio ? [makeDetailAudioClip("original", 0, editor.duration, info.peaks, editor.duration)] : [];
  editor.audioClips.forEach((clip) => { clip.vIndex = 1; });
  if (editor.videoClips.length === 1 && editor.videoClips[0].start === 0 && editor.videoClips[0].inPoint === 0) {
    editor.videoClips[0].duration = editor.duration;
    editor.videoClips[0].mediaDuration = editor.duration;
    editor.videoClips[0].vIndex = 1;
  }
  drawDetailAudioEditor();
}

function makeDetailAudioClip(source, start, duration, peaks, mediaDuration, inPoint = 0, gain = 1) {
  return {
    id: detailAudioClipId(),
    source,
    start,
    inPoint,
    duration,
    gain,
    peaks: peaks || [],
    mediaDuration: mediaDuration || duration,
  };
}

function makeDetailVideoClip(start, inPoint, duration, source = "original", mediaDuration = duration) {
  return { id: detailAudioClipId(), start, inPoint, duration, source, mediaDuration, group: "" };
}

function bindDetailAudioEditor(editor) {
  const panel = editor.panel;
  panel.querySelector(".audio_edit_magnetic").addEventListener("click", (event) => {
    event.stopPropagation();
    editor.magnetic = !editor.magnetic;
    const button = event.currentTarget;
    button.setAttribute("aria-pressed", String(editor.magnetic));
  });
  panel.querySelector(".audio_edit_add").addEventListener("click", (event) => {
    event.stopPropagation();
    addDetailAudioFromDialog().catch((error) => showErrorPanel("오디오 추가 실패", error.message));
  });
  panel.querySelector(".audio_edit_extract").addEventListener("click", (event) => {
    event.stopPropagation();
    extractSelectedDetailAudio(editor.prefix).catch((error) => showErrorPanel("오디오 추출 실패", error.message));
  });
  panel.querySelector(".audio_edit_save").addEventListener("click", (event) => {
    event.stopPropagation();
    saveDetailAudioEditor().catch((error) => showErrorPanel("비디오 편집 저장 실패", error.message));
  });
  panel.querySelectorAll(".audio_edit_target button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editor.target = button.dataset.target;
      drawDetailAudioEditor();
    });
  });
  editor.canvas.addEventListener("pointermove", (event) => {
    if (editor.gesture) return;
    if (detailAudioHandleAt(event)) editor.canvas.style.cursor = "ew-resize";
    else if (detailAudioClipAtTime(detailAudioTimeAt(event))) editor.canvas.style.cursor = "grab";
    else editor.canvas.style.cursor = "crosshair";
  });
  editor.canvas.addEventListener("pointerdown", (event) => {
    if (!editor.duration) return;
    editor.canvas.setPointerCapture?.(event.pointerId);
    const time = detailAudioTimeAt(event);
    const handle = detailAudioHandleAt(event);
    const trimIds = handle ? detailAudioTrimIds(handle.clip) : [];
    const clip = trimIds.length ? null : detailAudioClipAtTime(time);
    const moveIds = clip ? detailAudioTrimIds(clip) : [];
    editor.gesture = {
      x: event.clientX,
      y: event.clientY,
      shift: event.shiftKey,
      time,
      inside: false,
      mode: trimIds.length ? "trim" : "pending",
      trimEdge: handle?.edge || "",
      trimIds,
      trimBases: trimIds.length ? detailAudioTrimBases(handle.clip) : null,
      moveIds,
      audio: cloneDetailClips(editor.audioClips),
      video: cloneDetailClips(editor.videoClips),
    };
    if (!trimIds.length && !moveIds.length) seekDetailAudioTime(time);
  });
  panel.querySelector(".audio_edit_shield").addEventListener("click", (event) => {
    event.stopPropagation();
  });
  panel.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const time = detailAudioTimeAt(event);
    const attached = event.dataTransfer?.getData("application/x-gc-detail-attach");
    if (attached) {
      addDetailAudioFromMedia(attached, time).catch((error) => showErrorPanel("첨부 실패", error.message));
      return;
    }
    const files = [...(event.dataTransfer?.files || [])];
    addDetailAudioPaths(files.map((file) => file.path).filter(Boolean), time)
      .catch((error) => showErrorPanel("첨부 실패", error.message));
  });
  window.addEventListener("resize", drawDetailAudioEditor);
}

function cloneDetailClips(clips) {
  return clips.map((clip) => ({ ...clip }));
}

function detailAudioTimeAt(event) {
  const editor = detailAudioEditor;
  const rect = editor.canvas.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1)));
  return ratio * editor.duration;
}

function detailAudioSelectionRange() {
  const selection = detailAudioEditor?.selection;
  if (!selection || !detailAudioEditor.duration) return null;
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (end - start < 0.04) return null;
  return { start, end };
}

function detailAudioTimeInsideSelection(time) {
  const range = detailAudioSelectionRange();
  return Boolean(range && time >= range.start && time <= range.end);
}

function moveDetailAudioGesture(event) {
  const editor = detailAudioEditor;
  const gesture = editor?.gesture;
  if (!gesture) return;
  if (gesture.mode === "trim") {
    applyDetailAudioTrim(gesture, detailAudioTimeAt(event));
    return;
  }
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (gesture.mode === "pending") {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (gesture.moveIds?.length) gesture.mode = "move";
    else return;
  }
  if (gesture.mode === "select") return;
  const seconds = (dx / Math.max(editor.canvas.getBoundingClientRect().width, 1)) * editor.duration;
  if (gesture.mode === "move" || gesture.mode === "copy") {
    applyDetailAudioShift(gesture, seconds);
    return;
  }
  if (gesture.mode === "volume") {
    const range = detailAudioSelectionRange();
    editor.audioClips.forEach((clip, index) => {
      if (!range || !clipIntersects(clip, range.start, range.end)) return;
      clip.gain = Math.min(4, Math.max(0, gesture.gains[index] + (-dy / 140)));
    });
    drawDetailAudioEditor();
  }
}

function finishDetailAudioGesture(event) {
  const editor = detailAudioEditor;
  const gesture = editor?.gesture;
  if (!gesture) return;
  editor.gesture = null;
  if (gesture.mode === "trim" || gesture.mode === "move" || gesture.mode === "copy") {
    refreshDetailTimeline(editor);
  } else if (gesture.mode === "pending") {
    seekDetailAudioTime(gesture.time);
  } else if (gesture.mode === "select" && editor.selection && editor.selection.end < editor.selection.start) {
    editor.selection = { start: editor.selection.end, end: editor.selection.start };
  }
  syncDetailAudioPreview();
  drawDetailAudioEditor();
}

function detailAudioTargetClips() {
  const editor = detailAudioEditor;
  if (editor.target === "audio") return { audio: editor.audioClips, video: [] };
  if (editor.target === "video") return { audio: [], video: editor.videoClips };
  return { audio: editor.audioClips, video: editor.videoClips };
}

function clipIntersects(clip, start, end) {
  return clip.start < end && clip.start + clip.duration > start;
}

function beginDetailAudioCopy(gesture) {
  const editor = detailAudioEditor;
  const range = { start: Math.min(gesture.time, gesture.time), end: Math.max(gesture.time, gesture.time) };
  const selection = detailAudioSelectionRange() || range;
  const copies = sliceDetailClips(editor.audioClips, editor.videoClips, selection.start, selection.end);
  const groups = new Map();
  [...copies.audio, ...copies.video].forEach((clip) => {
    if (!clip.group) return;
    if (!groups.has(clip.group)) groups.set(clip.group, detailAudioClipId());
    clip.group = groups.get(clip.group);
  });
  assignFreshDetailVIndexes(editor, [...copies.audio, ...copies.video]);
  copies.audio.forEach((clip) => editor.audioClips.push(clip));
  copies.video.forEach((clip) => editor.videoClips.push(clip));
  gesture.copyIds = new Set([...copies.audio, ...copies.video].map((clip) => clip.id));
}

function sliceDetailClips(audioClips, videoClips, start, end) {
  const targets = detailAudioTargetClips();
  const sliceOne = (clip) => {
    const from = Math.max(clip.start, start);
    const to = Math.min(clip.start + clip.duration, end);
    if (to - from < 0.04) return null;
    return {
      ...clip,
      id: detailAudioClipId(),
      start: from,
      inPoint: clip.inPoint + (from - clip.start),
      duration: to - from,
      preview: null,
    };
  };
  return {
    audio: targets.audio.includes(audioClips[0]) || editorUsesAudio(targets, audioClips)
      ? audioClips.map(sliceOne).filter(Boolean)
      : [],
    video: targets.video.length ? videoClips.map(sliceOne).filter(Boolean) : [],
  };
}

function editorUsesAudio(targets, audioClips) {
  return targets.audio === audioClips;
}

function applyDetailAudioShift(gesture, seconds) {
  const editor = detailAudioEditor;
  if (!gesture.bases) gesture.bases = detailAudioMoveBases(gesture);
  const delta = snapDetailAudioDelta(gesture.bases, seconds);
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    if (!gesture.bases.has(clip.id)) return;
    const base = gesture.bases.get(clip.id);
    clip.start = Math.max(0, base + delta);
  });
  drawDetailAudioEditor();
}

function detailAudioMoveBases(gesture) {
  const editor = detailAudioEditor;
  const bases = new Map();
  if (gesture.moveIds?.length && gesture.mode === "move") {
    gesture.moveIds.forEach((id) => {
      const clip = [...editor.audioClips, ...editor.videoClips].find((item) => item.id === id);
      if (clip) bases.set(id, clip.start);
    });
    return bases;
  }
  if (gesture.mode === "copy") {
    gesture.copyIds?.forEach((id) => {
      const clip = [...editor.audioClips, ...editor.videoClips].find((item) => item.id === id);
      if (clip) bases.set(id, clip.start);
    });
    return bases;
  }
  const range = detailAudioSelectionRange();
  const add = (clips) => clips.forEach((clip) => {
    if (range && clipIntersects(clip, range.start, range.end)) bases.set(clip.id, clip.start);
  });
  if (editor.target !== "video") add(gesture.audio);
  if (editor.target !== "audio") add(gesture.video);
  return bases;
}

function snapDetailAudioDelta(bases, delta) {
  const editor = detailAudioEditor;
  if (!editor.magnetic) return delta;
  const width = Math.max(editor.canvas.getBoundingClientRect().width, 1);
  const threshold = Math.max(0.05, (10 / width) * editor.duration);
  const points = [0, editor.duration, detailAudioNow()];
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    if (bases.has(clip.id)) return;
    points.push(clip.start, clip.start + clip.duration);
  });
  let best = delta;
  let bestDistance = threshold;
  bases.forEach((start, id) => {
    const clip = [...editor.audioClips, ...editor.videoClips].find((item) => item.id === id);
    if (!clip) return;
    [start + delta, start + clip.duration + delta].forEach((edge) => {
      points.forEach((point) => {
        const distance = Math.abs(edge - point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = delta + (point - edge);
        }
      });
    });
  });
  return best;
}

function handleDetailAudioKey(event) {
  const editor = detailAudioEditor;
  if (!editor || event.target?.closest("input, textarea")) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "c") {
    event.preventDefault();
    copyDetailAudioSelection(false);
  } else if ((event.ctrlKey || event.metaKey) && key === "x") {
    event.preventDefault();
    copyDetailAudioSelection(true);
  } else if ((event.ctrlKey || event.metaKey) && key === "v") {
    event.preventDefault();
    pasteDetailAudioClipboard();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteDetailAudioSelection();
  } else if (event.key === "Escape") {
    editor.selection = null;
    drawDetailAudioEditor();
  }
}

function copyDetailAudioSelection(remove) {
  const range = detailAudioSelectionRange();
  if (!range) return;
  const editor = detailAudioEditor;
  const copies = sliceDetailClips(editor.audioClips, editor.videoClips, range.start, range.end);
  editor.clipboard = {
    audio: copies.audio,
    video: copies.video,
    start: range.start,
  };
  if (remove) deleteDetailAudioSelection();
}

function pasteDetailAudioClipboard() {
  const editor = detailAudioEditor;
  const clipboard = editor?.clipboard;
  if (!clipboard) return;
  const at = detailAudioNow();
  const groups = new Map();
  const regroup = (group) => {
    if (!group) return "";
    if (!groups.has(group)) groups.set(group, detailAudioClipId());
    return groups.get(group);
  };
  let nextLabel = nextDetailVIndex(editor);
  const labels = new Map();
  const labelFor = (clip) => {
    const key = clip.group || `v${clip.vIndex || clip.id}`;
    if (!labels.has(key)) {
      labels.set(key, nextLabel);
      nextLabel += 1;
    }
    return labels.get(key);
  };
  clipboard.audio.forEach((clip) => {
    const copy = { ...clip, id: detailAudioClipId(), preview: null, vIndex: labelFor(clip), group: regroup(clip.group), start: Math.max(0, clip.start - clipboard.start + at) };
    editor.audioClips.push(copy);
  });
  clipboard.video.forEach((clip) => {
    const copy = { ...clip, id: detailAudioClipId(), vIndex: labelFor(clip), group: regroup(clip.group), start: Math.max(0, clip.start - clipboard.start + at) };
    editor.videoClips.push(copy);
  });
  refreshDetailTimeline(editor);
  syncDetailAudioPreview();
  drawDetailAudioEditor();
}

function deleteDetailAudioSelection() {
  const range = detailAudioSelectionRange();
  const editor = detailAudioEditor;
  if (!range || !editor) return;
  if (editor.target !== "video") editor.audioClips = removeDetailClipRange(editor.audioClips, range.start, range.end);
  if (editor.target !== "audio") editor.videoClips = removeDetailClipRange(editor.videoClips, range.start, range.end);
  editor.selection = null;
  refreshDetailTimeline(editor);
  syncDetailAudioPreview();
  drawDetailAudioEditor();
}

function removeDetailClipRange(clips, start, end) {
  const next = [];
  clips.forEach((clip) => {
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= start || clip.start >= end) {
      next.push(clip);
      return;
    }
    if (clip.start < start) next.push({ ...clip, duration: start - clip.start });
    if (clipEnd > end) {
      next.push({
        ...clip,
        id: detailAudioClipId(),
        preview: null,
        start: end,
        inPoint: clip.inPoint + (end - clip.start),
        duration: clipEnd - end,
      });
    }
  });
  return next;
}

async function addDetailAudioFromDialog() {
  const selected = await detailAudioNative().pickAudioFiles();
  if (!selected || selected.cancelled) return;
  const editor = detailAudioEditor;
  await addDetailAudioPaths(selected.paths, detailAudioNow());
}

async function addDetailAudioFromMedia(raw, time) {
  const payload = JSON.parse(raw);
  const info = await detailAudioNative().audioPeaks(payload);
  if (!info?.path) throw new Error("파일을 찾지 못했습니다.");
  if (!info.hasAudio && !detailAudioIsVideo(info.path)) throw new Error("이 영상에는 오디오가 없습니다.");
  await addDetailAudioPaths([info.path], time, { mediaUrl: payload.url || "" });
}

document.addEventListener("dragstart", (event) => {
  const thumb = event.target?.closest?.(".i_detail_thumb_video, .b_detail_thumb_video");
  if (!thumb || thumb.dataset.buildJobId || !event.dataTransfer) return;
  const prefix = thumb.classList.contains("i_detail_thumb") ? "i" : "b";
  let post = selectedLibraryPost();
  if (post?.is_job_post) post = post.base_post;
  const item = (post?.items || []).find((entry) => mediaItemKey(entry) === thumb.dataset.libraryItemId);
  if (!item || detailItemType(item) !== "video") return;
  const url = detailMediaUrlForItem(prefix, item, post);
  if (!url) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-gc-detail-attach", JSON.stringify({
    provider: prefix === "i" ? "imagine" : "build",
    url,
  }));
});

async function addDetailAudioPaths(paths, time, options = {}) {
  const editor = detailAudioEditor;
  if (!editor) return;
  let cursor = Math.max(0, time);
  for (const filePath of paths) {
    const info = await detailAudioNative().localAudioPeaks({ path: filePath });
    const file = await detailAudioNative().readAudioFile({ path: filePath, includeVideo: !options.mediaUrl });
    if (detailAudioEditor !== editor) return;
    const hasAudio = info.hasAudio !== false && file.hasAudio !== false;
    let blobUrl = "";
    if (hasAudio && file.bytes) {
      const bytes = detailAudioBytes(file.bytes);
      if (bytes.length) {
        blobUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime || "audio/mpeg" }));
        editor.blobUrls.push(blobUrl);
      }
    }
    let mediaUrl = options.mediaUrl || "";
    if (!mediaUrl && file.videoBytes) {
      const videoBytes = detailAudioBytes(file.videoBytes);
      if (videoBytes.length) {
        mediaUrl = URL.createObjectURL(new Blob([videoBytes], { type: file.videoMime || "video/mp4" }));
        editor.blobUrls.push(mediaUrl);
      }
    }
    cursor = placeDetailAttachment(editor, {
      path: file.path || info.path || filePath,
      duration: Number(info.duration) || 0,
      peaks: info.peaks || [],
      hasAudio: Boolean(blobUrl),
    }, blobUrl, cursor, mediaUrl);
  }
  refreshDetailTimeline(editor);
  syncDetailAudioPreview();
  drawDetailAudioEditor();
}

function detailAudioNow() {
  const editor = detailAudioEditor;
  if (!editor) return 0;
  if (detailTimelineCustom(editor)) return editor.time || 0;
  return editor.video.currentTime || 0;
}

function seekDetailAudioTime(time) {
  const editor = detailAudioEditor;
  if (!editor) return;
  const next = Math.max(0, time);
  editor.time = editor.duration ? Math.min(editor.duration, next) : next;
  editor.holdClock = false;
  if (detailTimelineCustom(editor)) {
    presentDetailTimeline(editor, editor.running);
    syncDetailAudioPreview();
    drawDetailAudioEditor();
    paintDetailTimelineChrome(editor);
    return;
  }
  const media = editor.video.duration || 0;
  editor.video.currentTime = media ? Math.min(media, editor.time) : editor.time;
}

function detailAudioBytes(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value.data || value);
}

function detailAudioIsVideo(filePath) {
  return /\.(mp4|mov|m4v|mkv|webm|avi)(\?|$)/i.test(String(filePath || ""));
}

function placeDetailAttachment(editor, file, blobUrl, time, mediaUrl) {
  const length = Number(file.duration) || 0;
  if (length < 0.04) return time;
  const isVideo = detailAudioIsVideo(file.path);
  if (!file.hasAudio && !isVideo) return time;
  const end = detailClipEnd(editor);
  const start = end > 0 ? end + 2 : 0;
  const vIndex = nextDetailVIndex(editor);
  const group = detailAudioClipId();
  if (file.hasAudio && blobUrl) {
    const clip = makeDetailAudioClip(file.path, start, length, file.peaks, length);
    clip.blobUrl = blobUrl;
    clip.group = group;
    clip.vIndex = vIndex;
    editor.audioClips.push(clip);
  }
  if (isVideo) {
    const clip = makeDetailVideoClip(start, 0, length, file.path, length);
    clip.group = group;
    clip.mediaUrl = mediaUrl || "";
    clip.vIndex = vIndex;
    editor.videoClips.push(clip);
  }
  refreshDetailTimeline(editor);
  return start + length;
}

function detailClipEnd(editor) {
  let end = 0;
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    end = Math.max(end, clip.start + clip.duration);
  });
  return end;
}

function detailPlayEnd(editor) {
  return Math.max(0.04, detailClipEnd(editor));
}

function nextDetailVIndex(editor) {
  let max = 0;
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    max = Math.max(max, Number(clip.vIndex) || 0);
  });
  return max + 1;
}

function assignFreshDetailVIndexes(editor, clips) {
  let next = nextDetailVIndex(editor);
  const labels = new Map();
  clips.forEach((clip) => {
    const key = clip.group || `v${clip.vIndex || clip.id}`;
    if (!labels.has(key)) {
      labels.set(key, next);
      next += 1;
    }
    clip.vIndex = labels.get(key);
  });
}

function refreshDetailTimeline(editor) {
  const end = Math.max(0.04, detailClipEnd(editor));
  editor.duration = Math.max(editor.duration || 0, end);
  if (detailTimelineCustom(editor)) engageDetailTimeline(editor);
}

function detailTimelineCustom(editor) {
  return Boolean(editor && !videoTrackUntouched(editor));
}

function detailTimelineRate(editor) {
  const value = Number(editor.player.querySelector(".video-rate")?.value || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function detailVideoClipAt(editor, time) {
  for (let index = editor.videoClips.length - 1; index >= 0; index -= 1) {
    const clip = editor.videoClips[index];
    if (time >= clip.start && time < clip.start + clip.duration) return clip;
  }
  return null;
}

function engageDetailTimeline(editor) {
  if (!editor.controlsBound) {
    editor.previousLoop = editor.video.loop;
    editor.video.loop = false;
    editor.onPlayClick = (event) => {
      if (detailAudioEditor !== editor || !detailTimelineCustom(editor)) return;
      if (!event.target.closest(".video-play")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (editor.running) stopDetailTimeline(editor);
      else startDetailTimeline(editor);
    };
    editor.onSeek = (event) => {
      if (detailAudioEditor !== editor || !detailTimelineCustom(editor)) return;
      event.stopImmediatePropagation();
      const seek = editor.player.querySelector(".video-seek");
      seekDetailAudioTime((Number(seek?.value) || 0) / 1000 * (editor.duration || 0));
    };
    editor.player.addEventListener("click", editor.onPlayClick, true);
    const seek = editor.player.querySelector(".video-seek");
    seek?.addEventListener("input", editor.onSeek, true);
    seek?.addEventListener("change", editor.onSeek, true);
    editor.controlsBound = true;
  }
  if (!editor.running && !editor.video.paused) {
    editor.time = editor.video.currentTime || editor.time || 0;
    startDetailTimeline(editor);
    return;
  }
  presentDetailTimeline(editor, editor.running);
}

function startDetailTimeline(editor) {
  const atEnd = (time) => time >= detailPlayEnd(editor) - 0.05;
  if (atEnd(editor.time || 0)) editor.time = 0;
  editor.running = true;
  editor.video.loop = false;
  cancelAnimationFrame(editor.frame || 0);
  editor.lastTick = performance.now();
  presentDetailTimeline(editor, true);
  const loop = (now) => {
    if (detailAudioEditor !== editor || !editor.running) return;
    const playEnd = detailPlayEnd(editor);
    const clip = editor.activeClip;
    const element = clip ? ((clip.source && clip.source !== "original") ? editor.picture : editor.video) : null;
    const rate = detailTimelineRate(editor);
    if (clip && element && element.readyState < 2) {
      element.play().catch(() => {});
    } else if (!clip || !element || element.paused) {
      const delta = Math.min(0.1, (now - editor.lastTick) / 1000) * rate;
      editor.time += delta;
      if (editor.time >= playEnd) editor.time = 0;
      presentDetailTimeline(editor, true);
    } else {
      const local = element.currentTime - clip.inPoint;
      if (local >= clip.duration - 0.05) {
        editor.time = clip.start + clip.duration + 0.001;
        if (editor.time >= playEnd - 0.02) editor.time = 0;
        presentDetailTimeline(editor, true);
      } else if (local >= 0) editor.time = clip.start + local;
    }
    editor.lastTick = now;
    syncDetailAudioPreview();
    drawDetailAudioEditor();
    paintDetailTimelineChrome(editor);
    editor.frame = requestAnimationFrame(loop);
  };
  editor.frame = requestAnimationFrame(loop);
  paintDetailTimelineChrome(editor);
}

function stopDetailTimeline(editor) {
  editor.running = false;
  cancelAnimationFrame(editor.frame || 0);
  editor.video.pause();
  editor.picture?.pause();
  paintDetailTimelineChrome(editor);
}

function presentDetailTimeline(editor, playing) {
  const time = Math.max(0, editor.duration ? Math.min(editor.time || 0, Math.max(editor.duration - 0.001, 0)) : (editor.time || 0));
  editor.time = time;
  const clip = detailVideoClipAt(editor, time);
  editor.activeClip = clip;
  const picture = editor.picture;
  const external = Boolean(clip && clip.source && clip.source !== "original");
  if (!clip || (external && !clip.mediaUrl)) {
    picture?.pause();
    picture?.classList.remove("is-shown");
    if (!clip) {
      editor.video.pause();
      editor.video.classList.add("audio_edit_source_hidden");
      if (editor.black) editor.black.hidden = false;
    }
    return;
  }
  const element = external ? picture : editor.video;
  const local = Math.max(0, clip.inPoint + (time - clip.start));
  if (external) {
    if (picture.dataset.src !== clip.mediaUrl) {
      picture.dataset.src = clip.mediaUrl;
      picture.dataset.ready = "";
      picture.src = clip.mediaUrl;
      picture.onloadeddata = () => {
        if (picture.dataset.src !== clip.mediaUrl) return;
        picture.dataset.ready = "1";
        if (detailAudioEditor === editor && editor.activeClip === clip) {
          picture.classList.add("is-shown");
          editor.video.classList.add("audio_edit_source_hidden");
        }
      };
    }
    const ready = picture.dataset.ready === "1";
    picture.classList.toggle("is-shown", ready);
    editor.video.classList.toggle("audio_edit_source_hidden", ready);
    if (ready) editor.video.pause();
    if (editor.black) editor.black.hidden = true;
    if (!ready) return;
  } else {
    picture?.classList.remove("is-shown");
    picture?.pause();
    editor.video.classList.remove("audio_edit_source_hidden");
    if (editor.black) editor.black.hidden = true;
  }
  if (Math.abs((element.currentTime || 0) - local) > 0.18) {
    try { element.currentTime = local; } catch (error) {}
  }
  element.playbackRate = detailTimelineRate(editor);
  if (playing) element.play().catch(() => {});
  else element.pause();
}

function paintDetailTimelineChrome(editor) {
  if (!editor || !detailTimelineCustom(editor)) return;
  const current = editor.player.querySelector("[data-current]");
  const duration = editor.player.querySelector("[data-duration]");
  const seek = editor.player.querySelector(".video-seek");
  const play = editor.player.querySelector(".video-play");
  if (current && typeof formatVideoTime === "function") current.textContent = formatVideoTime(editor.time || 0);
  if (duration && typeof formatVideoTime === "function") duration.textContent = formatVideoTime(editor.duration || 0);
  if (seek && editor.duration) {
    const ratio = Math.max(0, Math.min(1, (editor.time || 0) / editor.duration));
    if (document.activeElement !== seek) seek.value = String(Math.round(ratio * 1000));
    seek.style.setProperty("--range-progress", `${ratio * 100}%`);
  }
  if (typeof setDetailVideoButtonIcon === "function") {
    setDetailVideoButtonIcon(play, editor.running ? "pause" : "play", editor.running ? "Pause" : "Play");
  }
}

function snapDetailAudioTime(time, ignoreIds = null) {
  const editor = detailAudioEditor;
  if (!editor?.magnetic) return Math.max(0, time);
  const width = Math.max(editor.canvas.getBoundingClientRect().width, 1);
  const threshold = Math.max(0.05, (10 / width) * editor.duration);
  const points = [0, editor.duration, detailAudioNow()];
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    if (ignoreIds?.has(clip.id)) return;
    points.push(clip.start, clip.start + clip.duration);
  });
  let best = Math.max(0, time);
  let bestDistance = threshold;
  points.forEach((point) => {
    const distance = Math.abs(time - point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  });
  return Math.max(0, best);
}

function detailAudioGuides(editor, width) {
  const duration = editor.duration || 1;
  const guides = [];
  const seen = new Set();
  const add = (clip) => {
    const key = `${clip.group || clip.id}:${clip.start.toFixed(3)}:${clip.duration.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    guides.push({
      clip,
      left: (clip.start / duration) * width,
      span: Math.max(1, (clip.duration / duration) * width),
    });
  };
  editor.audioClips.forEach(add);
  editor.videoClips.forEach((clip) => {
    const paired = clip.group && editor.audioClips.some((item) => item.group === clip.group);
    const sameOriginal = (!clip.source || clip.source === "original")
      && editor.audioClips.some((item) => item.source === "original" && Math.abs(item.start - clip.start) < 0.04 && Math.abs(item.duration - clip.duration) < 0.04);
    if (!paired && !sameOriginal) add(clip);
  });
  return guides;
}

function detailAudioHandleRects(guide, height) {
  const handleW = 6;
  const handleH = 14;
  const y = Math.max(0, (height - handleH) / 2);
  const leftX = guide.left + 1;
  const rightX = Math.max(leftX + handleW + 2, guide.left + guide.span - 1 - handleW);
  return [
    { edge: "start", x: leftX, y, w: handleW, h: handleH, clip: guide.clip },
    { edge: "end", x: rightX, y, w: handleW, h: handleH, clip: guide.clip },
  ];
}

function detailAudioHandleAt(event) {
  const editor = detailAudioEditor;
  if (!editor?.canvas) return null;
  const rect = editor.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const handles = detailAudioGuides(editor, rect.width).flatMap((guide) => detailAudioHandleRects(guide, rect.height));
  return handles.find((handle) => x >= handle.x - 4 && x <= handle.x + handle.w + 4 && y >= handle.y - 4 && y <= handle.y + handle.h + 4) || null;
}

function detailAudioClipAtTime(time) {
  const editor = detailAudioEditor;
  if (!editor) return null;
  const clips = [];
  if (editor.target !== "video") clips.push(...editor.audioClips);
  if (editor.target !== "audio") clips.push(...editor.videoClips);
  for (let index = clips.length - 1; index >= 0; index -= 1) {
    const clip = clips[index];
    if (time >= clip.start && time < clip.start + clip.duration) return clip;
  }
  return null;
}

function detailAudioEdgeAt(time) {
  const editor = detailAudioEditor;
  if (!editor?.duration) return null;
  const width = Math.max(editor.canvas.getBoundingClientRect().width, 1);
  const threshold = Math.max(0.05, (8 / width) * editor.duration);
  const clips = [];
  if (editor.target !== "video") clips.push(...editor.audioClips);
  if (editor.target !== "audio") clips.push(...editor.videoClips);
  let best = null;
  let bestDistance = threshold;
  clips.forEach((clip) => {
    [[clip.start, "start"], [clip.start + clip.duration, "end"]].forEach(([edge, name]) => {
      const distance = Math.abs(time - edge);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { clip, edge: name };
      }
    });
  });
  return best;
}

function detailAudioTrimIds(clip) {
  const editor = detailAudioEditor;
  const allowed = [];
  if (editor.target !== "video") allowed.push(...editor.audioClips);
  if (editor.target !== "audio") allowed.push(...editor.videoClips);
  if (!allowed.some((item) => item.id === clip.id) && !(clip.group && allowed.some((item) => item.group === clip.group))) return [];
  if (!clip.group) return [clip.id];
  return allowed.filter((item) => item.group === clip.group).map((item) => item.id);
}

function detailAudioTrimBases(clip) {
  const ids = new Set(detailAudioTrimIds(clip));
  const bases = new Map();
  [...detailAudioEditor.audioClips, ...detailAudioEditor.videoClips].forEach((item) => {
    if (!ids.has(item.id)) return;
    bases.set(item.id, { start: item.start, inPoint: item.inPoint, duration: item.duration });
  });
  return bases;
}

function applyDetailAudioTrim(gesture, time) {
  const editor = detailAudioEditor;
  const ids = new Set(gesture.trimIds);
  [...editor.audioClips, ...editor.videoClips].forEach((clip) => {
    if (!ids.has(clip.id)) return;
    const base = gesture.trimBases.get(clip.id);
    if (!base) return;
    const media = clip.mediaDuration || (base.inPoint + base.duration);
    if (gesture.trimEdge === "start") {
      let start = snapDetailAudioTime(time, ids);
      start = Math.max(base.start - base.inPoint, Math.min(base.start + base.duration - 0.04, start));
      const delta = start - base.start;
      clip.start = start;
      clip.inPoint = base.inPoint + delta;
      clip.duration = base.duration - delta;
    } else {
      let end = snapDetailAudioTime(time, ids);
      end = Math.max(base.start + 0.04, Math.min(base.start + (media - base.inPoint), end));
      clip.duration = end - base.start;
    }
  });
  drawDetailAudioEditor();
}

function detailAudioAmplitude(editor, time, duration) {
  let amplitude = 0;
  editor.audioClips.forEach((clip) => {
    if (time < clip.start || time >= clip.start + clip.duration) return;
    const sourceTime = clip.inPoint + (time - clip.start);
    const ratio = sourceTime / Math.max(clip.mediaDuration || duration, 0.001);
    const peaks = clip.peaks || [];
    if (!peaks.length) return;
    const scaled = Math.min(peaks.length - 1, Math.max(0, ratio * (peaks.length - 1)));
    const index = Math.floor(scaled);
    const next = Math.min(peaks.length - 1, index + 1);
    const mix = scaled - index;
    amplitude += ((peaks[index] || 0) * (1 - mix) + (peaks[next] || 0) * mix) * (clip.gain || 1);
  });
  return amplitude;
}

function smoothDetailAudioSeries(values) {
  let current = values.slice();
  for (let pass = 0; pass < 2; pass += 1) {
    const source = current;
    current = source.map((value, index) => {
      const left = source[Math.max(0, index - 1)];
      const right = source[Math.min(source.length - 1, index + 1)];
      return left * 0.25 + value * 0.5 + right * 0.25;
    });
  }
  return current;
}

function drawDetailAudioWave(context, editor, rect, duration) {
  editor.audioClips.forEach((clip) => drawDetailAudioClipWave(context, clip, rect, duration));
  context.fillStyle = "#fff";
  context.fillRect(0, rect.height / 2 - 0.3, rect.width, 0.6);
}

function drawDetailAudioClipWave(context, clip, rect, duration) {
  if (!clip.peaks?.length || clip.duration <= 0 || duration <= 0) return;
  const left = (clip.start / duration) * rect.width;
  const width = Math.max(1, (clip.duration / duration) * rect.width);
  const step = 3;
  const samples = [];
  const span = Math.max(0.001, clip.mediaDuration || clip.duration);
  const gain = Math.min(4, Math.max(0, clip.gain || 1));
  for (let x = 0; x <= width; x += step) {
    const local = clip.inPoint + (x / Math.max(width, 1)) * clip.duration;
    const index = Math.min(clip.peaks.length - 1, Math.max(0, Math.floor((local / span) * clip.peaks.length)));
    samples.push(Math.min(1, (clip.peaks[index] || 0) * gain));
  }
  const smooth = smoothDetailAudioSeries(samples);
  const mid = rect.height / 2;
  const maxHeight = rect.height * 0.42;
  const heightAt = (amplitude) => Math.min(maxHeight, Math.max(0, amplitude * maxHeight));
  context.beginPath();
  smooth.forEach((amplitude, index) => {
    const x = left + Math.min(width, index * step);
    const y = mid - heightAt(amplitude);
    if (index === 0) {
      context.moveTo(x, y);
      return;
    }
    const previousX = left + Math.min(width, (index - 1) * step);
    const previousY = mid - heightAt(smooth[index - 1]);
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
  });
  const last = smooth.length - 1;
  context.lineTo(left + Math.min(width, last * step), mid + heightAt(smooth[last] || 0));
  for (let index = last - 1; index >= 0; index -= 1) {
    const x = left + Math.min(width, index * step);
    const y = mid + heightAt(smooth[index]);
    const previousX = left + Math.min(width, (index + 1) * step);
    const previousY = mid + heightAt(smooth[index + 1]);
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
  }
  context.closePath();
  context.fillStyle = clip.source === "original" ? "#fff" : "#c4c4c4";
  context.fill();
}

function drawDetailVLabels(context, editor, rect, duration) {
  const labeled = new Set();
  const draw = (clip) => {
    const index = Number(clip.vIndex) || 0;
    if (!index || labeled.has(index) || duration <= 0) return;
    labeled.add(index);
    const left = (clip.start / duration) * rect.width;
    const span = Math.max(1, (clip.duration / duration) * rect.width);
    context.save();
    context.beginPath();
    context.rect(left, 0, span, rect.height);
    context.clip();
    context.font = "700 11px Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif";
    context.fillStyle = "#fff";
    context.textBaseline = "top";
    context.fillText(`V${index}`, left + 20, 4);
    context.restore();
  };
  editor.audioClips.forEach(draw);
  editor.videoClips.forEach((clip) => {
    if (editor.audioClips.some((item) => item.vIndex === clip.vIndex)) return;
    draw(clip);
  });
}

function drawDetailAudioEditor() {
  const editor = detailAudioEditor;
  if (!editor?.canvas?.isConnected) return;
  const canvas = editor.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const duration = editor.duration || 1;
  detailAudioGuides(editor, rect.width).forEach((guide) => {
    context.fillStyle = "rgba(0, 0, 0, 0.55)";
    context.fillRect(guide.left, 0, guide.span, rect.height);
  });
  drawDetailAudioWave(context, editor, rect, duration);
  editor.videoClips.forEach((clip) => {
    const x = (clip.start / duration) * rect.width;
    const width = (clip.duration / duration) * rect.width;
    context.fillStyle = clip.source && clip.source !== "original" ? "rgba(196, 196, 196, 0.9)" : "rgba(255, 255, 255, 0.85)";
    context.fillRect(x, rect.height - 3, Math.max(1, width), 2);
  });
  detailAudioGuides(editor, rect.width).forEach((guide) => {
    context.fillStyle = "#fff";
    context.fillRect(guide.left, 0, 1, rect.height);
    context.fillRect(guide.left + guide.span - 1, 0, 1, rect.height);
    detailAudioHandleRects(guide, rect.height).forEach((handle) => {
      context.fillRect(handle.x, handle.y, handle.w, handle.h);
    });
  });
  const range = detailAudioSelectionRange();
  editor.panel.querySelectorAll(".audio_edit_target button").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.target === editor.target);
  });
  if (range) {
    const left = (range.start / duration) * rect.width;
    const width = ((range.end - range.start) / duration) * rect.width;
    context.fillStyle = "rgba(255, 255, 255, 0.16)";
    context.fillRect(left, 0, width, rect.height);
    context.strokeStyle = "#fff";
    context.strokeRect(left + 0.5, 0.5, Math.max(0, width - 1), rect.height - 1);
  }
  const playhead = Math.min(rect.width, Math.max(0, (detailAudioNow() / duration) * rect.width));
  context.fillStyle = "#fff";
  context.fillRect(playhead, 0, 1.5, rect.height);
  drawDetailVLabels(context, editor, rect, duration);
  const time = detailAudioNow();
  const cover = detailVideoClipAt(editor, time);
  if (editor.black) editor.black.hidden = Boolean(cover) || !editor.duration;
}

function syncDetailAudioPreview() {
  const editor = detailAudioEditor;
  if (!editor) return;
  const time = detailAudioNow();
  syncDetailAudioPicture(editor, time);
  const untouched = audioTrackUntouched(editor) && videoTrackUntouched(editor);
  editor.video.muted = untouched ? editor.previousMuted : true;
  if (untouched) {
    editor.previewNodes?.forEach((node) => node.element.pause());
    return;
  }
  const context = editor.audioContext || new (window.AudioContext || window.webkitAudioContext)();
  editor.audioContext = context;
  if (context.state === "suspended") context.resume().catch(() => {});
  editor.audioClips.forEach((clip) => {
    const node = ensureDetailAudioNode(editor, clip, context);
    if (!node) return;
    const local = time - clip.start;
    const active = local >= 0 && local < clip.duration;
    node.gain.gain.value = clip.gain || 0;
    if (!active) {
      node.element.pause();
      return;
    }
    const sourceTime = clip.inPoint + local;
    if (node.element.paused) {
      node.element.currentTime = sourceTime;
      node.element.play().catch(() => {});
    } else if (Math.abs(node.element.currentTime - sourceTime) > 0.25) {
      node.element.currentTime = sourceTime;
    }
  });
}

function syncDetailAudioPicture(editor, time) {
  if (detailTimelineCustom(editor)) return;
  const picture = editor.picture;
  if (!picture) return;
  const clip = editor.videoClips.find((item) => item.source && item.source !== "original" && item.mediaUrl && time >= item.start && time < item.start + item.duration);
  if (!clip) {
    picture.classList.remove("is-shown");
    picture.pause();
    editor.video.classList.remove("audio_edit_source_hidden");
    return;
  }
  if (picture.dataset.src !== clip.mediaUrl) {
    picture.dataset.src = clip.mediaUrl;
    picture.src = clip.mediaUrl;
  }
  picture.classList.add("is-shown");
  editor.video.classList.add("audio_edit_source_hidden");
  const sourceTime = clip.inPoint + (time - clip.start);
  if (editor.video.paused) {
    picture.pause();
    if (Math.abs((picture.currentTime || 0) - sourceTime) > 0.08) picture.currentTime = sourceTime;
    return;
  }
  if (picture.paused) {
    picture.currentTime = sourceTime;
    picture.play().catch(() => {});
  } else if (Math.abs((picture.currentTime || 0) - sourceTime) > 0.25) {
    picture.currentTime = sourceTime;
  }
}

function ensureDetailAudioNode(editor, clip, context) {
  if (clip.preview) return clip.preview;
  const url = clip.blobUrl || (clip.source === "original" ? editor.mediaUrl : "");
  if (!url) return null;
  const element = new Audio(url);
  element.preload = "auto";
  const source = context.createMediaElementSource(element);
  const gain = context.createGain();
  source.connect(gain).connect(context.destination);
  clip.preview = { element, gain };
  editor.previewNodes.push(clip.preview);
  return clip.preview;
}

function audioTrackUntouched(editor) {
  const clip = editor.audioClips[0];
  const media = editor.mediaDuration || editor.duration;
  return editor.audioClips.length === 1
    && clip.source === "original"
    && clip.start < 0.02
    && clip.inPoint < 0.02
    && Math.abs(clip.gain - 1) < 0.02
    && Math.abs(clip.duration - media) < 0.05;
}

function videoTrackUntouched(editor) {
  const clip = editor.videoClips[0];
  const media = editor.mediaDuration || editor.duration;
  return editor.videoClips.length === 1
    && (!clip.source || clip.source === "original")
    && clip.start < 0.02
    && clip.inPoint < 0.02
    && Math.abs(clip.duration - media) < 0.05;
}

function chooseVideoEditSaveFolder() {
  return new Promise((resolve) => {
    if (typeof openMoveToCollectionDialog !== "function") {
      resolve(null);
      return;
    }
    openMoveToCollectionDialog({
      saveMode: true,
      onSave: (folder) => resolve(folder?.postPath ? folder : null),
    });
  });
}

async function saveDetailAudioEditor() {
  const editor = detailAudioEditor;
  if (!editor || editor.saving) return;
  const folder = await chooseVideoEditSaveFolder();
  if (!folder?.postPath || detailAudioEditor !== editor) return;
  editor.saving = true;
  try {
    const result = await detailAudioNative().saveAudioEdit({
      provider: editor.payload.provider,
      url: editor.payload.url,
      destinationPath: folder.postPath,
      audioClips: editor.audioClips.map(serializeDetailAudioClip),
      videoClips: editor.videoClips.map((clip) => ({
        start: clip.start,
        inPoint: clip.inPoint,
        duration: clip.duration,
        source: clip.source || "original",
      })),
    });
    if (!result || result.cancelled || detailAudioEditor !== editor) return;
    const data = await qApi("/api/library/register-saved-video", {
      post_path: folder.postPath,
      file_name: result.fileName,
      source_item_id: typeof mediaItemKey === "function" ? mediaItemKey(editor.payload.item) : "",
      width: result.width,
      height: result.height,
    });
    applyLibrarySnapshot(data);
    toast(`저장했습니다: ${result.fileName}`);
  } finally {
    editor.saving = false;
  }
}

function serializeDetailAudioClip(clip) {
  return {
    start: clip.start,
    inPoint: clip.inPoint,
    duration: clip.duration,
    gain: clip.gain,
    source: clip.source,
  };
}
