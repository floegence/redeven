package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestWriteRuntimeState(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	err := writeRuntimeState(runtimePath, runtimeState{
		LocalUIURLs:      []string{"http://127.0.0.1:43123/", "", "http://127.0.0.1:43123/"},
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
		DesktopManaged:   true,
		PID:              42,
	})
	if err != nil {
		t.Fatalf("writeRuntimeState() error = %v", err)
	}

	body, err := os.ReadFile(runtimePath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var state runtimeState
	if err := json.Unmarshal(body, &state); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if state.LocalUIURL != "http://127.0.0.1:43123/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
	if len(state.LocalUIURLs) != 1 || state.LocalUIURLs[0] != state.LocalUIURL {
		t.Fatalf("LocalUIURLs = %#v", state.LocalUIURLs)
	}
	if !state.RemoteEnabled || !state.DesktopManaged || state.EffectiveRunMode != "hybrid" || state.PID != 42 {
		t.Fatalf("unexpected state: %#v", state)
	}
}

func TestWriteRuntimeState_RejectsMissingLocalURL(t *testing.T) {
	err := writeRuntimeState(filepath.Join(t.TempDir(), "runtime", "local-ui.json"), runtimeState{})
	if err == nil {
		t.Fatalf("expected missing local_ui_url error")
	}
}

func TestServerStartWritesAndCloseRemovesRuntimeState(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}

	s := &Server{
		log:              discardLogger(),
		bind:             bind,
		configPath:       cfgPath,
		runtimeStatePath: localRuntimeStatePath(cfgPath),
		version:          "dev",
		gw:               newTestGateway(t, cfgPath),
		pending:          make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	body, err := os.ReadFile(localRuntimeStatePath(cfgPath))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var state runtimeState
	if err := json.Unmarshal(body, &state); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if state.LocalUIURL == "" || len(state.LocalUIURLs) == 0 {
		t.Fatalf("unexpected runtime state: %#v", state)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, err := os.Stat(localRuntimeStatePath(cfgPath)); !os.IsNotExist(err) {
		t.Fatalf("runtime state still exists, stat err = %v", err)
	}
}

func TestLoadAttachableRuntimeState(t *testing.T) {
	server := httpTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_redeven_proxy/env/" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := writeRuntimeState(runtimePath, runtimeState{
		LocalUIURLs:      []string{server.URL + "/", "https://example.com/"},
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
		DesktopManaged:   true,
		PID:              42,
	}); err != nil {
		t.Fatalf("writeRuntimeState() error = %v", err)
	}

	state, err := LoadAttachableRuntimeState(runtimePath, time.Second)
	if err != nil {
		t.Fatalf("LoadAttachableRuntimeState() error = %v", err)
	}
	if state == nil {
		t.Fatalf("expected attachable runtime state")
	}
	if state.LocalUIURL != server.URL+"/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
	if !state.RemoteEnabled || !state.DesktopManaged || state.EffectiveRunMode != "hybrid" || state.PID != 42 {
		t.Fatalf("unexpected state: %#v", state)
	}
}

func TestWaitForAttachableRuntimeState(t *testing.T) {
	server := httpTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_redeven_proxy/env/" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	go func() {
		time.Sleep(150 * time.Millisecond)
		_ = writeRuntimeState(runtimePath, runtimeState{
			LocalUIURLs:      []string{server.URL + "/"},
			EffectiveRunMode: "local",
		})
	}()

	state, err := WaitForAttachableRuntimeState(runtimePath, time.Second, 50*time.Millisecond, 200*time.Millisecond)
	if err != nil {
		t.Fatalf("WaitForAttachableRuntimeState() error = %v", err)
	}
	if state == nil {
		t.Fatalf("expected runtime state to become attachable")
	}
	if state.LocalUIURL != server.URL+"/" {
		t.Fatalf("LocalUIURL = %q", state.LocalUIURL)
	}
}

func TestLoadAttachableRuntimeStateRejectsNonLoopbackURL(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := writeRuntimeState(runtimePath, runtimeState{
		LocalUIURL: "https://example.com/",
	}); err != nil {
		t.Fatalf("writeRuntimeState() error = %v", err)
	}

	state, err := LoadAttachableRuntimeState(runtimePath, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("LoadAttachableRuntimeState() error = %v", err)
	}
	if state != nil {
		t.Fatalf("expected non-loopback runtime state to be rejected: %#v", state)
	}
}

func httpTestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}
