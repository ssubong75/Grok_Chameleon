"""Official ancestry must override stale local edges without changing other accounts."""
import copy
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest

from test_clone_batch_recovery import recovery_scope
from test_imagine_cache_recovery import functions


class OfficialLineageTests(unittest.TestCase):
    def test_only_explicit_parent_or_explicit_t2i_root_is_authoritative(self):
        scope = functions('imagine_official_asset_lineage',
                          imagine_conversation_media_gen=lambda a: a.get('generation', {}),
                          imagine_asset_reference_source_ids=lambda a: a.get('references', []))
        read = scope['imagine_official_asset_lineage']
        self.assertEqual(read({'assetId': 'video'}), {})
        self.assertEqual(read({'assetId': 'video', 'generation': {'action': 'imageToVideo'}}), {})
        self.assertEqual(read({'assetId': 'video', 'references': ['parent']})['source_ids'], ['parent'])
        self.assertEqual(read({'assetId': 'root', 'generation': {'action': 'textToImage'}})['source_ids'], [])

    def test_relation_and_both_caches_corrected_account_scoped_and_idempotent(self):
        item = {'item_id': 'video', 'source_item_id': 'wrong', 'parent_post_id': 'wrong',
                'metadata': {'imagine': {'original_post_id': 'wrong'}}}
        records = {'a': {'account_key': 'active', 'items': [copy.deepcopy(item)]},
                   'b': {'account_key': 'other', 'items': [copy.deepcopy(item)]}}
        caches = {key: [{'items': [copy.deepcopy(item)]}] for key in ('active', 'active:liked', 'other')}
        before_other = copy.deepcopy((records['b'], caches['other']))
        writes = []
        def upsert(root, key, record):
            writes.append(key)
            records[key] = record
        def transform(root, keys, change):
            for key in keys:
                caches[key] = [change(post) for post in caches[key]]
        scope = recovery_scope()
        scope.update(functions('imagine_reconcile_official_lineage_state',
            imagine_item_asset_id=scope['imagine_item_asset_id'],
            imagine_reconcile_official_lineage_cards=scope['imagine_reconcile_official_lineage_cards'],
            IMAGINE_RELATION_STATE_LOCK=threading.RLock(),
            imagine_account_settings_key=lambda a: a['id'],
            imagine_liked_cache_account_key=lambda a: a['id'] + ':liked',
            library_index=SimpleNamespace(transform_imagine_remote_posts=transform)))
        # Function extraction returns its execution globals with the same helper bindings.
        fn = scope['imagine_reconcile_official_lineage_state']
        fn.__globals__['imagine_state'] = SimpleNamespace(
            load_generated_relations=lambda root: records, upsert_generated_relation=upsert)
        evidence = {'video': {'asset_id': 'video', 'source_ids': ['correct'],
                               'conversation_id': 'actual', 'transport': 'asset'}}
        fn(Path('/unused'), {'id': 'active'}, evidence)
        self.assertEqual(records['a']['items'][0]['source_item_id'], 'correct')
        for key in ('active', 'active:liked'):
            self.assertEqual(caches[key][0]['items'][0]['source_item_id'], 'correct')
        self.assertEqual((records['b'], caches['other']), before_other)
        count = len(writes)
        fn(Path('/unused'), {'id': 'active'}, evidence)
        self.assertEqual(len(writes), count)


if __name__ == '__main__':
    unittest.main()
