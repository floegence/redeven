package appserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	redevenconfig "github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

type referenceOpenTargetToolExecutor struct{}

func (referenceOpenTargetToolExecutor) ExecuteTargetTool(_ context.Context, call ai.TargetToolCall) (ai.TargetToolResult, error) {
	return ai.TargetToolResult{TargetID: call.TargetID}, nil
}

func TestServer_AIReferenceOpenTargetAcceptsOnlyCanonicalIdentity(t *testing.T) {
	t.Parallel()

	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	home := t.TempDir()
	stateDir := t.TempDir()
	filePath := filepath.Join(home, "src", "main.ts")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("export const answer = 42\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	fileRealPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewRegistry(&redevenconfig.Config{
		AgentHomeDir: home,
		FilesystemScope: &redevenconfig.FilesystemScope{
			SchemaVersion: redevenconfig.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []redevenconfig.FilesystemRootPolicy{{
				ID: "home", Label: "Home", Path: home, Kind: redevenconfig.FilesystemRootHome,
				Permissions: redevenconfig.FilesystemPermissionSet{Read: true, Write: true},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	meta := session.Meta{
		EndpointID: "env_reference_open", UserPublicID: "user_reference_open", UserEmail: "reference-open@example.com",
		CanRead: true,
	}
	aiSvc, err := ai.NewService(ai.Options{
		Logger: logger, StateDir: stateDir, AgentHomeDir: home, FilesystemScope: scope, Shell: "/bin/sh",
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	thread, err := aiSvc.CreateThread(context.Background(), &session.Meta{
		EndpointID: meta.EndpointID, UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
		CanRead: true, CanWrite: true, CanExecute: true,
	}, "Reference open", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	locator := referenceOpenLocatorForTest(t, meta.EndpointID, filePath, false)
	seedFloretReferenceOpenTurn(t, stateDir, thread.ThreadID, "turn_reference_open", []flruntime.MessageReference{
		{ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "main.ts", ResourceRef: locator},
	})

	channelID := "ch_reference_open"
	srv, err := New(Options{
		Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("console.log('inject');")}},
		ListenAddr: "127.0.0.1:0", Logger: logger, AI: aiSvc, ConfigPath: writeTestConfig(t),
		ThreadReadStateStore: openTestThreadReadStateStore(t), ResolveSessionMeta: resolveMetaForTest(channelID, meta),
		AgentHomeDir: home, FilesystemScope: scope,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	endpoint := "/_redeven_proxy/api/ai/threads/" + url.PathEscape(thread.ThreadID) + "/reference-open-target"
	origin := envOriginWithChannel(channelID)

	rr := performServerRequest(srv, http.MethodPost, endpoint, origin, `{"turn_id":"turn_reference_open","reference_id":"context:0"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("reference open status=%d body=%s", rr.Code, rr.Body.String())
	}
	var response struct {
		OK   bool `json:"ok"`
		Data struct {
			Kind  string `json:"kind"`
			Label string `json:"label"`
			Path  string `json:"path"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Data.Kind != "file" || response.Data.Label != "main.ts" || response.Data.Path != fileRealPath {
		t.Fatalf("response=%#v", response)
	}
	if strings.Contains(rr.Body.String(), locator) || strings.Contains(rr.Body.String(), "resource_ref") {
		t.Fatalf("response leaked canonical locator: %s", rr.Body.String())
	}

	rr = performServerRequest(srv, http.MethodPost, endpoint, origin, `{"turn_id":"turn_reference_open","reference_id":"context:0","path":"/forged"}`)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), `"error":"invalid json"`) {
		t.Fatalf("forged path status=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = performServerRequest(srv, http.MethodPost, endpoint, origin, `{"turn_id":"turn_reference_open","reference_id":"missing"}`)
	if rr.Code != http.StatusNotFound || !strings.Contains(rr.Body.String(), ai.FlowerCanonicalReferenceNotFoundErrorCode) {
		t.Fatalf("missing reference status=%d body=%s", rr.Code, rr.Body.String())
	}
	if strings.Contains(logs.String(), locator) || strings.Contains(logs.String(), filePath) {
		t.Fatalf("reference resolver leaked host data to logs: %s", logs.String())
	}
}

func TestServer_AIReferenceOpenTargetRejectsCanonicalReferenceAfterTargetChanges(t *testing.T) {
	t.Parallel()

	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	home := t.TempDir()
	stateDir := t.TempDir()
	filePath := filepath.Join(home, "target-bound.txt")
	if err := os.WriteFile(filePath, []byte("target-bound\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	fileRealPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewRegistry(&redevenconfig.Config{
		AgentHomeDir: home,
		FilesystemScope: &redevenconfig.FilesystemScope{
			SchemaVersion: redevenconfig.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []redevenconfig.FilesystemRootPolicy{{
				ID: "home", Label: "Home", Path: home, Kind: redevenconfig.FilesystemRootHome,
				Permissions: redevenconfig.FilesystemPermissionSet{Read: true, Write: true},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	meta := session.Meta{
		EndpointID: "env_reference_target_change", UserPublicID: "user_reference_target_change",
		UserEmail: "reference-target-change@example.com", CanRead: true,
	}
	aiSvc, err := ai.NewService(ai.Options{
		Logger: logger, StateDir: stateDir, AgentHomeDir: home, FilesystemScope: scope, Shell: "/bin/sh",
		ToolTargetPolicy: ai.ToolTargetPolicy{
			Mode: ai.ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_before", "target_after"},
		},
		TargetToolExecutor: referenceOpenTargetToolExecutor{},
		ToolTargetPolicyForRun: func(_ *session.Meta, _ threadstore.ThreadSettings, routing *threadstore.FlowerThreadRouting) ai.ToolTargetPolicy {
			policy := ai.ToolTargetPolicy{
				Mode: ai.ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_before", "target_after"},
			}
			if routing != nil {
				policy.DefaultTargetID = routing.PrimaryTargetID
			}
			return policy
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	thread, err := aiSvc.CreateThread(context.Background(), &session.Meta{
		EndpointID: meta.EndpointID, UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
		CanRead: true, CanWrite: true, CanExecute: true,
	}, "Target-bound reference", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := aiSvc.UpsertFlowerThreadRouting(context.Background(), threadstore.FlowerThreadRouting{
		EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, PrimaryTargetID: "target_before",
	}); err != nil {
		t.Fatalf("set initial target: %v", err)
	}
	locator := referenceOpenTargetLocatorForTest(t, meta.EndpointID, "target_before", filePath)
	seedFloretReferenceOpenTurn(t, stateDir, thread.ThreadID, "turn_reference_target_change", []flruntime.MessageReference{{
		ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "target-bound.txt", ResourceRef: locator,
	}})
	if routing, err := aiSvc.GetFlowerThreadRouting(context.Background(), meta.EndpointID, thread.ThreadID); err != nil || routing == nil || routing.PrimaryTargetID != "target_before" {
		t.Fatalf("initial routing=%#v err=%v", routing, err)
	}
	if target, err := aiSvc.ResolveFlowerCanonicalReferenceOpenTarget(context.Background(), &meta, ai.FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_target_change", ReferenceID: "context:0",
	}); err != nil || target.Path != fileRealPath {
		t.Fatalf("resolve before AppServer request target=%#v err=%v", target, err)
	}

	channelID := "ch_reference_target_change"
	srv, err := New(Options{
		Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("console.log('inject');")}},
		ListenAddr: "127.0.0.1:0", Logger: logger, AI: aiSvc, ConfigPath: writeTestConfig(t),
		ThreadReadStateStore: openTestThreadReadStateStore(t), ResolveSessionMeta: resolveMetaForTest(channelID, meta),
		AgentHomeDir: home, FilesystemScope: scope,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	endpoint := "/_redeven_proxy/api/ai/threads/" + url.PathEscape(thread.ThreadID) + "/reference-open-target"
	origin := envOriginWithChannel(channelID)
	body := `{"turn_id":"turn_reference_target_change","reference_id":"context:0"}`
	if rr := performServerRequest(srv, http.MethodPost, endpoint, origin, body); rr.Code != http.StatusOK {
		t.Fatalf("reference open before target change status=%d body=%s", rr.Code, rr.Body.String())
	}
	if err := aiSvc.UpsertFlowerThreadRouting(context.Background(), threadstore.FlowerThreadRouting{
		EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, PrimaryTargetID: "target_after",
	}); err != nil {
		t.Fatalf("change target: %v", err)
	}
	rr := performServerRequest(srv, http.MethodPost, endpoint, origin, body)
	if rr.Code != http.StatusForbidden || !strings.Contains(rr.Body.String(), ai.FlowerCanonicalReferenceDeniedErrorCode) {
		t.Fatalf("reference open after target change status=%d body=%s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), locator) || strings.Contains(rr.Body.String(), filePath) ||
		strings.Contains(rr.Body.String(), "resource_ref") ||
		strings.Contains(logs.String(), locator) || strings.Contains(logs.String(), filePath) ||
		strings.Contains(logs.String(), "resource_ref") {
		t.Fatalf("target-change denial leaked host data: response=%s logs=%s", rr.Body.String(), logs.String())
	}
}

func referenceOpenLocatorForTest(t *testing.T, endpointID string, path string, directory bool) string {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"version": 1, "target_id": endpointID, "target_locality": "current_runtime",
		"current_target_id":    endpointID,
		"source_env_public_id": endpointID, "path": path, "directory": directory,
	})
	if err != nil {
		t.Fatal(err)
	}
	return "redeven-context:v1:" + base64.RawURLEncoding.EncodeToString(payload)
}

func referenceOpenTargetLocatorForTest(t *testing.T, endpointID string, targetID string, path string) string {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"version": 1, "target_id": targetID, "target_locality": "remote_runtime",
		"current_target_id": targetID, "source_env_public_id": endpointID, "path": path, "directory": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	return "redeven-context:v1:" + base64.RawURLEncoding.EncodeToString(payload)
}

func seedFloretReferenceOpenTurn(t *testing.T, stateDir string, threadID string, turnID string, references []flruntime.MessageReference) {
	t.Helper()
	store, err := flruntime.OpenSQLiteStore(filepath.Join(stateDir, "ai", "floret_threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	turnFactory, err := configureAppserverFloretTestTurnBinder(t, store).Bind(flruntime.ThreadID(threadID))
	if err != nil {
		t.Fatal(err)
	}
	host, err := turnFactory.NewHost(context.Background(), flruntime.TurnExecutionHostOptions{Config: flconfig.Config{
		Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "done", SystemPrompt: "test",
	}})
	if err != nil {
		t.Fatal(err)
	}
	supplemental := make([]flruntime.TurnSupplementalContextItem, 0, len(references))
	for _, reference := range references {
		supplemental = append(supplemental, flruntime.TurnSupplementalContextItem{
			Kind: "file_path", Title: reference.Label, Metadata: map[string]string{"reference_id": reference.ReferenceID}, Sensitive: true,
		})
	}
	if _, err := host.RunTurn(context.Background(), flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(threadID), TurnID: flruntime.TurnID(turnID), RunID: flruntime.RunID("run_" + turnID),
		Input: flruntime.TurnInput{References: references}, SupplementalContext: supplemental,
	}); err != nil {
		t.Fatal(err)
	}
}
