#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "SKIP: macOS fixture requires Darwin"; exit 0; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/redeven-native-fixture.XXXXXX")"
driver_pid=
cleanup() {
  if [[ -n "$driver_pid" ]]; then
    kill -TERM "$driver_pid" 2>/dev/null || true
    wait "$driver_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$tmp/Fixture.app/Contents/MacOS"
cat > "$tmp/Fixture.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.floegence.redeven.computer-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleName</key><string>Flower Native Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>
PLIST
swiftc "$root/scripts/fixtures/nativeComputerUse.swift" -o "$tmp/Fixture.app/Contents/MacOS/Fixture" -framework AppKit
swift build -c release --package-path "$root/desktop/native/computer-host" >/dev/null
python3 - "$tmp" "$root/desktop/native/computer-host/.build/release/redeven-computer-host" <<'PYTHON' &
import json, pathlib, select, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
root, binary = pathlib.Path(sys.argv[1]), sys.argv[2]
fixture = helper = None

def stop(process):
    if process is None: return
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    assert process.poll() is not None, 'test process was not reaped'

try:
    fixture = subprocess.Popen([str(root/'Fixture.app/Contents/MacOS/Fixture'), str(root/'result.json'), '--background', '--status-pipe'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while not (root/'result.json').exists():
        assert fixture.poll() is None, 'native fixture exited during startup'
        assert time.monotonic() < deadline, 'native fixture startup timeout'
        time.sleep(.05)
    geometry = json.loads((root/'result.json').read_text())['geometry']
    def verify_restored():
        fixture.stdin.write(b'status\n'); fixture.stdin.flush()
        assert select.select([fixture.stdout], [], [], 5)[0], 'native fixture status timeout'
        state = json.loads(fixture.stdout.readline())
        assert state['frontmost_pid'] == state['initial_frontmost_pid'], 'original application focus was not preserved: '+json.dumps(state)
        assert state['original_window_available'] and state['original_window_focused'], 'original window focus was not preserved'
        assert state['pointer_x'] == state['initial_pointer_x'] and state['pointer_y'] == state['initial_pointer_y'], 'pointer was not preserved'
        return state
    verify_restored()
    helper = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    sequence = 0
    target_id = "desktop-main"
    def action(tool, args):
        global sequence
        sequence += 1
        request = {'protocol_version':2,'request_id':str(sequence),'target_id':target_id,'tool_name':tool,'args':args, 'allowed_apps':['dev.floegence.redeven.computer-fixture'], 'allow_foreground':True, 'script_operation':True}
        helper.stdin.write((json.dumps(request)+'\n').encode())
        helper.stdin.flush()
        deadline = time.monotonic() + 15
        while True:
            assert select.select([helper.stdout], [], [], max(0, deadline-time.monotonic()))[0], 'native helper response timeout'
            line = helper.stdout.readline()
            assert line, 'native helper exited'
            response = json.loads(line)
            assert response['request_id'] == str(sequence), 'native helper response identity mismatch'
            if response['type'] == 'error': raise AssertionError(response.get('error_code', 'native helper error'))
            if response['type'] == 'result':
                assert response.get('safety',{}).get('level') != 'takeover', 'native helper paused: '+json.dumps(response.get('safety'))
                verify_restored()
                return response['payload']
    deadline = time.monotonic() + 10
    while True:
        targets = action('computer.targets', {})['targets']
        selected = [target for target in targets if target.get('app_bundle_id') == 'dev.floegence.redeven.computer-fixture']
        if selected or time.monotonic() >= deadline: break
        time.sleep(.1)
    assert len(selected) == 1, 'fixture window was not uniquely discovered'
    target_id = selected[0]['id']
    observed = action('computer.observe', {})
    assert 'screenshot_base64' not in observed, 'semantic observation captured pixels'
    controls = observed['observation']['nodes']
    buttons = [node for node in controls if node['role']=='AXButton' and node['name']=='Complete native step']
    fields = [node for node in controls if node['role']=='AXTextField' and node['name']=='Query']
    assert len(buttons)==1 and len(fields)==1, 'native semantic controls were not exposed'
    action('computer.action', {'action':'fill', 'selector':{'ref':fields[0]['ref']}, 'text':'Flower'})
    field = action('computer.action', {'action':'read', 'selector':{'ref':fields[0]['ref']}})
    assert field['node']['value'] == 'Flower', 'AX value was not updated'
    for _ in range(2):
        pressed = action('computer.action', {'action':'click', 'selector':{'role':'AXButton','name':'Complete native step'}})
        assert pressed['execution_mode']=='background' and 'screenshot_base64' not in pressed
        assert not pressed['background_interference'], 'AX action changed focus or pointer without user input'
    result = json.loads((root/'result.json').read_text())
    def point(name): return {'x':geometry[name+'X']-geometry['x'], 'y':geometry[name+'Y']-geometry['y']}
    action('computer.double_click', point('double'))
    action('computer.action', {'action':'key','selector':{'ref':fields[0]['ref']},'key':'Enter'})
    action('computer.click', point('scroll'))
    scrolls = [node for node in controls if node['role']=='AXScrollArea']
    assert len(scrolls)==1, 'scroll area missing'
    action('computer.action', {'action':'scroll','selector':{'ref':scrolls[0]['ref']},'delta_y':400})
    action('computer.wait', {'milliseconds':300})
    semantic_offset = json.loads((root/'result.json').read_text())['scrollOffset']
    assert semantic_offset > 0, 'semantic scroll did not move the selected control'
    action('computer.scroll', {**point('scroll'), 'delta_y':200})
    action('computer.wait', {'milliseconds':300})
    action('computer.screenshot', {})
    result = json.loads((root/'result.json').read_text())
    assert result['clicks'] == 2 and result['doubleClicked'] and result['entered'], 'native input effects did not complete'
    assert result['scrolled'] and result['scrollOffset'] > 0 and result['wheelEvents'] > 0, 'scroll did not move native content: '+json.dumps(result)
    assert result['scrollOffset'] > semantic_offset, 'coordinate scroll did not move the requested region'
    assert result['complete'], 'native fixture did not reach its final state'
    print(json.dumps({'native_fixture':'passed', 'clicks':result['clicks'], 'double':result['doubleClicked'], 'entered':result['entered'], 'scroll_offset':result['scrollOffset'], 'original_application_restored':True, 'original_window_restored':True, 'pointer_restored':True}))
finally:
    stop(helper)
    stop(fixture)
PYTHON
driver_pid=$!
wait "$driver_pid"
driver_pid=
