"""Regression checks for emulator reconnection without requiring an Android SDK."""
import subprocess
import unittest

from adb_session import ensure_emulator_root


class RootSessionTests(unittest.TestCase):
    def runner(self, responses):
        calls = []

        def run(args, **kwargs):
            calls.append(args[1:])
            expected, result = responses.pop(0)
            self.assertEqual(args[1:], expected)
            if isinstance(result, Exception):
                raise result
            code, stdout, stderr = result
            return subprocess.CompletedProcess(args, code, stdout, stderr)

        return run, calls

    def test_already_root_does_not_restart_daemon(self):
        run, calls = self.runner([(['shell', 'id', '-u'], (0, '0\n', ''))])
        ensure_emulator_root(run=run)
        self.assertEqual(len(calls), 1)

    def test_root_transport_error_can_reconnect_as_root(self):
        run, _ = self.runner([
            (['shell', 'id', '-u'], (0, '2000', '')),
            (['root'], (1, '', 'error: closed')),
            (['wait-for-device'], (0, '', '')),
            (['shell', 'id', '-u'], (0, '0', '')),
        ])
        ensure_emulator_root(run=run)

    def test_successful_root_command_still_requires_root_identity(self):
        run, _ = self.runner([
            (['shell', 'id', '-u'], (0, '2000', '')),
            (['root'], (0, 'restarting adbd as root', '')),
            (['wait-for-device'], (0, '', '')),
            (['shell', 'id', '-u'], (0, '2000', '')),
        ])
        with self.assertRaisesRegex(RuntimeError, 'could not be verified'):
            ensure_emulator_root(run=run, attempts=1)

    def test_production_image_fails_with_actual_diagnostic(self):
        run, calls = self.runner([
            (['shell', 'id', '-u'], (0, '2000', '')),
            (['root'], (1, '', 'adbd cannot run as root in production builds')),
        ])
        with self.assertRaisesRegex(RuntimeError, 'Google Play image'):
            ensure_emulator_root(run=run)
        self.assertEqual(len(calls), 2)

    def test_timed_out_reconnect_is_retried_and_eventually_verifies_root(self):
        run, _ = self.runner([
            (['shell', 'id', '-u'], (0, '2000', '')),
            (['root'], (1, '', 'device offline')),
            (['wait-for-device'], subprocess.TimeoutExpired(['adb'], 15)),
            (['shell', 'id', '-u'], (1, '', 'device offline')),
            (['shell', 'id', '-u'], (0, '2000', '')),
            (['root'], (0, 'restarting adbd as root', '')),
            (['wait-for-device'], (0, '', '')),
            (['shell', 'id', '-u'], (0, '0', '')),
        ])
        pauses = []
        ensure_emulator_root(run=run, pause=pauses.append)
        self.assertEqual(pauses, [1])


if __name__ == '__main__':
    unittest.main()
