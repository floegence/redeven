package localuiruntime

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestWriteState(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	err := WriteState(runtimePath, State{
		LocalUIURLs:        []string{"http://127.0.0.1:43123/", "", "http://127.0.0.1:43123/"},
		PasswordRequired:   true,
		EffectiveRunMode:   "hybrid",
		RemoteEnabled:      true,
		DesktopManaged:     true,
		StateDir:           "/Users/tester/.redeven",
		DiagnosticsEnabled: true,
		PID:                42,
		RuntimeService: runtimeservice.Snapshot{
			RuntimeVersion:   "v1.2.3",
			ProtocolVersion:  runtimeservice.ProtocolVersion,
			ServiceOwner:     runtimeservice.OwnerDesktop,
			DesktopManaged:   true,
			EffectiveRunMode: "hybrid",
			RemoteEnabled:    true,
			Compatibility:    runtimeservice.CompatibilityCompatible,
			ActiveWorkload: runtimeservice.Workload{
				TerminalCount: 2,
				SessionCount:  1,
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	body, err := os.ReadFile(runtimePath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var state State
	if err := json.Unmarshal(body, &state); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if state.LocalUIURL != "http://127.0.0.1:43123/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
	if len(state.LocalUIURLs) != 1 || state.LocalUIURLs[0] != state.LocalUIURL {
		t.Fatalf("LocalUIURLs = %#v", state.LocalUIURLs)
	}
	if !state.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if !state.RemoteEnabled || !state.DesktopManaged || state.EffectiveRunMode != "hybrid" || state.PID != 42 {
		t.Fatalf("unexpected state: %#v", state)
	}
	if state.StateDir != "/Users/tester/.redeven" || !state.DiagnosticsEnabled {
		t.Fatalf("unexpected diagnostics state: %#v", state)
	}
	if state.RuntimeService.RuntimeVersion != "v1.2.3" || state.RuntimeService.ActiveWorkload.TerminalCount != 2 {
		t.Fatalf("unexpected runtime service state: %#v", state.RuntimeService)
	}
}

func TestWriteStateRejectsMissingLocalURL(t *testing.T) {
	err := WriteState(filepath.Join(t.TempDir(), "runtime", "local-ui.json"), State{})
	if err == nil {
		t.Fatalf("expected missing local_ui_url error")
	}
}

func TestLoadAttachable(t *testing.T) {
	server := httpTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/local/runtime/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true,"data":{"status":"online","password_required":true,"runtime_service":{"runtime_version":"v9.9.9","protocol_version":"redeven-runtime-v1","service_owner":"desktop","desktop_managed":true,"effective_run_mode":"hybrid","remote_enabled":true,"compatibility":"compatible","active_workload":{"terminal_count":4,"session_count":2,"task_count":1,"port_forward_count":3}}}}`))
	}))

	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := WriteState(runtimePath, State{
		LocalUIURLs:        []string{server.URL + "/", "https://example.com/"},
		EffectiveRunMode:   "hybrid",
		RemoteEnabled:      true,
		DesktopManaged:     true,
		StateDir:           "/tmp/redeven",
		DiagnosticsEnabled: true,
		PID:                42,
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	state, err := LoadAttachable(runtimePath, time.Second)
	if err != nil {
		t.Fatalf("LoadAttachable() error = %v", err)
	}
	if state == nil {
		t.Fatalf("expected attachable runtime state")
	}
	if state.LocalUIURL != server.URL+"/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
	if !state.PasswordRequired {
		t.Fatalf("PasswordRequired = false, want true")
	}
	if !state.RemoteEnabled || !state.DesktopManaged || state.EffectiveRunMode != "hybrid" || state.PID != 42 {
		t.Fatalf("unexpected state: %#v", state)
	}
	if state.StateDir != "/tmp/redeven" || !state.DiagnosticsEnabled {
		t.Fatalf("unexpected diagnostics metadata: %#v", state)
	}
	if state.RuntimeService.RuntimeVersion != "v9.9.9" || state.RuntimeService.ActiveWorkload.PortForwardCount != 3 {
		t.Fatalf("unexpected probed runtime service metadata: %#v", state.RuntimeService)
	}
}

func TestWaitForAttachable(t *testing.T) {
	server := httpTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/local/runtime/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true,"data":{"status":"online","password_required":false}}`))
	}))

	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	go func() {
		time.Sleep(150 * time.Millisecond)
		_ = WriteState(runtimePath, State{
			LocalUIURLs:      []string{server.URL + "/"},
			EffectiveRunMode: "local",
		})
	}()

	state, err := WaitForAttachable(runtimePath, time.Second, 50*time.Millisecond, 200*time.Millisecond)
	if err != nil {
		t.Fatalf("WaitForAttachable() error = %v", err)
	}
	if state == nil {
		t.Fatalf("expected runtime state to become attachable")
	}
	if state.LocalUIURL != server.URL+"/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
	if state.PasswordRequired {
		t.Fatalf("PasswordRequired = true, want false")
	}
}

func TestLoadAttachableRejectsNonLoopbackURL(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := WriteState(runtimePath, State{
		LocalUIURL: "https://example.com/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	state, err := LoadAttachable(runtimePath, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("LoadAttachable() error = %v", err)
	}
	if state != nil {
		t.Fatalf("expected non-loopback runtime state to be rejected: %#v", state)
	}
}

func TestLoadAttachableRejectsNonRedevenProbeResponse(t *testing.T) {
	server := httpTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/local/runtime/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true,"data":{}}`))
	}))

	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := WriteState(runtimePath, State{
		LocalUIURL: server.URL + "/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	state, err := LoadAttachable(runtimePath, time.Second)
	if err != nil {
		t.Fatalf("LoadAttachable() error = %v", err)
	}
	if state != nil {
		t.Fatalf("expected non-Redeven probe response to be rejected: %#v", state)
	}
}

func TestSnapshotBindAddress(t *testing.T) {
	snapshot := &Snapshot{LocalUIURL: "http://127.0.0.1:43123/"}
	got, err := snapshot.BindAddress()
	if err != nil {
		t.Fatalf("BindAddress() error = %v", err)
	}
	if got != "127.0.0.1:43123" {
		t.Fatalf("BindAddress() = %q", got)
	}
}

func httpTestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}
