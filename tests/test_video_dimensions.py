import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('video_dimensions', Path(__file__).parents[1] / 'common/app/runtime/video_dimensions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DimensionTests(unittest.TestCase):
    def test_cached_probe_and_changed_original(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'synthetic.mp4'
            binary = root / 'fake-ffprobe'
            source.write_bytes(b'synthetic fixture')
            binary.write_text('fixture')
            with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps({'streams': [{'width': 1376, 'height': 768}]}))) as probe:
                self.assertEqual(module.read_video_dimensions(root, source, str(binary)), {'width': 1376, 'height': 768})
                module.read_video_dimensions(root, source, str(binary))
                self.assertEqual(probe.call_count, 1)
                stat = source.stat()
                os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1000000000))
                module.read_video_dimensions(root, source, str(binary))
                self.assertEqual(probe.call_count, 2)

    def test_invalid_or_missing_probe_does_not_guess(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'synthetic.mp4'
            source.write_bytes(b'synthetic fixture')
            self.assertEqual(module.read_video_dimensions(root, source, ''), {})

if __name__ == '__main__':
    unittest.main()
