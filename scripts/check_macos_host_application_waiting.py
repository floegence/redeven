#!/usr/bin/env python3
"""Verify delayed windows and reopening a background app using disposable bundles."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import tempfile
import time
import uuid

from check_macos_host_applications import Helper, eventually


def run(helper_path, scenario):
    with tempfile.TemporaryDirectory(prefix='redeven-window-wait-') as temporary:
        bundle = Path(temporary) / 'Fixture.app'
        executable = bundle / 'Contents/MacOS/Fixture'
        executable.parent.mkdir(parents=True)
        name = 'Window Lifecycle Fixture ' + uuid.uuid4().hex
        info = dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                    CFBundleName=name, CFBundlePackageType='APPL', NSHighResolutionCapable=True)
        if scenario == 'reopen':
            info['RedevenFixtureWindowOnReopen'] = True
        elif scenario in ('menu', 'stop'):
            info['RedevenFixtureWindowOnMenu'] = True
        elif scenario == 'delayed':
            info['RedevenFixtureInitialWindowDelay'] = 48.0
        with (bundle / 'Contents/Info.plist').open('wb') as file:
            plistlib.dump(info, file)
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'),
                        '-o', str(executable)], check=True)
        def receipt():
            try:
                return json.loads((bundle / 'receipt.json').read_text())
            except FileNotFoundError:
                return {}
        helper = Helper(helper_path)
        pid = None
        try:
            helper.send('catalog', paths=[str(bundle)])
            catalog = helper.wait('catalog')
            assert catalog['availability']['ready'], catalog['availability']
            app = next(a for a in catalog['applications'] if a['name'] == name)
            if scenario == 'reopen':
                helper.send('native', application_id=app['id'])
                helper.wait('opened')
                pid = eventually(lambda: receipt().get('pid'), 'Background fixture did not launch')
                assert receipt()['window'] == 0, receipt()
            started = time.monotonic()
            helper.send('launch', application_id=app['id'])
            launch = helper.wait('launched')
            pid = pid or launch['pid']
            assert launch['pid'] == pid
            if scenario == 'delayed':
                helper.wait('waiting')
                # A new viewer must receive the same waiting state on reconnect.
                helper.send('resume')
                helper.wait('waiting')
            if scenario == 'stop':
                helper.wait('waiting')
                helper.send('stop')
                helper.wait('ended')
                print(json.dumps(dict(scenario=scenario, passed=True, pid=pid)))
                return
            if scenario == 'menu':
                waiting = helper.wait('waiting')
                def items(values):
                    for item in values:
                        yield item
                        yield from items(item['children'])
                def application_menu():
                    helper.send('menu', generation=waiting['generation'])
                    try:
                        return helper.wait('menu')
                    except AssertionError as error:
                        if error.args[0].get('code') == 'TARGET_NOT_READY':
                            return None
                        raise
                menu = next(i for i in items(eventually(application_menu, 'Fixture menu did not become available')['items']) if i['title'] == 'Open fixture window')
                helper.send('menu_action', generation=waiting['generation'], item=menu['id'])
            window = helper.wait('window', timeout=60)
            helper.wait('frame')
            if scenario == 'windows':
                def inventory(expected):
                    # Allow the native inventory to observe capture's own system
                    # chrome; it must not become an application window.
                    time.sleep(0.8)
                    latest = next(e for e in reversed(helper.events) if e['type'] == 'windows')
                    assert {w['id'] for w in latest['windows']} == expected, latest
                def items(values):
                    for item in values:
                        yield item
                        yield from items(item['children'])
                def menu_action(title, current):
                    helper.send('menu', generation=current['generation'])
                    item = next(i for i in items(helper.wait('menu')['items']) if i['title'] == title)
                    helper.send('menu_action', generation=current['generation'], item=item['id'])
                main = window
                inventory({main['window']})
                menu_action('Open second window', window)
                window = helper.wait('window', timeout=5, predicate=lambda w: w['window'] != main['window'])
                helper.wait('frame')
                secondary = window
                inventory({main['window'], secondary['window']})
                helper.send('select', window=main['window'])
                window = helper.wait('window', predicate=lambda w: w['window'] == main['window'])
                helper.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                time.sleep(1.2)
                assert next(e for e in reversed(helper.events) if e['type'] == 'window')['window'] == main['window'], 'Inventory overrode explicit selection'
                helper.send('select', window=main['window'])
                helper.send('select', window=secondary['window'])
                window = helper.wait('window', timeout=5, predicate=lambda w: w['window'] == secondary['window'])
                helper.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                helper.send('close', window=window['window'], generation=window['generation'])
                window = helper.wait('window', predicate=lambda w: w['window'] == main['window'])
                helper.wait('frame')
                inventory({main['window']})
                menu_action('Open utility panel', window)
                listed = helper.wait('windows', predicate=lambda e: any(w['title'] == 'Fixture utility panel' for w in e['windows']))
                panel = next(w for w in listed['windows'] if w['title'] == 'Fixture utility panel')
                helper.send('select', window=panel['id'])
                window = helper.wait('window', predicate=lambda w: w['window'] == panel['id'])
                helper.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                inventory({main['window'], window['window']})
                helper.send('close', window=window['window'], generation=window['generation'])
                window = helper.wait('window', predicate=lambda w: w['window'] == main['window'])
                helper.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                inventory({main['window']})
                menu_action('Cancel next close', window)
                helper.wait('operation_complete', predicate=lambda m: m.get('action') == 'menu_action')
                helper.send('close', window=window['window'], generation=window['generation'])
                eventually(lambda: receipt().get('cancelled_closes') == 1, 'Close cancellation was not respected')
                for title, field in [('Minimize main window', 'minimized'), ('Hide fixture', 'hidden')]:
                    menu_action(title, window)
                    eventually(lambda: receipt().get(field), title + ' did not complete')
                    time.sleep(1.6)
                    assert receipt().get(field), title + ' was unexpectedly undone'
                    assert not any(e['type'] == 'ended' for e in helper.events), 'Hidden window ended the session'
                    helper.send('resume')
                    window = helper.wait('window')
                    helper.wait('frame', predicate=lambda f: f['generation'] == window['generation'])
                    eventually(lambda: not receipt().get(field), title + ' did not recover on reconnect')
                assert receipt()['pid'] == pid
            if scenario == 'reopen':
                assert receipt()['reopens'] > 0 and launch['existing_application'], receipt()
            elif scenario == 'delayed':
                assert time.monotonic() - started >= 45
            assert receipt()['pid'] == pid
            if scenario == 'menu':
                helper.send('menu_action', generation=waiting['generation'], item=menu['id'])
                assert helper.wait('operation_error')['code'] == 'STALE_WINDOW'
            helper.send('close', window=window['window'], generation=window['generation'])
            helper.wait('ended')
            eventually(lambda: not subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True).stdout,
                       'Closing the fixture did not terminate its process')
            print(json.dumps(dict(scenario=scenario, passed=True, pid=pid)))
        finally:
            helper.close()
            if pid:
                command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
                if command and Path(command).resolve() == executable.resolve():
                    os.kill(pid, signal.SIGTERM)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--scenario', choices=['reopen', 'delayed', 'menu', 'stop', 'windows'], required=True)
    args = parser.parse_args()
    run(args.helper, args.scenario)
