#!/usr/bin/env python3
"""Verify host-driven termination reasons using disposable native applications."""
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
    with tempfile.TemporaryDirectory(prefix='redeven-app-terminal-') as temporary:
        root = Path(temporary)
        compiled = root / 'Fixture'
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'), '-o', str(compiled)], check=True)
        scenarios = [
            ('application_exited', dict(RedevenFixtureQuitDelay=5.0)),
            ('application_exited', dict(RedevenFixtureQuitDelay=2.0, RedevenFixtureWindowOnMenu=True)),
            ('windows_closed', dict(RedevenFixtureCloseDelay=5.0, RedevenFixtureKeepRunning=True)),
            ('sharing_stopped', {}),
        ]
        for index, (reason, options) in enumerate(scenarios):
            bundle = root / f'Termination{index}.app'
            executable = bundle / 'Contents/MacOS/Fixture'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(compiled.read_bytes())
            executable.chmod(0o755)
            name = 'Termination Fixture ' + uuid.uuid4().hex
            with (bundle / 'Contents/Info.plist').open('wb') as file:
                plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                                  CFBundleName=name, CFBundlePackageType='APPL', NSHighResolutionCapable=True, **options), file)
            helper = Helper(helper_path)
            pid = None
            try:
                helper.send('catalog', paths=[str(bundle)])
                catalog = helper.wait('catalog')
                assert catalog['availability']['ready'], catalog['availability']
                app = next(a for a in catalog['applications'] if a['name'] == name)
                helper.send('launch', application_id=app['id'])
                pid = helper.wait('launched')['pid']
                if options.get('RedevenFixtureWindowOnMenu'):
                    helper.wait('waiting')
                else:
                    helper.wait('window'); helper.wait('frame')
                    # Reloading a viewer binds the same process and must not erase
                    # its earlier window-presence evidence.
                    helper.send('resume')
                    helper.wait('window'); helper.wait('frame')
                if reason == 'sharing_stopped':
                    helper.send('detach')
                ended = helper.wait('ended')
                assert ended.get('end_reason') == reason, ended
                if reason == 'application_exited':
                    eventually(lambda: not subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True).stdout,
                               'Host quit did not terminate the fixture')
                else:
                    os.kill(pid, 0)
                results.append(dict(reason=reason, windowless=bool(options.get('RedevenFixtureWindowOnMenu')), passed=True))
            finally:
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
