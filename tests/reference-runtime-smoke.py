"""Run against a complete app runtime; all writes and settings stay in a temp library."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

app = Path(sys.argv[1]).resolve()
assert (app / 'runtime/server.py').is_file()
with tempfile.TemporaryDirectory(prefix='grok-reference-smoke-') as temporary:
    sandbox = Path(temporary).resolve()
    runtime = sandbox / 'runtime'
    runtime.mkdir()
    library = sandbox / 'library'
    (runtime / 'settings.json').write_text(json.dumps({'library_root': str(library)}))
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(runtime),
        GROK_CHAMELEON_PORTABLE_ROOT=str(sandbox),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(sandbox / '.library_path.json'),
        GROK_CHAMELEON_PLATFORM_KEY='macos',
        GROK_CHAMELEON_NO_BROWSER='1',
        PYTHONDONTWRITEBYTECODE='1',
    )
    spec = importlib.util.spec_from_file_location('reference_smoke_server', app / 'runtime/server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.LEGACY_SETTINGS_PATH = sandbox / 'nonexistent-legacy.json'
    server.set_library_root(str(library))
    assert (library / '레퍼런스').is_dir()
    original_active_account = server.active_imagine_account
    server.active_imagine_account = lambda *args: {'id': 'test-only', 'email': 'test@example.invalid'}
    png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
    source = {'post_id': 'test-card', 'source': 'imagine', 'area': 'imagine_remote', 'remote': True,
              'liked': True, 'account_id': 'test-only', 'items': [
                  {'item_id': key, 'type': 'image', 'url': 'data:image/png;base64,' + png}
                  for key in ['source-image', 'second-image']]}
    original = copy.deepcopy(source)
    result = server.save_imagine_post_to_reference({'source_post': source})
    assert source == original
    assert result['saved_count'] == 2
    assert result['post']['area'] == 'reference'
    assert not result['post'].get('remote')
    assert len(result['post']['items']) == 2
    for item in result['post']['items']:
        assert item['object_url'].startswith('/api/media?path='), item['object_url']
        assert (library / '레퍼런스/test-card' / item['file']).read_bytes() == base64.b64decode(png)
    repeated = server.save_imagine_post_to_reference({'source_post': source})
    assert repeated['saved_count'] == 0
    server.scan_library(library)
    listed = server.list_reference_posts({})
    assert len(listed['posts']) == 1
    assert len(listed['posts'][0]['items']) == 2
    assert server.library_index.get_post(library, '레퍼런스/test-card')['area'] == 'reference'
    assert server.library_index.query_posts(library, scope='build')['total'] == 0
    for mode in ('i2i', 'i2v', 'extend'):
        folder, relative = server.build_append_target(library, mode, [{'detail_post_path': '레퍼런스/test-card'}])
        assert folder == library / '레퍼런스/test-card'
    assert server.imagine_state.local_exclusion_ids(library, 'test-only') == set()
    if '--serve' not in sys.argv[2:]:
        another = copy.deepcopy(source)
        another['post_id'] = 'another-account-card'
        another['account_id'] = 'another-account'
        another['items'][0]['url'] = 'https://example.invalid/original-gone.png'
        another['items'] = [another['items'][0], {'item_id': 'new-result', 'type': 'image', 'url': 'data:image/png;base64,' + png}]
        download = server.copy_imagine_remote_item_to_directory
        downloaded = []
        def guarded_download(root, item, *args, **kwargs):
            assert item['item_id'] != 'source-image', 'Existing original must not be downloaded'
            downloaded.append(item['item_id'])
            return download(root, item, *args, **kwargs)
        server.copy_imagine_remote_item_to_directory = guarded_download
        copied = server.save_imagine_post_to_reference({'source_post': another})
        assert len(copied['post']['items']) == 2
        assert downloaded == ['new-result']
        for item in copied['post']['items']:
            assert (library / '레퍼런스/another-account-card' / item['file']).read_bytes() == base64.b64decode(png)
        print('PASS: dead original URL reused from another local card; only the new result downloaded')
        import urllib.error
        def missing_original_download(root, item, *args, **kwargs):
            if item['item_id'] == 'unavailable-original':
                raise urllib.error.HTTPError('https://example.invalid/gone', 404, 'Not Found', {}, None)
            raise AssertionError('Existing results must be reused locally')
        server.copy_imagine_remote_item_to_directory = missing_original_download
        exceptional = copy.deepcopy(source)
        exceptional['items'].insert(0, {'item_id': 'unavailable-original', 'type': 'image', 'url': 'https://example.invalid/gone'})
        before = (library / '레퍼런스/test-card/post.json').read_bytes()
        separate = server.save_imagine_post_to_reference({'source_post': exceptional})
        assert separate['separate_card']
        assert separate['post']['folder_path'] == '레퍼런스/test-card-available'
        assert len(separate['post']['items']) == 2
        assert len(separate['unavailable_items']) == 1
        assert (library / '레퍼런스/test-card/post.json').read_bytes() == before
        assert server.save_imagine_post_to_reference({'source_post': exceptional})['saved_count'] == 0
        print('PASS: unavailable original creates a separate local results card and preserves the original card')
        merged = server.merge_selected_posts({'post_paths': ['레퍼런스/test-card', '레퍼런스/another-account-card'], 'target_path': '레퍼런스'})
        merged_path = merged['selected_path']
        assert merged_path.startswith('레퍼런스/')
        merged_post = server.library_index.get_post(library, merged_path)
        assert merged_post['area'] == 'reference'
        # These fixtures reuse the same bytes/URLs; leave existing media deduplication intact.
        assert merged_post['items']
        assert any(item['item_id'] == 'source-image' for item in merged_post['items'])
        assert not (library / '레퍼런스/test-card').exists()
        assert not (library / '레퍼런스/another-account-card').exists()
        for item in merged_post['items']:
            assert (library / merged_path / item['file']).read_bytes() == base64.b64decode(png)
        print('PASS: Reference merge stays in Reference, preserves media and removes only merged source folders')
    print('PASS: actual app runtime setup, whole-card file save, local media URLs, repeat save, rescan/index, and Build source routing')
    if '--serve' in sys.argv[2:]:
        server.active_imagine_account = original_active_account
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        print(f'Isolated UI: http://127.0.0.1:{httpd.server_port}/', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.server_close()
