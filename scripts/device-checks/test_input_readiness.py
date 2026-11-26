import unittest
from input_readiness import keyboard_ready


class KeyboardReadinessTests(unittest.TestCase):
    def test_served_package_and_visible_keyboard_are_required(self):
        self.assertTrue(keyboard_ready('mInputShown=true\npackageName=com.folio.reader fieldId=4', 'com.folio.reader'))
        self.assertFalse(keyboard_ready('mInputShown=false\npackageName=com.folio.reader fieldId=4', 'com.folio.reader'))

    def test_another_editor_does_not_receive_the_injected_text(self):
        self.assertFalse(keyboard_ready('mInputShown=true\npackageName=com.android.documentsui fieldId=4', 'com.folio.reader'))
        self.assertFalse(keyboard_ready('mInputShown=true\npackageName=com.folio.reader.dev fieldId=4', 'com.folio.reader'))

    def test_visible_window_flags_and_target_activity_are_supported(self):
        self.assertTrue(keyboard_ready('mImeWindowVis=0x3\nmCurFocusedWindow=Window{123 u0 com.folio.reader/.MainActivity}', 'com.folio.reader'))
        self.assertFalse(keyboard_ready('mImeWindowVis=0x1\nmCurFocusedWindow=Window{123 u0 com.folio.reader/.MainActivity}', 'com.folio.reader'))

    def test_pending_connection_does_not_count_as_keyboard_readiness(self):
        self.assertFalse(keyboard_ready('mInputShown=true\npackageName=com.folio.reader\nmServedConnecting=true', 'com.folio.reader'))

    def test_absent_input_service_state_never_passes(self):
        self.assertFalse(keyboard_ready('', 'com.folio.reader'))
