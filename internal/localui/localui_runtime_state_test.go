package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
	"github.com/floegence/redeven/internal/codeapp/gateway"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type runtimeControlCodeWorkspaceTestBackend struct {
	localUITestBackend
	t                    *testing.T
	createdManifest      gateway.CodeRuntimeArtifactManifest
	receivedUploadID     string
	receivedChunkIndex   int64
	receivedChunkPayload string
	completedUploadID    string
}

func (b *runtimeControlCodeWorkspaceTestBackend) CodeRuntimeStatus(context.Context) (gateway.CodeRuntimeStatus, error) {
	return gateway.CodeRuntimeStatus{
		ActiveRuntime: codeserver.RuntimeTargetStatus{
			DetectionState: codeserver.RuntimeDetectionMissing,
			Source:         "none",
		},
		ManagedRuntime: codeserver.RuntimeTargetStatus{
			DetectionState: codeserver.RuntimeDetectionMissing,
			Source:         "managed",
		},
		Operation: codeserver.RuntimeOperationStatus{State: codeserver.RuntimeOperationStateIdle},
	}, nil
}

func (b *runtimeControlCodeWorkspaceTestBackend) CreateCodeRuntimeImportSession(_ context.Context, manifest gateway.CodeRuntimeArtifactManifest) (gateway.CodeRuntimeImportSession, error) {
	b.createdManifest = manifest
	return gateway.CodeRuntimeImportSession{
		UploadID:       "upload_test",
		OperationID:    "upload_test",
		Manifest:       manifest,
		State:          "receiving",
		ExpectedBytes:  manifest.Archive.SizeBytes,
		ChunkSizeBytes: 4 * 1024 * 1024,
	}, nil
}

func (b *runtimeControlCodeWorkspaceTestBackend) AppendCodeRuntimeImportChunk(_ context.Context, uploadID string, chunkIndex int64, body io.Reader) (gateway.CodeRuntimeImportChunkResult, error) {
	raw, err := io.ReadAll(body)
	if err != nil {
		b.t.Fatalf("ReadAll() error = %v", err)
	}
	b.receivedUploadID = uploadID
	b.receivedChunkIndex = chunkIndex
	b.receivedChunkPayload = string(raw)
	return gateway.CodeRuntimeImportChunkResult{
		UploadID:       uploadID,
		ReceivedBytes:  int64(len(raw)),
		ExpectedBytes:  int64(len(raw)),
		NextChunkIndex: chunkIndex + 1,
	}, nil
}

func (b *runtimeControlCodeWorkspaceTestBackend) CompleteCodeRuntimeImportSession(_ context.Context, uploadID string) (gateway.CodeRuntimeStatus, error) {
	b.completedUploadID = uploadID
	return gateway.CodeRuntimeStatus{
		ActiveRuntime: codeserver.RuntimeTargetStatus{
			DetectionState: codeserver.RuntimeDetectionReady,
			Source:         "managed",
			Version:        "4.109.1",
		},
		ManagedRuntimeVersion: "4.109.1",
		ManagedRuntimeSource:  "managed",
		Operation:             codeserver.RuntimeOperationStatus{State: codeserver.RuntimeOperationStateSucceeded},
	}, nil
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
		InstanceID:       "rt_test",
		LocalUIEnabled:   true,
		DesktopManaged:   true,
		EffectiveRunMode: "desktop",
	})
	if err != nil {
		t.Fatalf("agent.New() error = %v", err)
	}
	return a
}

func TestServerStartPublishesRuntimeManagementStatus(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()

	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              filepath.Dir(filepath.Dir(cfgPath)),
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		desktopManaged:         true,
		desktopOwnerID:         "desktop-owner-state",
		gw:                     newTestGateway(t, cfgPath),
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

	status, err := runtimemanagement.LoadStatus(ctx, s.runtimeControlSockPath, time.Second)
	if err != nil {
		t.Fatalf("LoadStatus() error = %v", err)
	}
	if status.State != runtimemanagement.AttachStateReady || status.Endpoint == nil {
		t.Fatalf("unexpected runtime status: %#v", status)
	}
	if status.Endpoint.LocalUIURL == "" || len(status.Endpoint.LocalUIURLs) == 0 {
		t.Fatalf("unexpected runtime endpoint: %#v", status.Endpoint)
	}
	if status.Endpoint.PasswordRequired {
		t.Fatalf("PasswordRequired = true, want false")
	}
	if status.Identity.StateDir != filepath.Dir(cfgPath) {
		t.Fatalf("unexpected identity metadata: %#v", status.Identity)
	}
	if !status.Identity.DesktopManaged || status.Identity.DesktopOwnerID != "desktop-owner-state" {
		t.Fatalf("unexpected desktop ownership metadata: %#v", status.Identity)
	}
	if status.Endpoint.RuntimeControl == nil ||
		status.Endpoint.RuntimeControl.ProtocolVersion != "redeven-runtime-control-v1" ||
		status.Endpoint.RuntimeControl.BaseURL == "" ||
		status.Endpoint.RuntimeControl.Token == "" ||
		status.Endpoint.RuntimeControl.DesktopOwnerID != "desktop-owner-state" {
		t.Fatalf("unexpected runtime-control endpoint: %#v", status.Endpoint.RuntimeControl)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestServerRuntimeControlUsesStructuredAuthErrors(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()
	a := newDesktopManagedTestAgent(t, cfgPath)
	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              filepath.Dir(filepath.Dir(cfgPath)),
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		desktopManaged:         true,
		desktopOwnerID:         "desktop-owner-state",
		gw:                     newTestGateway(t, cfgPath),
		a:                      a,
		pending:                make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = s.Close() }()

	endpoint := s.RuntimeControlEndpointForDesktopBridge()
	if endpoint == nil {
		t.Fatalf("missing runtime-control endpoint")
	}

	req, err := http.NewRequest(http.MethodPost, endpoint.BaseURL+"/v1/provider-link", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+endpoint.Token)
	req.Header.Set("X-Redeven-Desktop-Owner-ID", endpoint.DesktopOwnerID)
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

func TestServerRuntimeControlCodeWorkspaceEngineImport(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()

	backend := &runtimeControlCodeWorkspaceTestBackend{t: t}
	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              filepath.Dir(filepath.Dir(cfgPath)),
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		desktopManaged:         true,
		desktopOwnerID:         "desktop-owner-state",
		gw:                     newTestGatewayWithBackend(t, cfgPath, backend),
		a:                      newDesktopManagedTestAgent(t, cfgPath),
		pending:                make(map[string]pendingDirect),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = s.Close() }()

	endpoint := s.RuntimeControlEndpointForDesktopBridge()
	if endpoint == nil {
		t.Fatalf("missing runtime-control endpoint")
	}
	do := func(method string, path string, body string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, endpoint.BaseURL+path, strings.NewReader(body))
		if err != nil {
			t.Fatalf("NewRequest() error = %v", err)
		}
		req.Header.Set("Authorization", "Bearer "+endpoint.Token)
		req.Header.Set("X-Redeven-Desktop-Owner-ID", endpoint.DesktopOwnerID)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("Do() error = %v", err)
		}
		return resp
	}

	manifestJSON := `{"manifest":{"schema_version":1,"engine":"code-server","version":"4.109.1","source":{"kind":"github_release","asset_name":"code-server-4.109.1-linux-amd64.tar.gz"},"platform":{"os":"linux","arch":"amd64","libc":"glibc","platform_id":"linux-amd64-glibc","supported":true},"archive":{"sha256":"` + strings.Repeat("a", 64) + `","size_bytes":11,"compression":"tar.gz"},"layout":{"binary_relpath":"bin/code-server","root_dir_hint":"code-server-4.109.1-linux-amd64"}}}`
	createResp := do(http.MethodPost, "/v1/code-workspace-engine/import-sessions", manifestJSON)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(createResp.Body)
		t.Fatalf("create status=%d body=%s", createResp.StatusCode, string(body))
	}
	if backend.createdManifest.Version != "4.109.1" {
		t.Fatalf("created manifest version=%q", backend.createdManifest.Version)
	}

	chunkResp := do(http.MethodPut, "/v1/code-workspace-engine/import-sessions/upload_test/chunks/0", "hello world")
	defer chunkResp.Body.Close()
	if chunkResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(chunkResp.Body)
		t.Fatalf("chunk status=%d body=%s", chunkResp.StatusCode, string(body))
	}
	if backend.receivedUploadID != "upload_test" || backend.receivedChunkIndex != 0 || backend.receivedChunkPayload != "hello world" {
		t.Fatalf("unexpected chunk capture: upload=%q index=%d payload=%q", backend.receivedUploadID, backend.receivedChunkIndex, backend.receivedChunkPayload)
	}

	completeResp := do(http.MethodPost, "/v1/code-workspace-engine/import-sessions/upload_test/complete", "")
	defer completeResp.Body.Close()
	if completeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(completeResp.Body)
		t.Fatalf("complete status=%d body=%s", completeResp.StatusCode, string(body))
	}
	if backend.completedUploadID != "upload_test" {
		t.Fatalf("completed upload id=%q", backend.completedUploadID)
	}
}
