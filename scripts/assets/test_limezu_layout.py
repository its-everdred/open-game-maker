"""Tests for identifying equivalent Modern Farm files across sizes."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import limezu_layout as layout


class SizeVariants(unittest.TestCase):
    def test_type_one_fence_matches_vendor_name_without_type_at_16px(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = [
                '32x32/Single_Files_32x32/Fences_32x32/Wooden_Fence_Type_1_Yellow_Brown_1_32x32.png',
                '16x16/Single_Files_16x16/Fences_16x16/Wooden_Fence_Yellow_Brown_1_16x16.png',
                '48x48/Single_Files_48x48/Fences_48x48/Wooden_Fence_Type_1_Yellow_Brown_1_48x48.png',
            ]
            for name in paths:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(layout.size_variants(root, root / paths[0]), [root / paths[1], root / paths[2]])

    def test_matches_corresponding_files_without_confusing_duplicate_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = [
                '32x32/Animals_32x32/Cows_32x32/Cow_32x32.png',
                '16x16/Animals_16x16/Cows/Cow_16x16.png',
                '48x48/Animals_48x48/Cows_48x48/Cow_48x48.png',
                '16x16/Animals_16x16/Goats/Goat_16x16.png',
                '16x16/Animals_16x16/Cows/Old_Cow/Cow_16x16.png',
            ]
            for path in paths:
                p = root / path
                p.parent.mkdir(parents=True, exist_ok=True)
                p.touch()
            variants = layout.size_variants(root, root / paths[0])
            self.assertEqual([p.relative_to(root).as_posix() for p in variants], [paths[1], paths[2]])

    def test_ambiguous_normalized_sibling_is_not_guessed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('32x32/Cows_32x32/Cow_32x32.png', '16x16/Cows/Cow.png',
                         '16x16/Cows_16x16/Cow_16x16.png'):
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.touch()
            with self.assertRaisesRegex(ValueError, 'ambiguous'):
                layout.size_variants(root, root / '32x32/Cows_32x32/Cow_32x32.png')

    def test_complete_tileset_folder_names_map_across_vendor_sizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            canonical = root / '32x32/Single_Files_32x32/0_Complete_Tileset_Singles_32x32/Tree_32x32.png'
            sibling = root / '48x48/Single_Files_48x48/0_Complete_Tileset_48x48/Tree_48x48.png'
            for path in (canonical, sibling):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(layout.size_variants(root, canonical), [sibling])

    def test_extra_separator_before_size_does_not_hide_sibling(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            canonical = root / '32x32/Fences_32x32/Corner__32x32.png'
            sibling = root / '48x48/Fences_48x48/Corner_48x48.png'
            for path in (canonical, sibling):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(layout.size_variants(root, canonical), [sibling])

    def test_internal_extra_separator_does_not_hide_sibling(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            canonical = root / '32x32/Props_32x32/Manger_Small__Full_32x32.png'
            sibling = root / '16x16/Props_16x16/Manger_Small_Full_16x16.png'
            for path in (canonical, sibling):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(layout.size_variants(root, canonical), [sibling])

    def test_numbered_vendor_copy_matches_only_when_unambiguous(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            canonical = root / '32x32/Fences_32x32/Upper_32x32.png'
            sibling = root / '16x16/Fences_16x16/Upper_16x16 (1).png'
            for path in (canonical, sibling):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(layout.size_variants(root, canonical), [sibling])
            duplicate = sibling.with_name('Upper_16x16.png')
            duplicate.touch()
            with self.assertRaisesRegex(ValueError, 'ambiguous'):
                layout.size_variants(root, canonical)


class CardGeneration(unittest.TestCase):
    def test_each_gif_resolution_has_measured_animation_metadata(self):
        from test_smallscaleint import png
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for size in (16, 32, 48):
                sheet = root / f'{size}x{size}/Animated_{size}x{size}/Animated_sheets_{size}x{size}/Fire_{size}x{size}.png'
                gif = root / f'{size}x{size}/Animated_{size}x{size}/Animated_gifs_{size}x{size}/Fire_{size}x{size}.gif'
                sheet.parent.mkdir(parents=True)
                gif.parent.mkdir(parents=True)
                sheet.write_bytes(png(2, 1))
                gif.write_bytes(bytes.fromhex('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024401003b'))
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            card = layout.build_cards(root, collection)[0]
            self.assertEqual(len(card['sprite']['animations']), 3)
            self.assertEqual(sum(f['path'].endswith('.gif') for f in card['source']['files']), 3)
            for animation in card['sprite']['animations']:
                self.assertEqual((animation['frame_size'], animation['fps']), ({'width': 1, 'height': 1}, 10))
                self.assertEqual(animation['frames'], [0, 1])
                self.assertIn('sheets', animation)

    def test_canonical_source_and_size_siblings_share_one_card(self):
        from test_smallscaleint import png
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for size in (16, 32, 48):
                path = root / f'{size}x{size}' / f'Animals_{size}x{size}' / f'Cows_{size}x{size}' / f'Cow_{size}x{size}.png'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(png(size, size))
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            cards = layout.build_cards(root, collection)
            self.assertEqual(len(cards), 1)
            card = cards[0]
            self.assertEqual(card['title'], 'Cow')
            self.assertIn('cow', card['describe']['objects'])
            self.assertEqual(card['image']['width_px'], 32)
            self.assertEqual([f['role'] for f in card['source']['files']], ['primary', 'companion', 'companion'])
            self.assertTrue(card['source']['files'][0]['path'].startswith('32x32/'))
            self.assertEqual(card['source']['content_hash'], card['source']['files'][0]['sha256'])

    def test_animation_uses_matching_strip_and_measured_gif_timing(self):
        from test_smallscaleint import png
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sheet = root / '32x32/Animated_32x32/Animated_sheets_32x32/Fire_32x32.png'
            gif = root / '32x32/Animated_32x32/Animated_gifs_32x32/Fire_32x32.gif'
            sheet.parent.mkdir(parents=True)
            gif.parent.mkdir(parents=True)
            sheet.write_bytes(png(2, 1))
            header = bytes.fromhex('47494638396101000100800000000000ffffff')
            control = bytes.fromhex('21f904000a000000')
            frame = bytes.fromhex('2c0000000001000100000202440100')
            gif.write_bytes(header + control + frame + control + frame + b'\x3b')
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            card = layout.build_cards(root, collection)[0]
            animation = card['sprite']['animations'][0]
            self.assertEqual(animation['frames'], [0, 1])
            self.assertEqual(animation['fps'], 10)
            self.assertEqual(animation['sheets'][0]['path'], sheet.relative_to(root).as_posix())
            self.assertEqual(animation['sheets'][0]['frame_w'], 1)

    def test_irregular_strip_keeps_gif_frame_size_without_guessing_frame_order(self):
        from test_smallscaleint import png
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sheet = root / '32x32/Animated_32x32/Animated_sheets_32x32/Fire_32x32.png'
            gif = root / '32x32/Animated_32x32/Animated_gifs_32x32/Fire_32x32.gif'
            sheet.parent.mkdir(parents=True)
            gif.parent.mkdir(parents=True)
            sheet.write_bytes(png(4, 1))
            header = bytes.fromhex('47494638396101000100800000000000ffffff')
            control = bytes.fromhex('21f904000a000000')
            frame = bytes.fromhex('2c0000000001000100000202440100')
            gif.write_bytes(header + control + frame + control + frame + b'\x3b')
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            card = layout.build_cards(root, collection)[0]
            self.assertEqual(card['sprite']['sheet'], {'frame_w': 1, 'frame_h': 1, 'cols': 4, 'rows': 1})
            self.assertEqual(card['sprite']['animations'][0]['files'], [gif.relative_to(root).as_posix()])

    def test_gif_without_strip_still_gets_a_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gif = root / '32x32/Animated_32x32/Animated_gifs_32x32/Fire_32x32.gif'
            gif.parent.mkdir(parents=True)
            gif.write_bytes(bytes.fromhex('47494638396101000100800000000000ffffff21f904000a0000002c00000000010001000002024401003b'))
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            card = layout.build_cards(root, collection)[0]
            self.assertEqual(card['source']['files'][0]['path'], gif.relative_to(root).as_posix())
            self.assertEqual(card['sprite']['animations'][0]['files'], [gif.relative_to(root).as_posix()])
            self.assertEqual(card['image']['width_px'], 1)

    def test_icons_outside_the_main_size_tree_get_cards(self):
        from test_smallscaleint import png
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for size in (16, 32):
                path = root / 'Icons' / f'Icons_{size}x{size}' / f'Icons_{size}x{size}' / f'Apple_{size}x{size}.png'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(png(size, size))
            collection = {'id': 't1:limezu-modern-farm@1.3', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'}
            cards = layout.build_cards(root, collection)
            self.assertEqual(len(cards), 1)
            self.assertEqual(len(cards[0]['source']['files']), 2)
            self.assertEqual(cards[0]['sprite']['drawn_view'], 'none')


class GifMetadata(unittest.TestCase):
    def test_reads_frames_and_delays_without_decoding_pixels(self):
        import limezu_gif
        # Two 1x1 frames with 100 ms delays and one global color table.
        header = bytes.fromhex('47494638396101000100800000000000ffffff')
        control = bytes.fromhex('21f904000a000000')
        frame = bytes.fromhex('2c0000000001000100000202440100')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'anim.gif'
            path.write_bytes(header + control + frame + control + frame + b'\x3b')
            self.assertEqual(limezu_gif.metadata(path), {'width': 1, 'height': 1, 'frames': 2, 'fps': 10.0, 'has_alpha': False})
            path.write_bytes(header + control + frame[:-1])
            with self.assertRaises(ValueError):
                limezu_gif.metadata(path)


if __name__ == '__main__':
    unittest.main()
