package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A literal fixture freezes the supported pre-icon configuration shape.
const mcpV1Configuration = `{"schema_version":1,"revision":7,"servers":[{"id":"private","revision":5,"name":"Private tools","transport":"http","url":"https://example.com/mcp","headers":{"Authorization":"private-token"},"enabled":true,"tools":[{"name":"lookup","description":"Look up an item","schema":{"type":"object"}}],"checked_at":1780000000000},{"id":"local","revision":7,"name":"Local tools","transport":"stdio","command":"fixture","args":["--tools"],"env":{"KEY":"private-env"},"enabled":false,"tools":[],"checked_at":0}]}`

func TestMCPIconSchemaUpgradePreservesConfiguration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ai", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(mcpV1Configuration), 0600); err != nil {
		t.Fatal(err)
	}
	var original mcpStore
	if err := json.Unmarshal([]byte(mcpV1Configuration), &original); err != nil {
		t.Fatal(err)
	}
	manager, err := openMCPManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	if manager.revision != original.Revision || !reflect.DeepEqual(manager.servers, original.Servers) {
		t.Fatal("migration changed revisions, secrets, enablement, tools, or timestamps")
	}
	tool := original.Servers[0].Tools[0]
	if manager.Tools()[0].Name != mcpToolName(original.Servers[0], tool) {
		t.Fatal("migration changed tool identity")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var upgraded mcpStore
	if json.Unmarshal(data, &upgraded) != nil || upgraded.SchemaVersion != 2 {
		t.Fatal("migration did not persist schema version 2")
	}
	if _, err := openMCPManager(dir); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(after, data) {
		t.Fatal("opening current configuration rewrote the file")
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("migration did not retain private file permissions")
	}
}

func TestMCPIconSchemaRejectsDriftReadOnly(t *testing.T) {
	for _, fixture := range []string{
		strings.Replace(mcpV1Configuration, `"tools":[]`, `"tools":[],"icons":[]`, 1),
		strings.Replace(mcpV1Configuration, `"checked_at":0`, `"checked_at":-1`, 1),
		strings.Replace(mcpV1Configuration, `"schema_version":1`, `"schema_version":3`, 1),
		strings.Replace(strings.Replace(mcpV1Configuration, `"schema_version":1`, `"schema_version":2`, 1), `"tools":[]`, `"tools":[],"icons":[{"src":"https://example.com/icon.svg"}]`, 1),
	} {
		dir := t.TempDir()
		path := filepath.Join(dir, "ai", "mcp.json")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(fixture), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := openMCPManager(dir); err == nil {
			t.Fatal("drifted, unsafe, or future configuration accepted")
		}
		after, _ := os.ReadFile(path)
		if string(after) != fixture {
			t.Fatal("rejected configuration was modified")
		}
	}
}

func TestMCPIconSchemaUpgradeWriteFailurePreservesOriginal(t *testing.T) {
	if os.Geteuid() <= 0 {
		t.Skip("requires an unprivileged POSIX user for a real filesystem write denial")
	}
	dir := t.TempDir()
	parent := filepath.Join(dir, "ai")
	path := filepath.Join(parent, "mcp.json")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(mcpV1Configuration), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(parent, 0700)
	if manager, err := openMCPManager(dir); err == nil || manager != nil {
		t.Fatal("failed migration started the manager")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != mcpV1Configuration {
		t.Fatal("failed migration changed the original file")
	}
}

func TestMCPDisableDuringConnectionPreventsDispatch(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
	var calls atomic.Int32
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo input"}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		calls.Add(1)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "called"}}}, nil, nil
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
	var blockConnection atomic.Bool
	connecting := make(chan struct{}, 1)
	release := make(chan struct{})
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if blockConnection.CompareAndSwap(true, false) {
			connecting <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		handler.ServeHTTP(w, r)
	}))
	defer httpServer.Close()
	defer close(release)
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "local", Name: "Local tools", Transport: "http", URL: httpServer.URL, Enabled: true}
	view, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	toolName := manager.Tools()[0].Name
	blockConnection.Store(true)
	completed := make(chan error, 1)
	go func() {
		_, err := manager.Call(t.Context(), toolName, map[string]any{})
		completed <- err
	}()
	select {
	case <-connecting:
	case <-t.Context().Done():
		t.Fatal("MCP connection did not start")
	}
	input.Revision = view.Servers[0].Revision
	input.Enabled = false
	if _, err = manager.Save(t.Context(), input); err != nil {
		t.Fatal(err)
	}
	release <- struct{}{}
	if err = <-completed; err == nil || errors.Is(err, errMCPEffectUnknown) {
		t.Fatalf("disabled call must fail before dispatch: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatal("disabled server received a tool call")
	}
}

func TestMCPManagementLifecycle(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo input"}, func(_ context.Context, _ *mcp.CallToolRequest, args struct {
		Text string `json:"text"`
	}) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: args.Text}}}, nil, nil
	})
	httpServer := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true}))
	defer httpServer.Close()
	dir := t.TempDir()
	manager, err := openMCPManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "local", Name: "Local tools", Transport: "http", URL: httpServer.URL, Enabled: true, Headers: map[string]string{"Authorization": "Bearer private-token"}}
	view, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "private-token") {
		t.Fatal("catalog exposed a secret")
	}
	defs := manager.Tools()
	if len(defs) != 1 {
		t.Fatalf("tools = %d", len(defs))
	}
	if got := (DefaultPermissionToolFilter{}).FilterTools(FlowerPermissionReadonly, defs); len(got) != 0 {
		t.Fatal("untrusted MCP tools must not enter read-only mode")
	}
	if permissionDecisionForTool(FlowerPermissionApprovalRequired, defs[0]) != ApprovalDecisionAsk {
		t.Fatal("MCP call bypasses approval")
	}
	registry := NewInMemoryToolRegistry()
	if err := registry.Register(defs[0]); err != nil {
		t.Fatalf("register MCP tool: %v", err)
	}
	definition, err := floretToolDefinitionForSnapshot(defs[0], PermissionSnapshot{PermissionType: FlowerPermissionApprovalRequired})
	if err != nil || !definition.OpenWorld || definition.ReadOnly || len(definition.Effects) != 2 || definition.Effects[0] != fltools.EffectNetwork || definition.Effects[1] != fltools.EffectWrite {
		t.Fatalf("MCP execution must declare external effects: %+v, %v", definition, err)
	}
	if definition.Permission.Mode != fltools.PermissionAsk {
		t.Fatal("Floret approval must cover MCP execution")
	}
	result, err := manager.Call(t.Context(), defs[0].Name, map[string]any{"text": "hello"})
	if err != nil || !strings.Contains(string(result), "hello") {
		t.Fatalf("call: %s %v", result, err)
	}
	reopened, err := openMCPManager(dir)
	if err != nil || len(reopened.Tools()) != 1 {
		t.Fatalf("reopen: %v", err)
	}
	input.Revision = view.Servers[0].Revision
	input.Enabled = false
	input.Headers = nil
	view, err = manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(manager.Tools()) != 0 {
		t.Fatal("disabled tools still available")
	}
	if _, err := manager.Call(t.Context(), defs[0].Name, nil); err == nil {
		t.Fatal("stale call accepted")
	}
	if _, err := manager.Save(t.Context(), input); err == nil {
		t.Fatal("stale revision accepted")
	}
	if err := manager.Delete(input.ID, view.Servers[0].Revision); err != nil {
		t.Fatal(err)
	}
	if len(manager.List().Servers) != 0 {
		t.Fatal("server was not deleted")
	}
	info, _ := os.Stat(filepath.Join(dir, "ai", "mcp.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions = %v", info.Mode())
	}
}

func TestMCPSecretsRollbackAndIdentity(t *testing.T) {
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "private", Name: "Private", Transport: "http", URL: "http://127.0.0.1:1/mcp", Headers: map[string]string{"Authorization": "token"}}
	view, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(manager.path)
	input.Revision = view.Servers[0].Revision
	input.Enabled = true
	if _, err := manager.Save(t.Context(), input); err == nil {
		t.Fatal("unavailable server saved")
	}
	after, _ := os.ReadFile(manager.path)
	if string(before) != string(after) {
		t.Fatal("failed connection changed saved configuration")
	}
	input.Enabled = false
	input.Headers = nil
	view, err = manager.Save(t.Context(), input)
	if err != nil || manager.servers[0].Headers["Authorization"] != "token" {
		t.Fatalf("omitted credentials not preserved: %v", err)
	}
	input.Revision = view.Servers[0].Revision
	input.Headers = map[string]string{}
	_, err = manager.Save(t.Context(), input)
	if err != nil || len(manager.servers[0].Headers) != 0 {
		t.Fatalf("explicit credentials not cleared: %v", err)
	}
	if err := manager.Delete(input.ID, input.Revision); !errors.Is(err, errMCPConflict) {
		t.Fatalf("stale delete: %v", err)
	}
}

func TestMCPStdioHelper(t *testing.T) {
	if os.Getenv("REDEVEN_MCP_TEST_PROCESS") != "1" {
		return
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "stdio-fixture", Version: "1"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo text"}, func(_ context.Context, _ *mcp.CallToolRequest, input struct {
		Text string `json:"text"`
	}) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: input.Text + ":" + os.Getenv("REDEVEN_PARENT_SECRET") + ":" + os.Getenv("REDEVEN_MCP_SECRET")}}}, nil, nil
	})
	if server.Run(context.Background(), &mcp.StdioTransport{}) != nil {
		os.Exit(2)
	}
	os.Exit(0)
}

func TestMCPStdioDiscoveryAndExecution(t *testing.T) {
	t.Setenv("REDEVEN_PARENT_SECRET", "must-not-leak")
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "stdio", Name: "Local tool", Enabled: true, Transport: "stdio", Command: executable, Args: []string{"-test.run=^TestMCPStdioHelper$"}, Env: map[string]string{"REDEVEN_MCP_TEST_PROCESS": "1", "REDEVEN_MCP_SECRET": "configured"}}
	view, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	name := manager.Tools()[0].Name
	if _, err = manager.Check(t.Context(), input.ID, view.Servers[0].Revision); err != nil {
		t.Fatal(err)
	}
	if manager.Tools()[0].Name != name {
		t.Fatal("unchanged discovery changed tool identity")
	}
	result, err := manager.Call(t.Context(), name, map[string]any{"text": "hello"})
	if err != nil || !strings.Contains(string(result), "hello::configured") || strings.Contains(string(result), "must-not-leak") {
		t.Fatalf("stdio result %s, %v", result, err)
	}
}

func TestMCPUnknownEffectRemainsTerminal(t *testing.T) {
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "call", ToolName: "mcp_test", Status: toolResultStatusError, Details: errMCPEffectUnknown.Error(), dispatchErr: errMCPEffectUnknown})
	if err != nil || !errors.Is(result.DispatchErr, errMCPEffectUnknown) {
		t.Fatalf("unknown MCP outcome became retryable result: %+v, %v", result, err)
	}
}

func TestMCPRejectsInvalidStateWithoutMutation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ai", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	before := []byte(`{"schema_version":99,"servers":[]}`)
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := openMCPManager(dir); err == nil {
		t.Fatal("future schema accepted")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("unsupported state changed")
	}
}

func TestMCPDeletedIdentityCannotBeChangedByStaleEditor(t *testing.T) {
	manager, err := openMCPManager(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := MCPServerInput{ID: "workspace", Name: "Workspace", Transport: "stdio", Command: "fixture"}
	first, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err = manager.Delete(input.ID, first.Servers[0].Revision); err != nil {
		t.Fatal(err)
	}
	manager, err = openMCPManager(filepath.Dir(filepath.Dir(manager.path)))
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Save(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if second.Servers[0].Revision <= first.Servers[0].Revision {
		t.Fatal("server revision was reused after deletion")
	}
	if err = manager.Delete(input.ID, first.Servers[0].Revision); !errors.Is(err, errMCPConflict) {
		t.Fatalf("stale editor deleted new server: %v", err)
	}
}

func TestMCPRejectsSchemaDriftAndInvalidTransports(t *testing.T) {
	for _, value := range []string{`{"schema_version":1,"revision":1,"servers":null}`, `{"schema_version":1,"revision":1,"servers":[],"unknown":true}`, `{"schema_version":1,"servers":[]}`, `{"schema_version":1,"revision":1,"servers":[{"id":"x"}]}`} {
		t.Run(value, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "ai", "mcp.json")
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(value), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openMCPManager(dir); err == nil {
				t.Fatal("drifted configuration accepted")
			}
			after, _ := os.ReadFile(path)
			if string(after) != value {
				t.Fatal("drifted configuration changed")
			}
		})
	}
	for _, url := range []string{"http://remote.example/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?token=secret", "file:///tmp/mcp"} {
		if err := validateMCPServer(MCPServerInput{ID: "server", Name: "Server", Transport: "http", URL: url}); err == nil {
			t.Fatalf("unsafe endpoint accepted: %s", url)
		}
	}
}

func TestMCPSkillDependenciesFollowConfiguredServerIdentity(t *testing.T) {
	manager := &mcpManager{servers: []mcpServerRecord{{MCPServerInput: MCPServerInput{ID: "docs", Enabled: true, Transport: "http", URL: "https://example.com/mcp"}, CheckedAt: 1}}}
	skills := &skillManager{mcpManager: manager, catalogEntries: []SkillCatalogEntry{{Name: "docs", Dependencies: []SkillMCPDependency{{Name: "docs", Transport: "http", URL: "https://example.com/mcp"}}}}}
	if skills.Catalog().Skills[0].DependencyState != "ok" {
		t.Fatal("configured dependency still degraded")
	}
	manager.servers[0].Enabled = false
	if skills.Catalog().Skills[0].DependencyState != "degraded" {
		t.Fatal("disabled dependency remains available")
	}
	manager.servers[0].Enabled = true
	if manager.HasDependency(SkillMCPDependency{Name: "docs", URL: "https://other.example/mcp"}) {
		t.Fatal("different endpoint matched by name alone")
	}
}
