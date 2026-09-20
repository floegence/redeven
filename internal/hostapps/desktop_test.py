"""Integration checks for the host GIO adapter (requires Python GIO/GTK 3)."""
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("desktop", Path(__file__).with_name("desktop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopEntryTests(unittest.TestCase):
    def test_custom_entries_do_not_invent_application_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            desktop.add_application(directory, 'plain', {'executable': '/bin/true', 'name': 'Plain'})
            app = desktop.applications(directory)['custom:plain.desktop']
            self.assertFalse(app.get_description())
            self.assertFalse(app.get_categories())
            self.assertIsNone(app.get_icon())

    def test_catalog_preserves_arbitrary_host_metadata_and_absolute_icons(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            icon = root / 'host-icon.svg'
            icon.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="red"/></svg>')
            entry = root / 'lab.desktop'
            entry.write_text(f'[Desktop Entry]\nType=Application\nName=Host Lab\nComment=Description supplied by the host\nExec=/bin/true\nCategories=X-Host-Laboratory;Science;\nIcon={icon}\n')
            app = desktop.Gio.DesktopAppInfo.new_from_filename(str(entry))
            with patch.object(desktop, 'applications', return_value={'lab.desktop': app}):
                result = desktop.catalog(directory)[0]
            self.assertEqual(result['name'], 'Host Lab')
            self.assertEqual(result['description'], 'Description supplied by the host')
            self.assertEqual(result['categories'], ['X-Host-Laboratory', 'Science'])
            self.assertTrue(result['icon'].startswith('data:image/png;base64,'))

    def test_icon_lookup_respects_the_host_active_theme(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            theme_root = root / 'HostTheme'
            icons = theme_root / '64x64' / 'apps'
            icons.mkdir(parents=True)
            (theme_root / 'index.theme').write_text('[Icon Theme]\nName=Host Theme\nDirectories=64x64/apps\n[64x64/apps]\nSize=64\nType=Fixed\nContext=Applications\n')
            (icons / 'host-lab.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="blue"/></svg>')
            entry = root / 'lab.desktop'
            entry.write_text('[Desktop Entry]\nType=Application\nName=Host Lab\nExec=/bin/true\nIcon=host-lab\n')
            app = desktop.Gio.DesktopAppInfo.new_from_filename(str(entry))
            theme = desktop.Gtk.IconTheme.new()
            theme.set_search_path([str(root)])
            theme.set_custom_theme('HostTheme')
            with patch.object(desktop.Gtk.Settings, 'get_default', return_value=object()), patch.object(desktop.Gtk.IconTheme, 'get_default', return_value=theme):
                self.assertTrue(desktop.icon_data(app).startswith('data:image/png;base64,'))

    def test_custom_arguments_are_literal_and_executable_path_can_contain_spaces(self):
        with tempfile.TemporaryDirectory(prefix="redeven gio ") as directory:
            root = Path(directory)
            executable = root / "record arguments"
            output = root / "result.json"
            executable.write_text("#!" + sys.executable + "\nimport json, sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps(sys.argv[2:]))\n")
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
