package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestDesktopBridgeFailsWhenRuntimeDaemonIsNotRunning(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	stateRoot := filepath.Join(t.TempDir(), "state")

	code := runCLI(
		[]string{"desktop-bridge", "--state-root", stateRoot},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)
	if code == 0 {
		t.Fatalf("exit code = 0, want failure")
	}
	if strings.Contains(stderr.String(), "init runtime") {
		t.Fatalf("stderr = %q, bridge must not initialize runtime", stderr.String())
	}
	if !strings.Contains(strings.ToLower(stderr.String()), "runtime daemon is not running") {
		t.Fatalf("stderr = %q, want runtime daemon not running error", stderr.String())
	}
}

func TestDesktopBridgeKeepsStdoutProtocolPure(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-bridge-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	localUIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/local/runtime/health" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"status":"online","password_required":false,"desktop_managed":true,"desktop_owner_id":"test-desktop-owner"}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer localUIServer.Close()
	controlServer := httptest.NewServer(http.NotFoundHandler())
	defer controlServer.Close()
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:        layout.StateDir,
				StartedAtUnixMS: 1778751234567,
				DesktopManaged:  true,
				DesktopOwnerID:  "test-desktop-owner",
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:       localUIServer.URL + "/",
				LocalUIURLs:      []string{localUIServer.URL + "/"},
				PasswordRequired: false,
				RuntimeControl: &runtimemanagement.RuntimeControlEndpoint{
					ProtocolVersion: "runtime-control-v1",
					BaseURL:         controlServer.URL + "/",
					Token:           "token",
					DesktopOwnerID:  "test-desktop-owner",
				},
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				DesktopManaged: true,
			}),
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

	code := runCLI(
		[]string{"desktop-bridge", "--state-root", stateRoot},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	out := stdout.Bytes()
	if bytes.HasPrefix(out, []byte("{")) || bytes.Contains(out, []byte("code app server listening")) {
		t.Fatalf("stdout contains non-protocol log bytes: %q", string(out[:min(len(out), 160)]))
	}

	header, payload, err := desktopbridge.ReadFrame(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("ReadFrame(stdout) error = %v; stdout prefix=%q", err, string(out[:min(len(out), 160)]))
	}
	if header.Type != desktopbridge.FrameTypeHello {
		t.Fatalf("frame type = %q, want %q", header.Type, desktopbridge.FrameTypeHello)
	}
	var hello desktopbridge.Hello
	if err := json.Unmarshal(payload, &hello); err != nil {
		t.Fatalf("hello payload JSON error = %v", err)
	}
	if hello.ProtocolVersion != desktopbridge.ProtocolVersion {
		t.Fatalf("hello protocol = %q, want %q", hello.ProtocolVersion, desktopbridge.ProtocolVersion)
	}
	if hello.StartedAtUnixMS != 1778751234567 {
		t.Fatalf("hello StartedAtUnixMS = %d", hello.StartedAtUnixMS)
	}
	if strings.Contains(stderr.String(), "code app server listening") || strings.Contains(stderr.String(), "init runtime") {
		t.Fatalf("stderr = %q, bridge must not start runtime components", stderr.String())
	}
}
