package hostapps

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func desktopRecordFixture() map[string]any {
	id := strings.Repeat("a", 64)
	return map[string]any{
		"version": 3, "backend": "wayland", "component": strings.Repeat("b", 64),
		"id": id, "owner": "alice", "application": map[string]any{"id": "fixture.desktop"},
		"process": map[string]any{"pid": 123, "boot": "boot", "started": "456"}, "started_at_unix_ms": 1,
		"endpoint": map[string]any{"SocketPath": filepath.Join(applicationSocketDir(id), "control.sock"), "Instance": id, "Token": strings.Repeat("c", 64)},
	}
}

func TestDesktopApplicationRecordBindsBackendAndEndpoint(t *testing.T) {
	for _, backend := range []string{"wayland", "xpra"} {
		t.Run(backend, func(t *testing.T) {
			r := desktopRecordFixture()
			r["backend"] = backend
			if backend == "xpra" {
				delete(r, "endpoint")
				r["address"] = "127.0.0.1:43210"
			}
			data, _ := json.Marshal(r)
			if _, err := decodeApplicationRecord(data, r["id"].(string)); err != nil {
				t.Fatal("supported backend record rejected", err)
			}
		})
	}
}

func TestDesktopApplicationRecordRejectsCrossBackendAuthority(t *testing.T) {
	for _, change := range []func(map[string]any){
		func(r map[string]any) { r["backend"] = "unknown" },
		func(r map[string]any) { r["version"] = 4 },
		func(r map[string]any) { r["address"] = "127.0.0.1:43210" },
		func(r map[string]any) { r["component"] = "system" },
		func(r map[string]any) { r["endpoint"].(map[string]any)["Instance"] = "other" },
		func(r map[string]any) { r["endpoint"].(map[string]any)["SocketPath"] = "/tmp/other.sock" },
		func(r map[string]any) { r["endpoint"].(map[string]any)["Token"] = "" },
		func(r map[string]any) { r["backend"] = "xpra"; r["address"] = "127.0.0.1:43210" },
	} {
		r := desktopRecordFixture()
		change(r)
		data, _ := json.Marshal(r)
		if _, err := decodeApplicationRecord(data, r["id"].(string)); err == nil {
			t.Fatal("conflicting backend authority accepted")
		}
	}
}

func TestDesktopBackendFailureCannotBecomeNormalApplicationEnd(t *testing.T) {
	m := macFixture(t)
	forward, err := m.forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:43210/_redeven_host_app/")
	if err != nil {
		t.Fatal(err)
	}
	s := &ownedSession{application: &linuxApplication{}, owner: "alice", done: make(chan struct{}), view: Session{ID: "failure", State: "running", Backend: "wayland", Forward: forward}}
	m.sessions[s.view.ID] = s
	m.finish(s, "launch_failed", nil)
	if s.view.State != "failed" || s.view.EndReason != "" {
		t.Fatal("backend failure became normal application end", s.view)
	}
}
