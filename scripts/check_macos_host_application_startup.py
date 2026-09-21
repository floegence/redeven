#!/usr/bin/env python3
"""Measure native attach/reconnect and stress capture replacement in a disposable app."""
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

from check_macos_host_applications import Helper


def run(helper_path, output):
    with tempfile.TemporaryDirectory(prefix='redeven-capture-startup-') as temporary:
        bundle = Path(temporary) / 'Startup.app'
        executable = bundle / 'Contents/MacOS/Fixture'
        executable.parent.mkdir(parents=True)
        with (bundle / 'Contents/Info.plist').open('wb') as file:
            plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                              CFBundleName='Capture Startup Fixture', CFBundlePackageType='APPL', NSHighResolutionCapable=True), file)
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'), '-o', str(executable)], check=True)
        helper = Helper(helper_path)
        pid = None
        evidence = {}
        try:
            helper.send('catalog', paths=[str(bundle)])
            catalog = helper.wait('catalog')
            identifier = next(app['id'] for app in catalog['applications'] if app['name'] == 'Capture Startup Fixture')
            started = time.monotonic()
            helper.send('launch', paths=[str(bundle)], application_id=identifier)
            pid = helper.wait('launched')['pid']
            window = helper.wait('window')
            # A viewer negotiating video before startCapture completes used to
            # overlap stop/start and fail with SC_-3805.
            helper.send('configure', mode='auto', pixel_ratio=2, video=True)
            window = helper.wait('window', predicate=lambda m: m['generation'] > window['generation'])
            helper.wait('frame', predicate=lambda m: m['generation'] == window['generation'])
            evidence['startup_with_reconfiguration_ms'] = round((time.monotonic() - started) * 1000)
            helper.close()
            helper = Helper(helper_path)
            started = time.monotonic()
            helper.send('launch', paths=[str(bundle)], application_id=identifier, defer_capture=True)
            helper.send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
            assert helper.wait('launched')['pid'] == pid
            window = helper.wait('window')
            helper.wait('frame', predicate=lambda m: m['generation'] == window['generation'])
            assert window['width'] == 800 and window['height'] == 550, window
            assert len([e for e in helper.events if e['type'] == 'window']) == 1
            evidence['negotiated_attach_ms'] = round((time.monotonic() - started) * 1000)
            # A repeated viewport request must preserve capture and frame credit.
            helper.send('resize', window=window['window'], generation=window['generation'], width=800, height=550)
            helper.wait('operation_complete', predicate=lambda m: m.get('action') == 'resize')
            assert len([e for e in helper.events if e['type'] == 'window']) == 1
            evidence['unchanged_size_preserves_capture'] = True
            latencies = []
            for index in range(8):
                started = time.monotonic()
                # Exercise a new viewer while the previous capture is active.
                helper.send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
                window = helper.wait('window', predicate=lambda m: m['generation'] > window['generation'])
                helper.wait('frame', predicate=lambda m: m['generation'] == window['generation'])
                latencies.append(round((time.monotonic() - started) * 1000))
            evidence['reconnect_ms'] = latencies
            # New requests supersede unresolved selection without overlapping OS streams.
            for index in range(8):
                helper.send('configure', mode='smooth' if index % 2 == 0 else 'clarity', pixel_ratio=2, video=True)
            window = helper.wait('window', predicate=lambda m: m['generation'] > window['generation'])
            helper.wait('frame', predicate=lambda m: m['generation'] == window['generation'] and m['mode'] == 'clarity')
            helper.send('configure', mode='clarity', pixel_ratio=2, video=True, width=900, height=600)
            window = helper.wait('window', predicate=lambda m: m['generation'] > window['generation'])
            helper.wait('frame', predicate=lambda m: m['generation'] == window['generation'])
            assert window['width'] == 900 and window['height'] == 600, window
            helper.send('configure', mode='clarity', pixel_ratio=2, video=True, width=900, height=600)
            helper.send('menu', generation=window['generation'])
            assert helper.wait('menu')['generation'] == window['generation']
            evidence['combined_configuration_and_unchanged_generation'] = True
            assert json.loads((bundle / 'receipt.json').read_text())['pid'] == pid
            assert not [e for e in helper.events if e['type'] in ('capture_error', 'error', 'operation_error')], list(helper.events)
            evidence['burst_reconfiguration'] = True
            evidence['same_process'] = True
            output.write_text(json.dumps(evidence, indent=2) + '\n')
            print(json.dumps(evidence))
        finally:
            helper.close()
            if pid:
                command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
                if command and Path(command).resolve() == executable.resolve():
                    os.kill(pid, signal.SIGTERM)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.helper.resolve(), args.output.resolve())
