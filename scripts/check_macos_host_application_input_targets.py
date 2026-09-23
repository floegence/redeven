#!/usr/bin/env python3
"""Verify native input receipts in task-owned Chrome and Terminal windows."""
import argparse
import base64
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shlex
import signal
import subprocess
import tempfile
import threading
import uuid

from check_macos_host_applications import Helper, eventually


UNICODE = '中文日本語한글🙂👩🏽‍💻e\u0301𠮷'


def attach(helper_path, bundle, title):
    helper = Helper(helper_path)
    try:
        application = 'macos-' + hashlib.sha256(str(Path(bundle).resolve()).encode()).hexdigest()
        helper.send('launch', application_id=application)
        launched = helper.wait('launched')
        windows = helper.wait('windows', predicate=lambda item: any(title in w['title'] for w in item['windows']))
        target = next(w for w in windows['windows'] if title in w['title'])
        initial = helper.wait('window')
        helper.send('select', window=target['id'])
        window = helper.wait('window', predicate=lambda item: item['window'] == target['id'] and item['generation'] > initial['generation'])
        helper.wait('frame', predicate=lambda item: item['generation'] == window['generation'])
        return helper, {'window': window['window'], 'generation': window['generation']}, launched['pid']
    except BaseException:
        helper.close()
        raise


def text(helper, bound, value):
    helper.send('input', kind='text', text=value, **bound)
    helper.wait('operation_complete', predicate=lambda item: item['action'] == 'input')


def key(helper, bound, value):
    helper.send('input', kind='key', key=value, **bound)
    for _ in range(2):
        helper.wait('operation_complete', predicate=lambda item: item['action'] == 'input')


def screenshot(helper, bound, output):
    frame = helper.wait('frame', predicate=lambda item: item['generation'] == bound['generation'])
    output.write_bytes(base64.b64decode(frame['data']))


def chrome(helper_path, output):
    marker = 'Redeven input ' + uuid.uuid4().hex
    receipt = {'text': None}

    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            body = (f'<!doctype html><title>{marker}</title><style>body{{font:20px system-ui;padding:30px}}'
                    'textarea{width:90%;height:300px;font:24px system-ui}</style>'
                    '<h1>Native browser input acceptance</h1><textarea autofocus></textarea>'
                    '<script>const field=document.querySelector("textarea");let pending=Promise.resolve();'
                    'field.addEventListener("input",()=>{const body=field.value;'
                    'pending=pending.then(()=>fetch("/receipt",{method:"POST",body}));});'
                    'field.focus();</script>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            receipt['text'] = self.rfile.read(int(self.headers['Content-Length'])).decode()
            (output / 'chrome-received.json').write_text(json.dumps(receipt))
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    helper = None
    bound = None
    try:
        subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                        '--new-window', f'http://127.0.0.1:{server.server_port}'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        helper, bound, pid = attach(helper_path, '/Applications/Google Chrome.app', marker)
        text(helper, bound, UNICODE)
        text(helper, bound, UNICODE)
        eventually(lambda: receipt['text'] == UNICODE * 2, 'Chrome did not receive repeated Unicode')
        key(helper, bound, 'Meta+a')
        expected = UNICODE + '\n' + 'second line'
        text(helper, bound, expected)
        eventually(lambda: receipt['text'] == expected, 'Chrome multiline replacement failed')
        key(helper, bound, 'a')
        key(helper, bound, 'b')
        key(helper, bound, 'Backspace')
        expected += 'a'
        eventually(lambda: receipt['text'] == expected, 'Chrome physical typing/deletion failed')
        screenshot(helper, bound, output / 'chrome.jpg')
        return {'target': 'Google Chrome', 'pid': pid, 'received': receipt['text'], 'passed': True}
    finally:
        if helper:
            (output / 'chrome-events.json').write_text(json.dumps([event for event in helper.events if event['type'] != 'windows'], indent=2))
            try:
                if bound:
                    current = next((item for item in reversed(helper.events) if item['type'] == 'window' and item['window'] == bound['window']), bound)
                    helper.send('close', window=bound['window'], generation=current['generation'])
                    helper.wait('operation_complete', predicate=lambda item: item['action'] == 'close')
            finally:
                helper.close()
        server.shutdown()
        server.server_close()
        thread.join()


def terminal(helper_path, root, output):
    marker = 'Redeven-input-' + uuid.uuid4().hex
    received = root / 'terminal.json'
    fixture = root / 'terminal.py'
    fixture.write_text('import json, os, sys\nfrom pathlib import Path\n'
                       f'path=Path({str(received)!r})\nlines=[]\n'
                       f'print("\\033]0;{marker}\\007",end="",flush=True)\n'
                       'def save():\n'
                       ' temporary=path.with_suffix(".tmp")\n'
                       ' temporary.write_text(json.dumps({"pid":os.getpid(),"lines":lines}))\n'
                       ' temporary.replace(path)\n'
                       'save()\n'
                       'for line in sys.stdin:\n'
                       ' if line.rstrip("\\n")=="__REDEVEN_END__": break\n'
                       ' lines.append(line.rstrip("\\n")); save()\n')
    command = root / (marker + '.command')
    command.write_text('#!/bin/sh\nexec /usr/bin/python3 ' + shlex.quote(str(fixture)) + '\n')
    command.chmod(0o700)
    helper = None
    bound = None
    try:
        subprocess.run(['open', '-a', 'Terminal', str(command)], check=True)
        eventually(received.exists, 'Terminal fixture did not start')
        helper, bound, pid = attach(helper_path, '/System/Applications/Utilities/Terminal.app', marker)
        text(helper, bound, UNICODE)
        key(helper, bound, 'Enter')
        text(helper, bound, UNICODE)
        key(helper, bound, 'Enter')
        key(helper, bound, 'a')
        key(helper, bound, 'b')
        key(helper, bound, 'Backspace')
        key(helper, bound, 'Enter')
        expected = [UNICODE, UNICODE, 'a']
        eventually(lambda: json.loads(received.read_text())['lines'] == expected,
                   'Terminal did not receive exact Unicode and key ordering')
        screenshot(helper, bound, output / 'terminal.jpg')
        return {'target': 'Terminal', 'pid': pid, 'received': expected, 'passed': True}
    finally:
        if helper:
            (output / 'terminal-events.json').write_text(json.dumps([event for event in helper.events if event['type'] != 'windows'], indent=2))
            try:
                if received.exists():
                    state = json.loads(received.read_text())
                    (output / 'terminal-received.json').write_text(json.dumps(state))
                    command_line = subprocess.check_output(['ps', '-p', str(state['pid']), '-o', 'command='], text=True)
                    if str(fixture) in command_line:
                        os.kill(state['pid'], signal.SIGTERM)
                if bound:
                    current = next((item for item in reversed(helper.events) if item['type'] == 'window' and item['window'] == bound['window']), bound)
                    helper.send('close', window=bound['window'], generation=current['generation'])
                    helper.wait('operation_complete', predicate=lambda item: item['action'] == 'close')
            finally:
                helper.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--target', choices=['chrome', 'terminal', 'all'], default='all')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='redeven-input-targets-') as temporary:
        results = []
        if args.target in ('chrome', 'all'):
            results.append(chrome(args.helper, args.output))
        if args.target in ('terminal', 'all'):
            results.append(terminal(args.helper, Path(temporary), args.output))
    (args.output / 'result.json').write_text(json.dumps({'passed': True, 'system_ime': False, 'targets': results}, indent=2))
    print('PASS: ' + ', '.join(result['target'] for result in results) + ' received exact Unicode and key transitions')


if __name__ == '__main__':
    main()
