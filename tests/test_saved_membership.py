"""Live cross-conversation families must survive the final Saved membership filter."""
import copy
import unittest

from test_imagine_cache_recovery import functions


def detail(*ids):
    return {'responses': [{'fileAttachmentAssetMetadata': [{'assetId': value} for value in ids]}]}


def card(provenance='normal-saved'):
    return {'metadata': {'saved_provenance': provenance}, 'items': [
        {'item_id': 'image', 'conversation_id': 'root'},
        {'item_id': 'video', 'conversation_id': 'video-conversation', 'source_item_id': 'image'},
        {'item_id': 'extended', 'conversation_id': 'extend-conversation', 'source_item_id': 'video'},
    ]}


def scope(fetch):
    return functions('imagine_confirm_saved_conversation_membership', 'imagine_filter_saved_membership',
        'imagine_error_is_confirmed_not_found',
        imagine_post_saved_identity=lambda post: (post['metadata']['saved_provenance'], ''),
        imagine_item_is_upload_source=lambda item: item.get('role') == 'source',
        imagine_relation_conversation_id=lambda item: item.get('conversation_id', ''),
        imagine_item_asset_id=lambda item: item.get('item_id', ''),
        imagine_representative_item=lambda items: items[-1] if items else None,
        imagine_conversation_detail=fetch)


class SavedMembershipTests(unittest.TestCase):
    def test_live_family_missing_from_feed_survives_complete_membership_and_reload(self):
        calls = []
        def fetch(key, account, timeout):
            calls.append(key)
            return detail('extended')
        s = scope(fetch)
        posts = [card()]
        original = copy.deepcopy(posts)
        # The normal conversation-detail pass already fetched the video. Reuse it.
        details = {'video-conversation': detail('image', 'video')}
        membership, missing = s['imagine_confirm_saved_conversation_membership'](posts, {}, {'root'}, details)
        self.assertEqual(membership, {'root', 'video-conversation', 'extend-conversation'})
        self.assertEqual(missing, set())
        self.assertEqual(calls, ['extend-conversation'])
        result = s['imagine_filter_saved_membership'](posts, membership)
        self.assertEqual([item['item_id'] for item in result[0]['items']], ['image', 'video', 'extended'])
        self.assertEqual(s['imagine_filter_saved_membership'](result, membership), result)
        s['imagine_confirm_saved_conversation_membership'](posts, {}, {'root'}, details)
        self.assertEqual(calls, ['extend-conversation'])
        self.assertEqual(posts, original)

    def test_orphan_asset_cannot_revive_deleted_conversation(self):
        def fetch(key, *args):
            raise RuntimeError('Imagine HTTP 404: conversation was not found')
        s = scope(fetch)
        membership, missing = s['imagine_confirm_saved_conversation_membership']([card()], {}, {'root'}, {})
        self.assertEqual(membership, {'root'})
        self.assertEqual(missing, {'video-conversation', 'extend-conversation'})
        self.assertEqual([i['item_id'] for i in s['imagine_filter_saved_membership']([card()], membership)[0]['items']], ['image'])

    def test_existing_conversation_must_contain_actual_result(self):
        s = scope(lambda *args: detail('unrelated-image'))
        membership, _ = s['imagine_confirm_saved_conversation_membership']([card()], {}, {'root'}, {})
        self.assertEqual(membership, {'root'})

    def test_network_failure_does_not_replace_complete_snapshot(self):
        for message in ('Imagine HTTP 401', 'Imagine HTTP 429', 'timed out'):
            def fetch(*args):
                raise RuntimeError(message)
            with self.assertRaisesRegex(RuntimeError, 'previous cards retained'):
                scope(fetch)['imagine_confirm_saved_conversation_membership']([card()], {}, {'root'}, {})

    def test_liked_is_not_reclassified_and_upload_only_is_not_membership(self):
        def fetch(*args):
            raise AssertionError('Unexpected lookup')
        posts = [card('cloned-liked'), {'metadata': {'saved_provenance': 'normal-saved'},
                 'items': [{'item_id': 'upload', 'role': 'source', 'conversation_id': 'deleted'}]}]
        self.assertEqual(scope(fetch)['imagine_confirm_saved_conversation_membership'](posts, {}, set(), {}), (set(), set()))


if __name__ == '__main__':
    unittest.main()
