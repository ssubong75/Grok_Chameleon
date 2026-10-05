"""Run against a complete packaged app; all libraries/network responses are synthetic."""
import copy
import importlib.util
import json
import os
from contextlib import ExitStack
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid


APP = Path(sys.argv.pop(1)).resolve()
ACCOUNT = {'id': 'delete-sync-test', 'user_id': 'owner'}
OTHER = {'id': 'other-account', 'user_id': 'other-owner'}
IMAGE, VIDEO, SURVIVOR, BATCH, OTHER_BATCH = [
    str(uuid.uuid5(uuid.NAMESPACE_URL, 'delete-sync-test/' + name))
    for name in ('image', 'video', 'survivor', 'batch', 'other-batch')
]


def ids(posts):
    return {s.imagine_item_asset_id(item) for post in posts for item in post.get('items', [])}


class DeletionSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SANDBOX)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.mac, self.windows, self.usb = [self.base / name for name in ('mac', 'windows', 'usb')]
        self.current = self.mac
        self.responses = {}
        self.deletes = []
        self.delete_error = None
        self.membership = {'ok': True, 'complete': True, 'entries': [], 'errors': []}
        self.probe_available = False
        for root in (self.mac, self.windows, self.usb):
            root.mkdir()
            (root / 'library.json').write_text(json.dumps({
                'library_id': self.base.name, 'version': 1,
            }), encoding='utf-8')
        self.mocks = patch.multiple(s,
            library_root=lambda: self.current,
            active_imagine_account=lambda root, account_id='': OTHER if account_id == OTHER['id'] else ACCOUNT,
            imagine_current_owner_user_id=lambda account: account['user_id'],
            imagine_get_json=self.get,
            imagine_delete_json=self.delete,
            imagine_remote_media_available=lambda *a, **k: self.probe_available,
            imagine_collection_asset_membership_all=lambda *a, **k: copy.deepcopy(self.membership))
        self.mocks.start()
        self.addCleanup(self.mocks.stop)

    def get(self, endpoint, account, **kwargs):
        if not endpoint.startswith('/rest/assets/'):
            raise AssertionError('Unexpected network request: ' + endpoint)
        value = self.responses.get(endpoint.rsplit('/', 1)[-1], RuntimeError('Imagine HTTP 404'))
        if isinstance(value, Exception):
            raise value
        return {'asset': copy.deepcopy(value)}

    def delete(self, endpoint, account, **kwargs):
        self.deletes.append(endpoint)
        if self.delete_error:
            raise self.delete_error
        return {'ok': True}

    def card(self, asset_ids, batch=BATCH):
        items, receipts = [], []
        for asset_id in asset_ids:
            mime = 'video/mp4' if asset_id == VIDEO else 'image/jpeg'
            origin = str(uuid.uuid5(uuid.NAMESPACE_URL, 'origin/' + asset_id))
            asset = {
                'assetId': asset_id, 'sourceConversationId': batch, 'mimeType': mime,
                'key': 'https://example.invalid/' + asset_id + ('.mp4' if asset_id == VIDEO else '.jpg'),
                'isModelGenerated': True, 'fileSource': 'IMAGINE_GENERATED_FILE_SOURCE',
                'createTime': '2026-01-01T00:00:00Z', 'userId': 'owner',
                'auxKeys': {'duplicated_from_asset_id': origin},
            }
            self.responses[asset_id] = asset
            items.extend(s.imagine_unsaved_post_from_asset(asset, ACCOUNT)['items'])
            receipts.append({'asset_id': asset_id, 'source_asset_id': origin,
                             'conversation_id': batch, 'media_url': asset['key'], 'media_type': mime})
        return {
            'post_id': batch, 'folder_path': 'imagine_saved/' + batch, 'items': items,
            'account_id': ACCOUNT['id'], 'created_at': '2026-01-01T00:00:00Z',
            'metadata': {'saved_provenance': 'cloned-liked', 'saved_anchor_id': batch,
                         'cloned_copy': True, 'clone_lineage_normalized': True,
                         'liked_scope': 'foreign-origin', 'official_clone_assets': receipts},
        }

    def seed(self, root):
        posts = [self.card([IMAGE, VIDEO]), self.card([SURVIVOR], OTHER_BATCH)]
        s.cache_imagine_remote_posts(root, ACCOUNT, copy.deepcopy(posts))
        s.imagine_store_liked_cache(root, ACCOUNT, copy.deepcopy(posts), prune=True)
        s.imagine_store_liked_cache(root, OTHER, copy.deepcopy(posts), prune=True)
        return posts

    def cached(self, account=ACCOUNT):
        return s.list_imagine_liked_cache({'account_id': account['id'], 'limit': 5000})

    def sync(self, root):
        control = self.base / 'control'
        return sync.synchronize(root, self.usb, control / (root.name + '.json'), control)

    def target(self, asset_id, **extra):
        return {'asset_id': asset_id, 'account_id': ACCOUNT['id'], **extra}

    def test_mac_delete_usb_windows_keeps_stale_index_but_hides_deleted_card(self):
        for root in (self.mac, self.windows, self.usb):
            self.seed(root)
        self.sync(self.mac)
        self.sync(self.windows)
        s.delete_imagine_conversation(self.target(IMAGE, conversation_id=BATCH, items=[
            self.target(IMAGE), self.target(VIDEO),
        ]))
        self.assertEqual(ids(self.cached()['posts']), {SURVIVOR})
        # The receiving machine still physically holds its old index.
        old = s.library_index.query_imagine_remote_posts(
            self.windows, s.imagine_liked_cache_account_key(ACCOUNT), limit=5000)['posts']
        self.assertEqual(ids(old), {IMAGE, VIDEO, SURVIVOR})
        self.sync(self.mac)
        self.sync(self.windows)
        self.current = self.windows
        self.assertEqual(ids(self.cached()['posts']), {SURVIVOR})
        self.assertEqual(set(self.cached()['hidden_asset_ids']), {IMAGE, VIDEO})
        self.assertEqual(ids(self.cached(OTHER)['posts']), {IMAGE, VIDEO, SURVIVOR})
        # Even offline membership must tell the renderer which old items to drop.
        self.membership = {'ok': False, 'complete': False, 'errors': [{'error': 'offline'}]}
        live = s.list_imagine_liked({})
        self.assertFalse(live['complete'])
        self.assertEqual(set(live['hidden_asset_ids']), {IMAGE, VIDEO})
        self.assertEqual(ids(live['posts']), {SURVIVOR})
        self.assertEqual(self.sync(self.windows)['changed'], 0)

    def test_live_partial_failure_persists_only_confirmed_deletions(self):
        self.seed(self.mac)
        self.responses[IMAGE] = RuntimeError('Imagine HTTP 404')
        self.responses[VIDEO] = RuntimeError('Imagine HTTP 403')
        live = s.list_imagine_liked({})
        self.assertFalse(live['complete'])
        self.assertEqual(live['confirmed_deleted_asset_ids'], [IMAGE])
        self.assertEqual(ids(live['posts']), {VIDEO, SURVIVOR})
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), {IMAGE})
        self.assertEqual(ids(self.cached()['posts']), {VIDEO, SURVIVOR})
        self.assertEqual(ids(self.cached(OTHER)['posts']), {IMAGE, VIDEO, SURVIVOR})

    def test_live_all_missing_drops_card_without_opening_detail(self):
        self.seed(self.mac)
        self.responses[IMAGE] = RuntimeError('Imagine HTTP 404')
        self.responses[VIDEO] = RuntimeError('Imagine HTTP 410')
        live = s.list_imagine_liked({})
        self.assertTrue(live['complete'])
        self.assertEqual(ids(live['posts']), {SURVIVOR})
        self.assertEqual(set(live['confirmed_deleted_asset_ids']), {IMAGE, VIDEO})
        self.assertEqual(ids(self.cached()['posts']), {SURVIVOR})

    def test_live_working_clone_url_is_preserved(self):
        self.seed(self.mac)
        self.responses[IMAGE] = RuntimeError('Imagine HTTP 404')
        self.probe_available = True
        live = s.list_imagine_liked({})
        self.assertEqual(ids(live['posts']), {IMAGE, VIDEO, SURVIVOR})
        self.assertEqual(live['confirmed_deleted_asset_ids'], [])
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), set())

    def test_asset_and_metadata_delete_are_durable_only_after_success(self):
        self.seed(self.mac)
        self.delete_error = RuntimeError('Imagine HTTP 403')
        for name in ('delete_imagine_asset', 'delete_imagine_asset_metadata', 'delete_imagine_conversation'):
            with self.subTest(route=name):
                with self.assertRaises(RuntimeError):
                    getattr(s, name)(self.target(IMAGE, conversation_id=BATCH))
                self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), set())
                self.assertEqual(s.imagine_pending_delete_ids(self.mac, ACCOUNT), set())
                self.assertEqual(ids(self.cached()['posts']), {IMAGE, VIDEO, SURVIVOR})
        self.delete_error = None
        s.delete_imagine_asset(self.target(IMAGE))
        s.delete_imagine_asset_metadata(self.target(VIDEO))
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), {IMAGE, VIDEO})
        self.assertEqual(ids(self.cached()['posts']), {SURVIVOR})

    def test_shared_upload_source_is_not_globally_excluded(self):
        self.seed(self.mac)
        s.delete_imagine_conversation(self.target(VIDEO, conversation_id=BATCH, items=[
            self.target(IMAGE, bundle_source_only=True), self.target(VIDEO),
            {'asset_id': SURVIVOR, 'account_id': OTHER['id']},
            self.target(SURVIVOR, conversation_id=OTHER_BATCH),
        ]))
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), {VIDEO})

    def test_detail_confirmation_and_list_use_same_durable_cleanup(self):
        self.seed(self.mac)
        self.responses[IMAGE] = RuntimeError('Imagine HTTP 404')
        result = s.discard_missing_imagine_asset(self.target(IMAGE, status=404))
        self.assertEqual(result['action'], 'pruned')
        self.assertEqual(ids(self.cached()['posts']), {VIDEO, SURVIVOR})
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), {IMAGE})

    def test_upload_page_delete_does_not_hide_shared_source(self):
        self.seed(self.mac)
        s.delete_imagine_asset(self.target(IMAGE, source_scope='upload_page'))
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), set())
        self.assertEqual(ids(self.cached()['posts']), {IMAGE, VIDEO, SURVIVOR})

    def test_external_alias_removal_is_durable_without_deleting_foreign_media(self):
        self.seed(self.mac)
        s.update_imagine_local_heart_posts(self.mac, ACCOUNT, add_post=self.card([IMAGE]))
        s.update_imagine_account_setting_ids(
            self.mac, 'imagine_external_reference_asset_ids', ACCOUNT, add={IMAGE})
        result = s.delete_imagine_asset(self.target(IMAGE))
        self.assertEqual(result['action'], 'external-reference-remove')
        self.assertEqual(self.deletes, [])
        self.assertEqual(s.imagine_local_exclusion_ids(self.mac, ACCOUNT), {IMAGE})


with tempfile.TemporaryDirectory(prefix='grok-delete-sync-smoke-') as directory:
    SANDBOX = Path(directory)
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(SANDBOX / 'runtime'),
        GROK_CHAMELEON_PORTABLE_ROOT=str(SANDBOX),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(SANDBOX / 'pointer.json'),
        GROK_CHAMELEON_PLATFORM_KEY='windows', GROK_CHAMELEON_NO_BROWSER='1',
    )
    spec = importlib.util.spec_from_file_location('delete_sync_server', APP / 'runtime/server.py')
    s = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(s)
    import sync_state as sync
    # No test may fall through to a real transport, including unexpected media probes.
    def reject_network(*args, **kwargs):
        raise AssertionError('Unexpected real network transport')
    with ExitStack() as guard:
        guard.enter_context(patch.object(s.urllib.request, 'urlopen', reject_network))
        if s.curl_requests:
            guard.enter_context(patch.object(s.curl_requests, 'request', reject_network))
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DeletionSyncTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
