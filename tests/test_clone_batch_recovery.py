"""Exercise persisted clone recovery without starting the app or writing a library."""
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest

from test_imagine_cache_recovery import functions


def recovery_scope(**bindings):
    defaults = dict(imagine_representative_item=lambda items: items[-1] if items else None,
                    imagine_state=SimpleNamespace(load_generated_relations=lambda root: {}),
                    imagine_relation_materialized_item=lambda item, *args: copy.deepcopy(item))
    defaults.update(bindings)
    return functions(
        'imagine_item_asset_id', 'imagine_item_source_ids', 'imagine_item_source_id',
        'imagine_item_official_lineage', 'imagine_apply_official_item_lineage',
        'imagine_reconcile_official_lineage_cards',
        'imagine_rebind_cloned_item_sources', 'imagine_normalize_external_clone_records',
        'imagine_clone_batch_item_order', 'imagine_item_clone_record', 'imagine_group_external_clone_batch_cards',
        'imagine_post_is_link_source', 'imagine_post_clone_source_id',
        'imagine_post_saved_identity', 'imagine_saved_display_group_id',
        'imagine_stamp_saved_identity', 'merge_imagine_liked_lineage_cards',
        'merge_imagine_liked_lineage_with_saved_cache', 'imagine_known_clone_asset_ids',
        **defaults,
    )


def card(name, *items):
    return {'post_id': name, 'folder_path': 'imagine_saved/' + name,
            'metadata': {'flat_only': True, 'conversation_id': 'shared-conversation'},
            'items': [{'item_id': value, 'source_item_id': parent} for value, parent in items]}


def records():
    return [{'asset_id': name, 'source_asset_id': 'original-' + name, 'conversation_id': 'batch'}
            for name in ('image', 'video', 'sibling')]


class CloneBatchRecoveryTests(unittest.TestCase):
    def test_official_parent_separates_child_from_wrong_cached_family(self):
        scope = recovery_scope()
        old = card('wrong', ('root-a', ''), ('video-a', 'root-a'), ('video-b', 'root-a'))
        other = card('correct', ('root-b', ''))
        fresh = card('fresh', ('video-b', 'root-b'))
        fresh['items'][0]['metadata'] = {'imagine': {'official_lineage': {
            'asset_id': 'video-b', 'source_ids': ['root-b'],
            'conversation_id': 'real-video-conversation', 'transport': 'asset'}}}
        entries = [{'asset_id': 'root-' + k, 'source_asset_id': 'original-' + k,
                    'conversation_id': 'batch-' + k} for k in ('a', 'b')]
        before = copy.deepcopy(old)
        for posts in ([old, other, fresh], [fresh, other, old]):
            grouped = scope['imagine_group_external_clone_batch_cards'](posts, entries)
            merged = scope['merge_imagine_liked_lineage_cards'](grouped)
            self.assertEqual({frozenset(i['item_id'] for i in p['items']) for p in merged},
                             {frozenset(['root-a', 'video-a']), frozenset(['root-b', 'video-b'])})
            child = next(i for p in merged for i in p['items'] if i['item_id'] == 'video-b')
            self.assertEqual(scope['imagine_item_source_ids'](child), ['root-b'])
            self.assertEqual(child['conversation_id'], 'real-video-conversation')
            self.assertEqual(scope['imagine_group_external_clone_batch_cards'](merged, entries), grouped)
        self.assertEqual(old, before)

    def test_official_edges_preserve_only_proven_clone_alias(self):
        apply = recovery_scope()['imagine_apply_official_item_lineage']
        evidence = {'asset_id': 'video', 'source_ids': ['original'], 'conversation_id': 'batch'}
        aliased = {'item_id': 'video', 'source_item_id': 'copy',
                   'metadata': {'imagine': {'cloned_source_asset_id': 'original'}}}
        self.assertEqual(apply(aliased, evidence)['source_item_id'], 'copy')
        different = {**evidence, 'source_ids': ['different-parent']}
        self.assertEqual(apply(aliased, different)['source_item_id'], 'different-parent')
        self.assertNotIn('cloned_source_asset_id', apply(aliased, different)['metadata']['imagine'])
        self.assertEqual(apply(aliased, {**evidence, 'source_ids': []})['source_item_id'], '')

    def test_exact_batch_parent_sibling_child_and_unrelated_root(self):
        posts = [card('a', ('image', ''), ('normal', '')),
                 card('b', ('video', 'original-image')),
                 card('c', ('sibling', 'original-image')),
                 card('d', ('grandchild', 'video')), card('e', ('extend', 'grandchild'))]
        before = copy.deepcopy(posts)
        scope = recovery_scope()
        grouped = scope['imagine_group_external_clone_batch_cards'](posts, records())
        self.assertEqual(posts, before)
        self.assertEqual(len(grouped), 2)
        normal = next(p for p in grouped if p['items'][0]['item_id'] == 'normal')
        self.assertEqual(scope['imagine_post_saved_identity'](normal)[0], 'normal-saved')
        batch = next(p for p in grouped if p['metadata'].get('clone_batch_id') == 'batch')
        items = {i['item_id']: i for i in batch['items']}
        self.assertEqual(set(items), {'image', 'video', 'sibling', 'grandchild', 'extend'})
        self.assertEqual(items['video']['source_item_id'], 'image')
        self.assertEqual(items['sibling']['source_item_id'], 'image')
        self.assertFalse(items['extend']['metadata'].get('cloned_copy', False))
        # Repeated cache loads and live refreshes cannot split or multiply the same family.
        again = scope['imagine_group_external_clone_batch_cards'](copy.deepcopy(grouped), records())
        self.assertEqual(grouped, again)

    def test_records_do_not_discard_non_record_descendants(self):
        post = card('image', ('image', ''), ('video', 'original-image'), ('new', 'video'))
        post['metadata']['official_clone_assets'] = records()
        grouped = recovery_scope()['imagine_group_external_clone_batch_cards']([post])
        self.assertEqual(len(grouped), 1)
        self.assertEqual({i['item_id'] for i in grouped[0]['items']}, {'image', 'video', 'new'})

    def test_old_upload_snapshot_is_represented_by_its_existing_copy_only(self):
        snapshot = card('batch', ('original-image', ''))
        snapshot['metadata'].update(upload_origin_bundle=True, upload_source_asset_id='original-image',
                                    conversation_id='batch', saved_provenance='plain-liked')
        snapshot['items'][0]['metadata'] = {'bundle_source_snapshot': True}
        family = card('image', ('image', ''), ('video', 'original-image'))
        group = recovery_scope()['imagine_group_external_clone_batch_cards']
        result = group([copy.deepcopy(snapshot), family], records())
        self.assertEqual(len(result), 1)
        self.assertEqual({i['item_id'] for i in result[0]['items']}, {'image', 'video'})
        self.assertEqual(group([copy.deepcopy(snapshot)], records()), [snapshot])
        unrelated = copy.deepcopy(snapshot)
        unrelated['metadata']['conversation_id'] = 'another-batch'
        self.assertEqual(len(group([unrelated, family], records())), 2)
        original = copy.deepcopy(snapshot)
        original['items'][0]['metadata'].clear()
        self.assertEqual(len(group([original, family], records())), 2)

    def test_batches_with_shared_original_stay_separate(self):
        entries = [{'asset_id': name, 'source_asset_id': 'same-original', 'conversation_id': name}
                   for name in ('batch-a', 'batch-b')]
        posts = [card('a', ('batch-a', 'same-original')), card('b', ('batch-b', 'same-original'))]
        grouped = recovery_scope()['imagine_group_external_clone_batch_cards'](posts, entries)
        self.assertEqual(len(grouped), 2)

    def test_every_official_copy_recovers_its_own_batch_not_latest_map_copy(self):
        posts = []
        for batch in ('first', 'second'):
            for suffix, parent in [('root', ''), ('edit', 'original-root'), ('video', 'original-edit')]:
                post = card(batch + suffix, (batch + suffix, parent))
                item = post['items'][0]
                item['conversation_id'] = batch
                item['metadata'] = {'imagine': {'cloned_from_asset_id': 'original-' + suffix}}
                posts.append(post)
        latest_only = [{'asset_id': 'secondroot', 'source_asset_id': 'original-root', 'conversation_id': 'second'}]
        result = recovery_scope()['imagine_group_external_clone_batch_cards'](posts, latest_only)
        self.assertEqual(len(result), 2)
        for post in result:
            batch = post['metadata']['clone_batch_id']
            items = {i['item_id']: i for i in post['items']}
            self.assertEqual(set(items), {batch + suffix for suffix in ('root', 'edit', 'video')})
            self.assertEqual(items[batch + 'edit']['source_item_id'], batch + 'root')
            self.assertEqual(items[batch + 'video']['source_item_id'], batch + 'edit')

    def test_rebuild_from_saved_with_empty_liked_and_no_duplicate_items(self):
        saved = [card('a', ('image', '')), card('b', ('video', 'original-image')),
                 card('normal', ('normal', ''))]
        scope = recovery_scope(
            library_index=SimpleNamespace(query_imagine_remote_posts=lambda *a, **k: {'posts': copy.deepcopy(saved)}),
            imagine_account_settings_key=lambda account: account['id'],
            imagine_clone_asset_map=lambda root, account: {r['source_asset_id']: r for r in records()},
        )
        merge = scope['merge_imagine_liked_lineage_with_saved_cache']
        first = merge(Path('/unused'), {'id': 'account'}, [])
        self.assertEqual(len(first), 1)
        second = merge(Path('/unused'), {'id': 'account'}, copy.deepcopy(first))
        self.assertEqual(len(second), 1)
        self.assertEqual([i['item_id'] for i in second[0]['items']], ['image', 'video'])
        hidden = merge(Path('/unused'), {'id': 'account'}, [], hidden_ids={'video'})
        self.assertEqual([i['item_id'] for i in hidden[0]['items']], ['image'])

    def test_union_of_both_account_local_ledgers(self):
        scope = recovery_scope(
            imagine_account_setting_ids=lambda root, key, account: {'legacy'} if account['id'] == 'a' else set(),
            imagine_clone_asset_map=lambda root, account: {'original': {'asset_id': 'mapped'}} if account['id'] == 'a' else {},
        )
        lookup = scope['imagine_known_clone_asset_ids']
        self.assertEqual(lookup(Path('/unused'), {'id': 'a'}), {'legacy', 'mapped'})
        self.assertEqual(lookup(Path('/unused'), {'id': 'b'}), set())

    def test_cycles_terminate_and_grandchildren_share_family(self):
        posts = [card('a', ('image', 'video')), card('b', ('video', 'image')),
                 card('c', ('grandchild', 'video')), card('normal', ('normal', ''))]
        for post in posts[:2]:
            post['metadata'].update(saved_provenance='cloned-liked', saved_anchor_id=post['post_id'])
        scope = recovery_scope()
        merged = scope['merge_imagine_liked_lineage_cards'](posts)
        self.assertEqual(len(merged), 2)
        self.assertEqual({i['item_id'] for i in merged[0]['items']}, {'image', 'video', 'grandchild'})
        self.assertEqual(scope['imagine_post_saved_identity'](merged[1])[0], 'normal-saved')

    def test_durable_relation_expands_only_matching_account_parent(self):
        saved = [card('a', ('image', ''))]
        scope = recovery_scope(
            library_index=SimpleNamespace(query_imagine_remote_posts=lambda *a, **k: {'posts': copy.deepcopy(saved)}),
            imagine_account_settings_key=lambda account: 'account',
            imagine_clone_asset_map=lambda *a: {r['source_asset_id']: r for r in records()},
            imagine_state=SimpleNamespace(load_generated_relations=lambda root: {
                'unrelated-card-key': {'account_key': 'account', 'items': [
                    {'item_id': 'new', 'source_item_id': 'image'},
                    {'item_id': 'normal', 'source_item_id': 'ordinary'}]},
                'other': {'account_key': 'other', 'items': [{'item_id': 'foreign', 'source_item_id': 'image'}]},
            }),
        )
        result = scope['merge_imagine_liked_lineage_with_saved_cache'](Path('/unused'), {}, [])
        self.assertEqual({i['item_id'] for p in result for i in p['items']}, {'image', 'new'})


if __name__ == '__main__':
    unittest.main()
