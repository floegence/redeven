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
swiftc "$root/scripts/fixtures/nativeComputerUse.swift" -o "$tmp/Fixture" -framework AppKit
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
    fixture = subprocess.Popen([str(root/'Fixture'), str(root/'result.json'), '--park-pointer'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while not (root/'result.json').exists():
        assert fixture.poll() is None, 'native fixture exited during startup'
        assert time.monotonic() < deadline, 'native fixture startup timeout'
        time.sleep(.05)
    geometry = json.loads((root/'result.json').read_text())['geometry']
    helper = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    sequence = 0
    def action(tool, args):
        global sequence
        sequence += 1
        request = {'protocol_version':1,'request_id':str(sequence),'target_id':'desktop-main','tool_name':tool,'args':args}
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
            if response['type'] == 'result': return
    def point(name): return {'x':geometry[name+'X'], 'y':geometry[name+'Y']}
    action('computer.click', point('click'))
    action('computer.click', point('click'))
    action('computer.double_click', point('double'))
    action('computer.click', point('input'))
    action('computer.type', {'text':'Flower'})
    action('computer.key', {'key':'Enter'})
    action('computer.click', point('scroll'))
    action('computer.scroll', {'delta_y':400})
    action('computer.wait', {'milliseconds':300})
    action('computer.screenshot', {})
    result = json.loads((root/'result.json').read_text())
    assert result['clicks'] == 2 and result['doubleClicked'] and result['entered'], 'native input effects did not complete'
    assert result['scrolled'] and result['scrollOffset'] > 0 and result['wheelEvents'] > 0, 'scroll did not move native content: '+json.dumps(result)
    assert result['complete'], 'native fixture did not reach its final state'
    print(json.dumps({'native_fixture':'passed', 'clicks':result['clicks'], 'double':result['doubleClicked'], 'entered':result['entered'], 'scroll_offset':result['scrollOffset']}))
finally:
    stop(helper)
    stop(fixture)
PYTHON
driver_pid=$!
wait "$driver_pid"
driver_pid=
