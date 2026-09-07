"""Isolated production-function tests: no live library, network, or server startup."""
import ast
import copy
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace
import unittest
from urllib.parse import urlencode

SOURCE = Path(__file__).resolve().parents[1] / 'common/app/runtime/server.py'
TREE = ast.parse(SOURCE.read_text())


def functions(*names, **bindings):
    scope = dict(Path=Path, json=json, ThreadPoolExecutor=ThreadPoolExecutor,
                 as_completed=as_completed, urlencode=urlencode, **bindings)
    selected = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), scope)
    return scope


class CacheRecoveryTests(unittest.TestCase):
    def test_restore_exact_account_owned_lineage_and_exclusions(self):
        posts = [{'post_id': 'source', 'folder_path': 'imagine_saved/source',
                  'items': [{'item_id': 'source'}]}]
        original = copy.deepcopy(posts)
        for account_key, source_path, expected in [
            ('account', 'imagine_saved/source', ['source', 'result']),
            ('other', 'imagine_saved/source', ['source']),
            ('', 'imagine_saved/source', ['source']),
            ('account', 'imagine_saved/other', ['source']),
        ]:
            relations = {'source': {'account_key': account_key, 'source_post_path': source_path,
                                   'items': [{'item_id': 'result'}, {'item_id': 'hidden'}]}}
            def merge(post, root, account, records, **options):
                self.assertFalse(options['ensure_upload_bundle'])
                self.assertTrue(options['allow_cross_conversation_relations'])
                post['items'].extend(copy.deepcopy(records['source']['items']))
            scope = functions('restore_imagine_display_relations',
                ensure_imagine_state_migrated=lambda root: None,
                imagine_account_settings_key=lambda account: 'account',
                imagine_state=SimpleNamespace(load_generated_relations=lambda root: relations),
                imagine_pending_delete_ids=lambda root, account: set(),
                imagine_local_exclusion_ids=lambda root, account: {'hidden'},
                imagine_item_asset_id=lambda item: item['item_id'],
                imagine_apply_generated_relations=merge)
            result = scope['restore_imagine_display_relations'](posts, Path('/unused'), {})
            self.assertEqual([i['item_id'] for i in result[0]['items']], expected)
            self.assertEqual(posts, original)

    def test_detail_failures_abort_instead_of_returning_partial_list(self):
        for message in ['Imagine HTTP 429: Too many requests', 'Imagine HTTP 503', 'timed out']:
            def fail(*args):
                raise RuntimeError(message)
            scope = functions('list_imagine_saved',
                library_root=lambda: Path('/unused'),
                active_imagine_account=lambda *args: {'id': 'account'},
                imagine_current_owner_user_id=lambda account: 'owner',
                decode_imagine_saved_cursor=lambda cursor: ('', '', False, False, 0),
                imagine_get_json=lambda *args, **kwargs: {'conversations': [
                    {'conversationId': 'conversation', 'latestAssetMetadata': {}}]},
                imagine_conversation_detail=fail,
                imagine_debug_event=lambda *args: None,
                imagine_error_is_confirmed_not_found=lambda error: False)
            with self.assertRaisesRegex(RuntimeError, 'previous cards retained'):
                scope['list_imagine_saved']({'cursor': 'page'})

    def test_fallback_lookup_rejects_429_but_preserves_confirmed_deletion(self):
        for confirmed in [False, True]:
            def fail(*args):
                raise RuntimeError('404' if confirmed else '429')
            scope = functions('imagine_recover_missing_direct_upload_conversation_cards',
                imagine_conversation_detail=fail,
                imagine_debug_event=lambda *args: None,
                imagine_error_is_confirmed_not_found=lambda error: confirmed)
            run = lambda: scope['imagine_recover_missing_direct_upload_conversation_cards'](
                {'conversation': {'proves_deletion': True}}, {})
            if confirmed:
                self.assertEqual(run(), ([], {'conversation'}))
            else:
                with self.assertRaisesRegex(RuntimeError, 'previous cards retained'):
                    run()


if __name__ == '__main__':
    unittest.main()
