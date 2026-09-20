"""Redeven's host application adapter over GLib/GIO desktop entries.

GIO owns desktop-file precedence, visibility, field codes and process launching.
This helper never evaluates an application command through a shell.
"""

import base64
import json
import os
import pathlib
import sys

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


def icon_data(app):
    icon = app.get_icon()
    if not icon:
        return ""
    try:
        theme = Gtk.IconTheme.new()
        theme.set_custom_theme("Adwaita")
        info = theme.lookup_by_gicon(icon, 64, Gtk.IconLookupFlags.FORCE_SIZE)
        if not info:
            return ""
        success, data = info.load_icon().save_to_bufferv("png", [], [])
        if success and len(data) <= 65536:
            return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
    except GLib.Error:
        pass
    return ""


def catalog(directory):
    result = []
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
            "icon": icon_data(app),
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
    key.set_string("Desktop Entry", "Categories", "Utility;")
    destination = pathlib.Path(directory) / (identity + ".desktop")
    destination.write_text(key.to_data()[0], encoding="utf-8")
    destination.chmod(0o600)


def main():
    action, directory = sys.argv[1:3]
    if action == "catalog":
        print(json.dumps(catalog(directory), ensure_ascii=False))
    elif action == "add":
        add_application(directory, sys.argv[3], json.load(sys.stdin))
        print("{}")
    elif action == "launch":
        identity, receipt = sys.argv[3:5]
        try:
            app = applications(directory).get(identity)
            if not app or not app.should_show() or app.get_boolean("Terminal"):
                raise ValueError("The application is no longer available.")
            if app.get_boolean("DBusActivatable"):
                # Desktop bus activation can delegate to the user's existing
                # systemd session and lose this private display environment.
                # Keep GIO's Exec semantics, but launch in our own bus/process tree.
                entry = GLib.KeyFile.new()
                entry.load_from_file(app.get_filename(), GLib.KeyFileFlags.NONE)
                entry.set_boolean("Desktop Entry", "DBusActivatable", False)
                launch_entry = pathlib.Path(receipt).with_name("launch.desktop")
                launch_entry.write_text(entry.to_data()[0], encoding="utf-8")
                launch_entry.chmod(0o600)
                app = Gio.DesktopAppInfo.new_from_filename(str(launch_entry))
            if not app.launch([], Gio.AppLaunchContext.new()):
                raise ValueError("The application could not be started.")
            result = {"ok": True}
        except Exception as error:
            print(str(error), file=sys.stderr)
            result = {"ok": False}
        temporary = receipt + ".tmp"
        pathlib.Path(temporary).write_text(json.dumps(result), encoding="utf-8")
        os.replace(temporary, receipt)
        if not result["ok"]:
            sys.exit(1)
    else:
        raise ValueError("Unknown application operation")


if __name__ == "__main__":
    main()
