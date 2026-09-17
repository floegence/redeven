#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'SKIP: macOS capture requires Darwin'; exit 0; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/redeven-native-background.XXXXXX")"
driver_pid=
cleanup() {
  if [[ -n "$driver_pid" ]]; then
    kill -TERM "$driver_pid" 2>/dev/null || true
    wait "$driver_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$temporary/Fixture.app/Contents/MacOS"
cat > "$temporary/Fixture.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.floegence.redeven.capture-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleName</key><string>Flower Background Capture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>
PLIST
swiftc "$root/scripts/fixtures/nativeComputerCapture.swift" -o "$temporary/Fixture.app/Contents/MacOS/Fixture" -framework AppKit
"$temporary/Fixture.app/Contents/MacOS/Fixture" --preflight
swift build -c release --package-path "$root/desktop/native/computer-host" >/dev/null
python3 - "$temporary" "$root/desktop/native/computer-host/.build/release/redeven-computer-host" <<'PYTHON' &
import base64, json, os, pathlib, select, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
root, binary = pathlib.Path(sys.argv[1]), sys.argv[2]
fixture = helper = excluded = None

def stop(process):
    if process is None: return
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    assert process.poll() is not None, 'test process was not reaped'

def receive(process):
    assert select.select([process.stdout], [], [], 15)[0], 'capture response timed out'
    line = process.stdout.readline()
    assert line, 'capture process exited'
    return json.loads(line)

sequence = 0
def action(process, tool, target='desktop-main', args=None):
    global sequence
    sequence += 1
    request = {'protocol_version': 2, 'request_id': str(sequence), 'target_id': target,
               'tool_name': tool, 'args': args or {}, 'allowed_apps': ['dev.floegence.redeven.capture-fixture'],
               'allow_foreground': False, 'script_operation': True}
    process.stdin.write((json.dumps(request)+'\n').encode()); process.stdin.flush()
    response = receive(process)
    assert response['request_id'] == str(sequence), 'capture identity mismatch'
    assert response['type'] != 'started', 'background capture attempted foreground use'
    return response

def spawn_helper(environment=None):
    return subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=environment)

try:
    executable = str(root/'Fixture.app/Contents/MacOS/Fixture')
    fixture = subprocess.Popen([executable], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    before = receive(fixture)
    assert before['covered'] and before['frontmost_unchanged'] and before['pointer_unchanged'], before
    helper = spawn_helper()
    deadline = time.monotonic() + 10
    while True:
        inventory = action(helper, 'computer.targets')['payload']['targets']
        targets = [t for t in inventory if t.get('app_bundle_id') == 'dev.floegence.redeven.capture-fixture' and t['display_name'].endswith(' — Flower Background Capture')]
        if targets or time.monotonic() >= deadline: break
        # WindowServer and AX publish a just-launched window independently.
        # Wait only for discovery; no capture or input is replayed here.
        time.sleep(.1)
    assert len(targets) == 1, {'error': 'capture window not uniquely discovered', 'fixture': before,
                            'fixture_targets': [t for t in inventory if t.get('app_bundle_id') == 'dev.floegence.redeven.capture-fixture']}
    target = targets[0]['id']
    observed = action(helper, 'computer.observe', target)
    assert observed['type'] == 'result' and observed['safety']['level'] == 'routine', observed
    assert any(n.get('value') == 'Background target content' or n.get('name') == 'Background target content' for n in observed['payload']['observation']['nodes'])
    assert 'screenshot_base64' not in observed['payload'], 'AX observation unexpectedly captured pixels'
    captured = action(helper, 'computer.screenshot', target)
    assert captured['type'] == 'result' and captured['safety']['level'] == 'routine', {k:v for k,v in captured.items() if k != 'payload'}
    payload = captured['payload']
    assert payload['execution_mode'] == 'background' and not payload['background_interference']
    assert payload['width'] == before['target_width'] and payload['height'] == before['target_height']
    image = root/'target.png'
    image.write_bytes(base64.b64decode(payload['screenshot_base64'], validate=True))
    pixels = json.loads(subprocess.check_output([executable, '--inspect', str(image)]))
    assert pixels['width'] == payload['width'] and pixels['height'] == payload['height']
    assert all(abs(actual-expected) < 0.05 for actual, expected in zip(pixels['center_rgb'], [0.2, 0.6, 0.3])), pixels
    excluded = spawn_helper({**os.environ, 'REDEVEN_COMPUTER_EXCLUDED_WINDOW_OWNER_PID': str(fixture.pid)})
    assert not any(t.get('app_bundle_id') == 'dev.floegence.redeven.capture-fixture' for t in action(excluded, 'computer.targets')['payload']['targets']), 'excluded owner appeared in target inventory'
    fixture.stdin.write(b'status\n'); fixture.stdin.flush()
    after = receive(fixture)
    assert after['covered'] and after['frontmost_unchanged'] and after['pointer_unchanged'], after
    print(json.dumps({'scope': 'macos-background-occluded-window', 'passed': True, 'semantic_read': True,
                      'target_pixels_verified': True, 'excluded_owner_hidden': True, 'foreground_unchanged': True,
                      'pointer_unchanged': True, 'foreground_authorized': False}))
finally:
    stop(excluded)
    stop(helper)
    stop(fixture)
PYTHON
driver_pid=$!
wait "$driver_pid"
driver_pid=
