"""Deletion reconciliation without touching real accounts, files, or the network."""
import copy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
import unittest
from urllib.parse import quote

from test_imagine_cache_recovery import functions


class UploadDeletionTests(unittest.TestCase):
    def harness(self, status='404', owner='owner', asset_conversation='dead', created='2020-01-01T00:00:00Z'):
        source = {'item_id': 'upload', 'role': 'source'}
        result = {'item_id': 'result', 'conversation_id': 'dead'}
        survivor = {'item_id': 'survivor', 'conversation_id': 'live'}
        posts = [{'post_id': 'bundle', 'items': [source, result, survivor]}]
        records = {
            'bundle': {'account_key': 'account', 'upload_origin_bundle': True,
                       'upload_source_asset_id': 'upload', 'items': [result, survivor]},
            'other': {'account_key': 'other', 'upload_origin_bundle': True,
                      'items': [result]},
        }
        excluded, conversation_calls, asset_calls, pruned = set(), [], [], []

        def detail(conversation, *args):
            conversation_calls.append(conversation)
            if conversation == 'live' or status == '200':
                return {'responses': []}
            raise RuntimeError('Imagine HTTP ' + status)

        def asset(url, *args, **kwargs):
            asset_calls.append(url)
            return {'ownerUserId': owner, 'sourceConversationId': asset_conversation,
                    'createTime': created}

        def replace(root, updated):
            records.clear()
            records.update(updated)

        def exclude(root, account, ids, **kwargs):
            self.assertEqual(account, 'account')
            self.assertEqual(kwargs['reason'], 'remote_conversation_deleted')
            excluded.update(ids)

        scope = functions(
            'imagine_prune_deleted_upload_conversations',
            'remove_imagine_generated_relation_state',
            'imagine_filter_deleted_conversation_posts',
            'imagine_error_is_confirmed_not_found', 'parse_iso_time',
            datetime=datetime, timezone=timezone, quote=quote,
            IMAGINE_RELATION_STATE_LOCK=RLock(),
            ensure_imagine_state_migrated=lambda root: None,
            imagine_account_settings_key=lambda a: 'account',
            imagine_current_owner_user_id=lambda a: 'owner',
            library_index=SimpleNamespace(query_imagine_remote_posts=lambda *a, **k: {'posts': copy.deepcopy(posts)}),
            imagine_state=SimpleNamespace(load_generated_relations=lambda root: copy.deepcopy(records),
                                         replace_generated_relations=replace, add_local_exclusions=exclude),
            imagine_local_exclusion_ids=lambda *a: set(excluded),
            imagine_item_is_upload_source=lambda i: i.get('role') == 'source',
            imagine_item_asset_id=lambda i: i.get('item_id', ''),
            imagine_relation_item_key=lambda i: i.get('item_id', ''),
            imagine_relation_conversation_id=lambda i: i.get('conversation_id', ''),
            imagine_post_saved_identity=lambda p: (p.get('provenance', 'normal-saved'), p['post_id']),
            imagine_conversation_detail=detail, imagine_get_json=asset,
            imagine_asset_owner_user_id=lambda a: a.get('ownerUserId'),
            imagine_asset_upload_only=lambda a: False,
            imagine_representative_item=lambda items: items[-1],
            imagine_remote_cache_post_key=lambda p: 'normal-saved:' + p['post_id'],
            prune_imagine_remote_cache_assets=lambda root, account, ids: pruned.append(set(ids)),
            remove_imagine_remote_cache_post_keys=lambda *a, **k: None,
            prune_imagine_saved_display_cache=lambda *a: None,
            cache_imagine_remote_posts=lambda *a: None,
            imagine_debug_event=lambda *a: None,
        )
        return scope, records, posts, excluded, conversation_calls, asset_calls, pruned

    def test_dead_conversation_with_live_asset_is_removed_without_shared_source_or_other_account(self):
        scope, records, posts, excluded, calls, assets, pruned = self.harness()
        other = copy.deepcopy(records['other'])
        result = scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live'})
        self.assertEqual(result, {'result'})
        self.assertEqual(excluded, {'result'})
        self.assertEqual(calls, ['dead'])  # cache and relation share one lookup
        self.assertEqual(records['other'], other)
        self.assertEqual([i['item_id'] for i in records['bundle']['items']], ['survivor'])
        self.assertEqual(records['bundle']['upload_source_asset_id'], 'upload')
        filtered = scope['imagine_filter_deleted_conversation_posts'](posts, set(), result)
        self.assertEqual([i['item_id'] for i in filtered[0]['items']], ['upload', 'survivor'])
        scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live'})
        self.assertEqual(calls, ['dead'])  # persistent exclusion prevents recreation/rechecking

    def test_live_forbidden_timeout_foreign_new_or_wrong_conversation_is_preserved(self):
        cases = [dict(status='200'), dict(status='403'), dict(status='503'),
                 dict(status='timeout'), dict(owner='foreign'), dict(created=''),
                 dict(created=datetime.now(timezone.utc).isoformat())]
        for case in cases:
            with self.subTest(case=case):
                scope, records, posts, excluded, *rest = self.harness(**case)
                original = copy.deepcopy(records)
                self.assertEqual(scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live'}), set())
                self.assertEqual(records, original)
                self.assertFalse(excluded)

    def test_deleted_asset_is_removed_even_when_conversation_is_live(self):
        for status in ('200', '404'):
            with self.subTest(conversation=status):
                scope, records, posts, excluded, *rest = self.harness(status=status)
                original_get = scope['imagine_get_json']
                def get(url, *args, **kwargs):
                    if url.endswith('/result'):
                        raise RuntimeError('Imagine HTTP 404: Asset not found')
                    return original_get(url, *args, **kwargs)
                scope['imagine_get_json'] = get
                deleted = scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live', 'dead'})
                self.assertEqual(deleted, {'result'})
                self.assertEqual(excluded, {'result'})
                self.assertEqual([i['item_id'] for i in records['bundle']['items']], ['survivor'])

    def test_dead_association_does_not_delete_asset_in_another_conversation(self):
        scope, records, posts, excluded, *rest = self.harness(asset_conversation='different')
        records['live-copy'] = {'account_key': 'account', 'upload_origin_bundle': True,
                                'items': [{'item_id': 'result', 'conversation_id': 'different'}]}
        detached = set()
        deleted = scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live', 'different'}, detached)
        self.assertEqual(deleted, set())
        self.assertEqual(excluded, set())
        self.assertEqual(detached, {'dead'})
        self.assertEqual([i['item_id'] for i in records['bundle']['items']], ['survivor'])
        self.assertEqual(records['live-copy']['items'][0]['item_id'], 'result')
        self.assertEqual(records['other']['items'][0]['item_id'], 'result')

    def test_asset_authorization_and_network_errors_are_not_deletions(self):
        for status in ('403', '429', '503', 'timeout'):
            scope, records, posts, excluded, *rest = self.harness()
            original = copy.deepcopy(records)
            def get(*args, **kwargs):
                raise RuntimeError('Imagine HTTP ' + status)
            scope['imagine_get_json'] = get
            self.assertEqual(scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, set()), set())
            self.assertEqual(records, original)
            self.assertFalse(excluded)

    def test_new_result_is_not_checked_during_upstream_propagation(self):
        scope, records, posts, excluded, calls, assets, *rest = self.harness()
        records['bundle']['items'][0]['created_at'] = datetime.now(timezone.utc).isoformat()
        scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, {'live'})
        self.assertNotIn('/rest/assets/result', assets)
        self.assertFalse(excluded)

    def test_deleted_root_conversation_keeps_other_live_children(self):
        scope, *rest = self.harness()
        post = {'metadata': {'relation_only_card': True, 'conversation_id': 'dead'},
                'items': [{'item_id': 'removed', 'conversation_id': 'dead'},
                          {'item_id': 'kept', 'conversation_id': 'live'}]}
        filtered = scope['imagine_filter_deleted_conversation_posts']([post], {'dead'})
        self.assertEqual([i['item_id'] for i in filtered[0]['items']], ['kept'])

    def test_last_result_removes_main_card_but_not_upload_only_entry(self):
        scope, records, posts, *rest = self.harness()
        posts[0]['items'] = posts[0]['items'][:2]
        upload = {'post_id': 'upload', 'items': [{'item_id': 'upload', 'role': 'source'}]}
        filtered = scope['imagine_filter_deleted_conversation_posts']([*posts, upload], set(), {'result'})
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]['post_id'], 'upload')
        self.assertEqual(filtered[0]['items'], upload['items'])

    def test_foreign_relations_and_link_cards_are_not_candidates(self):
        scope, records, posts, excluded, calls, *rest = self.harness()
        records.pop('bundle')
        posts[0]['provenance'] = 'plain-liked'
        self.assertEqual(scope['imagine_prune_deleted_upload_conversations'](Path('/unused'), {}, set()), set())
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
