"""Live Liked checks must repair missing parents without deleting unverified media."""
import copy
import unittest
from urllib.parse import quote

from test_clone_batch_recovery import recovery_scope
from test_imagine_cache_recovery import functions


def image(asset_id='image', parent='', batch='batch'):
    return {'assetId': asset_id, 'mimeType': 'image/jpeg',
            'key': 'https://example.invalid/' + asset_id + '.jpg',
            'sourceConversationId': batch,
            'parents': [parent] if parent else []}


def video(asset_id='video', parent='original-image', batch='batch'):
    return {**image(asset_id, parent, batch), 'mimeType': 'video/mp4',
            'key': 'https://example.invalid/' + asset_id + '.mp4'}


def receipt(asset_id, mime, batch='batch'):
    return {'asset_id': asset_id, 'source_asset_id': 'original-' + asset_id,
            'conversation_id': batch, 'media_type': mime,
            'media_url': 'https://example.invalid/' + asset_id}


def item(asset):
    asset_id = asset['assetId']
    parents = asset.get('parents')
    metadata = {'imagine': {}}
    if parents is not None:
        metadata['imagine']['official_lineage'] = {
            'asset_id': asset_id, 'source_ids': parents,
            'conversation_id': asset.get('sourceConversationId', ''), 'transport': 'asset'}
    return {'item_id': asset_id, 'asset_id': asset_id,
            'type': 'image' if asset['mimeType'].startswith('image') else 'video',
            'mime_type': asset['mimeType'], 'url': asset['key'], 'remote_url': asset['key'],
            'conversation_id': asset.get('sourceConversationId', ''),
            'source_item_id': next(iter(parents or []), ''),
            'metadata': metadata, 'created_at': '2026-01-01'}


def card(*assets, batch='batch'):
    return {'post_id': batch, 'created_at': '2026-01-01', 'items': [item(a) for a in assets],
            'metadata': {'saved_provenance': 'cloned-liked', 'liked_scope': 'foreign-origin',
                         'official_clone_assets': [receipt('image', 'image/jpeg', batch),
                                                   receipt('video', 'video/mp4', batch)]}}


def setup(responses, available=False):
    scope = recovery_scope()
    requests = []
    probes = []

    def get(endpoint, account, **kwargs):
        asset_id = endpoint.rsplit('/', 1)[-1]
        requests.append((asset_id, account['id']))
        value = responses.get(asset_id, RuntimeError('Imagine HTTP 404'))
        if isinstance(value, Exception):
            raise value
        return {'asset': copy.deepcopy(value)}

    def materialize(asset, account):
        return {'items': [item(asset)]}

    def probe(url, account, kind, **kwargs):
        probes.append((url, account['id'], kind))
        return available

    bindings = {key: scope[key] for key in (
        'imagine_item_asset_id', 'imagine_normalize_external_clone_records',
        'imagine_item_clone_record', 'imagine_item_official_lineage',
        'imagine_apply_official_item_lineage', 'imagine_group_external_clone_batch_cards',
        'merge_imagine_liked_lineage_cards')}
    fn = functions('imagine_revalidate_liked_assets', quote=quote,
                   imagine_get_json=get, imagine_unsaved_post_from_asset=materialize,
                   imagine_remote_media_available=probe,
                   imagine_representative_item=lambda items: items[-1], **bindings)
    return fn['imagine_revalidate_liked_assets'], requests, probes


def held(posts):
    return {i['item_id'] for p in posts for i in p['items']}


class LikedAssetRevalidationTests(unittest.TestCase):
    def test_missing_receipt_image_is_verified_restored_and_rebound(self):
        original = [card(video())]
        before = copy.deepcopy(original)
        verify, calls, _ = setup({'video': video(), 'image': image()})
        result, errors, report = verify(original, {'id': 'active'})
        self.assertEqual(held(result), {'image', 'video'})
        self.assertEqual(len(result), 1)
        child = next(i for i in result[0]['items'] if i['type'] == 'video')
        self.assertEqual(child['source_item_id'], 'image')
        self.assertEqual(report['recovered'], 1)
        self.assertEqual(errors, [])
        self.assertEqual({a for _, a in calls}, {'active'})
        self.assertEqual(original, before)

    def test_existing_assets_rechecked_on_every_live_read(self):
        verify, calls, _ = setup({'video': video(), 'image': image()})
        first = verify([card(video(), image())], {'id': 'active'})[0]
        second = verify(first, {'id': 'active'})[0]
        self.assertEqual(len(calls), 4)
        self.assertEqual(first, second)
        self.assertEqual(sum(len(p['items']) for p in second), 2)

    def test_404_detail_with_working_recorded_url_restores_image(self):
        verify, _, probes = setup({'video': video()}, available=True)
        result, errors, report = verify([card(video())], {'id': 'active'})
        self.assertEqual(held(result), {'image', 'video'})
        self.assertEqual(report['recovered'], 1)
        self.assertEqual(report['confirmed_deleted_asset_ids'], [])
        self.assertEqual(len(errors), 1)  # Detail is still unverified, so no pruning.
        self.assertEqual(len(probes), 1)

    def test_failed_requests_preserve_existing_items_and_input(self):
        original = [card(video(), image())]
        before = copy.deepcopy(original)
        verify, _, _ = setup({'video': RuntimeError('429'), 'image': RuntimeError('timeout')})
        result, errors, report = verify(original, {'id': 'active'})
        self.assertEqual(held(result), {'image', 'video'})
        self.assertEqual(len(errors), 2)
        self.assertEqual(report['confirmed_deleted_asset_ids'], [])
        self.assertEqual(original, before)

    def test_missing_unavailable_original_is_not_invented(self):
        verify, _, _ = setup({'video': video()})
        result, errors, report = verify([card(video())], {'id': 'active'})
        self.assertEqual(held(result), {'video'})
        self.assertEqual(report['recovered'], 0)
        self.assertTrue(errors)

    def test_hidden_original_is_never_requested_or_restored(self):
        verify, calls, _ = setup({'video': video(), 'image': image()})
        result, _, _ = verify([card(video())], {'id': 'active'}, hidden_ids={'image'})
        self.assertEqual(held(result), {'video'})
        self.assertEqual([asset_id for asset_id, _ in calls], ['video'])

    def test_only_explicit_deleted_flag_removes_existing_item(self):
        verify, _, probes = setup({'video': video(), 'image': {**image(), 'isDeleted': True}}, available=True)
        result, errors, report = verify([card(video(), image())], {'id': 'active'})
        self.assertEqual(held(result), {'video'})
        self.assertEqual(report['confirmed_deleted_asset_ids'], ['image'])
        self.assertEqual(errors, [])
        self.assertEqual(probes, [])

    def test_current_parent_replaces_stale_edge_and_fetches_missing_parent(self):
        plain = {'post_id': 'plain', 'items': [item(video(parent='wrong'))], 'metadata': {}}
        verify, calls, _ = setup({'video': video(parent='correct'), 'correct': image('correct')})
        result, _, _ = verify([plain], {'id': 'active'})
        self.assertEqual(held(result), {'video', 'correct'})
        self.assertEqual(result[0]['items'][0]['source_item_id'], 'correct')
        self.assertEqual({asset_id for asset_id, _ in calls}, {'video', 'correct'})

    def test_duplicate_receipts_do_not_duplicate_requests_or_items(self):
        original = card(video())
        original['metadata']['official_clone_assets'] *= 2
        verify, calls, _ = setup({'video': video(), 'image': image()})
        result, _, _ = verify([original], {'id': 'active'})
        self.assertEqual(len(calls), 2)
        self.assertEqual(sum(len(p['items']) for p in result), 2)

    def test_mismatched_response_id_cannot_replace_existing_asset(self):
        verify, _, _ = setup({'video': video('unrelated'), 'image': image()})
        original = card(video())
        result, errors, _ = verify([original], {'id': 'active'})
        self.assertEqual(held(result), {'video', 'image'})
        self.assertTrue(errors)
        self.assertNotIn('unrelated', held(result))

    def test_cycles_terminate(self):
        plain = {'post_id': 'plain', 'items': [item(video(parent='image'))], 'metadata': {}}
        verify, calls, _ = setup({'video': video(parent='image'), 'image': image(parent='video')})
        result, _, report = verify([plain], {'id': 'active'})
        self.assertEqual(held(result), {'video', 'image'})
        self.assertEqual(len(calls), 2)
        self.assertEqual(report['checked'], 2)

    def test_pending_slot_without_remote_asset_id_is_preserved(self):
        original = card(video())
        original['items'].append({'type': 'video', 'status': 'moderated'})
        verify, _, _ = setup({'video': video(), 'image': image()})
        result, _, _ = verify([original], {'id': 'active'})
        self.assertTrue(any(i.get('status') == 'moderated' for p in result for i in p['items']))

    def test_copied_image_does_not_import_foreign_ancestors(self):
        verify, calls, _ = setup({'video': video(), 'image': image(parent='foreign-grandparent'),
                                 'foreign-grandparent': image('foreign-grandparent')})
        result, _, _ = verify([card(video())], {'id': 'active'})
        self.assertEqual(held(result), {'image', 'video'})
        self.assertEqual(len(result), 1)
        self.assertEqual({asset_id for asset_id, _ in calls}, {'video', 'image'})

    def test_bundle_hidden_source_stays_hidden_even_if_officially_available(self):
        original = card(video())
        original['metadata'].update(source_hidden_in_bundle=True, upload_source_asset_id='image')
        verify, calls, _ = setup({'video': video(), 'image': image()})
        result, _, _ = verify([original], {'id': 'active'})
        self.assertEqual(held(result), {'video'})
        self.assertEqual({asset_id for asset_id, _ in calls}, {'video'})


if __name__ == '__main__':
    unittest.main()
