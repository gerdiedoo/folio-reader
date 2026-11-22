import unittest
from tap_geometry import exposed_book_point


class BookTapTests(unittest.TestCase):
    def test_partly_visible_card_uses_exposed_cover_above_tabs(self):
        point = exposed_book_point([28, 1800, 520, 2500], 1080, 2400, 2150)
        self.assertIsNotNone(point)
        self.assertTrue(1800 < point[1] < 2150)

    def test_fully_covered_card_requires_scroll(self):
        self.assertIsNone(exposed_book_point([28, 2180, 520, 2500], 1080, 2400, 2150))

    def test_card_clipped_by_header_uses_its_exposed_part(self):
        self.assertEqual(exposed_book_point([28, 0, 520, 900], 1080, 2400, 2150), (274, 472))


if __name__ == '__main__':
    unittest.main()
