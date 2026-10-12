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
  editor.video?.removeEventListener("timeupdate", editor.onTime);
  editor.video?.removeEventListener("seeked", editor.onTime);
  document.removeEventListener("pointermove", editor.onPointerMove);
  document.removeEventListener("pointerup", editor.onPointerUp);
  document.removeEventListener("keydown", editor.onKey);
  editor.previewNodes?.forEach((node) => {
    node.element.pause();
    node.element.src = "";
  });
  editor.blobUrls?.forEach((url) => URL.revokeObjectURL(url));
  editor.audioContext?.close().catch(() => {});
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
  if (!detailAudioNative()?.audioPeaks) throw new Error("오디오 편집을 쓰려면 앱을 다시 실행해 주세요.");
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
    <canvas class="audio_edit_wave"></canvas>
  `;
  const black = document.createElement("div");
  black.className = "audio_edit_black";
  black.hidden = true;
  player.append(black, panel);
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
    mediaUrl: video.currentSrc || video.src,
  };
  detailAudioEditor = editor;
  editor.onTime = () => {
    if (detailAudioEditor !== editor) return;
    syncDetailAudioPreview();
    drawDetailAudioEditor();
  };
  editor.onPointerMove = (event) => moveDetailAudioGesture(event);
  editor.onPointerUp = (event) => finishDetailAudioGesture(event);
  editor.onKey = (event) => handleDetailAudioKey(event);
  video.addEventListener("timeupdate", editor.onTime);
  video.addEventListener("seeked", editor.onTime);
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
  editor.videoClips = [makeDetailVideoClip(0, 0, editor.duration)];
  drawDetailAudioEditor();
  const info = await detailAudioNative().audioPeaks(payload);
  if (detailAudioEditor !== editor) return;
  editor.duration = Number(info.duration) || editor.duration;
  editor.info = info;
  editor.audioClips = info.hasAudio ? [makeDetailAudioClip("original", 0, editor.duration, info.peaks, editor.duration)] : [];
  if (editor.videoClips.length === 1 && editor.videoClips[0].start === 0 && editor.videoClips[0].inPoint === 0) {
    editor.videoClips[0].duration = editor.duration;
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

function makeDetailVideoClip(start, inPoint, duration) {
  return { id: detailAudioClipId(), start, inPoint, duration };
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
    saveDetailAudioEditor().catch((error) => showErrorPanel("오디오 편집 저장 실패", error.message));
  });
  panel.querySelectorAll(".audio_edit_target button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editor.target = button.dataset.target;
      drawDetailAudioEditor();
    });
  });
  editor.canvas.addEventListener("pointerdown", (event) => {
    if (!editor.duration) return;
    editor.canvas.setPointerCapture?.(event.pointerId);
    const time = detailAudioTimeAt(event);
    editor.gesture = {
      x: event.clientX,
      y: event.clientY,
      shift: event.shiftKey,
      time,
      inside: Boolean(detailAudioSelectionRange() && detailAudioTimeInsideSelection(time)),
      mode: "pending",
      audio: cloneDetailClips(editor.audioClips),
      video: cloneDetailClips(editor.videoClips),
    };
    editor.video.currentTime = time;
  });
  panel.addEventListener("dragover", (event) => event.preventDefault());
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    addDetailAudioPaths(files.map((file) => file.path).filter(Boolean), detailAudioTimeAt(event))
      .catch((error) => showErrorPanel("오디오 추가 실패", error.message));
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
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (gesture.mode === "pending") {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (gesture.inside && gesture.shift) gesture.mode = "copy";
    else if (gesture.inside && Math.abs(dy) > Math.abs(dx) && editor.target !== "video") gesture.mode = "volume";
    else if (gesture.inside) gesture.mode = "move";
    else gesture.mode = "select";
    if (gesture.mode === "copy") beginDetailAudioCopy(gesture);
    if (gesture.mode === "volume") gesture.gains = editor.audioClips.map((clip) => clip.gain);
  }
  if (gesture.mode === "select") {
    editor.selection = { start: gesture.time, end: detailAudioTimeAt(event) };
    drawDetailAudioEditor();
    return;
  }
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
  if (gesture.mode === "pending") {
    editor.selection = { start: 0, end: editor.duration };
    editor.video.currentTime = gesture.time;
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
    clip.start = Math.min(editor.duration - clip.duration, Math.max(0, base + delta));
  });
  drawDetailAudioEditor();
}

function detailAudioMoveBases(gesture) {
  const editor = detailAudioEditor;
  const bases = new Map();
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
  const points = [0, editor.duration, editor.video.currentTime || 0];
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
  const at = editor.video.currentTime || 0;
  clipboard.audio.forEach((clip) => {
    const copy = { ...clip, id: detailAudioClipId(), preview: null, start: clip.start - clipboard.start + at };
    copy.start = Math.min(editor.duration - copy.duration, Math.max(0, copy.start));
    editor.audioClips.push(copy);
  });
  clipboard.video.forEach((clip) => {
    const copy = { ...clip, id: detailAudioClipId(), start: clip.start - clipboard.start + at };
    copy.start = Math.min(editor.duration - copy.duration, Math.max(0, copy.start));
    editor.videoClips.push(copy);
  });
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
  const range = detailAudioSelectionRange();
  await addDetailAudioPaths(selected.paths, range ? range.start : (editor.video.currentTime || 0));
}

async function addDetailAudioPaths(paths, time) {
  const editor = detailAudioEditor;
  if (!editor) return;
  for (const filePath of paths) {
    const info = await detailAudioNative().localAudioPeaks({ path: filePath });
    const file = await detailAudioNative().readAudioFile({ path: filePath });
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes?.data || file.bytes || []);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime || "audio/mpeg" }));
    editor.blobUrls.push(blobUrl);
    const range = detailAudioSelectionRange();
    const duration = range ? Math.min(info.duration, range.end - range.start) : info.duration;
    const clip = makeDetailAudioClip(info.path, time, Math.min(duration, Math.max(0, editor.duration - time)), info.peaks, info.duration);
    clip.blobUrl = blobUrl;
    editor.audioClips.push(clip);
    time = Math.min(editor.duration, time + clip.duration);
  }
  syncDetailAudioPreview();
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
  const step = 3;
  const samples = [];
  for (let x = 0; x <= rect.width; x += step) {
    samples.push(detailAudioAmplitude(editor, (x / Math.max(rect.width, 1)) * duration, duration));
  }
  const smooth = smoothDetailAudioSeries(samples);
  const mid = rect.height / 2;
  const maxHeight = rect.height * 0.42;
  const heightAt = (amplitude) => Math.min(maxHeight, Math.max(0, amplitude * maxHeight));
  context.beginPath();
  smooth.forEach((amplitude, index) => {
    const x = Math.min(rect.width, index * step);
    const y = mid - heightAt(amplitude);
    if (index === 0) {
      context.moveTo(x, y);
      return;
    }
    const previousX = Math.min(rect.width, (index - 1) * step);
    const previousY = mid - heightAt(smooth[index - 1]);
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
  });
  const last = smooth.length - 1;
  context.lineTo(Math.min(rect.width, last * step), mid + heightAt(smooth[last]));
  for (let index = last - 1; index >= 0; index -= 1) {
    const x = Math.min(rect.width, index * step);
    const y = mid + heightAt(smooth[index]);
    const previousX = Math.min(rect.width, (index + 1) * step);
    const previousY = mid + heightAt(smooth[index + 1]);
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
  }
  context.closePath();
  context.fillStyle = "#fff";
  context.fill();
  context.fillStyle = "#fff";
  context.fillRect(0, rect.height / 2 - 0.3, rect.width, 0.6);
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
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fillRect(0, 0, rect.width, rect.height);
  const duration = editor.duration || 1;
  drawDetailAudioWave(context, editor, rect, duration);
  editor.videoClips.forEach((clip) => {
    const x = (clip.start / duration) * rect.width;
    const width = (clip.duration / duration) * rect.width;
    context.fillStyle = "rgba(255, 255, 255, 0.85)";
    context.fillRect(x, rect.height - 3, Math.max(1, width), 2);
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
  const playhead = ((editor.video.currentTime || 0) / duration) * rect.width;
  context.fillStyle = "#fff";
  context.fillRect(playhead, 0, 1.5, rect.height);
  const covered = editor.videoClips.some((clip) => {
    const time = editor.video.currentTime || 0;
    return time >= clip.start && time < clip.start + clip.duration;
  });
  if (editor.black) editor.black.hidden = covered || !editor.duration;
}

function syncDetailAudioPreview() {
  const editor = detailAudioEditor;
  if (!editor) return;
  const time = editor.video.currentTime || 0;
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
  return editor.audioClips.length === 1
    && clip.source === "original"
    && clip.start < 0.02
    && clip.inPoint < 0.02
    && Math.abs(clip.gain - 1) < 0.02
    && Math.abs(clip.duration - editor.duration) < 0.05;
}

function videoTrackUntouched(editor) {
  const clip = editor.videoClips[0];
  return editor.videoClips.length === 1
    && clip.start < 0.02
    && clip.inPoint < 0.02
    && Math.abs(clip.duration - editor.duration) < 0.05;
}

async function saveDetailAudioEditor() {
  const editor = detailAudioEditor;
  if (!editor) return;
  const result = await detailAudioNative().saveAudioEdit({
    provider: editor.payload.provider,
    url: editor.payload.url,
    audioClips: editor.audioClips.map(serializeDetailAudioClip),
    videoClips: editor.videoClips.map((clip) => ({
      start: clip.start,
      inPoint: clip.inPoint,
      duration: clip.duration,
    })),
  });
  if (!result || result.cancelled) return;
  if (editor.payload.provider === "build" && editor.payload.post?.folder_path) {
    const data = await qApi("/api/library/register-saved-video", {
      post_path: editor.payload.post.folder_path,
      file_name: result.fileName,
      source_item_id: typeof mediaItemKey === "function" ? mediaItemKey(editor.payload.item) : "",
      width: result.width,
      height: result.height,
    });
    applyLibrarySnapshot(data);
  }
  toast(`저장했습니다: ${result.path}`);
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
