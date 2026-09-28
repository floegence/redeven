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

func TestRetainedXpraExplicitTerminationPreservesEndReason(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		m := macFixture(t)
		forward, err := m.forwards.OpenOwnedForwardSession(context.Background(), "http://127.0.0.1:43210/_redeven_host_app/")
		if err != nil {
			t.Fatal(err)
		}
		a := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("a", 64), Backend: "xpra"}, terminationRequested: explicit}
		s := &ownedSession{application: a, owner: "alice", done: make(chan struct{}), view: Session{ID: "termination", State: "running", Backend: "linux", Forward: forward}}
		m.sessions[s.view.ID] = s
		done := make(chan error)
		close(done)
		m.watchApplication(a, done)
		m.appsDone.Wait()
		if explicit && (s.view.State != "ended" || s.view.EndReason != "application_exited" || s.view.ErrorCode != "") {
			t.Fatal("explicit Xpra termination was reported as capture failure", s.view)
		}
		if !explicit && (s.view.State != "failed" || s.view.EndReason != "" || s.view.ErrorCode != "capture_failed") {
			t.Fatal("unknown Xpra death became normal application exit", s.view)
		}
	}
}

func TestDesktopReceiptRequiresExactHelperAndExplicitExit(t *testing.T) {
	recordData, _ := json.Marshal(desktopRecordFixture())
	record, err := decodeApplicationRecord(recordData, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name         string
		transitions  []map[string]any
		ready        bool
		code, reason string
	}{
		{"slow startup", []map[string]any{{"state": "starting", "phase": "application"}}, false, "", ""},
		{"waiting for first window", []map[string]any{{"state": "prepared", "phase": "sharing_ready"}}, true, "", ""},
		{"launcher failure", []map[string]any{{"state": "failed", "phase": "application_start", "error_code": "APPLICATION_LAUNCHER_EXITED"}}, false, "launch_failed", ""},
		{"launcher failure before cleanup exit", []map[string]any{{"state": "failed", "phase": "application_start", "error_code": "APPLICATION_LAUNCHER_EXITED", "exit_code": 46}, {"state": "exited", "phase": "cleanup"}}, false, "launch_failed", ""},
		{"host services", []map[string]any{{"state": "failed", "phase": "host_services", "error_code": "APPLICATION_HOST_SERVICE_UNAVAILABLE"}}, false, "host_service_unavailable", ""},
		{"host service lost after preparation", []map[string]any{{"state": "prepared", "phase": "sharing_ready"}, {"state": "failed", "phase": "host_services", "error_code": "APPLICATION_HOST_SERVICE_UNAVAILABLE"}}, true, "host_service_unavailable", ""},
		{"stale package", []map[string]any{{"state": "failed", "phase": "revalidation", "error_code": "APPLICATION_PLAN_STALE"}}, false, "plan_stale", ""},
		{"capture failure", []map[string]any{{"state": "prepared", "phase": "sharing_ready"}, {"state": "failed", "phase": "capture", "error_code": "CAPTURE_UNAVAILABLE"}}, true, "capture_failed", ""},
		{"real exit", []map[string]any{{"state": "exited", "phase": "process_exit"}}, false, "", "application_exited"},
		{"exit before graphics cleanup", []map[string]any{{"state": "exited", "phase": "process_exit"}, {"state": "failed", "phase": "cleanup", "error_code": "DESKTOP_BUS_CLOSE_FAILED"}}, false, "", "application_exited"},
	} {
		t.Run(test.name, func(t *testing.T) {
			receipt := map[string]any{"version": 1, "instance": record.ID, "helper_pid": 123, "helper_start_ticks": 456, "transitions": test.transitions}
			data, _ := json.Marshal(receipt)
			result, err := decodeDesktopReceipt(data, record)
			if err != nil || result.Ready != test.ready || result.ErrorCode != test.code || result.EndReason != test.reason {
				t.Fatal(result, err)
			}
			for _, field := range []string{"instance", "helper_pid", "helper_start_ticks", "version"} {
				altered := map[string]any{}
				for k, v := range receipt {
					altered[k] = v
				}
				altered[field] = nil
				data, _ = json.Marshal(altered)
				if _, err := decodeDesktopReceipt(data, record); err == nil {
					t.Fatalf("accepted foreign receipt field %s", field)
				}
			}
		})
	}
}
