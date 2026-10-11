"""Resolve detail videos absent from post.json using a disposable library."""
import importlib.util
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
app = Path(sys.argv[1]).resolve()
sys.path[:0] = [str(app / 'runtime'), str(app / 'vendor/python')]
fixture = Path(__file__).parent / 'fixtures/merge-audio.mp4'
with tempfile.TemporaryDirectory(prefix='gc-detail-video-') as temporary:
    sandbox = Path(temporary)
    runtime = sandbox / 'runtime'
    runtime.mkdir()
    library = sandbox / 'library'
    (runtime / 'settings.json').write_text(json.dumps({'library_root': str(library)}))
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(runtime),
        GROK_CHAMELEON_PORTABLE_ROOT=str(sandbox),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(sandbox / '.library_path.json'),
        GROK_CHAMELEON_PLATFORM_KEY='macos', GROK_CHAMELEON_NO_BROWSER='1',
    )
    spec = importlib.util.spec_from_file_location('detail_merge_smoke', app / 'runtime/server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.LEGACY_SETTINGS_PATH = sandbox / 'no-legacy.json'
    server.set_library_root(str(library))
    relative = 'collection/Test/Imagine'
    folder = library / relative
    folder.mkdir(parents=True)
    for name in ('registered.mp4', 'imported.mp4'):
        shutil.copyfile(fixture, folder / name)
    metadata = {'post_id': 'Imagine', 'items': [
        {'item_id': 'custom-registered-id', 'file': 'registered.mp4', 'type': 'video'}
    ]}
    server.write_json(folder / 'post.json', metadata)
    original_bytes = {name: (folder / name).read_bytes() for name in ('registered.mp4', 'imported.mp4')}
    server.merge_detail_videos({'post_path': relative, 'item_keys': ['custom-registered-id', 'imported']})
    saved = server.read_json(folder / 'post.json')
    merged = next(i for i in saved['items'] if i.get('relation') == 'video_merge')
    assert (folder / merged['file']).is_file()
    assert merged['source_item_ids'] == ['custom-registered-id', 'imported']
    assert all((folder / name).read_bytes() == content for name, content in original_bytes.items())
    before = (folder / 'post.json').read_bytes()
    for missing in ('missing', '../outside'):
        try:
            server.merge_detail_videos({'post_path': relative, 'item_keys': ['imported', missing]})
        except RuntimeError as error:
            assert 'source video was not found' in str(error)
        else:
            raise AssertionError('Unknown or unsafe key accepted')
        assert (folder / 'post.json').read_bytes() == before
    png = subprocess.check_output([
        server.resolve_ffmpeg_binary(), '-v', 'error', '-i', str(fixture),
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ])
    capture = {'post_path': relative, 'item_key': 'imported', 'time': 0,
               'image': 'data:image/png;base64,' + base64.b64encode(png).decode()}
    server.save_detail_video_frame(capture)
    saved = server.read_json(folder / 'post.json')
    frame = next(i for i in saved['items'] if i.get('relation') == 'frame_capture')
    assert frame['source_item_id'] == 'imported'
    assert (folder / frame['file']).read_bytes() == png
    assert all((folder / name).read_bytes() == content for name, content in original_bytes.items())
    before = (folder / 'post.json').read_bytes()
    for missing in ('missing', '../outside'):
        try:
            server.save_detail_video_frame({**capture, 'item_key': missing})
        except RuntimeError as error:
            assert 'source video was not found' in str(error)
        else:
            raise AssertionError('Unknown or unsafe capture key accepted')
        assert (folder / 'post.json').read_bytes() == before
    print('PASS: disk-only video merge and frame capture; originals unchanged; missing/unsafe keys rejected')
