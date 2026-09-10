"""Use a read-only source snapshot; all runtime operations stay in a temporary library."""
import copy
import faulthandler
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time

app, source = map(lambda p: Path(p).resolve(), sys.argv[1:3])
account_id = sys.argv[3]
with tempfile.TemporaryDirectory(prefix='grok-clone-cache-smoke-') as directory:
    sandbox = Path(directory)
    root = sandbox / 'library'
    (root / 'sql_data').mkdir(parents=True)
    runtime = sandbox / 'runtime'
    runtime.mkdir()
    for filename in ('state.sqlite3', 'library_index.sqlite3'):
        with sqlite3.connect((source / 'sql_data' / filename).as_uri() + '?mode=ro', uri=True) as src:
            with sqlite3.connect(root / 'sql_data' / filename) as dest:
                src.backup(dest)
    shutil.copy2(source / 'library.json', root / 'library.json')
    displays = source / 'runtime_data/macos/imagine_saved_display'
    if displays.is_dir():
        shutil.copytree(displays, root / 'runtime_data/macos/imagine_saved_display')
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(runtime), GROK_CHAMELEON_PORTABLE_ROOT=str(sandbox),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(sandbox / 'pointer.json'),
        GROK_CHAMELEON_PLATFORM_KEY='macos', GROK_CHAMELEON_NO_BROWSER='1',
    )
    spec = importlib.util.spec_from_file_location('clone_smoke_server', app / 'runtime/server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.library_root = lambda: root
    account = {'id': account_id}
    server.active_imagine_account = lambda *a: account
    def reject_network(*args, **kwargs):
        raise AssertionError('Cache attempted a remote request')
    server.imagine_get_json = reject_network
    server.imagine_ensure_upload_bundle_record = reject_network
    item_id = server.imagine_item_asset_id
    def ids(posts):
        return {item_id(i) for p in posts for i in p.get('items', []) if item_id(i)}
    # Both remote transports must preserve the official per-copy origin. Settings can
    # remember only the newest copy for an original; that must not split earlier batches.
    synthetic_cards = []
    for batch in ('first', 'second'):
        for suffix, parent, action, kind in (
            ('root', '', 'textToImage', 'image'),
            ('edit', 'original-root', 'imageToImage', 'image'),
            ('video', 'original-edit', 'imageToVideo', 'video'),
        ):
            asset = {'assetId': batch + suffix, 'sourceConversationId': batch,
                'mimeType': 'image/jpeg' if kind == 'image' else 'video/mp4',
                'key': 'https://example.invalid/' + batch + suffix + ('.jpg' if kind == 'image' else '.mp4'),
                'isModelGenerated': True, 'fileSource': 'IMAGINE_GENERATED_FILE_SOURCE',
                'auxKeys': {'duplicated_from_asset_id': 'original-' + suffix},
                'mediaGenInput': {action: {'inputAssets': [parent] if parent else []}}}
            item = server.imagine_conversation_asset_item(asset, batch, {}, [], {}, account)
            flat = server.imagine_unsaved_post_from_asset(asset, account)
            assert item['metadata']['imagine']['cloned_from_asset_id'] == 'original-' + suffix
            assert flat['items'][0]['metadata']['imagine']['cloned_from_asset_id'] == 'original-' + suffix
            synthetic_cards.append({'post_id': item['item_id'], 'items': [item], 'metadata': {'flat_only': True}})
    synthetic_groups = server.imagine_group_external_clone_batch_cards(synthetic_cards)
    assert len(synthetic_groups) == 2
    for post in synthetic_groups:
        batch = post['metadata']['clone_batch_id']
        held = {item_id(item): item for item in post['items']}
        assert held[batch + 'edit']['source_item_id'] == batch + 'root'
        assert held[batch + 'video']['source_item_id'] == batch + 'edit'
    old_liked = server.library_index.query_imagine_remote_posts(root, account_id + ':liked', limit=5000)['posts']
    saved = server.library_index.query_imagine_remote_posts(root, account_id, limit=5000)['posts']
    all_held = ids([*old_liked, *saved])
    mapping = server.imagine_clone_asset_map(root, account)
    represented_snapshots = set()
    for post in [*old_liked, *saved]:
        metadata = post.get('metadata') or {}
        batch = metadata.get('clone_batch_id') or metadata.get('conversation_id')
        for item in post.get('items', []):
            record = mapping.get(item_id(item), {})
            if (metadata.get('upload_origin_bundle')
                and metadata.get('upload_source_asset_id') == item_id(item)
                and (item.get('metadata') or {}).get('bundle_source_snapshot') is True
                and record.get('conversation_id') == batch and record.get('asset_id') in all_held):
                represented_snapshots.add(item_id(item))
    known = server.imagine_known_clone_asset_ids(root, account)
    hidden = server.imagine_pending_delete_ids(root, account) | server.imagine_local_exclusion_ids(root, account)
    start = time.monotonic()
    faulthandler.dump_traceback_later(15, repeat=False)
    result = server.list_imagine_liked_cache({'limit': 5000})
    faulthandler.cancel_dump_traceback_later()
    liked = result['posts']
    assert not ((ids(old_liked) - hidden - represented_snapshots) - ids(liked)), 'Lost prior Liked items'
    for origin in represented_snapshots - ids(liked):
        assert mapping[origin]['asset_id'] in ids(liked), 'Removed snapshot without its copy'
    assert not (((ids(saved) | ids(old_liked)) & known) - hidden - ids(liked)), 'Missed known clones'
    assert sum(len(ids([p])) for p in liked) == len(ids(liked)), 'Duplicated Liked items'
    batches = {}
    for record in mapping.values():
        for index, post in enumerate(liked):
            if record['asset_id'] in ids([post]):
                batches.setdefault(record['conversation_id'], set()).add(index)
    assert not any(len(value) > 1 for value in batches.values()), 'Split clone batches'
    display = server.list_imagine_saved_display_cache({})
    main = server.imagine_filter_liked_scope_posts(copy.deepcopy(display['posts']), set(result['liked_exclusion']['ids']))
    assert not (ids(main) & known), 'Known clones still visible in Main'
    assert not (ids(main) & ids(liked)), 'Main/Liked overlap'
    print(json.dumps({'liked_cards': len(liked), 'liked_assets': len(ids(liked)),
                      'main_display_cards': len(main), 'main_display_assets': len(ids(main)),
                      'known_clone_assets': len(known), 'split_batches': 0, 'duplicate_assets': 0,
                      'cache_seconds': round(time.monotonic() - start, 3)}))
    # Persistence/restart path: use the real store, then rebuild the response again.
    folded = server.imagine_group_external_clone_batch_cards(copy.deepcopy(liked))
    records = server.imagine_remote_cache_records(folded)
    keys = [record['post_key'] for record in records]
    assert ids(folded) == ids(liked), 'Store fold lost items'
    assert len(keys) == len(set(keys)), 'Duplicate current cache keys'
    assert not (set(keys) & {key for record in records for key in record.get('legacy_post_keys', [])}), \
        'Alias cleanup would delete a current card'
    server.imagine_store_liked_cache(root, account, liked, prune=True)
    again = server.list_imagine_liked_cache({'limit': 5000})['posts']
    stored_posts = server.library_index.query_imagine_remote_posts(root, account_id + ':liked', limit=5000)['posts']
    assert ids(liked) == ids(stored_posts), 'SQLite store lost items'
    signature = lambda posts: sorted(tuple(sorted(ids([p]))) for p in posts)
    if signature(again) != signature(liked):
        print('reload difference', json.dumps({'cards': len(again), 'assets': len(ids(again)),
            'lost': sorted(ids(liked) - ids(again)), 'added': sorted(ids(again) - ids(liked)),
            'changed_groups': len(set(signature(again)) ^ set(signature(liked)))}))
    assert signature(again) == signature(liked), 'Cache reload changed families'
    print('persist/reload: identical families')
