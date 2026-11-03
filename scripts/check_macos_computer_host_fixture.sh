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
    previous_state=json.loads((root/'result.json').read_text())
    def verify_restored():
        global previous_state
        fixture.stdin.write(b'status\n'); fixture.stdin.flush()
        assert select.select([fixture.stdout], [], [], 5)[0], 'native fixture status timeout'
        state = json.loads(fixture.stdout.readline())
        origins=state.get('input_origins',{})
        old=previous_state.get('input_origins',{})
        own={str(fixture.pid), str(helper.pid) if helper else ''}
        user_input=any(count>old.get(pid,0) for pid,count in origins.items() if pid not in own)
        if not user_input:
            assert state['frontmost_pid']==previous_state['frontmost_pid'], 'application focus changed without user input: '+json.dumps(state)
            assert state['pointer_x']==previous_state['pointer_x'] and state['pointer_y']==previous_state['pointer_y'], 'pointer changed without user input'
        previous_state=state
        return state
    verify_restored()
    helper = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    sequence = 0
    target_id = "desktop-main"
    def action(tool, args, require_routine=True):
        global sequence
        sequence += 1
        request = {'protocol_version':4,'request_id':str(sequence),'target_id':target_id,'tool_name':tool,'args':args, 'full_access':True, 'script_operation':True}
        helper.stdin.write((json.dumps(request)+'\n').encode())
        helper.stdin.flush()
        deadline = time.monotonic() + 15
        while True:
            assert select.select([helper.stdout], [], [], max(0, deadline-time.monotonic()))[0], 'native helper response timeout'
            line = helper.stdout.readline()
            assert line, 'native helper exited'
            response = json.loads(line)
            assert response['request_id'] == str(sequence), 'native helper response identity mismatch'
            if response['type'] == 'error': raise AssertionError((args.get('action',tool),response.get('error_code'),response.get('error')))
            if response['type'] == 'result':
                if not require_routine: return response
                assert response.get('safety',{}).get('level') != 'takeover', 'native helper paused: '+json.dumps({'safety':response.get('safety'),'action':args})
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
    selector={'ref':fields[0]['ref']}
    source=action('computer.action', {'action':'source','selector':selector})
    assert 'AXValue' in source['fields'], source
    exact=action('computer.action', {'action':'source','selector':selector,'field':'AXValue'})
    assert exact['value']=='Flower' and exact['truncated'] is False, exact
    selection=action('computer.action', {'action':'select_text','selector':selector,'text':'low'})
    assert selection['selection']['start']==1 and selection['selection']['end']==4, selection
    assert action('computer.action', {'action':'selection','selector':selector})['text']=='low'
    action('computer.action', {'action':'select_range','selector':selector,'start':0,'end':6})
    copied=action('computer.action', {'action':'copy','selector':selector})
    assert copied['clipboard_changed'], (copied, verify_restored()['actions'])
    clipboard=action('computer.action', {'action':'clipboard','operation':'read'})
    import base64
    assert any(base64.b64decode(v)==b'Flower' for item in clipboard['items'] for v in item.values()), clipboard
    action('computer.action', {'action':'cut','selector':selector})
    assert action('computer.action', {'action':'source','selector':selector,'field':'AXValue'})['value']=='', 'cut did not delete'
    action('computer.action', {'action':'paste','selector':selector})
    assert action('computer.action', {'action':'source','selector':selector,'field':'AXValue'})['value']=='Flower', 'paste did not insert'
    action('computer.action', {'action':'input_sequence','events':[{'type':'keyDown','key':'ArrowRight'},{'type':'keyUp','key':'ArrowRight'}]})
    action('computer.action', {'action':'hover','selector':{'ref':buttons[0]['ref']}})
    for _ in range(2):
        pressed = action('computer.action', {'action':'click', 'selector':{'role':'AXButton','name':'Complete native step'}})
        assert 'screenshot_base64' not in pressed
        assert pressed['execution_mode'] in ['background','foreground'], pressed
        # AXPress may activate its app; existing foreground consent covers this.
        if pressed['background_interference']: assert pressed['execution_mode']=='foreground'
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
    fixture.stdin.write(b'protect\n'); fixture.stdin.flush()
    assert select.select([fixture.stdout], [], [], 5)[0], 'secure fixture update timeout'
    json.loads(fixture.stdout.readline())
    blocked = action('computer.observe', {}, require_routine=False)
    assert blocked.get('safety', {}).get('level') == 'takeover', 'secure role did not pause observation'
    assert 'secret_input' in blocked['safety']['reason_codes']
    assert 'fixture-private-value' not in json.dumps(blocked), 'secure value leaked'
    assert 'screenshot_base64' not in json.dumps(blocked), 'secure pixels leaked'
    print(json.dumps({'native_fixture':'passed', 'clicks':result['clicks'], 'double':result['doubleClicked'], 'entered':result['entered'], 'scroll_offset':result['scrollOffset'], 'original_application_restored':True, 'original_window_restored':True, 'pointer_restored':True}))
finally:
    stop(helper)
    stop(fixture)
PYTHON
driver_pid=$!
wait "$driver_pid"
driver_pid=
