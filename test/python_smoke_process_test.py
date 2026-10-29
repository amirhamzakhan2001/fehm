"""Exercise cleanup through a wrapper with a long-running child on Windows."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    'smoke_process', Path(__file__).resolve().parents[1] / 'scripts/smoke_process.py'
)
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class SmokeCleanupTests(unittest.TestCase):
    def test_windows_stops_tree_using_absolute_system_utility(self):
        process = Mock(pid=123, **{'poll.return_value': None})
        with patch.object(sys, 'platform', 'win32'), patch.dict(os.environ, {'SystemRoot': 'C:/Windows'}), patch.object(
            cleanup.subprocess, 'run', return_value=Mock(returncode=0)
        ) as run:
            cleanup.stop_process(process)
        self.assertEqual(run.call_args.args[0], [str(Path('C:/Windows') / 'System32/taskkill.exe'), '/PID', '123', '/T', '/F'])
        process.wait.assert_called_once_with(timeout=10)
        process.terminate.assert_not_called()

    def test_completed_process_needs_no_termination(self):
        process = Mock(**{'poll.return_value': 0})
        cleanup.stop_process(process)
        process.terminate.assert_not_called()
        process.kill.assert_not_called()

    def test_failed_tree_cleanup_is_reported(self):
        process = Mock(pid=123, **{'poll.return_value': None})
        with patch.object(sys, 'platform', 'win32'), patch.dict(os.environ, {'SystemRoot': 'C:/Windows'}), patch.object(
            cleanup.subprocess, 'run', return_value=Mock(returncode=1, stderr=b'Access denied')
        ):
            with self.assertRaisesRegex(RuntimeError, 'Cannot stop CLI process tree'):
                cleanup.stop_process(process)

    def test_command_timeout_cleans_up_before_propagating(self):
        process = Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired(['fehm'], 60)
        with patch.object(cleanup.subprocess, 'Popen', return_value=process), patch.object(cleanup, 'stop_process') as stop:
            with self.assertRaises(subprocess.TimeoutExpired):
                cleanup.run_cli(['fehm'], text=True, encoding='utf-8')
        stop.assert_called_once_with(process)
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()

    @unittest.skipUnless(sys.platform == 'win32', 'Windows wrapper process tree')
    def test_windows_child_releases_port_and_pipes(self):
        child = "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(120)"
        wrapper = f'import subprocess,sys; sys.exit(subprocess.call([sys.executable,"-c",{child!r}]))'
        process = subprocess.Popen([sys.executable, '-c', wrapper], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            port = int(process.stdout.readline())
            cleanup.stop_process(process)
            process.communicate(timeout=10)
            with socket.socket() as probe:
                self.assertNotEqual(probe.connect_ex(('127.0.0.1', port)), 0)
        finally:
            cleanup.stop_process(process)
            process.stdout.close()
            process.stderr.close()


if __name__ == '__main__':
    unittest.main()
