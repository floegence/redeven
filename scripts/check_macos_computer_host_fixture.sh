#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "macOS fixture requires Darwin"; exit 0; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/redeven-native-fixture.XXXXXX")"
cleanup() { kill "${fixture_pid:-}" 2>/dev/null || true; python3 - "$tmp" <<'PY'
import shutil,sys
shutil.rmtree(sys.argv[1],ignore_errors=True)
PY
}
trap cleanup EXIT INT TERM
cat >"$tmp/Fixture.swift" <<'SWIFT'
import AppKit
final class Delegate: NSObject, NSApplicationDelegate {
 var window:NSWindow!; var button:NSButton!
 func applicationDidFinishLaunching(_:Notification) { window=NSWindow(contentRect:NSRect(x:200,y:200,width:500,height:300),styleMask:[.titled,.closable],backing:.buffered,defer:false); button=NSButton(title:"Complete native step",target:self,action:#selector(done)); button.frame=NSRect(x:120,y:120,width:260,height:50); window.contentView!.addSubview(button); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
 @objc func done() { button.title="Completed 1"; try? "1".write(toFile:"${TMPDIR:-/tmp}/redeven-native-fixture.done",atomically:true,encoding:.utf8) }
}
let app=NSApplication.shared; let d=Delegate(); app.delegate=d; app.run()
SWIFT
# Replace the literal shell path inside the fixture source with this run's marker.
sed -i '' "s#\${TMPDIR:-/tmp}/redeven-native-fixture.done#$tmp/done#" "$tmp/Fixture.swift"
swiftc "$tmp/Fixture.swift" -o "$tmp/Fixture" -framework AppKit
swift build -c release --package-path "$root/desktop/native/computer-host" >/dev/null
"$tmp/Fixture" >/dev/null 2>&1 & fixture_pid=$!
sleep 1
printf '%s\n' '{"protocol_version":1,"request_id":"fixture-click","target_id":"desktop-main","tool_name":"computer.click","args":{"x":330,"y":1100}}' | "$root/desktop/native/computer-host/.build/release/redeven-computer-host" >/dev/null
sleep 1
test -s "$tmp/done"
echo "macOS native computer host fixture passed"
