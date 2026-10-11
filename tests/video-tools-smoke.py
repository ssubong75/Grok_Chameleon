"""Exercise the packaged tools using synthetic media, never the user library."""
import json
from fractions import Fraction
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

app = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(app / "runtime"))
from video_merge import ConversionRequired, merge_compatible_videos, probe_video

suffix = ".exe" if os.name == "nt" else ""
ffmpeg = str(app / "vendor/ffmpeg" / ("ffmpeg" + suffix))
ffprobe = str(app / "vendor/ffmpeg" / ("ffprobe" + suffix))
fixture = Path(__file__).parent / "fixtures/merge-audio.mp4"


def packets(source):
    data = json.loads(subprocess.check_output([
        ffprobe, "-v", "error", "-show_packets", "-show_data_hash", "sha256",
        "-show_entries", "packet=stream_index,data_hash", "-of", "json", str(source),
    ]))
    streams = {}
    for packet in data["packets"]:
        streams.setdefault(packet["stream_index"], []).append(packet["data_hash"])
    return streams


with tempfile.TemporaryDirectory(prefix="gc-video-tools-") as temporary:
    work = Path(temporary)
    sources = [work / "1.mp4", work / "2.mp4"]
    for source in sources:
        shutil.copyfile(fixture, source)
    target = work / "merged.mp4"
    merge_compatible_videos(ffmpeg, ffprobe, sources, target)
    original = packets(fixture)
    assert packets(target) == {index: values * 2 for index, values in original.items()}
    cover_fixture = fixture.with_name("merge-audio-cover.mp4")
    for case, selected in enumerate([(cover_fixture, cover_fixture), (fixture, cover_fixture),
                                     (cover_fixture, fixture)]):
        case_dir = work / f"cover-{case}"
        case_dir.mkdir()
        case_sources = [case_dir / "1.mp4", case_dir / "2.mp4"]
        for source, sample in zip(case_sources, selected):
            shutil.copyfile(sample, source)
        result = case_dir / "merged.mp4"
        merge_compatible_videos(ffmpeg, ffprobe, case_sources, result)
        assert packets(result) == {index: values * 2 for index, values in original.items()}
    audio = work / "audio.m4a"
    subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-i", str(fixture),
                    "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "aac",
                    "-b:a", "192k", str(audio)], check=True, timeout=30)
    assert audio.stat().st_size > 0
    # Conversion is opt-in and must normalize video/audio settings across platforms.
    mismatched = work / "different.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-i", str(fixture), "-map", "0:v:0", "-map", "0:a:0",
                    "-vf", "scale=320:240,fps=30", "-c:v", "libx264", "-profile:v", "high",
                    "-level:v", "3.1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "32000",
                    "-ac", "2", str(mismatched)], check=True, timeout=60)
    shutil.copyfile(fixture, sources[0])
    shutil.copyfile(mismatched, sources[1])
    before = [source.read_bytes() for source in sources]
    converted = work / "converted.mp4"
    try:
        merge_compatible_videos(ffmpeg, ffprobe, sources, converted)
        raise AssertionError("Mismatched settings must require confirmation")
    except ConversionRequired:
        pass
    assert not converted.exists()
    result = merge_compatible_videos(ffmpeg, ffprobe, sources, converted, allow_conversion=True)
    assert result["reencoded"] is True
    streams = probe_video(ffprobe, converted)["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    audio = next(s for s in streams if s["codec_type"] == "audio")
    input_videos = [next(s for s in probe_video(ffprobe, source)["streams"] if s["codec_type"] == "video") for source in sources]
    larger = max(input_videos, key=lambda v: (v["width"] * v["height"], v["width"], v["height"]))
    higher_fps = max(Fraction(v.get("avg_frame_rate") or v["r_frame_rate"]) for v in input_videos)
    assert video["codec_name"] == "h264" and video["level"] == 41
    assert (video["width"], video["height"]) == (larger["width"], larger["height"])
    assert Fraction(video["r_frame_rate"]) == higher_fps
    reverse_dir = work / "reverse"
    reverse_dir.mkdir()
    reverse_sources = [reverse_dir / "1.mp4", reverse_dir / "2.mp4"]
    for source, destination in zip(reversed(sources), reverse_sources):
        shutil.copyfile(source, destination)
    reversed_output = reverse_dir / "merged.mp4"
    merge_compatible_videos(ffmpeg, ffprobe, reverse_sources, reversed_output, allow_conversion=True)
    reversed_video = next(s for s in probe_video(ffprobe, reversed_output)["streams"] if s["codec_type"] == "video")
    assert (reversed_video["width"], reversed_video["height"]) == (larger["width"], larger["height"])
    # Very short segments can make ffprobe infer a slightly different rate at the join.
    assert abs(float(Fraction(reversed_video["avg_frame_rate"]) - higher_fps)) < 0.1
    assert audio["codec_name"] == "aac" and audio["sample_rate"] == "48000" and audio["channels"] == 2
    assert before == [source.read_bytes() for source in sources]
    # A video without audio gets a silent track, preserving both video segments.
    silent = work / "silent.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-i", str(fixture), "-map", "0:v:0", "-c", "copy", str(silent)],
                   check=True, timeout=30)
    shutil.copyfile(silent, sources[1])
    result = merge_compatible_videos(ffmpeg, ffprobe, sources, work / "with-silence.mp4", allow_conversion=True)
    assert result["reencoded"] is True
print("PASS: packet-preserving merge, cover handling, consent, conversion, missing audio, and original preservation")
