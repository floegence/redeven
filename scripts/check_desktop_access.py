#!/usr/bin/env python3
"""Qualify the actual signed helper without granting or resetting OS permissions."""
import argparse
import json
import os
from pathlib import Path
import select
import plistlib
import shutil
import signal
import subprocess
import tempfile
import time


def run(binary):
    source = Path(__file__).resolve().parent.parent
    evidence = []
    with tempfile.TemporaryDirectory(prefix='redeven-desktop-access-') as temporary:
        root = Path(temporary).resolve()
        relay = root / 'redeven-computer-host'
        shutil.copy2(binary, relay)
        app = root / 'Redeven Desktop Access Dev.app'
        subprocess.run(['node', str(source / 'scripts/stage_desktop_access.mjs'), str(relay), str(app)], check=True)
        executable = app / 'Contents/MacOS/redeven-computer-host'
        def helpers():
            output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm='], text=True)
            return [(int(parts[0]), int(parts[1])) for line in output.splitlines()
                    if len(parts := line.strip().split(None, 2)) == 3 and parts[2] == str(executable)]
        fixture = root / 'Native Fixture.app'
        fixture_binary = fixture / 'Contents/MacOS/Fixture'
        fixture_binary.parent.mkdir(parents=True)
        with (fixture / 'Contents/Info.plist').open('wb') as stream:
            plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.desktop-access',
                              CFBundleName='Desktop Access Native Fixture', CFBundlePackageType='APPL',
                              RedevenFixtureWindowOnMenu=True), stream)
        subprocess.run(['swiftc', str(source / 'scripts/fixtures/nativeHostApplication.swift'), '-o', str(fixture_binary)], check=True)
        fixture_pid = None
        for mode in ['eof', 'signal', 'killed']:
            env = dict(os.environ, REDEVEN_HOST_PERMISSION_APP_NAME='Incorrect parent identity')
            process = subprocess.Popen([str(relay), '--host-applications'], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            def request(action, **fields):
                process.stdin.write(json.dumps(dict(protocol_version=2, session_id=('b' if action == 'desktop' else 'a') * 32, action=action, **fields)) + '\n')
                process.stdin.flush()
                assert select.select([process.stdout], [], [], 30)[0], 'helper response timeout'
                line = process.stdout.readline()
                assert line, process.stderr.read()
                return json.loads(line)
            try:
                catalog = request('catalog', paths=[str(fixture)])
                assert catalog['type'] == 'catalog', catalog
                availability = catalog['availability']
                assert availability['permission_app_name'] == 'Redeven Desktop Access Dev', availability
                assert availability['native_ready'], 'graphical login required for this qualification'
                selected = next(item for item in catalog['applications'] if item['name'] == 'Desktop Access Native Fixture')
                assert request('native', application_id=selected['id'], paths=[str(fixture)])['type'] == 'opened'
                deadline = time.monotonic() + 10
                while not (fixture / 'receipt.json').exists():
                    assert time.monotonic() < deadline, 'native application launch failed'
                    time.sleep(0.05)
                fixture_pid = json.loads((fixture / 'receipt.json').read_text())['pid']
                running = helpers()
                assert len(running) == 1 and running[0][1] == 1, running
                helper_pid = running[0][0]
                desktop = request('desktop', command=dict(version=1, id=1, method='probe'))
                assert desktop['capabilities']['permission_application'] == dict(name='Redeven Desktop Access Dev', identifier='com.floegence.redeven.desktop-access.dev')
                assert desktop['capabilities']['screen'] == availability['permissions']['screen_recording']
                assert desktop['capabilities']['input'] == availability['permissions']['accessibility']
                # Catalog/probe do not enable a feature or request a grant.
                if mode == 'signal': process.send_signal(signal.SIGTERM)
                elif mode == 'killed': process.kill()
                else: process.stdin.close()
                result = process.wait(timeout=12)
                assert result == {'eof': 0, 'signal': 143, 'killed': -9}[mode], result
                deadline = time.monotonic() + 8
                while helpers():
                    assert time.monotonic() < deadline, 'helper survived relay shutdown'
                    time.sleep(0.05)
                os.kill(fixture_pid, 0)
                evidence.append(dict(mode=mode, helper_pid=helper_pid, parent=1,
                                     permissions=availability['permissions'], native_ready=availability['native_ready']))
            finally:
                if process.poll() is None:
                    process.terminate(); process.wait(timeout=12)
                if fixture_pid:
                    command = subprocess.run(['ps', '-p', str(fixture_pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
                    if command == str(fixture_binary):
                        os.kill(fixture_pid, signal.SIGTERM)
                    fixture_pid = None
                    (fixture / 'receipt.json').unlink(missing_ok=True)
        assert len({item['helper_pid'] for item in evidence}) == len(evidence)
        # Signed app identity remains verifiable after all independent restarts.
        subprocess.run(['codesign', '--verify', '--strict', str(app)], check=True)
    print(json.dumps(dict(passed=True, system_permissions_changed=False, native_cases=evidence)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    run(parser.parse_args().helper.resolve())
