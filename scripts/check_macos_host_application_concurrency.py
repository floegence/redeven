#!/usr/bin/env python3
"""Verify native capture ownership across independent, disposable applications."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import tempfile
import time
import uuid

from check_macos_host_applications import Helper, HelperHost


def run(helper_path, output):
    evidence = {}
    with tempfile.TemporaryDirectory(prefix='redeven-concurrent-capture-') as temporary:
        root = Path(temporary)
        fixture = root / 'Fixture'
        subprocess.run(['swiftc', str(Path(__file__).parent / 'fixtures/nativeHostApplication.swift'),
                        '-o', str(fixture)], check=True)
        host = HelperHost(helper_path)
        clients, owned, windows = [], [], []
        try:
            for index in range(2):
                bundle = root / f'Fixture{index}.app'
                executable = bundle / 'Contents/MacOS/Fixture'
                executable.parent.mkdir(parents=True)
                shutil.copy2(fixture, executable)
                name = f'Concurrent Capture Fixture {index}'
                with (bundle / 'Contents/Info.plist').open('wb') as file:
                    plistlib.dump(dict(CFBundleExecutable='Fixture', CFBundleIdentifier='com.floegence.fixture.' + uuid.uuid4().hex,
                                      CFBundleName=name, CFBundlePackageType='APPL', NSHighResolutionCapable=True), file)
                if index == 1:
                    # This exact order previously left an idle native process
                    # contending with the next application's replayd connection.
                    clients[0].send('suspend')
                    clients[0].wait('suspended')
                client = Helper(host=host)
                clients.append(client)
                client.send('catalog', paths=[str(bundle)])
                app = next(app for app in client.wait('catalog')['applications'] if app['name'] == name)
                started = time.monotonic()
                client.send('launch', paths=[str(bundle)], application_id=app['id'], defer_capture=True)
                launched = client.wait('launched')
                owned.append((launched['pid'], executable))
                client.send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
                window = client.wait('window')
                frame = client.wait('frame', timeout=5, predicate=lambda value: value['generation'] == window['generation'])
                assert frame['session_id'] == client.session_id
                windows.append(window)
                evidence[f'application_{index}_launch_ms'] = round((time.monotonic() - started) * 1000)
            evidence['suspended_application_does_not_block_next'] = True
            suspended_frames = len(clients[0].frames)
            time.sleep(0.25)
            assert len(clients[0].frames) == suspended_frames

            reconnects = []
            for _ in range(3):
                for index, client in enumerate(clients):
                    started = time.monotonic()
                    previous = windows[index]['generation']
                    client.send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
                    windows[index] = client.wait('window', predicate=lambda value: value['generation'] > previous)
                    client.wait('frame', timeout=3, predicate=lambda value: value['generation'] == windows[index]['generation'])
                    reconnects.append(round((time.monotonic() - started) * 1000))
                    client.send('suspend')
                    client.wait('suspended')
            evidence['alternating_reconnect_ms'] = reconnects

            # Frame credit and cancellation are per application, even when one
            # consumer stalls while another continues receiving fresh pictures.
            clients[0].auto_ack = False
            for index, client in enumerate(clients):
                previous = windows[index]['generation']
                client.send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
                windows[index] = client.wait('window', predicate=lambda value: value['generation'] > previous)
                client.wait('frame', timeout=3, predicate=lambda value: value['generation'] == windows[index]['generation'])
            evidence['independent_frame_credit'] = True

            clients[0].send('detach')
            clients[0].wait('ended')
            clients[0].close()
            previous = windows[1]['generation']
            clients[1].send('resume', mode='auto', pixel_ratio=2, video=True, width=800, height=550)
            windows[1] = clients[1].wait('window', predicate=lambda value: value['generation'] > previous)
            clients[1].wait('frame', timeout=3, predicate=lambda value: value['generation'] == windows[1]['generation'])
            evidence['detaching_one_preserves_other_capture'] = True
            assert host.process.poll() is None
            for pid, _ in owned:
                os.kill(pid, 0)
            evidence['same_helper_and_application_processes'] = True
            for client in clients:
                assert not [event for event in client.events if event['type'] in ('error', 'capture_error', 'operation_error', 'blocked')], list(client.events)
            output.write_text(json.dumps(evidence, indent=2) + '\n')
            print(json.dumps(evidence))
        finally:
            for client in clients:
                client.close()
            host.close()
            for pid, executable in owned:
                command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], text=True, capture_output=True).stdout.strip()
                if command and Path(command).resolve() == executable.resolve():
                    os.kill(pid, signal.SIGTERM)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.helper.resolve(), args.output.resolve())
