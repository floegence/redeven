package hostapps

import (
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"
)

func TestMacNativeHostIsolatesRoutingBackpressureAndClientClose(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"echo"'*) printf '{"type":"result","request":%s}\n' "$request" ;;
 *'"action":"burst"'*) i=0; while [ "$i" -lt 256 ]; do printf '%s\n' '{"type":"result"}'; i=$((i+1)); done ;;
 esac
done
`)
	first, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	if first.host != second.host {
		t.Fatal("applications acquired different native owners")
	}
	pid := first.host.cmd.Process.Pid
	check := func(client *macHostClient, forgedID string) {
		t.Helper()
		if err := macSend(client, map[string]any{"action": "echo", "session_id": forgedID}); err != nil {
			t.Fatal(err)
		}
		var got struct {
			SessionID string `json:"session_id"`
			Request   struct {
				SessionID string `json:"session_id"`
			} `json:"request"`
		}
		if err := json.NewDecoder(client).Decode(&got); err != nil {
			t.Fatal(err)
		}
		if got.SessionID != client.id || got.Request.SessionID != client.id {
			t.Fatalf("request escaped its native channel: %+v", got)
		}
	}
	check(first, second.id)
	check(second, first.id)
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := macSend(first, map[string]any{"action": "echo"}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("closed application accepted input: %v", err)
	}
	check(second, first.id)
	stalled, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	if err := macSend(stalled, map[string]any{"action": "burst"}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stalled.done:
	case <-time.After(3 * time.Second):
		t.Fatal("stalled channel retained an unbounded response queue")
	}
	check(second, stalled.id)
	if second.host.cmd.Process.Pid != pid {
		t.Fatal("closing a channel replaced the shared native process")
	}
}

func TestMacNativeHostCrashClosesEveryChannelAndReapsProcess(t *testing.T) {
	m := macFixture(t)
	first, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	if err := first.host.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	for _, done := range []<-chan struct{}{first.done, second.done, first.host.done} {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("helper exit left a native channel alive")
		}
	}
	if first.host.cmd.ProcessState == nil {
		t.Fatal("native process was not reaped")
	}
	third, err := m.openMacClient()
	if err != nil {
		t.Fatal(err)
	}
	if third.host == first.host {
		t.Fatal("new application reused the failed native host")
	}
}
