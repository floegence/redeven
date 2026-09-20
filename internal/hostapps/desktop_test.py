"""Integration checks for the host GIO adapter (requires Python GIO/GTK 3)."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("desktop", Path(__file__).with_name("desktop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopEntryTests(unittest.TestCase):
    def test_custom_arguments_are_literal_and_executable_path_can_contain_spaces(self):
        with tempfile.TemporaryDirectory(prefix="redeven gio ") as directory:
            root = Path(directory)
            executable = root / "record arguments"
            output = root / "result.json"
            executable.write_text("#!/usr/bin/python3\nimport json, sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps(sys.argv[2:]))\n")
            executable.chmod(0o700)
            expected = ["two words", "%f", "100%", "$(touch NOT_EXECUTED)", 'a"b', "a\\b", "a'b", ""]
            arguments = " ".join(desktop.GLib.shell_quote(arg) for arg in [str(output), *expected])
            desktop.add_application(directory, "example", {"executable": str(executable), "name": "Example", "arguments": arguments})
            app = desktop.applications(directory)["custom:example.desktop"]
            self.assertTrue(app.launch([], desktop.Gio.AppLaunchContext.new()))
            deadline = time.monotonic() + 5
            while not output.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertEqual(json.loads(output.read_text()), expected)
            self.assertFalse((root / "NOT_EXECUTED").exists())

    def test_invalid_executable_is_rejected_without_a_desktop_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            for executable in ["relative", directory, "/missing/redeven-executable"]:
                with self.assertRaises(ValueError):
                    desktop.add_application(directory, "invalid", {"executable": executable, "name": "Invalid"})
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
