"""Console entry-point path regression tests, runnable on every CI platform."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "fehm_cli", Path(__file__).resolve().parents[1] / "python/fehm/cli.py"
)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class LauncherPathTests(unittest.TestCase):
    def test_windows_extensionless_entry_point(self):
        with tempfile.TemporaryDirectory(prefix="fehm installed ü ") as tmp:
            executable = Path(tmp) / "fehm.exe"
            executable.touch()
            with patch.object(sys, "platform", "win32"), patch.object(
                sys, "argv", [str(executable.with_suffix(""))]
            ):
                self.assertEqual(cli.launcher_path(), executable)

    def test_existing_entry_point_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix="fehm installed ü ") as tmp:
            for platform, name in [("win32", "fehm.exe"), ("win32", "fehm"), ("linux", "fehm")]:
                with self.subTest(platform=platform, name=name):
                    executable = Path(tmp) / name
                    executable.touch()
                    with patch.object(sys, "platform", platform), patch.object(
                        sys, "argv", [str(executable)]
                    ):
                        self.assertEqual(cli.launcher_path(), executable)

    def test_missing_executable_is_not_replaced_with_another_missing_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "fehm"
            with patch.object(sys, "platform", "win32"), patch.object(sys, "argv", [str(missing)]):
                self.assertEqual(cli.launcher_path(), missing)


if __name__ == "__main__":
    unittest.main()
