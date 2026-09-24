"""Task-owned GTK4 controls and standalone GNOME saved-document receipts."""
import json
import os
from pathlib import Path
import subprocess
import sys

root, kind = Path(sys.argv[1]), sys.argv[2]
environment = {key: os.environ.get(key) for key in (
    'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'GTK_IM_MODULE', 'GTK_PATH',
    'GTK_IM_MODULE_FILE', 'QT_IM_MODULE', 'XMODIFIERS')}
(root / 'environment.json').write_text(json.dumps(environment))

if kind == 'gnome':
    # Private XDG directories and --standalone prohibit delegation to, or state
    # restoration from, the user's running editor. The display and bus are private.
    for key in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'):
        directory = root / key.lower()
        directory.mkdir(mode=0o700)
        os.environ[key] = str(directory)
    os.environ['GSETTINGS_BACKEND'] = 'memory'
    document = root / 'document.txt'
    document.write_bytes(b'')
    with subprocess.Popen(['/usr/bin/gnome-text-editor', '--standalone', str(document)]) as child:
        (root / 'application.json').write_text(json.dumps({
            'pid': child.pid, 'start': Path(f'/proc/{child.pid}/stat').read_text(),
            'version': subprocess.check_output(['/usr/bin/gnome-text-editor', '--version'], text=True)}))
        sys.exit(child.wait())

import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk, Gdk, Gio

app = Gtk.Application(application_id='org.floegence.RedevenInputAcceptance',
                      flags=Gio.ApplicationFlags.NON_UNIQUE)


def activate(application):
    window = Gtk.ApplicationWindow(application=application, title='Client input acceptance')
    row = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, homogeneous=True)
    fields = []
    cursor = Gdk.Cursor.new_from_texture(Gdk.Texture.new_from_filename(str(root / 'cursor.png')), 22, 24, None)

    def contents():
        if kind == 'gtk4-entry':
            return [field.get_text() for field in fields]
        return [field.get_buffer().get_text(*field.get_buffer().get_bounds(), True) for field in fields]

    def save(*_):
        pending = root / 'receipt.tmp'
        pending.write_text(json.dumps(contents()))
        pending.replace(root / 'receipt.json')

    for _ in range(2):
        field = Gtk.Entry() if kind == 'gtk4-entry' else Gtk.TextView()
        fields.append(field)
        field.set_hexpand(True)
        field.set_vexpand(True)
        field.set_cursor(cursor)
        if kind == 'gtk4-entry':
            field.connect('changed', save)
        else:
            field.get_buffer().connect('changed', save)
        row.append(field)
    window.set_child(row)
    window.set_default_size(640, 480)
    window.present()
    fields[0].grab_focus()
    save()
    (root / 'application.json').write_text(json.dumps({
        'pid': os.getpid(), 'start': Path('/proc/self/stat').read_text(),
        'gtk': [Gtk.get_major_version(), Gtk.get_minor_version(), Gtk.get_micro_version()]}))


app.connect('activate', activate)
app.run([])
