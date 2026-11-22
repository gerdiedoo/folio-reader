"""Reconnect after adbd restarts and require verified root on the CI emulator."""
import subprocess
import time


def ensure_emulator_root(run=subprocess.run, pause=time.sleep, attempts=3):
    diagnostics = []

    def command(*args):
        try:
            result = run(['adb', *args], capture_output=True, text=True, timeout=15)
            detail = ' '.join((result.stdout.strip(), result.stderr.strip())).strip()
            diagnostics.append(f"adb {' '.join(args)}: exit {result.returncode}: {detail}")
            return result.returncode, result.stdout.strip(), detail
        except subprocess.TimeoutExpired:
            diagnostics.append(f"adb {' '.join(args)}: timed out")
            return None, '', ''

    for attempt in range(attempts):
        if command('shell', 'id', '-u')[:2] == (0, '0'):
            return
        _, _, detail = command('root')
        if 'cannot run as root in production builds' in detail.lower():
            raise RuntimeError('The CI emulator image does not support root. Use the google_apis '
                               'image, not a Google Play image.\n' + '\n'.join(diagnostics))
        # `adb root` restarts adbd. Its own status may be nonzero while the
        # transport disconnects; the connected daemon's UID is authoritative.
        command('wait-for-device')
        if command('shell', 'id', '-u')[:2] == (0, '0'):
            return
        if attempt + 1 < attempts:
            pause(1)
    raise RuntimeError('CI emulator root access could not be verified after reconnecting.\n'
                       + '\n'.join(diagnostics))
