#!/usr/bin/env python3
"""Exercise real native windows in a disposable bundle; never open personal apps."""
import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import queue
import signal
import subprocess
import tempfile
import threading
import time
import uuid


def eventually(check, description, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.025)
    raise AssertionError(description)


class Helper:
    def __init__(self, executable):
        self.process = subprocess.Popen([str(executable), '--host-applications'], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.messages = queue.Queue()
        def read():
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def send(self, action, **values):
        self.process.stdin.write(json.dumps(dict(protocol_version=1, action=action, **values)) + '\n')
        self.process.stdin.flush()

    def wait(self, kind, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if value['type'] == kind:
                return value
            if value['type'] in ('error', 'blocked', 'capture_error'):
                raise AssertionError(value)
        raise AssertionError('Timed out waiting for ' + kind)

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=5)
        self.reader.join(timeout=5)
        self.process.stdout.close()
        self.process.stderr.close()


def run(helper_path, output):
    with tempfile.TemporaryDirectory(prefix='redeven-native-app-') as temporary:
        root = Path(temporary)
        bundle = root / 'Fixture.app'
        name = 'Native Host Fixture ' + uuid.uuid4().hex
        executable = bundle / 'Contents/MacOS/Fixture'
        executable.parent.mkdir(parents=True)
        with (bundle / 'Contents/Info.plist').open('wb') as file:
            plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                              CFBundleName=name, CFBundlePackageType='APPL', NSHighResolutionCapable=True), file)
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'), '-o', str(executable)], check=True)
        def receipt():
            try:
                return json.loads((bundle / 'receipt.json').read_text())
            except FileNotFoundError:
                return {}
        def stop_fixture(pid):
            # Identity is checked against this exact temporary bundle, not a name search.
            command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
            if command and Path(command).resolve() == executable.resolve():
                os.kill(pid, signal.SIGTERM)
        owned = set()
        helper = Helper(helper_path)
        try:
            helper.send('catalog', paths=[str(bundle)])
            catalog = helper.wait('catalog')
            assert catalog['availability']['ready'], catalog['availability']
            app = next(a for a in catalog['applications'] if a['name'] == name)
            assert app['icon'].startswith('data:image/png;base64,') and app['categories'] == []
            helper.send('native', application_id=app['id'])
            helper.wait('opened')
            direct = eventually(lambda: receipt().get('pid'), 'Native launch did not open the fixture')
            owned.add(direct)
            helper.close()
            # Native launch has no streaming helper lifetime dependency.
            os.kill(direct, 0)
            stop_fixture(direct)
            (bundle / 'receipt.json').unlink()
            helper = Helper(helper_path)
            helper.send('launch', application_id=app['id'], paths=[str(bundle)])
            launched = helper.wait('launched')
            pid = launched['pid']; owned.add(pid)
            window = helper.wait('window')
            frame = helper.wait('frame')
            output.mkdir(parents=True, exist_ok=True)
            (output / 'native-frame.jpg').write_bytes(base64.b64decode(frame['data']))
            bound = dict(window=window['window'], generation=window['generation'])
            def click(x, y):
                point = dict(x=x / window['width'], y=(window['height'] - y) / window['height'], button=0)
                helper.send('input', kind='down', **point, **bound)
                helper.send('input', kind='up', **point, **bound)
            click(110, 320)
            eventually(lambda: receipt().get('pid') == pid and receipt().get('clicks') == 1, 'Click did not reach the owned fixture')
            click(200, 240)
            # Unicode is intentional coverage for the native text input contract.
            helper.send('input', kind='text', text='Redeven macOS 你好', **bound)
            helper.send('input', kind='key', key='Enter', **bound)
            eventually(lambda: receipt().get('text') == 'Redeven macOS 你好', 'Unicode text was not committed')
            click(200, 240)
            helper.send('input', kind='key', key='Meta+a', **bound)
            helper.send('input', kind='text', text='Replaced', **bound)
            helper.send('input', kind='key', key='Enter', **bound)
            eventually(lambda: receipt().get('text') == 'Replaced', 'Native shortcut did not select the text')
            helper.send('menu', **bound)
            def items(values):
                for item in values:
                    yield item
                    yield from items(item['children'])
            menu = next(i for i in items(helper.wait('menu')['items']) if i['title'] == 'Record menu action')
            helper.send('menu_action', item=menu['id'], **bound)
            eventually(lambda: receipt().get('menu_clicks') == 1, 'System menu action was not invoked')
            helper.send('resume')
            resumed = helper.wait('window'); helper.wait('frame')
            assert resumed['window'] == window['window'] and resumed['generation'] > window['generation']
            assert receipt()['pid'] == pid, 'Reconnect relaunched the application'
            helper.send('input', kind='text', text='stale', **bound)
            assert helper.wait('error')['code'] == 'STALE_WINDOW'
            bound['generation'] = resumed['generation']
            helper.send('resize', width=800, height=550, **bound)
            resized = helper.wait('window'); helper.wait('frame')
            assert resized['width'] == 800 and resized['height'] == 550, resized
            before_close = receipt()
            helper.send('close', window=resized['window'], generation=resized['generation'])
            helper.wait('ended')
            evidence = dict(native_launch=True, catalog=True, capture=True, input=before_close,
                            system_menu=True, reconnect_same_process=True, stale_input_rejected=True,
                            resize=resized, actual_window_closed=True)
            (output / 'native-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
            print('PASS: native launch, catalog, pixels, click, Unicode, shortcut, menu, reconnect, stale input, resize, close')
        except Exception:
            output.mkdir(parents=True, exist_ok=True)
            (output / 'failed-receipt.json').write_text(json.dumps(receipt(), indent=2))
            raise
        finally:
            helper.close()
            if receipt().get('pid'):
                owned.add(receipt()['pid'])
            for pid in owned:
                stop_fixture(pid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('helper', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.helper.resolve(), args.output.resolve())
