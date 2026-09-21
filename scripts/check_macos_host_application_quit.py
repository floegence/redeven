#!/usr/bin/env python3
"""Verify explicit graceful quit and detachment using only disposable apps."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import tempfile
import uuid

from check_macos_host_applications import Helper, eventually


def run(helper_path):
    results = []
    with tempfile.TemporaryDirectory(prefix='redeven-app-quit-') as temporary:
        root = Path(temporary)
        compiled = root / 'Fixture'
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'), '-o', str(compiled)], check=True)
        for windowless in (True, False):
            bundle = root / ('Background.app' if windowless else 'Windowed.app')
            executable = bundle / 'Contents/MacOS/Fixture'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(compiled.read_bytes())
            executable.chmod(0o755)
            name = 'Quit Fixture ' + uuid.uuid4().hex
            with (bundle / 'Contents/Info.plist').open('wb') as file:
                plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                                  CFBundleName=name, CFBundlePackageType='APPL', NSHighResolutionCapable=True,
                                  RedevenFixtureWindowOnMenu=windowless, RedevenFixtureCancelFirstQuit=True), file)
            def receipt():
                try:
                    return json.loads((bundle / 'receipt.json').read_text())
                except FileNotFoundError:
                    return {}
            helper = Helper(helper_path)
            pid = None
            sharing = None
            try:
                helper.send('catalog', paths=[str(bundle)])
                app = next(a for a in helper.wait('catalog')['applications'] if a['name'] == name)
                helper.send('native' if windowless else 'launch', application_id=app['id'])
                helper.wait('opened' if windowless else 'launched')
                pid = eventually(lambda: receipt().get('pid'), 'Fixture did not launch')
                if not windowless:
                    window = helper.wait('window')
                    helper.wait('frame')
                    helper.send('menu', generation=window['generation'])
                    def items(values):
                        for item in values:
                            yield item
                            yield from items(item['children'])
                    item = next(i for i in items(helper.wait('menu')['items']) if i['title'] == 'Open second window')
                    helper.send('menu_action', generation=window['generation'], item=item['id'])
                    eventually(lambda: receipt().get('secondary'), 'Second window did not open')
                    helper.wait('window', predicate=lambda w: w['window'] != window['window'])
                    helper.send('detach')
                    helper.wait('ended')
                # A fresh helper must find the native/windowless app after the
                # original sharing/helper lifetime ends, without relaunching it.
                helper.close()
                helper = Helper(helper_path)
                def running():
                    helper.send('running')
                    return next((a for a in helper.wait('running')['running'] if a['application_id'] == app['id']), None)
                target = eventually(running, 'App missing from system inventory')
                assert len(target['instances']) == 1, target
                assert receipt()['pid'] == pid
                helper.send('quit', application_id=app['id'], instances=target['instances'] + ['f' * 64])
                assert helper.wait('error')['code'] == 'APPLICATION_NOT_FOUND'
                assert receipt()['quit_requests'] == 0, 'Partially stale selection terminated a live process'
                helper.send('quit', application_id='macos-foreign', instances=target['instances'])
                assert helper.wait('error')['code'] == 'APPLICATION_NOT_FOUND'
                if not windowless:
                    sharing = Helper(helper_path)
                    sharing.send('launch', application_id=app['id'], paths=[str(bundle)])
                    assert sharing.wait('launched')['existing_application']
                    sharing.wait('window'); sharing.wait('frame')
                helper.send('quit', **target)
                helper.wait('quit_requested')
                eventually(lambda: receipt().get('quit_requests') == 1, 'First quit did not reach the application')
                assert running() == target, 'Cancelled quit removed the running application'
                os.kill(pid, 0)
                if sharing:
                    assert not any(e['type'] == 'ended' for e in sharing.events)
                    sharing.send('resume')
                    window = sharing.wait('window')
                    sharing.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                helper.send('quit', **target)
                helper.wait('quit_requested')
                if sharing:
                    sharing.wait('ended')
                eventually(lambda: running() is None, 'Confirmed quit did not remove the running application')
                eventually(lambda: not subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True).stdout,
                           'Quit left the application process running')
                helper.send('quit', **target)
                assert helper.wait('error')['code'] == 'APPLICATION_NOT_FOUND'
                results.append(dict(windowless=windowless, pid=pid, cancelled_quit_preserved=True,
                                    stale_selection_rejected=True, quit_confirmed=True))
            finally:
                if sharing:
                    sharing.close()
                helper.close()
                if pid:
                    command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
                    if command and Path(command).resolve() == executable.resolve():
                        os.kill(pid, signal.SIGTERM)
    print(json.dumps(dict(passed=True, scenarios=results)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    run(parser.parse_args().helper)
