"""Exercise Reference persistence on temporary libraries, with downloads mocked."""
import ast
import copy
import json
import os
from pathlib import Path
import tempfile
import threading
import sqlite3
import shutil
from types import SimpleNamespace
import unittest
import unicodedata
from urllib.parse import unquote

SOURCE = Path(__file__).resolve().parents[1] / "common/app/runtime/server.py"
TREE = ast.parse(SOURCE.read_text())


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.downloaded = []
        self.refreshed = []
        self.fail_id = None
        def download(root, item, target, account, index):
            self.downloaded.append(item['item_id'])
            if item['item_id'] == self.fail_id:
                raise RuntimeError('download failed')
            file = unique_path(target / (item.get('filename') or item['item_id'] + '.png'))
            file.write_bytes(item['item_id'].encode())
            return {**item, 'file': file.name, 'url': '', 'source_url': item['url']}
        def unique_path(path):
            candidate, suffix = path, 1
            while candidate.exists():
                candidate = path.with_name(f'{path.stem}-{suffix}{path.suffix}')
                suffix += 1
            return candidate
        def safe_join(root, rel):
            result = (root / rel).resolve()
            if root.resolve() not in result.parents:
                raise ValueError('outside library')
            return result
        def read_json(path, default=None):
            return json.loads(path.read_text()) if path.exists() else default
        def write_json(path, data):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
        self.scope = dict(
            Path=Path, tempfile=tempfile, os=os, unquote=unquote, library_root=lambda: self.root,
            COLLECTION_MOVE_LOCK=threading.Lock(),
            build_post_save_lock=lambda target: threading.Lock(),
            normalize_unicode_text=lambda value: unicodedata.normalize('NFC', value),
            imagine_item_asset_id=lambda item: item.get('item_id', ''),
            remote_imagine_item_url=lambda item: item.get('source_url') or item.get('url', ''),
            active_imagine_account=lambda *args: {'id': 'account'},
            copy_imagine_remote_item_to_directory=download,
            read_json=read_json, write_json=write_json, safe_join=safe_join,
            unique_path=unique_path, now_iso=lambda: '2026-09-08T00:00:00Z',
            safe_int=lambda value, default=0: int(value or default),
            serializable_media_item=lambda item: dict(item),
            representative_for_merged_items=lambda items: items[-1]['file'],
            refresh_library_index_paths=lambda root, paths: self.refreshed.extend(paths),
            post_from_folder=lambda root, folder, context: {**read_json(folder / 'post.json'), **context},
        )
        names = {'reference_item_key', 'save_imagine_post_to_reference', 'remote_imagine_payload_post',
                 'safe_name', 'post_json_from_post', 'indexed_post_context', 'ensure_library_root',
                 'copy_imagine_remote_post_to_collection', 'build_append_target'}
        nodes = [n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), self.scope)
        self.source = {'post_id': 'card-123', 'source': 'imagine', 'area': 'imagine_remote',
                       'remote': True, 'account_id': 'account', 'liked': True,
                       'items': [{'item_id': 'one', 'type': 'image', 'url': 'https://example.test/one'},
                                 {'item_id': 'two', 'type': 'image', 'url': 'https://example.test/two'}]}

    def save(self):
        return self.scope['save_imagine_post_to_reference']({'source_post': self.source})

    def metadata(self):
        return json.loads((self.root / '레퍼런스/card-123/post.json').read_text())

    def test_whole_card_saved_without_changing_liked_source(self):
        original = copy.deepcopy(self.source)
        result = self.save()
        self.assertEqual(result['post']['area'], 'reference')
        self.assertEqual(result['post']['folder_path'], '레퍼런스/card-123')
        self.assertEqual(self.source, original)
        self.assertEqual(self.downloaded, ['one', 'two'])
        self.assertEqual(self.refreshed, ['레퍼런스/card-123'])
        self.assertEqual(len(self.metadata()['items']), 2)

    def test_repeat_save_and_added_media_preserve_existing_files(self):
        self.save()
        self.assertEqual(self.save()['saved_count'], 0)
        self.source['items'].append({'item_id': 'three', 'url': 'https://example.test/three', 'type': 'image'})
        self.assertEqual(self.save()['saved_count'], 1)
        self.assertEqual(self.downloaded, ['one', 'two', 'three'])
        self.assertEqual(len(list((self.root / '레퍼런스').iterdir())), 1)
        self.assertEqual(len(self.metadata()['items']), 3)

    def test_download_failure_publishes_no_partial_new_card(self):
        self.fail_id = 'two'
        with self.assertRaisesRegex(RuntimeError, 'download failed'):
            self.save()
        self.assertFalse((self.root / '레퍼런스/card-123').exists())
        self.assertEqual(list((self.root / 'cache').iterdir()), [])

    def test_failed_update_keeps_existing_metadata_and_media(self):
        self.save()
        before = self.metadata()
        self.source['items'] += [{'item_id': id, 'url': 'https://example.test/' + id} for id in ['three', 'four']]
        self.fail_id = 'four'
        with self.assertRaises(RuntimeError):
            self.save()
        self.assertEqual(self.metadata(), before)
        self.assertFalse((self.root / '레퍼런스/card-123/three.png').exists())

    def test_filename_collisions_and_duplicate_items(self):
        self.source['items'][0]['filename'] = 'same.png'
        self.save()
        self.source['items'] += [{'item_id': 'three', 'url': 'https://example.test/three', 'filename': 'same.png'}] * 2
        self.save()
        files = [i['file'] for i in self.metadata()['items']]
        self.assertEqual(len(files), 3)
        self.assertEqual(len(set(files)), 3)
        self.assertEqual((self.root / '레퍼런스/card-123/same.png').read_bytes(), b'one')
        self.assertEqual(self.downloaded.count('three'), 1)

    def test_missing_media_is_repaired_on_repeat_save(self):
        self.save()
        (self.root / '레퍼런스/card-123/one.png').unlink()
        self.assertEqual(self.save()['saved_count'], 1)
        self.assertEqual((self.root / '레퍼런스/card-123/one.png').read_bytes(), b'one')

    def test_unsafe_card_ids_are_rejected(self):
        for id in ('..', '../other', '/outside', 'a/b', '%2e%2e%2fcreated', ''):
            self.source['post_id'] = id
            with self.assertRaises(RuntimeError):
                self.save()

    def test_library_setup_creates_reference_folder(self):
        folders = next(n for n in TREE.body if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == 'LIBRARY_FOLDERS' for t in n.targets))
        self.scope.update(LIBRARY_FOLDERS=ast.literal_eval(folders.value), default_library_json=lambda: {},
                          default_build_auth=lambda: {}, default_imagine_auth=lambda: {})
        self.scope['ensure_library_root'](self.root)
        self.assertTrue((self.root / '레퍼런스').is_dir())

    def test_build_modes_append_to_local_reference_card(self):
        self.save()
        for action in ('i2i', 'i2v', 'extend', 'video_edit'):
            result = self.scope['build_append_target'](self.root, action, [{'detail_post_path': '레퍼런스/card-123'}])
            self.assertEqual(result, ((self.root / '레퍼런스/card-123').resolve(), '레퍼런스/card-123'))

    def test_repeat_save_preserves_build_results_and_metadata(self):
        self.save()
        folder = self.root / '레퍼런스/card-123'
        data = self.metadata()
        data['build_requests'] = [{'action': 'i2v'}]
        data['items'].append({'item_id': 'build-video', 'type': 'video', 'file': 'build.mp4'})
        data['representative'] = 'build.mp4'
        (folder / 'build.mp4').write_bytes(b'build-result')
        (folder / 'post.json').write_text(json.dumps(data))
        self.save()
        self.assertEqual(self.metadata()['build_requests'], data['build_requests'])
        self.assertEqual(self.metadata()['representative'], 'build.mp4')
        self.assertEqual(self.metadata()['items'], data['items'])

    def test_collection_copy_never_hides_remote_source_even_on_repeat(self):
        parent = self.root / 'collection/category'
        parent.mkdir(parents=True)
        def forbidden(*args):
            self.fail('Collection copy must not hide or unsave its source')
        self.scope.update(
            validate_collection_target_parent=lambda *args: parent,
            existing_remote_collection_post=lambda *args: None,
            unique_directory_name=lambda parent, name: name,
            readable_name=lambda name: name,
            shutil=shutil, current_library_snapshot=lambda root: {'ok': True},
            hide_imagine_source_moved_to_collection=forbidden,
            media_item_key=lambda item: item.get('item_id', ''),
        )
        payload = {'source_post': self.source, 'collection_path': 'collection/category'}
        before = copy.deepcopy(self.source)
        result = self.scope['copy_imagine_remote_post_to_collection'](payload)
        self.assertNotIn('imagine_moved_ids', result)
        folder = parent / 'card-123'
        self.scope['existing_remote_collection_post'] = lambda *args: (folder, json.loads((folder / 'post.json').read_text()))
        repeat = self.scope['copy_imagine_remote_post_to_collection'](payload)
        self.assertNotIn('imagine_moved_ids', repeat)
        self.assertEqual(self.source, before)

    def test_old_collection_move_exclusions_do_not_hide_cards(self):
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.execute('CREATE TABLE imagine_local_exclusions (account_key TEXT, asset_id TEXT, reason TEXT)')
        connection.executemany('INSERT INTO imagine_local_exclusions VALUES (?,?,?)',
                              [('a', 'moved', 'moved_to_collection'), ('a', 'unsaved', 'external_unsave'), ('b', 'other', 'external_unsave')])
        source = SOURCE.with_name('imagine_state.py')
        node = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'local_exclusion_ids')
        scope = {'Path': Path, '_connect': lambda root: connection}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), scope)
        self.assertEqual(scope['local_exclusion_ids'](self.root, 'a'), {'unsaved'})


if __name__ == '__main__':
    unittest.main()
