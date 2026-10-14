const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]);

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

function downloadToFile(url, target) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const client = String(url).startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        downloadToFile(new URL(response.headers.location, url).href, target).then((filePath) => {
          if (settled) return;
          settled = true;
          resolve(filePath);
        }, fail);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new Error(`영상을 받지 못했습니다. (${status})`));
        return;
      }
      const declared = Number(response.headers["content-length"] || 0);
      if (declared > 1024 * 1024 * 1024) {
        response.resume();
        fail(new Error("영상이 너무 큽니다."));
        return;
      }
      const partial = `${target}.${crypto.randomUUID()}.part`;
      const file = fs.createWriteStream(partial);
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > 1024 * 1024 * 1024) {
          response.destroy();
          fail(new Error("영상이 너무 큽니다."));
        }
      });
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          if (settled) {
            fs.unlink(partial, () => {});
            return;
          }
          try {
            if (!fs.existsSync(partial) || fs.statSync(partial).size <= 0) {
              fs.unlink(partial, () => {});
              fail(new Error("받은 영상이 비어 있습니다."));
              return;
            }
            fs.renameSync(partial, target);
            settled = true;
            resolve(target);
          } catch (error) {
            fs.unlink(partial, () => {});
            fail(error);
          }
        });
      });
      file.on("error", (error) => {
        fs.unlink(partial, () => {});
        fail(error);
      });
    });
    request.on("error", fail);
    request.setTimeout(180000, () => request.destroy(new Error("영상 받기가 시간 초과되었습니다.")));
  });
}

async function materializeRemoteMedia(source) {
  const remoteUrl = String(source.searchParams.get("url") || "").trim();
  let extension = ".mp4";
  try {
    const parsed = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    if (VIDEO_EXTENSIONS.has(parsed) || AUDIO_EXTENSIONS.has(parsed)) extension = parsed;
  } catch (error) {}
  const hash = crypto.createHash("sha256").update(source.href).digest("hex").slice(0, 32);
  const directory = path.join(os.tmpdir(), "grok-chameleon-edit");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${hash}${extension}`);
  try {
    if (fs.statSync(target).size > 0) return target;
  } catch (error) {}
  await downloadToFile(source.href, target);
  return target;
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
  if (source.pathname === "/api/imagine/remote/media") {
    const localPath = await materializeRemoteMedia(source);
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
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration,duration_ts,time_base,nb_frames,disposition",
    "-of", "json",
    input,
  ], 30000);
  const parsed = JSON.parse(stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video" && stream.codec_name !== "mjpeg" && !stream.disposition?.attached_pic) || streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  // Container duration can include an AAC tail after the last video frame.
  const videoDuration = Number(video?.duration) || Number(video?.duration_ts) * frameTimeBase(video?.time_base);
  const duration = videoDuration > 0 ? videoDuration : Number(parsed.format?.duration || 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: frameRate(video?.avg_frame_rate) || 24,
    frameCount: Number(video?.nb_frames) || 0,
    hasAudio: Boolean(audio),
  };
}

function frameTimeBase(value) {
  const parts = String(value || "").split("/").map(Number);
  return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 0;
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
  const { input, localPath } = await resolveInput(payload, deps);
  const info = await probeMedia(ffprobe, input);
  const peaks = info.hasAudio ? await collectPeaks(deps.ffmpeg, input) : [];
  return { ...info, peaks, path: localPath || input };
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
      source: String(clip.source || "original"),
    };
  }).filter((clip) => clip.duration >= 0.04);
}

function audioSourcePath(clip) {
  if (!clip.source || clip.source === "original") return "";
  const source = String(clip.source);
  if (/^https?:\/\//i.test(source)) return source;
  const filePath = path.resolve(source);
  const extension = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) throw new Error("오디오 또는 비디오 파일만 붙일 수 있습니다.");
  if (!fs.statSync(filePath).isFile()) throw new Error("파일을 찾을 수 없습니다.");
  return filePath;
}

function librarySaveDirectory(rootText, relativePath) {
  const root = fs.realpathSync(path.resolve(String(rootText || "")));
  const relative = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const top = relative.split("/")[0];
  if (!path.isAbsolute(root) || !relative || !["collection", "created", "upload", "reference"].includes(top)) {
    throw new Error("저장할 항목 폴더를 선택해 주세요.");
  }
  if (relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("저장할 항목 폴더를 선택해 주세요.");
  }
  const directory = fs.realpathSync(path.resolve(root, ...relative.split("/")));
  const inside = path.relative(root, directory);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("저장할 항목 폴더를 선택해 주세요.");
  if (!fs.statSync(directory).isDirectory()) {
    throw new Error("저장할 항목 폴더를 찾을 수 없습니다.");
  }
  return directory;
}

async function saveAudioEdit(payload, deps) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const ffprobe = probeBinary(deps.ffmpeg);
  if (!ffprobe) throw new Error("FFprobe를 찾을 수 없습니다.");
  if (!["build", "imagine"].includes(payload.provider)) throw new Error("Invalid provider.");
  const { input, localPath } = await resolveInput(payload, deps);
  const localSource = deps.resolveSource(payload.url).pathname === "/api/media";
  const info = await probeMedia(ffprobe, input);
  const clipEnd = (payload.videoClips || [])
    .reduce((max, clip) => Math.max(max, finite(clip.start) + finite(clip.duration)), 0);
  let duration = clipEnd > 0.04 ? clipEnd : info.duration;
  if (!(duration > 0)) throw new Error("영상 길이를 알 수 없습니다.");
  const videoClips = sanitizeClips(payload.videoClips, duration, "video");
  if (!videoClips.length) throw new Error("저장할 영상 클립이 없습니다.");
  let audioClips = sanitizeClips(payload.audioClips, duration, "audio");
  const fps = info.fps || 24;
  const extraPaths = [];
  const assignInput = (clip) => {
    const filePath = audioSourcePath(clip);
    if (!filePath) {
      clip.inputIndex = 0;
      return;
    }
    if (!extraPaths.includes(filePath)) extraPaths.push(filePath);
    clip.inputIndex = extraPaths.indexOf(filePath) + 1;
  };
  videoClips.forEach(assignInput);
  audioClips.forEach(assignInput);

  const orderedVideo = [...videoClips].sort((a, b) => a.start - b.start);
  const sequentialVideo = orderedVideo.length > 0 && orderedVideo.every((clip, index) =>
    !index || clip.start >= orderedVideo[index - 1].start + orderedVideo[index - 1].duration - 1e-7);
  if (sequentialVideo) {
    const inputInfo = new Map([[0, info]]);
    let previousOldEnd = 0;
    let previousEndFrame = 0;
    for (const clip of orderedVideo) {
      const inputIndex = clip.inputIndex || 0;
      if (!inputInfo.has(inputIndex)) inputInfo.set(inputIndex, await probeMedia(ffprobe, extraPaths[inputIndex - 1]));
      const media = inputInfo.get(inputIndex);
      const sourceFps = media.fps || fps;
      const totalFrames = media.frameCount || Math.round(media.duration * sourceFps);
      clip.oldStart = clip.start;
      clip.oldDuration = clip.duration;
      clip.sourceStartFrame = Math.ceil(clip.inPoint * sourceFps - 1e-7);
      clip.sourceEndFrame = Math.min(totalFrames, Math.ceil((clip.inPoint + clip.duration) * sourceFps - 1e-7));
      if (clip.sourceEndFrame <= clip.sourceStartFrame) throw new Error("선택한 구간에 영상 프레임이 없습니다.");
      const gapFrames = Math.max(0, Math.round((clip.oldStart - previousOldEnd) * fps));
      clip.startFrame = previousEndFrame + gapFrames;
      clip.frameCount = Math.max(1, Math.round((clip.sourceEndFrame - clip.sourceStartFrame) * fps / sourceFps));
      clip.start = clip.startFrame / fps;
      clip.duration = clip.frameCount / fps;
      previousOldEnd = clip.oldStart + clip.oldDuration;
      previousEndFrame = clip.startFrame + clip.frameCount;
    }
    duration = previousEndFrame / fps;
    // Audio follows the video timeline. Remove audio-only tails instead of
    // freezing a video frame to accommodate them; preserve intentional gaps.
    const mapTime = (time) => {
      let offset = 0;
      for (const clip of orderedVideo) {
        if (time < clip.oldStart) return time + offset;
        if (time < clip.oldStart + clip.oldDuration - 1e-9) return clip.start + Math.min(time - clip.oldStart, clip.duration);
        offset = clip.start + clip.duration - clip.oldStart - clip.oldDuration;
      }
      return time + offset;
    };
    const boundaries = orderedVideo.flatMap(clip => [clip.oldStart, clip.oldStart + Math.min(clip.duration, clip.oldDuration), clip.oldStart + clip.oldDuration]);
    audioClips = audioClips.flatMap(audio => {
      const end = audio.start + audio.duration;
      const points = [...new Set([audio.start, end, ...boundaries.filter(time => time > audio.start && time < end)])].sort((a, b) => a - b);
      return points.slice(0, -1).map((start, index) => {
        const mapped = Math.max(0, mapTime(start));
        const length = Math.max(0, Math.min(mapTime(points[index + 1]), duration) - mapped);
        return {...audio, start:mapped, duration:length, inPoint:audio.inPoint + start - audio.start};
      }).filter(audio => audio.duration > 1 / 48000);
    });
  }

  const accounts = await deps.fetchJson(new URL("/api/accounts", deps.serverBase), { signal: AbortSignal.timeout(10000) });
  const libraryRoot = fs.realpathSync(accounts.library_root);
  let directory;
  if (localSource) {
    if (!localPath) throw new Error("원본 영상 파일을 찾을 수 없습니다.");
    const sourceDirectory = path.dirname(fs.realpathSync(localPath));
    directory = librarySaveDirectory(libraryRoot, path.relative(libraryRoot, sourceDirectory));
  } else {
    const destinationPath = String(payload.destinationPath || "").trim();
    if (!destinationPath) throw new Error("저장할 폴더를 선택해 주세요.");
    const parent = librarySaveDirectory(libraryRoot, destinationPath);
    const stem = stampStem();
    for (let index = 0; ; index += 1) {
      directory = path.join(parent, index ? `${stem}_${index}` : stem);
      try {
        fs.mkdirSync(directory);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
  }
  const target = path.join(directory, uniqueStampedName(directory, "mp4"));

  const width = evenSize(info.width || 1280);
  const height = evenSize(info.height || 720);
  const identity = videoClips.length === 1
    && (!videoClips[0].source || videoClips[0].source === "original")
    && videoClips[0].start < 0.02
    && videoClips[0].inPoint < 0.02
    && Math.abs(videoClips[0].duration - info.duration) < 0.05
    && Math.abs(duration - info.duration) < 0.05;
  const filters = [];
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input];
  for (const filePath of extraPaths) args.push("-i", filePath);

  let videoMap = "0:v:0";
  if (!identity && sequentialVideo) {
    const segments = [];
    let previousEnd = 0;
    orderedVideo.forEach((clip, index) => {
      const gap = clip.startFrame - previousEnd;
      if (gap > 0) {
        filters.push(`color=c=black:s=${width}x${height}:r=${fps},trim=end_frame=${gap},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[gap${index}]`);
        segments.push(`[gap${index}]`);
      }
      filters.push(`[${clip.inputIndex || 0}:v]trim=start_frame=${clip.sourceStartFrame}:end_frame=${clip.sourceEndFrame},setpts=PTS-STARTPTS,fps=${fps}:start_time=0,trim=end_frame=${clip.frameCount},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`);
      segments.push(`[v${index}]`);
      previousEnd = clip.startFrame + clip.frameCount;
    });
    filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[vout]`);
    videoMap = "[vout]";
  } else if (!identity) {
    filters.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${(duration + 1 / fps).toFixed(9)},trim=end_frame=${Math.ceil(duration * fps - 1e-7)},format=yuv420p[base]`);
    let previous = "base";
    videoClips.forEach((clip, index) => {
      const end = clip.inPoint + clip.duration;
      const label = `v${index}`;
      const next = index === videoClips.length - 1 ? "vout" : `vx${index}`;
      const inputIndex = clip.inputIndex || 0;
      filters.push(`[${inputIndex}:v]trim=start=${clip.inPoint.toFixed(9)}:end=${end.toFixed(9)},setpts=PTS-STARTPTS,fps=${fps}:start_time=0,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,settb=AVTB,setpts=PTS+${clip.start.toFixed(9)}/TB[${label}]`);
      filters.push(`[${previous}][${label}]overlay=x=0:y=0:eof_action=pass:enable='gte(t,${(clip.start - 1e-6).toFixed(9)})*lt(t,${(clip.start + clip.duration - 1e-6).toFixed(9)})'[${next}]`);
      previous = next;
    });
    if (!videoClips.length) filters.push("[base]null[vout]");
    videoMap = "[vout]";
  }

  const audioLabels = [];
  filters.push(`aevalsrc=0:channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(9)}[sil]`);
  audioClips.forEach((clip, index) => {
    if (clip.source === "original" && !info.hasAudio) return;
    const inputIndex = clip.source === "original" ? 0 : clip.inputIndex;
    const end = clip.inPoint + clip.duration;
    const label = `a${index}`;
    const delay = Math.max(0, Math.round(clip.start * 48000));
    filters.push(`[${inputIndex}:a]atrim=start=${clip.inPoint.toFixed(9)}:end=${end.toFixed(9)},asetpts=PTS-STARTPTS,aresample=48000,volume=${clip.gain.toFixed(4)},adelay=${delay}S:all=1[${label}]`);
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
  args.push("-t", duration.toFixed(9), temp);
  try {
    await runFile(deps.ffmpeg, args);
    await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
    const stat = await fs.promises.stat(target);
    return {
      cancelled: false,
      path: target,
      fileName: path.basename(target),
      postPath: path.relative(libraryRoot, directory).split(path.sep).join("/"),
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

async function readLocalAudio(filePath, deps = {}, includeVideo = true) {
  const resolved = audioSourcePath({ source: filePath });
  if (isRemoteSource(resolved) || VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    return readVideoAudio(resolved, deps, includeVideo);
  }
  const stat = fs.statSync(resolved);
  if (stat.size > 80 * 1024 * 1024) throw new Error("오디오 파일이 너무 큽니다.");
  return { path: resolved, mime: audioMime(resolved), bytes: fs.readFileSync(resolved), hasAudio: true };
}

function isRemoteSource(source) {
  return /^https?:\/\//i.test(source);
}

function videoMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".avi") return "video/x-msvideo";
  return "video/mp4";
}

async function readVideoAudio(filePath, deps, includeVideo = true) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const result = { path: filePath, mime: "audio/mp4", bytes: null, hasAudio: false, videoMime: videoMime(filePath) };
  if (includeVideo && !isRemoteSource(filePath)) {
    const stat = await fs.promises.stat(filePath);
    if (stat.size <= 160 * 1024 * 1024) result.videoBytes = await fs.promises.readFile(filePath);
  }
  const temp = path.join(os.tmpdir(), `gc-attach-${crypto.randomUUID()}.m4a`);
  try {
    await runFile(deps.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", filePath, "-map", "0:a:0", "-vn",
      "-c:a", "aac", "-b:a", "128k", temp,
    ]);
    result.bytes = await fs.promises.readFile(temp);
    result.hasAudio = true;
    return result;
  } catch (error) {
    const detail = String(error.stderr || error.message || "");
    if (/matches no streams|does not contain any stream|Output file is empty/i.test(detail)) return result;
    throw new Error("영상 오디오를 읽지 못했습니다.");
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}

async function localAudioPeaks(filePath, deps) {
  if (!deps.ffmpeg) throw new Error("FFmpeg를 찾을 수 없습니다.");
  const ffprobe = probeBinary(deps.ffmpeg);
  if (!ffprobe) throw new Error("FFprobe를 찾을 수 없습니다.");
  const resolved = audioSourcePath({ source: filePath });
  const info = await probeMedia(ffprobe, resolved);
  const extension = path.extname(resolved).toLowerCase();
  if (!info.hasAudio && !VIDEO_EXTENSIONS.has(extension)) throw new Error("이 파일에는 오디오가 없습니다.");
  const peaks = info.hasAudio ? await collectPeaks(deps.ffmpeg, resolved) : [];
  return { path: resolved, duration: info.duration, peaks, hasAudio: Boolean(info.hasAudio) };
}

module.exports = {
  audioPeaks,
  localAudioPeaks,
  readLocalAudio,
  resolveEditInput: resolveInput,
  saveAudioEdit,
  stampStem,
  uniqueStampedName,
};
