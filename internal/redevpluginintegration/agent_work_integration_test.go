package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/agentwork"
	"github.com/floegence/redevplugin/v3/pkg/bridge"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/permissions"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/registry"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

func TestInstalledAgentWorkCapabilityRequiresHostReviewAndRevalidatesRevocation(t *testing.T) {
	root := t.TempDir()
	store, err := automation.Open(filepath.Join(root, "workflows.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta := &session.Meta{ChannelID: "agent-work-channel", EndpointID: "agent-work-env", UserPublicID: "agent-work-user", NamespacePublicID: "namespace", FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, root)
	options.AgentHomeDir = t.TempDir()
	options.Automation = store
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	integration, err := New(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer integration.Close()
	// Authenticate through the installed host's product adapter to populate the
	// verified identity cache; no invocation supplies an owner or stored binding.
	resolved, err := canonicalPluginSessionContextFromMeta(meta.ChannelID, meta)
	if err != nil {
		t.Fatal(err)
	}
	resolved.CanRead = true
	resolved.CanWrite = true
	// The mounted handler authenticates against the actual integration cache.
	request := authenticatedRequest(http.MethodPost, "/_redevplugin/api/plugins/catalog/query", meta.ChannelID)
	request.Body = io.NopCloser(bytes.NewBufferString("{}"))
	request.Header.Set("Content-Type", "application/json")
	request = WithRouteRole(request, RouteRoleEnvTrusted)
	request, err = WithTrustedOrigin(request, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "env.example.test"
	request.Header.Set("Origin", "https://env.example.test")
	request.Header.Set(csrfHeader, csrfProof)
	response := httptest.NewRecorder()
	integration.Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("authenticate actual host: %d %s", response.Code, response.Body.String())
	}
	ctx := sessionctx.WithContext(context.WithValue(t.Context(), trustedOriginContextKey{}, "https://env.example.test"), resolved)
	contract, err := agentwork.Contract()
	if err != nil {
		t.Fatal(err)
	}
	methods := []any{}
	for _, name := range []string{"submit", "get", "input", "cancel"} {
		methods = append(methods, map[string]any{"method": "agent.work." + name, "route": map[string]any{"kind": "capability", "binding_id": "work", "target_method": "agent.work." + name}})
	}
	manifest := map[string]any{"schema_version": "redevplugin.manifest.v9", "publisher": map[string]any{"publisher_id": "dev.redeven.acceptance", "display_name": "Acceptance"}, "plugin": map[string]any{"plugin_id": "dev.redeven.acceptance.agentwork", "display_name": "Agent work acceptance", "version": "1.0.0"}, "api": map[string]any{"major": 1, "required_features": []string{}, "optional_features": []string{}}, "permissions": []any{}, "presentation": map[string]any{"locales": map[string]any{"default": "en-US"}}, "surfaces": []any{map[string]any{"surface_id": "work.view", "kind": "view", "label": "Work", "entry": "ui/index.html", "web": map[string]any{"root": "ui", "spa": false}}}, "workers": []any{}, "capability_bindings": []any{map[string]any{"binding_id": "work", "contract": contract.Pin}}, "methods": methods}
	dir := t.TempDir()
	if err = os.Mkdir(filepath.Join(dir, "ui"), 0700); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(manifest)
	if err = os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "ui", "index.html"), []byte("<!doctype html><html><body>Agent work acceptance</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if _, err = pluginpkg.BuildFromDir(ctx, dir, &archive, pluginpkg.DefaultReadLimits()); err != nil {
		t.Fatal(err)
	}
	inspected, err := integration.host.InspectUploadedExternalPackage(ctx, host.InspectUploadedExternalPackageRequest{Intent: host.ExternalPackageIntent{Action: "install"}, Package: bytes.NewReader(archive.Bytes()), DeclaredSize: int64(archive.Len())})
	if err != nil {
		t.Fatal(err)
	}
	installed := installInspectedTestPackage(t, ctx, integration.host, inspected.InspectionID, inspected.InspectedHashes.PackageSHA256)
	current := func() registry.PluginRecord {
		records, e := integration.host.ListPlugins(ctx)
		if e != nil {
			t.Fatal(e)
		}
		for _, r := range records {
			if r.PluginInstanceID == installed.PluginInstanceID {
				return r
			}
		}
		t.Fatal("installed identity missing")
		return registry.PluginRecord{}
	}
	for _, permission := range []string{"agent.work.read", "agent.work.execute"} {
		r := current()
		_, err = integration.host.GrantPermission(ctx, host.GrantPermissionRequest{PluginInstanceID: r.PluginInstanceID, PermissionID: permission, ExpectedPolicyRevision: r.PolicyRevision, ExpectedManagementRevision: r.ManagementRevision, ExpectedRevokeEpoch: r.RevokeEpoch})
		if err != nil {
			t.Fatal(err)
		}
	}
	r := current()
	bootstrap, err := integration.host.OpenSurface(ctx, host.OpenSurfaceRequest{PluginInstanceID: r.PluginInstanceID, SurfaceID: "work.view", SurfaceInstanceID: "work-surface", ExpectedManagementRevision: r.ManagementRevision})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = integration.host.PrepareSurface(ctx, host.PrepareSurfaceRequest{SurfaceInstanceID: bootstrap.SurfaceInstanceID, AssetTicket: bootstrap.AssetTicket}); err != nil {
		t.Fatal(err)
	}
	handshake := bridge.Handshake{PluginID: bootstrap.PluginID, SurfaceID: bootstrap.SurfaceID, SurfaceInstanceID: bootstrap.SurfaceInstanceID, ActiveFingerprint: bootstrap.ActiveFingerprint, BridgeNonce: bootstrap.BridgeNonce, AssetSessionNonce: bootstrap.AssetSessionNonce, ManagementRevision: bootstrap.ManagementRevision, RevokeEpoch: bootstrap.RevokeEpoch}
	gateway, err := integration.host.MintBridgeToken(ctx, host.MintBridgeTokenRequest{Handshake: handshake, BridgeChannelID: "work-bridge", HandshakeTranscriptSHA256: bridge.HandshakeTranscriptSHA256(handshake, "work-bridge")})
	if err != nil {
		t.Fatal(err)
	}
	call := func(method string, args map[string]any) (host.CallMethodResult, error) {
		return integration.host.CallPluginMethod(ctx, host.CallMethodRequest{PluginInstanceID: installed.PluginInstanceID, SurfaceInstanceID: "work-surface", BridgeChannelID: "work-bridge", GatewayToken: gateway.GatewayToken, Method: method, Params: args})
	}
	args := map[string]any{"work_id": "inspection", "request_id": "original", "instruction": "Analyze provided health observations", "context_json": "{\"healthy\":false}"}
	receipt, err := call("agent.work.submit", args)
	if err != nil {
		business, valid := host.AsValidatedCapabilityBusinessError(err)
		t.Fatalf("submit: %v; business=%+v valid=%v request=%v response=%v denied=%v permission=%v confirmation=%v token=%v", err, business, valid, errors.Is(err, host.ErrMethodRequestContract), errors.Is(err, host.ErrMethodResponseContract), errors.Is(err, host.ErrActionDenied), errors.Is(err, permissions.ErrPermissionDenied), errors.Is(err, host.ErrConfirmationRequired), errors.Is(err, bridge.ErrTokenAudience))
	}
	data, ok := receipt.Data.(map[string]any)
	if !ok || data["state"] != "waiting" {
		t.Fatal("unreviewed work executed", receipt)
	}
	owner := automation.Owner{User: meta.UserPublicID, Environment: meta.EndpointID}
	flow, err := store.Get(ctx, owner, data["execution_ref"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Grant(ctx, owner, flow.ID); !errors.Is(err, automation.ErrNotFound) {
		t.Fatal("plugin self-granted model", err)
	}
	again, err := call("agent.work.submit", args)
	if err != nil || again.Data.(map[string]any)["execution_ref"] != flow.ID {
		t.Fatal("lost idempotence", err)
	}
	if err = store.ValidatePluginAuthority(ctx, owner, flow.ID); err != nil {
		t.Fatal("retained original binding rejected", err)
	}
	definition := flow.Definition
	definition.Model = "fixture/gpt-5-mini"
	flow, err = store.Save(ctx, owner, flow.ID, flow.Revision, definition)
	if err != nil {
		t.Fatal(err)
	}
	publication, err := store.Publish(ctx, owner, flow.ID, flow.Revision, automation.Grant{Enabled: true, Model: definition.Model, WorkingDirectory: definition.WorkingDirectory, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: meta.NamespacePublicID, App: meta.FloeApp, Read: true, Write: true, Execute: true}})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, owner, flow.ID, "authorized", publication.Version, "live", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.CreateRun(ctx, owner, flow.ID, "duplicate-run", publication.Version, "live", time.Now()); !errors.Is(err, automation.ErrConflict) {
		t.Fatal("plugin request ran twice", err)
	}
	var turns atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		count := turns.Add(1)
		for _, value := range body["tools"].([]any) {
			tool, _ := value.(map[string]any)
			if name, _ := tool["name"].(string); !strings.HasPrefix(name, "automation_") {
				t.Errorf("plugin analysis acquired tool %s", name)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		emit := func(value any) {
			raw, _ := json.Marshal(value)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
			w.(http.Flusher).Flush()
		}
		if count <= 2 {
			name, args := "automation_read_context", `{"after_revision":0,"limit":50}`
			if count == 2 {
				input, _ := json.Marshal(body["input"])
				if !strings.Contains(string(input), "healthy") {
					t.Error("provided material missing from canonical tool response")
				}
				name, args = "automation_submit_result", `{"result_json":"{\"healthy\":false}"}`
			}
			item := map[string]any{"type": "function_call", "id": fmt.Sprint(count), "call_id": fmt.Sprint(count), "name": name, "arguments": args}
			emit(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			emit(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
		} else {
			emit(map[string]any{"type": "response.output_text.delta", "delta": "Analysis complete."})
			emit(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": map[string]any{"type": "message", "id": "answer", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Analysis complete.", "annotations": []any{}}}}})
		}
		emit(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", count), "model": "gpt-5-mini", "status": "completed", "usage": map[string]any{"input_tokens": 1, "output_tokens": 1}}})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		w.(http.Flusher).Flush()
	}))
	defer provider.Close()
	svc, err := ai.NewService(ai.Options{StateDir: filepath.Join(root, "ai"), AgentHomeDir: options.AgentHomeDir, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: definition.Model, Providers: []config.AIProvider{{ID: "fixture", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}, Automation: store, AutomationAuthorize: func(ctx context.Context, o automation.Owner, r automation.Run) (*session.Meta, error) {
		if err := store.ValidatePluginAuthority(ctx, o, r.WorkflowID); err != nil {
			return nil, err
		}
		g, err := store.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
		if err != nil || !g.Enabled || !g.ExpiresAt.After(time.Now()) {
			return nil, automation.ErrUnauthorized
		}
		return meta, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	engine := &automation.Engine{Store: store, Executor: ai.AutomationExecutor{Service: svc}}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if err = engine.Step(t.Context(), owner, run.ID); err != nil {
			t.Fatal(err)
		}
		run, err = store.Run(t.Context(), owner, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status == "completed" || run.Status == "failed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if run.Status != "completed" || turns.Load() < 3 {
		t.Fatal("canonical plugin analysis did not complete", run.Status, run.Attempts)
	}
	got, err := call("agent.work.get", map[string]any{"work_id": "inspection", "request_id": "original"})
	if err != nil || got.Data.(map[string]any)["result_json"] != `{"healthy":false}` {
		t.Fatal("structured result missing", got, err)
	}
	r = current()
	_, err = integration.host.RevokePermission(ctx, host.RevokePermissionRequest{PluginInstanceID: r.PluginInstanceID, PermissionID: "agent.work.execute", ExpectedPolicyRevision: r.PolicyRevision, ExpectedManagementRevision: r.ManagementRevision, ExpectedRevokeEpoch: r.RevokeEpoch})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.ValidatePluginAuthority(ctx, owner, flow.ID); err == nil {
		t.Fatal("revoked original binding remained usable")
	}
	if _, err = call("agent.work.get", map[string]any{"work_id": "inspection", "request_id": "original"}); err == nil {
		t.Fatal("stale gateway returned retained result")
	}
}
