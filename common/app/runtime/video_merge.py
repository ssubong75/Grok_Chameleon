"""Lossless concatenation of compatible local MP4/MOV videos."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path


def probe_video(binary: str, source: Path) -> dict:
    result = subprocess.run(
        [binary, "-v", "error", "-show_streams", "-show_format",
         "-show_data_hash", "sha256", "-of", "json", str(source)],
        capture_output=True, text=True, timeout=45,
    )
    if result.returncode:
        raise RuntimeError("The video file could not be inspected.")
    data = json.loads(result.stdout)
    all_streams = data.get("streams") or []
    streams = [s for s in all_streams if not (
        s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic")
    )]
    data["has_attached_picture"] = len(streams) != len(all_streams)
    data["streams"] = streams
    if (not streams or sum(s.get("codec_type") == "video" for s in streams) != 1
            or any(s.get("codec_type") not in {"video", "audio"} for s in streams)
            or any(s.get("codec_name") not in {"h264", "hevc", "aac"} for s in streams)):
        raise RuntimeError("Merge supports H.264/HEVC videos with optional AAC audio.")
    for stream in streams:
        if not stream.get("extradata_hash"):
            raise RuntimeError("The video's codec settings could not be verified.")
    duration = float(data.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("The video duration could not be verified.")
    return data


def stream_signature(stream: dict) -> dict:
    # Encoded codec configuration is compared too; matching dimensions alone
    # does not make two streams safe to copy into one MP4 track.
    keys = (
        "codec_type", "codec_name", "codec_tag_string", "profile", "level",
        "width", "height", "pix_fmt", "sample_aspect_ratio", "field_order",
        "color_range", "color_space", "color_transfer", "color_primaries",
        "chroma_location", "r_frame_rate", "time_base", "sample_rate",
        "channels", "channel_layout", "extradata_hash", "disposition",
    )
    value = {key: stream.get(key) for key in keys}
    value["display_matrix"] = [entry for entry in stream.get("side_data_list", [])
                               if entry.get("side_data_type") == "Display Matrix"]
    return value


class ConversionRequired(RuntimeError):
    """Inputs need the user's consent before lossy conversion."""


def convert_and_merge(ffmpeg: str, ffprobe: str, sources: list[Path], target: Path, infos: list[dict]) -> dict:
    from fractions import Fraction
    import tempfile

    video = next(s for s in infos[0]["streams"] if s["codec_type"] == "video")
    width, height = (int(video[k]) // 2 * 2 for k in ("width", "height"))
    rate = Fraction(video.get("avg_frame_rate") or video["r_frame_rate"])
    if width < 2 or height < 2 or not 0 < rate <= 240:
        raise RuntimeError("The target video dimensions or frame rate are invalid.")
    fps = f"{rate.numerator}/{rate.denominator}"
    # Use level 4.1 for normal HD; larger/faster videos need a higher AVC level.
    level = ["-level:v", "4.1"] if width * height <= 1920 * 1088 and rate <= 30 else []
    with tempfile.TemporaryDirectory(prefix="converted_", dir=target.parent) as directory:
        work = Path(directory)
        converted = []
        for number, (source, info) in enumerate(zip(sources, infos), 1):
            out = work / f"{number}.mp4"
            v = next(s for s in info["streams"] if s["codec_type"] == "video")
            audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
            duration = float(info["format"]["duration"])
            args = [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-i", str(source)]
            if audio is None:
                args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            args += ["-map", f"0:{v['index']}", "-map", f"0:{audio['index']}" if audio else "1:a:0",
                     "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p",
                     "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", *level,
                     "-color_range", "tv", "-colorspace", "bt709", "-color_trc", "bt709", "-color_primaries", "bt709",
                     "-video_track_timescale", "90000", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                     "-af", "aresample=48000:async=1:first_pts=0,apad", "-t", str(duration),
                     "-map_metadata", "-1", "-map_chapters", "-1", "-metadata:s:v:0", "rotate=0",
                     "-disposition:v:0", "default", "-disposition:a:0", "default", "-movflags", "+faststart", "-n", str(out)]
            result = subprocess.run(args, capture_output=True, text=True, timeout=1800)
            if result.returncode:
                raise RuntimeError("Video conversion failed: " + result.stderr.strip()[-600:])
            converted.append(out)
        joined = work / "merged.mp4"
        result = merge_compatible_videos(ffmpeg, ffprobe, converted, joined)
        joined.replace(target)
        return {**result, "reencoded": True}


def merge_compatible_videos(ffmpeg: str, ffprobe: str, sources: list[Path], target: Path, *, allow_conversion: bool = False) -> dict:
    if len(sources) != 2:
        raise RuntimeError("Attach two videos.")
    infos = [probe_video(ffprobe, source) for source in sources]
    signatures = [[stream_signature(s) for s in info["streams"]] for info in infos]
    if signatures[0] != signatures[1]:
        if allow_conversion:
            return convert_and_merge(ffmpeg, ffprobe, sources, target, infos)
        raise ConversionRequired("These videos need conversion before merging.")
    # The caller creates these files with controlled names in a private workdir.
    manifest = target.parent / "inputs.ffconcat"
    if any(source.parent != target.parent or source.name not in {"1.mp4", "2.mp4"} for source in sources):
        raise RuntimeError("Invalid merge input path.")
    concat_sources = sources
    if any(info["has_attached_picture"] for info in infos):
        # Remove cover-art tracks before concatenation so differing cover-art
        # positions cannot change how the demuxer matches actual media tracks.
        concat_sources = []
        for number, (source, info) in enumerate(zip(sources, infos), 1):
            media_only = target.parent / f"media-{number}.mp4"
            mapping = [value for stream in info["streams"]
                       for value in ("-map", f"0:{stream['index']}")]
            remux = subprocess.run(
                [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-i", str(source),
                 *mapping, "-c", "copy", "-n", str(media_only)],
                capture_output=True, text=True, timeout=300,
            )
            if remux.returncode:
                raise RuntimeError("The video thumbnail could not be separated without conversion.")
            concat_sources.append(media_only)
    manifest.write_text("ffconcat version 1.0\n" + "".join(
        f"file '{source.name}'\n" for source in concat_sources
    ), encoding="utf-8")
    result = subprocess.run(
        [ffmpeg, "-nostdin", "-hide_banner", "-v", "warning",
         "-f", "concat", "-safe", "1", "-auto_convert", "0", "-i", str(manifest),
         "-map", "0", "-c", "copy", "-movflags", "+faststart", "-n", str(target)],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode or not target.is_file() or not target.stat().st_size:
        raise RuntimeError("The videos could not be merged without conversion.")
    # AAC priming may require a tiny DTS adjustment at the join; encoded
    # packets are still copied unchanged. Never publish corrupt input.
    if "corrupt" in result.stderr.lower():
        raise RuntimeError("The video contains corrupt data. Merge was stopped.")
    output = probe_video(ffprobe, target)
    expected = sum(float(info["format"]["duration"]) for info in infos)
    actual = float(output["format"]["duration"])
    if abs(actual - expected) > max(.25, expected * .001):
        raise RuntimeError("The merged video duration could not be verified.")
    video = next(s for s in output["streams"] if s["codec_type"] == "video")
    return {"duration": actual, "width": video["width"], "height": video["height"]}
