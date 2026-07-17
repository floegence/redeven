package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-bridge-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	var publicRequests atomic.Int32
	publicLocalUIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		publicRequests.Add(1)
		http.Error(w, "public Local UI must not be used by desktop-bridge", http.StatusMisdirectedRequest)
	}))
	defer publicLocalUIServer.Close()
	trustedBridgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/local/runtime/health" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"status":"online","password_required":false,"desktop_managed":true,"desktop_owner_id":"test-desktop-owner"}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer trustedBridgeServer.Close()
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
				LocalUIURL:       publicLocalUIServer.URL + "/",
				LocalUIURLs:      []string{publicLocalUIServer.URL + "/"},
				LocalUIBridgeURL: trustedBridgeServer.URL + "/",
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

	bridgeInputReader, bridgeInputWriter := io.Pipe()
	defer bridgeInputReader.Close()
	bridgeOutputReader, bridgeOutputWriter := io.Pipe()
	defer bridgeOutputReader.Close()
	var stderr bytes.Buffer
	done := make(chan int, 1)
	go func() {
		done <- runCLI(
			[]string{"desktop-bridge", "--state-root", stateRoot},
			bridgeInputReader,
			bridgeOutputWriter,
			&stderr,
		)
		_ = bridgeOutputWriter.Close()
	}()

	header, payload, err := desktopbridge.ReadFrame(bridgeOutputReader)
	if err != nil {
		t.Fatalf("ReadFrame(hello) error = %v", err)
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

	openPayload, err := json.Marshal(desktopbridge.StreamOpen{Surface: desktopbridge.StreamSurfaceLocalUI})
	if err != nil {
		t.Fatalf("Marshal(stream open) error = %v", err)
	}
	if err := desktopbridge.WriteFrame(bridgeInputWriter, desktopbridge.FrameHeader{StreamID: "local-ui-health", Type: desktopbridge.FrameTypeStreamOpen}, openPayload); err != nil {
		t.Fatalf("WriteFrame(stream open) error = %v", err)
	}
	request := "GET /api/local/runtime/health HTTP/1.1\r\nHost: 127.0.0.1:54321\r\nConnection: close\r\n\r\n"
	if err := desktopbridge.WriteFrame(bridgeInputWriter, desktopbridge.FrameHeader{StreamID: "local-ui-health", Type: desktopbridge.FrameTypeStreamData}, []byte(request)); err != nil {
		t.Fatalf("WriteFrame(stream data) error = %v", err)
	}

	header, payload, err = desktopbridge.ReadFrame(bridgeOutputReader)
	if err != nil {
		t.Fatalf("ReadFrame(stream response) error = %v", err)
	}
	if header.Type != desktopbridge.FrameTypeStreamData || !bytes.Contains(payload, []byte("200 OK")) {
		t.Fatalf("unexpected stream response: header=%#v payload=%q", header, payload)
	}
	if publicRequests.Load() != 0 {
		t.Fatalf("desktop-bridge contacted public Local UI %d times", publicRequests.Load())
	}

	_ = bridgeInputWriter.Close()
	var code int
	select {
	case code = <-done:
	case <-time.After(time.Second):
		t.Fatal("desktop-bridge did not stop after input closed")
	}
	if code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	if strings.Contains(stderr.String(), "code app server listening") || strings.Contains(stderr.String(), "init runtime") {
		t.Fatalf("stderr = %q, bridge must not start runtime components", stderr.String())
	}
}

func TestDesktopBridgeFailsWhenTrustedLocalUIBridgeURLIsMissing(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-bridge-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	var publicRequests atomic.Int32
	publicLocalUIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		publicRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer publicLocalUIServer.Close()
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:  publicLocalUIServer.URL + "/",
				LocalUIURLs: []string{publicLocalUIServer.URL + "/"},
			},
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runCLI(
		[]string{"desktop-bridge", "--state-root", stateRoot},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)
	if code == 0 {
		t.Fatalf("exit code = 0, want failure")
	}
	if !strings.Contains(stderr.String(), "trusted Local UI bridge URL") {
		t.Fatalf("stderr = %q, want missing trusted bridge URL error", stderr.String())
	}
	if publicRequests.Load() != 0 {
		t.Fatalf("desktop-bridge fell back to public Local UI %d times", publicRequests.Load())
	}
}
