"""Resolve detail videos absent from post.json using a disposable library."""
import importlib.util
import base64
import json
import os
import re
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
    assert re.fullmatch(r'\d{6}_\d{4}(?:_\d+)?\.mp4', merged['file'])
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
    # Folder discovery must register imported media, preserving opaque metadata.
    scan_relative = 'collection/Test/Imported'
    scan_folder = library / scan_relative
    scan_folder.mkdir(parents=True)
    shutil.copyfile(fixture, scan_folder / 'new.mp4')
    old_item = {'item_id': 'NEW', 'file': 'old.mp4', 'type': 'video', 'custom': 'keep-item'}
    original_metadata = {'post_id': 'existing', 'custom': {'keep': True},
                         'updated_at': '2020-01-01T00:00:00Z', 'items': [old_item]}
    server.write_json(scan_folder / 'post.json', original_metadata)
    context = server.indexed_post_context(scan_relative)
    server.DISCOVERED_MEDIA_REGISTRATION_ENABLED = False
    before_registration = server.post_from_folder(library, scan_folder, context)
    before_activity = server.library_index.post_activity_at(before_registration)
    server.DISCOVERED_MEDIA_REGISTRATION_ENABLED = True
    with server.build_post_save_lock(scan_folder):
        after_registration = server.post_from_folder(library, scan_folder, context)
    assert server.library_index.post_activity_at(after_registration) == before_activity
    registered = server.read_json(scan_folder / 'post.json')
    assert registered['custom'] == original_metadata['custom']
    assert registered['updated_at'] == original_metadata['updated_at']
    assert registered['items'][0] == old_item
    new = next(i for i in registered['items'] if i['file'] == 'new.mp4')
    assert new['item_id'] == 'new-2'
    assert new['created_at']
    first = (scan_folder / 'post.json').read_bytes()
    server.post_from_folder(library, scan_folder, context)
    assert (scan_folder / 'post.json').read_bytes() == first
    shutil.copyfile(fixture, scan_folder / 'old.mp4')
    os.utime(scan_folder / 'old.mp4', (1700000000, 1700000000))
    server.post_from_folder(library, scan_folder, context)
    registered = server.read_json(scan_folder / 'post.json')
    repaired = next(i for i in registered['items'] if i['file'] == 'old.mp4')
    assert repaired['created_at'] == '2023-11-14T22:13:20Z'
    assert repaired['custom'] == 'keep-item'
    repaired['updated_at'] = '2099-01-01T00:00:00Z'
    server.write_json(scan_folder / 'post.json', registered)
    server.post_from_folder(library, scan_folder, context)
    assert server.read_json(scan_folder / 'post.json')['items'][0]['created_at'] == '2023-11-14T22:13:20Z'
    repaired['created_at'] = '2022-01-01T00:00:00Z'
    server.write_json(scan_folder / 'post.json', registered)
    scanned = server.post_from_folder(library, scan_folder, context)
    assert next(i for i in scanned['items'] if i['file'] == 'old.mp4')['created_at'] == '2022-01-01T00:00:00Z'
    fresh_relative = 'upload/Fresh'
    fresh = library / fresh_relative
    fresh.mkdir(parents=True)
    shutil.copyfile(fixture, fresh / 'copied.mp4')
    server.DISCOVERED_MEDIA_REGISTRATION_ENABLED = False
    before_fresh = server.post_from_folder(library, fresh, server.indexed_post_context(fresh_relative))
    server.DISCOVERED_MEDIA_REGISTRATION_ENABLED = True
    after_fresh = server.post_from_folder(library, fresh, server.indexed_post_context(fresh_relative))
    assert server.library_index.post_activity_at(after_fresh) == server.library_index.post_activity_at(before_fresh)
    assert server.read_json(fresh / 'post.json')['items'][0]['file'] == 'copied.mp4'
    (fresh / 'post.json').write_text('{invalid')
    server.post_from_folder(library, fresh, server.indexed_post_context(fresh_relative))
    assert (fresh / 'post.json').read_text() == '{invalid'
    assert all((folder / name).read_bytes() == content for name, content in original_bytes.items())
    print('PASS: merge/capture; timestamp output name; registration and missing date repair; stable dates after edits; metadata preservation; collisions; nested lock')
