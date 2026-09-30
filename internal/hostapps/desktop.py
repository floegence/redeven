"""Redeven's host application adapter over GLib/GIO desktop entries.

GIO owns desktop-file precedence, visibility, field codes and process launching.
This helper never evaluates an application command through a shell.
"""

import base64
import json
import os
import pathlib
import sys
import tempfile

import gi

gi.require_version("Gio", "2.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gio, GLib, Gtk  # noqa: E402


def applications(directory):
    found = {app.get_id(): app for app in Gio.AppInfo.get_all() if app.get_id()}
    for path in pathlib.Path(directory).glob("*.desktop"):
        app = Gio.DesktopAppInfo.new_from_filename(str(path))
        if app:
            found["custom:" + path.name] = app
    return found


def icon_themes():
    # Preserve GTK's active theme and inherited/hicolor lookup first. Alternate
    # installed themes use independent objects and never change host settings.
    active = Gtk.IconTheme.get_default() if Gtk.Settings.get_default() else Gtk.IconTheme.new()
    yield active
    paths = active.get_search_path()
    seen = set()
    for directory in paths:
        try:
            entries = sorted(pathlib.Path(directory).iterdir(), key=lambda path: path.name)
        except OSError:
            continue
        for entry in entries:
            if entry.name in seen:
                continue
            try:
                metadata = GLib.KeyFile.new()
                metadata.load_from_file(str(entry / "index.theme"), GLib.KeyFileFlags.NONE)
                if not metadata.get_string_list("Icon Theme", "Directories"):
                    continue
            except GLib.Error:
                # Cursor-only themes and incomplete installations supply no
                # application icon directories.
                continue
            seen.add(entry.name)
            theme = Gtk.IconTheme.new()
            theme.set_search_path(paths)
            theme.set_custom_theme(entry.name)
            yield theme


def icon_data(app, themes=None):
    icon = app.get_icon()
    if not icon:
        return ""
    for theme in themes if themes is not None else icon_themes():
        try:
            info = theme.lookup_by_gicon(icon, 64, Gtk.IconLookupFlags.FORCE_SIZE)
            if info:
                success, data = info.load_icon().save_to_bufferv("png", [], [])
                if success and len(data) <= 65536:
                    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
        except GLib.Error:
            pass
        if not isinstance(icon, Gio.ThemedIcon):
            break
    return ""


def catalog(directory):
    result = []
    themes = list(icon_themes())
    for identity, app in applications(directory).items():
        if not isinstance(app, Gio.DesktopAppInfo) or not app.should_show():
            continue
        if app.get_boolean("Terminal"):
            continue
        result.append({
            "id": identity,
            "name": app.get_display_name(),
            "description": app.get_description() or "",
            "categories": [s for s in (app.get_categories() or "").split(";") if s],
            "icon": icon_data(app, themes),
            "custom": identity.startswith("custom:"),
        })
    return sorted(result, key=lambda item: (item["name"].casefold(), item["id"]))


def add_application(directory, identity, request):
    executable = request["executable"]
    if not os.path.isabs(executable) or not os.path.isfile(executable) or not os.access(executable, os.X_OK):
        raise ValueError("The executable must be an existing executable file with an absolute path.")
    # Desktop Entry Exec uses double quotes and literal percent escaping.
    # GLib owns argument parsing; GIO owns field expansion and process launch.
    args = GLib.shell_parse_argv(request.get("arguments", ""))[1] if request.get("arguments") else []
    def quote(argument):
        argument = argument.replace("%", "%%")
        for char in ('\\', '"', '`', '$'):
            argument = argument.replace(char, "\\" + char)
        return '"' + argument + '"'
    command = " ".join(quote(arg) for arg in [executable, *args])
    key = GLib.KeyFile.new()
    key.set_string("Desktop Entry", "Type", "Application")
    key.set_string("Desktop Entry", "Name", request["name"])
    key.set_string("Desktop Entry", "Exec", command)
    if request.get("remote_browser"):
        key.set_string("Desktop Entry", "Categories", "Network;WebBrowser;")
    destination = pathlib.Path(directory) / (identity + ".desktop")
    descriptor, temporary = tempfile.mkstemp(prefix=".application-", dir=directory)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            output.write(key.to_data()[0])
        os.replace(temporary, destination)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def main():
    action, directory = sys.argv[1:3]
    if action == "catalog":
        print(json.dumps(catalog(directory), ensure_ascii=False))
    elif action == "add":
        add_application(directory, sys.argv[3], json.load(sys.stdin))
        print("{}")
    elif action == "resolve":
        app = applications(directory).get(sys.argv[3])
        if not isinstance(app, Gio.DesktopAppInfo) or app.get_boolean("Terminal"):
            raise ValueError("The authorized desktop entry is unavailable")
        filename = app.get_filename()
        if not filename or not os.path.isabs(filename):
            raise ValueError("The desktop entry has no absolute source")
        print(json.dumps({"desktop_file": filename}))
    else:
        raise ValueError("Unknown application operation")


if __name__ == "__main__":
    main()
