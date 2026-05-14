package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newDesktopManagedTestAgent(t *testing.T, cfgPath string) *agent.Agent {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	a, err := agent.New(agent.Options{
		Config: &config.Config{
			AgentHomeDir:     t.TempDir(),
			PermissionPolicy: policy,
		},
		ConfigPath:       cfgPath,
		LocalUIEnabled:   true,
		DesktopManaged:   true,
		EffectiveRunMode: "desktop",
	})
	if err != nil {
		t.Fatalf("agent.New() error = %v", err)
	}
	return a
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
		a:       newDesktopManagedTestAgent(t, cfgPath),
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
	if state.RuntimeControl == nil ||
		state.RuntimeControl.ProtocolVersion != "redeven-runtime-control-v1" ||
		state.RuntimeControl.BaseURL == "" ||
		state.RuntimeControl.Token == "" ||
		state.RuntimeControl.DesktopOwnerID != "desktop-owner-state" {
		t.Fatalf("unexpected runtime-control endpoint: %#v", state.RuntimeControl)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, err := os.Stat(localuiruntime.RuntimeStatePath(cfgPath)); !os.IsNotExist(err) {
		t.Fatalf("runtime state still exists, stat err = %v", err)
	}
}

func TestServerRuntimeControlUsesStructuredAuthErrors(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	a := newDesktopManagedTestAgent(t, cfgPath)
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
		a:                a,
		pending:          make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = s.Close() }()

	state, err := localuiruntime.Load(localuiruntime.RuntimeStatePath(cfgPath))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if state == nil || state.RuntimeControl == nil {
		t.Fatalf("missing runtime-control endpoint: %#v", state)
	}

	req, err := http.NewRequest(http.MethodPost, state.RuntimeControl.BaseURL+"/v1/provider-link", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+state.RuntimeControl.Token)
	req.Header.Set("X-Redeven-Desktop-Owner-ID", state.RuntimeControl.DesktopOwnerID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("StatusCode = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
	var envelope struct {
		OK    bool `json:"ok"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if envelope.OK || envelope.Error == nil || envelope.Error.Code != "RUNTIME_CONTROL_METHOD_NOT_ALLOWED" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
}
