package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/diagnostics"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
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
		stateDir:         filepath.Dir(cfgPath),
		runtimeStatePath: localuiruntime.RuntimeStatePath(cfgPath),
		version:          "dev",
		desktopManaged:   true,
		desktopOwnerID:   "desktop-owner-state",
		gw:               newTestGateway(t, cfgPath),
		diag: func() *diagnostics.Store {
			store, err := diagnostics.New(diagnostics.Options{
				Logger:   discardLogger(),
				StateDir: filepath.Dir(cfgPath),
				Source:   diagnostics.SourceAgent,
			})
			if err != nil {
				t.Fatalf("diagnostics.New() error = %v", err)
			}
			return store
		}(),
		pending: make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	body, err := os.ReadFile(localuiruntime.RuntimeStatePath(cfgPath))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var state localuiruntime.State
	if err := json.Unmarshal(body, &state); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if state.LocalUIURL == "" || len(state.LocalUIURLs) == 0 {
		t.Fatalf("unexpected runtime state: %#v", state)
	}
	if state.PasswordRequired {
		t.Fatalf("PasswordRequired = true, want false")
	}
	if state.StateDir != filepath.Dir(cfgPath) || !state.DiagnosticsEnabled {
		t.Fatalf("unexpected diagnostics metadata: %#v", state)
	}
	if !state.DesktopManaged || state.DesktopOwnerID != "desktop-owner-state" {
		t.Fatalf("unexpected desktop ownership metadata: %#v", state)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, err := os.Stat(localuiruntime.RuntimeStatePath(cfgPath)); !os.IsNotExist(err) {
		t.Fatalf("runtime state still exists, stat err = %v", err)
	}
}
