"""Exercise the packaged tools using synthetic media, never the user library."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

app = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(app / "runtime"))
from video_merge import merge_compatible_videos

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
print("PASS: lossless merge with/without attached covers and M4A audio extraction")
