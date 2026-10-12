const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"]);

function stampStem(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function uniqueStampedName(directory, extension) {
  const stem = stampStem();
  let name = `${stem}.${extension}`;
  let index = 1;
  while (fs.existsSync(path.join(directory, name))) {
    name = `${stem}_${index}.${extension}`;
    index += 1;
  }
  return name;
}

function runFile(binary, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(String(stderr || error.message || "ffmpeg failed").slice(-600));
        failure.stderr = String(stderr || "");
        reject(failure);
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}

async function resolveInput(payload, deps) {
  const source = deps.resolveSource(payload.url);
  if (source.pathname === "/api/media") {
    const infoUrl = new URL("/api/card-preview/source-info", deps.serverBase);
    infoUrl.search = source.search;
    const info = await deps.fetchJson(infoUrl, { signal: AbortSignal.timeout(10000) });
    const localPath = String(info.source_path || "");
    if (!path.isAbsolute(localPath) || !fs.statSync(localPath).isFile()) throw new Error("영상 파일을 찾을 수 없습니다.");
    return { input: localPath, localPath };
  }
  return { input: source.href, localPath: "" };
}

function probeBinary(ffmpeg) {
  const name = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const candidate = path.join(path.dirname(ffmpeg), name);
  return fs.existsSync(candidate) ? candidate : "";
}

function frameRate(value) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator) return 0;
  const rate = numerator / denominator;
  return rate > 1 && rate < 240 ? rate : 0;
}

async function probeMedia(ffprobe, input) {
  const stdout = await runFile(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate",
    "-of", "json",
    input,
  ], 30000);
  const parsed = JSON.parse(stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video" && stream.codec_name !== "mjpeg" && !stream.disposition?.attached_pic) || streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration || 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: frameRate(video?.avg_frame_rate) || 24,
    hasAudio: Boolean(audio),
  };
}

function collectPeaks(ffmpeg, input, buckets = 1400) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", input, "-map", "0:a:0", "-ac", "1", "-ar", "4000", "-f", "f32le", "pipe:1",
    ], { windowsHide: true });
    const peaks = [];
    let leftover = Buffer.alloc(0);
    let bucketMax = 0;
    let bucketCount = 0;
    const samplesPerBucket = 200;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      reject(error);
    };
    child.stdout.on("data", (chunk) => {
      const buffer = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buffer.length - (buffer.length % 4);
      for (let index = 0; index < usable; index += 4) {
        const sample = Math.abs(buffer.readFloatLE(index));
        if (sample > bucketMax) bucketMax = sample;
        bucketCount += 1;
        if (bucketCount >= samplesPerBucket) {
          peaks.push(Math.min(1, bucketMax));
          bucketMax = 0;
          bucketCount = 0;
        }
      }
      leftover = buffer.subarray(usable);
    });
    child.stderr.on("data", () => {});
    child.on("error", fail);
    child.on("close", (code) => {
      if (failed) return;
      if (bucketCount) peaks.push(Math.min(1, bucketMax));
      if (code !== 0 && !peaks.length) {
        resolve([]);
        return;
      }
      if (peaks.length > buckets) {
        const reduced = [];
        for (let index = 0; index < buckets; index += 1) {
          const start = Math.floor((index / buckets) * peaks.length);
          const end = Math.floor(((index + 1) / buckets) * peaks.length);
          let max = 0;
          for (let cursor = start; cursor < end; cursor += 1) if (peaks[cursor] > max) max = peaks[cursor];
          reduced.push(max);
        }
        resolve(reduced);
        return;
      }
      resolve(peaks);
    });
  });
}

async function audioPeaks(payload, deps) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const ffprobe = probeBinary(deps.ffmpeg);
  if (!ffprobe) throw new Error("FFprobe를 찾을 수 없습니다.");
  const { input } = await resolveInput(payload, deps);
  const info = await probeMedia(ffprobe, input);
  const peaks = info.hasAudio ? await collectPeaks(deps.ffmpeg, input) : [];
  return { ...info, peaks };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeClips(clips, duration, kind) {
  return (Array.isArray(clips) ? clips : []).map((clip) => {
    const start = Math.max(0, finite(clip.start));
    const inPoint = Math.max(0, finite(clip.inPoint));
    const length = Math.max(0, finite(clip.duration));
    const end = Math.min(duration, start + length);
    return {
      kind,
      start,
      inPoint,
      duration: Math.max(0, end - start),
      gain: Math.min(4, Math.max(0, finite(clip.gain, 1))),
      source: kind === "audio" ? String(clip.source || "original") : "original",
    };
  }).filter((clip) => clip.duration >= 0.04);
}

function audioSourcePath(clip) {
  if (!clip.source || clip.source === "original") return "";
  const filePath = path.resolve(clip.source);
  const extension = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) throw new Error("오디오 파일만 붙일 수 있습니다.");
  if (!fs.statSync(filePath).isFile()) throw new Error("오디오 파일을 찾을 수 없습니다.");
  return filePath;
}

async function saveAudioEdit(payload, deps) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const ffprobe = probeBinary(deps.ffmpeg);
  if (!ffprobe) throw new Error("FFprobe를 찾을 수 없습니다.");
  if (!["build", "imagine"].includes(payload.provider)) throw new Error("Invalid provider.");
  const { input, localPath } = await resolveInput(payload, deps);
  const info = await probeMedia(ffprobe, input);
  const duration = info.duration;
  if (!(duration > 0)) throw new Error("영상 길이를 알 수 없습니다.");
  const videoClips = sanitizeClips(payload.videoClips, duration, "video");
  const audioClips = sanitizeClips(payload.audioClips, duration, "audio");
  const extraPaths = [];
  for (const clip of audioClips) {
    const filePath = audioSourcePath(clip);
    if (!filePath) continue;
    if (!extraPaths.includes(filePath)) extraPaths.push(filePath);
    clip.inputIndex = extraPaths.indexOf(filePath) + 1;
  }

  let target;
  if (payload.provider === "build") {
    if (!localPath) throw new Error("빌드 영상의 로컬 파일을 찾을 수 없습니다.");
    target = path.join(path.dirname(localPath), uniqueStampedName(path.dirname(localPath), "mp4"));
  } else {
    const selected = await deps.dialog.showSaveDialog(deps.window, {
      title: "영상 저장 위치",
      defaultPath: `${stampStem()}.mp4`,
      filters: [{ name: "MP4 영상", extensions: ["mp4"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (selected.canceled || !selected.filePath) return { cancelled: true };
    target = selected.filePath;
    if (!/\.mp4$/i.test(target)) target += ".mp4";
    if (target !== selected.filePath && fs.existsSync(target)) throw new Error("같은 이름의 영상 파일이 이미 있습니다.");
  }

  const width = evenSize(info.width || 1280);
  const height = evenSize(info.height || 720);
  const fps = info.fps || 24;
  const identity = videoClips.length === 1
    && videoClips[0].start < 0.02
    && videoClips[0].inPoint < 0.02
    && Math.abs(videoClips[0].duration - duration) < 0.05;
  const filters = [];
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input];
  for (const filePath of extraPaths) args.push("-i", filePath);

  let videoMap = "0:v:0";
  if (!identity) {
    filters.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)},format=yuv420p[base]`);
    let previous = "base";
    videoClips.forEach((clip, index) => {
      const end = clip.inPoint + clip.duration;
      const label = `v${index}`;
      const next = index === videoClips.length - 1 ? "vout" : `vx${index}`;
      filters.push(`[0:v]trim=start=${clip.inPoint.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS+${clip.start.toFixed(3)}/TB,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[${label}]`);
      filters.push(`[${previous}][${label}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${clip.start.toFixed(3)},${(clip.start + clip.duration).toFixed(3)})'[${next}]`);
      previous = next;
    });
    if (!videoClips.length) filters.push("[base]null[vout]");
    videoMap = "[vout]";
  }

  const audioLabels = [];
  filters.push(`aevalsrc=0:channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[sil]`);
  audioClips.forEach((clip, index) => {
    if (clip.source === "original" && !info.hasAudio) return;
    const inputIndex = clip.source === "original" ? 0 : clip.inputIndex;
    const end = clip.inPoint + clip.duration;
    const label = `a${index}`;
    const delay = Math.max(0, Math.round(clip.start * 1000));
    filters.push(`[${inputIndex}:a]atrim=start=${clip.inPoint.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,volume=${clip.gain.toFixed(4)},adelay=${delay}:all=1[${label}]`);
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length) {
    filters.push(`[sil]${audioLabels.join("")}amix=inputs=${audioLabels.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    filters.push("[sil]anull[aout]");
  }

  args.push("-filter_complex", filters.join(";"));
  if (identity) args.push("-map", "0:v:0", "-c:v", "copy");
  else args.push("-map", videoMap, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps));
  args.push("-map", "[aout]", "-c:a", "aac", "-profile:a", "aac_low", "-ar", "48000", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart");
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.mp4`);
  args.push(temp);
  try {
    await runFile(deps.ffmpeg, args);
    if (payload.provider === "build") await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
    else await fs.promises.rename(temp, target);
    const stat = await fs.promises.stat(target);
    return {
      cancelled: false,
      path: target,
      fileName: path.basename(target),
      width,
      height,
      duration,
      size: stat.size,
    };
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}

function evenSize(value) {
  const size = Math.max(2, Math.round(value || 2));
  return size - (size % 2);
}

function audioMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".ogg") return "audio/ogg";
  return "audio/mp4";
}

function readLocalAudio(filePath) {
  const resolved = audioSourcePath({ source: filePath });
  const stat = fs.statSync(resolved);
  if (stat.size > 80 * 1024 * 1024) throw new Error("오디오 파일이 너무 큽니다.");
  return { path: resolved, mime: audioMime(resolved), bytes: fs.readFileSync(resolved) };
}

async function localAudioPeaks(filePath, deps) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const ffprobe = probeBinary(deps.ffmpeg);
  if (!ffprobe) throw new Error("FFprobe를 찾을 수 없습니다.");
  const resolved = audioSourcePath({ source: filePath });
  const info = await probeMedia(ffprobe, resolved);
  const peaks = info.hasAudio ? await collectPeaks(deps.ffmpeg, resolved) : [];
  return { path: resolved, duration: info.duration, peaks };
}

module.exports = {
  audioPeaks,
  localAudioPeaks,
  readLocalAudio,
  saveAudioEdit,
  stampStem,
  uniqueStampedName,
};
