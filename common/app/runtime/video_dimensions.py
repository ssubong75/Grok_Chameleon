"""Read local video dimensions on demand, with a versioned disk cache."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import uuid

_probe_slots = threading.Semaphore(2)

def read_video_dimensions(root: Path, source: Path, binary: str) -> dict:
    root = root.resolve()
    source = source.resolve()
    relative = source.relative_to(root).as_posix()
    stat = source.stat()
    version = (stat.st_mtime_ns, stat.st_size)
    key = hashlib.sha256(f"{relative}\0{version[0]}\0{version[1]}".encode()).hexdigest()
    cache = root / "cache" / "video-dimensions"
    cache.resolve().relative_to(root)
    if cache.resolve().parent != (root / "cache").resolve():
        raise ValueError("Unsafe dimensions cache path")
    target = cache / f"{key}.json"
    with _probe_slots:
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
            if int(data.get("width", 0)) > 0 and int(data.get("height", 0)) > 0:
                return data
        except (OSError, ValueError, TypeError):
            pass
        if not binary or not Path(binary).is_file():
            return {}
        result = subprocess.run([
            binary, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", str(source),
        ], capture_output=True, text=True, timeout=15, check=True,
           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0)
        streams = json.loads(result.stdout).get("streams", [])
        if not streams:
            return {}
        width, height = int(streams[0].get("width", 0)), int(streams[0].get("height", 0))
        if width <= 0 or height <= 0:
            return {}
        current = source.stat()
        if (current.st_mtime_ns, current.st_size) != version:
            return {}
        data = {"width": width, "height": height}
        temporary = cache / f"{key}.{uuid.uuid4().hex}.part"
        try:
            cache.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(data), encoding="utf-8")
            temporary.replace(target)
        except OSError:
            pass
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        return data
