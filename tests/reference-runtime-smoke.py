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
    thumbnail_stage = sandbox / 'thumbnail-stage'
    thumbnail_stage.mkdir()
    thumbnail = server.stage_reference_thumbnail(library, {'item_id': 'video', 'thumbnail_url': 'data:image/png;base64,' + png}, {'type': 'video'}, thumbnail_stage, {})
    assert thumbnail.read_bytes() == base64.b64decode(png)
    assert thumbnail.name == 'preview_image.png'
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
    # Exercise deletion reconciliation with the actual SQLite store, entirely in sandbox.
    test_account = {'id': 'delete-test', 'email': 'delete@example.invalid'}
    account_key = server.imagine_account_settings_key(test_account)
    relation = {'account_key': account_key, 'upload_origin_bundle': True,
                'source_post_id': 'deleted-conversation', 'upload_source_asset_id': 'kept-upload',
                'items': [{'item_id': 'deleted-result', 'conversation_id': 'deleted-conversation'},
                          {'item_id': 'kept-result', 'conversation_id': 'kept-conversation'}]}
    server.imagine_state.upsert_generated_relation(library, 'deleted-conversation', relation)
    foreign = {**relation, 'account_key': 'other-account'}
    server.imagine_state.upsert_generated_relation(library, 'foreign-record', foreign)
    originals = {name: getattr(server, name) for name in
                 ['imagine_current_owner_user_id', 'imagine_conversation_detail', 'imagine_get_json']}
    server.imagine_current_owner_user_id = lambda account: 'test-owner'
    def deleted_detail(conversation, *args):
        assert conversation == 'deleted-conversation'
        raise RuntimeError('Imagine HTTP 404: Conversation was not found')
    server.imagine_conversation_detail = deleted_detail
    def owned_orphan(url, *args, **kwargs):
        assert url in {'/rest/assets/deleted-result', '/rest/assets/kept-result'}
        conversation = 'kept-conversation' if url.endswith('/kept-result') else 'deleted-conversation'
        return {'ownerUserId': 'test-owner', 'sourceConversationId': conversation,
                'createTime': '2020-01-01T00:00:00Z', 'mimeType': 'video/mp4'}
    server.imagine_get_json = owned_orphan
    try:
        deleted = server.imagine_prune_deleted_upload_conversations(library, test_account, {'kept-conversation'})
        assert deleted == {'deleted-result'}
        remaining = server.imagine_state.load_generated_relations(library)
        assert [i['item_id'] for i in remaining['deleted-conversation']['items']] == ['kept-result']
        assert remaining['deleted-conversation']['upload_source_asset_id'] == 'kept-upload'
        assert remaining['foreign-record']['items'] == foreign['items']
        assert server.imagine_state.local_exclusion_ids(library, account_key) == {'deleted-result'}
        assert not server.imagine_state.local_exclusion_ids(library, 'other-account')
        assert server.imagine_prune_deleted_upload_conversations(library, test_account, {'kept-conversation'}) == set()
        # Same asset survives under another conversation: remove only the stale edge.
        stale = {'account_key': account_key, 'upload_origin_bundle': True,
                 'source_post_id': 'old-conversation',
                 'items': [{'item_id': 'shared-result', 'conversation_id': 'old-conversation'},
                           {'item_id': 'kept-result', 'conversation_id': 'kept-conversation'}]}
        live = {**stale, 'source_post_id': 'new-conversation',
                'items': [{'item_id': 'shared-result', 'conversation_id': 'new-conversation'}]}
        server.imagine_state.upsert_generated_relation(library, 'old-conversation', stale)
        server.imagine_state.upsert_generated_relation(library, 'new-conversation', live)
        def shared_asset(url, *args, **kwargs):
            if url.endswith('/shared-result'):
                return {'ownerUserId': 'test-owner', 'sourceConversationId': 'new-conversation',
                        'createTime': '2020-01-01T00:00:00Z'}
            return owned_orphan(url, *args, **kwargs)
        server.imagine_get_json = shared_asset
        def stale_detail(conversation, *args):
            assert conversation == 'old-conversation'
            raise RuntimeError('Imagine HTTP 404: Conversation was not found')
        server.imagine_conversation_detail = stale_detail
        detached = set()
        assert server.imagine_prune_deleted_upload_conversations(
            library, test_account, {'kept-conversation', 'new-conversation'}, detached,
        ) == set()
        assert detached == {'old-conversation'}
        remaining = server.imagine_state.load_generated_relations(library)
        assert [i['item_id'] for i in remaining['old-conversation']['items']] == ['kept-result']
        assert remaining['new-conversation']['items'] == live['items']
        assert 'shared-result' not in server.imagine_state.local_exclusion_ids(library, account_key)
    finally:
        for name, function in originals.items():
            setattr(server, name, function)
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
