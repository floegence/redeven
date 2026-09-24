"""Task-owned GTK or Firefox controls with application-side pointer receipts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

root = Path(sys.argv[1])
kind = sys.argv[2]
(root / 'environment.json').write_text(json.dumps({key: os.environ.get(key) for key in
    ['DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'GTK_IM_MODULE', 'QT_IM_MODULE', 'XMODIFIERS']}))


def save(state):
    temporary = root / 'receipt.tmp'
    temporary.write_text(json.dumps(state))
    temporary.replace(root / 'receipt.json')


if kind == 'pointer-firefox':
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write((root / 'pointer.html').read_bytes())

        def do_POST(self):
            save(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = root / 'firefox-profile'
    profile.mkdir()
    (profile / 'user.js').write_text('user_pref("browser.shell.checkDefaultBrowser", false);\n'
        'user_pref("browser.aboutwelcome.enabled", false);\nuser_pref("termsofuse.bypassNotification", true);\n'
        'user_pref("datareporting.healthreport.uploadEnabled", false);\n'
        'user_pref("browser.startup.homepage_override.mstone", "ignore");\n')
    try:
        subprocess.run(['/usr/bin/firefox', '--no-remote', '--profile', str(profile),
                        f'http://127.0.0.1:{server.server_port}'], check=True)
    finally:
        server.shutdown()
else:
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk, Gdk
    state = dict(clicks=0, doubles=0, rights=0, drag=20, inset=0)
    window = Gtk.Window(title='Redeven pointer acceptance')
    window.set_default_size(640, 480)
    fixed = Gtk.Fixed()
    window.add(fixed)
    outer, inner = Gtk.ScrolledWindow(), Gtk.ScrolledWindow()
    outer.set_size_request(640, 480)
    inner.set_size_request(240, 240)
    content, rows = Gtk.Fixed(), Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    content.set_size_request(2000, 3000)
    rows.set_size_request(1400, 1800)
    for n in range(60):
        rows.pack_start(Gtk.Label(label=f'Nested row {n:02d}', xalign=0), False, False, 6)
    outer.add_with_viewport(content)
    inner.add_with_viewport(rows)
    fixed.put(outer, 0, 0)
    fixed.put(inner, 340, 70)
    button = Gtk.Button(label='Tap target')
    button.set_size_request(180, 60)
    content.put(button, 20, 220)
    field = Gtk.Entry(text='Select this text')
    content.put(field, 20, 350)
    drag = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1)
    drag.set_value(20)
    drag.set_size_request(260, 50)
    content.put(drag, 20, 100)

    def receipt(*_):
        for name, scroll in [('outer', outer), ('inner', inner)]:
            state[name] = [scroll.get_hadjustment().get_value(), scroll.get_vadjustment().get_value()]
        state['drag'] = drag.get_value()
        save(state)

    def clicked(*_):
        state['clicks'] += 1
        receipt()

    def pressed(_widget, event):
        if event.button == 3:
            state['rights'] += 1
        if event.type == Gdk.EventType._2BUTTON_PRESS:
            state['doubles'] += 1
        receipt()
        return False

    button.connect('clicked', clicked)
    window.connect('button-press-event', pressed)
    for scroll in (outer, inner):
        for adjustment in (scroll.get_hadjustment(), scroll.get_vadjustment()):
            adjustment.connect('value-changed', receipt)
    drag.connect('value-changed', receipt)
    window.connect('destroy', Gtk.main_quit)
    window.show_all()
    receipt()
    Gtk.main()
