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
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/redeven/internal/ai/agentplugins"
	"github.com/floegence/redeven/internal/settings"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func pluginFixture(t *testing.T, manager *agentplugins.Manager, servers map[string]any) agentplugins.Install {
	t.Helper()
	root := t.TempDir()
	write := func(name string, data []byte) {
		t.Helper()
		path := filepath.Join(root, name)
		if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(path, data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	b, _ := json.Marshal(map[string]any{"$schema": agentplugins.ManifestSchema, "name": "review-tools"})
	write("plugin.json", b)
	write("skills/review/SKILL.md", []byte("---\nname: review\ndescription: Review changes\n---\nReview the current changes.\n"))
	b, _ = json.Marshal(map[string]any{"$schema": agentplugins.MCPSchema, "mcpServers": servers})
	write("mcp.json", b)
	op, e := manager.Prepare(t.Context(), "owner", agentplugins.PrepareRequest{RequestID: root, Source: agentplugins.Source{Type: "local", Directory: root}})
	if e != nil || op.Status != "ready" {
		t.Fatal(op, e)
	}
	components := []string{"skill:review"}
	for key := range op.Package.MCP {
		components = append(components, "mcp:"+key)
	}
	in, e := manager.Commit("owner", agentplugins.CommitRequest{OperationID: op.ID, Digest: op.Digest, Enabled: true, Components: components})
	if e != nil {
		t.Fatal(e)
	}
	return in
}
func TestAgentPluginSkillIdentityAndRevocation(t *testing.T) {
	state := t.TempDir()
	plugins, e := agentplugins.Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer plugins.Close()
	first := pluginFixture(t, plugins, map[string]any{})
	second := pluginFixture(t, plugins, map[string]any{})
	manager := newSkillManager(state, state)
	manager.userHome = t.TempDir()
	manager.plugins = plugins
	catalog := manager.Reload()
	names := map[string]bool{}
	for _, entry := range catalog.Skills {
		if entry.PluginID != "" {
			names[entry.Name] = true
			activation, _, e := manager.Activate(t.Context(), entry.Name, "full_access", false)
			if e != nil || !strings.Contains(activation.Content, "Review the current changes") {
				t.Fatal(activation, e)
			}
		}
	}
	if len(names) != 2 {
		t.Fatal("same-named plugin skills collided", names)
	}
	disabled := false
	_, e = plugins.Change(agentplugins.Change{ID: first.ID, Revision: first.Revision, Enabled: &disabled})
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = manager.Activate(t.Context(), "review-tools@"+first.ID+"/review", "full_access", false); e == nil {
		t.Fatal("disabled skill activated")
	}
	if _, _, e = manager.Activate(t.Context(), "review-tools@"+second.ID+"/review", "full_access", false); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(plugins.Root(second), "skills/review/SKILL.md"), []byte("tampered"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, _, e = manager.Activate(t.Context(), "review-tools@"+second.ID+"/review", "full_access", false); e == nil {
		t.Fatal("tampered skill activated")
	}
}
func TestAgentPluginMCPPersistenceSecretsAndDispatchRevocation(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
	var calls atomic.Int32
	var block atomic.Bool
	connecting := make(chan struct{}, 1)
	release := make(chan struct{})
	defer close(release)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo"}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		calls.Add(1)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "done"}}}, nil, nil
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		if block.CompareAndSwap(true, false) {
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
	state := t.TempDir()
	plugins, e := agentplugins.Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { _ = plugins.Close() }()
	in := pluginFixture(t, plugins, map[string]any{"remote": map[string]any{"type": "streamable-http", "url": httpServer.URL}})
	secrets := settings.NewSecretsStore(filepath.Join(state, "secrets.json"))
	ref, e := secrets.PutAgentPluginCredential(map[string]string{"Authorization": "Bearer test-secret"})
	if e != nil {
		t.Fatal(e)
	}
	in, e = plugins.BindCredential(in.ID, in.Revision, "mcp:remote", ref, []string{"Authorization"})
	if e != nil {
		t.Fatal(e)
	}
	manager, e := openMCPManager(state)
	if e != nil {
		t.Fatal(e)
	}
	manager.plugins = plugins
	manager.pluginSecrets = secrets
	if len(manager.List().Servers) != 1 || len(manager.Tools()) != 0 {
		t.Fatal("unchecked component visibility incorrect")
	}
	if e = manager.checkPlugin(t.Context(), in.ID, in.Revision, "mcp:remote", false); e != nil {
		t.Fatal(e)
	}
	name := manager.Tools()[0].Name
	if _, e = manager.Call(t.Context(), name, map[string]any{}); e != nil || calls.Load() != 1 {
		t.Fatal(e, calls.Load())
	}
	b, _ := json.Marshal(manager.List())
	if strings.Contains(string(b), "test-secret") {
		t.Fatal("credential leaked")
	}
	if e = plugins.Close(); e != nil {
		t.Fatal(e)
	}
	plugins, e = agentplugins.Open(state)
	if e != nil {
		t.Fatal(e)
	}
	manager.plugins = plugins
	if len(manager.Tools()) != 1 || manager.Tools()[0].Name != name {
		t.Fatal("discovery not restored")
	}
	block.Store(true)
	done := make(chan error, 1)
	go func() { _, err := manager.Call(t.Context(), name, map[string]any{}); done <- err }()
	select {
	case <-connecting:
	case <-t.Context().Done():
		t.Fatal("connection did not start")
	}
	disabled := false
	_, e = plugins.Change(agentplugins.Change{ID: in.ID, Revision: in.Revision, Enabled: &disabled})
	if e != nil {
		t.Fatal(e)
	}
	release <- struct{}{}
	if e = <-done; e == nil || errors.Is(e, errMCPEffectUnknown) {
		t.Fatal("stale dispatch was not prevented", e)
	}
	if calls.Load() != 1 || len(manager.Tools()) != 0 {
		t.Fatal("disabled tool dispatched")
	}
}
func TestAgentPluginStdioPermissionAndVariables(t *testing.T) {
	state := t.TempDir()
	plugins, e := agentplugins.Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer plugins.Close()
	in := pluginFixture(t, plugins, map[string]any{"local": map[string]any{"type": "stdio", "command": "missing-fixture-command", "args": []string{"${PLUGIN_ROOT}", "${PLUGIN_DATA}"}, "env": map[string]string{"VALUE": "${PLUGIN_DATA}"}}})
	manager, e := openMCPManager(state)
	if e != nil {
		t.Fatal(e)
	}
	manager.plugins = plugins
	manager.pluginSecrets = settings.NewSecretsStore(filepath.Join(state, "secrets.json"))
	if e = manager.checkPlugin(t.Context(), in.ID, in.Revision, "mcp:local", false); e == nil || e.Error() != "process_permission_required" {
		t.Fatal(e)
	}
	input, e := manager.pluginMCPInput(in, "mcp:local")
	if e != nil {
		t.Fatal(e)
	}
	root, _ := filepath.EvalSymlinks(plugins.Root(in))
	data, _ := filepath.EvalSymlinks(plugins.Data(in.ID))
	if input.cwd != root || input.Env["PLUGIN_ROOT"] != root || input.Env["PLUGIN_DATA"] != data || input.Env["VALUE"] != data || input.Args[0] != root {
		t.Fatalf("wrong host paths: %+v", input)
	}
}

func TestAgentPluginStdioHelper(t *testing.T) {
	if os.Getenv("REDEVEN_AGENT_PLUGIN_TEST") != "1" {
		return
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "plugin-stdio", Version: "1"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "paths", Description: "Report resolved fixture paths"}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		cwd, _ := os.Getwd()
		b, _ := json.Marshal(map[string]string{"cwd": cwd, "root": os.Getenv("PLUGIN_ROOT"), "data": os.Getenv("PLUGIN_DATA"), "secret": os.Getenv("PLUGIN_SECRET"), "parent": os.Getenv("REDEVEN_PARENT_SECRET")})
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
	})
	if server.Run(context.Background(), &mcp.StdioTransport{}) != nil {
		os.Exit(2)
	}
	os.Exit(0)
}
func TestAgentPluginStdioRealExecution(t *testing.T) {
	t.Setenv("REDEVEN_PARENT_SECRET", "do-not-inherit")
	state := t.TempDir()
	plugins, e := agentplugins.Open(state)
	if e != nil {
		t.Fatal(e)
	}
	defer plugins.Close()
	executable, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	// A bare executable token is resolved through the client-selected base PATH.
	t.Setenv("PATH", filepath.Dir(executable)+string(os.PathListSeparator)+os.Getenv("PATH"))
	in := pluginFixture(t, plugins, map[string]any{"local": map[string]any{"type": "stdio", "command": filepath.Base(executable), "args": []string{"-test.run=^TestAgentPluginStdioHelper$"}, "cwd": "${PLUGIN_DATA}", "env": map[string]string{"REDEVEN_AGENT_PLUGIN_TEST": "1"}}})
	manager, e := openMCPManager(state)
	if e != nil {
		t.Fatal(e)
	}
	manager.plugins = plugins
	manager.pluginSecrets = settings.NewSecretsStore(filepath.Join(state, "secrets.json"))
	ref, e := manager.pluginSecrets.PutAgentPluginCredential(map[string]string{"PLUGIN_SECRET": "only-this-server"})
	if e != nil {
		t.Fatal(e)
	}
	in, e = plugins.BindCredential(in.ID, in.Revision, "mcp:local", ref, []string{"PLUGIN_SECRET"})
	if e != nil {
		t.Fatal(e)
	}
	if e = manager.checkPlugin(t.Context(), in.ID, in.Revision, "mcp:local", true); e != nil {
		t.Fatal(e)
	}
	result, e := manager.Call(t.Context(), manager.Tools()[0].Name, map[string]any{})
	if e != nil {
		t.Fatal(e)
	}
	root, _ := filepath.EvalSymlinks(plugins.Root(in))
	data, _ := filepath.EvalSymlinks(plugins.Data(in.ID))
	for _, expected := range []string{root, data, "only-this-server"} {
		if !strings.Contains(string(result), expected) {
			t.Fatal("missing resolved value", expected, string(result))
		}
	}
	if strings.Contains(string(result), "do-not-inherit") {
		t.Fatal("inherited parent credential")
	}
}

func TestAgentPluginsSurviveConversationSnapshotRestore(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-waiting")
	snapshotID := captureFixtureSnapshot(t, state)
	opts := fixtureMaintenanceOptions(t, state)
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	in := pluginFixture(t, service.agentPlugins, map[string]any{})
	data := filepath.Join(service.agentPlugins.Data(in.ID), "retained.txt")
	if err = os.WriteFile(data, []byte("persistent plugin data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	registry := filepath.Join(state, "ai", "agent-plugins", "registry.sqlite")
	before, err := os.ReadFile(registry)
	if err != nil {
		t.Fatal(err)
	}
	if err = RestoreFlowerSnapshot(t.Context(), opts, snapshotID); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(registry)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("conversation restore changed plugin registry", err)
	}
	content, err := os.ReadFile(data)
	if err != nil || string(content) != "persistent plugin data" {
		t.Fatal("conversation restore changed plugin data", err)
	}
	service, err = NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	current, err := service.agentPlugins.Get(in.ID)
	if err != nil || current.Digest != in.Digest {
		t.Fatal("plugin did not survive restore", err)
	}
}
