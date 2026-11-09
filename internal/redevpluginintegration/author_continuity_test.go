package redevpluginintegration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

// Admitted source work outlives the browser channel. It must not revive that
// channel's preview, installation, or bridge authority.
func TestAuthorSourceSurvivesDisconnectedChannel(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	store, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	product := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "author-channel", EndpointID: "author-env", UserPublicID: "author-user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true}
	connected := true
	opts := ownerScopeTestOptions(t, root)
	opts.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	opts.PluginCreation = product
	opts.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, connected && id == meta.ChannelID }
	integration, err := New(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = integration.Close() })
	draft, err := product.Create(ctx, meta, "continuity")
	if err != nil {
		t.Fatal(err)
	}
	source, err := product.SourceScope(ctx, meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	connected = false
	restored, err := product.SourceScope(ctx, meta, draft.ID)
	if err != nil || restored != source {
		t.Fatalf("admitted source lost after disconnect: %+v %v", restored, err)
	}
	for _, op := range []string{"status", "initialize", "capture"} {
		args := map[string]any{}
		if op == "initialize" {
			args = map[string]any{"slug": "continuity", "display_name": "Continuity", "template": "web"}
		}
		result, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, op, args)
		if err != nil {
			t.Fatalf("%s after disconnect: %v", op, err)
		}
		if op == "capture" && result.(map[string]any)["ready_for_install"] != false {
			t.Fatal("offline capture revived installation authority")
		}
	}
	if _, _, err := integration.author.context(ctx, meta); err == nil {
		t.Fatal("stale session authenticated")
	}
	if _, err := product.Create(ctx, meta, "disconnected-create"); err == nil {
		t.Fatal("stale session created a workspace")
	}
	for _, kind := range []string{"user", "environment", "read", "write", "execute"} {
		denied := *meta
		switch kind {
		case "user":
			denied.UserPublicID = "other"
		case "environment":
			denied.EndpointID = "other"
		case "read":
			denied.CanRead = false
		case "write":
			denied.CanWrite = false
		case "execute":
			denied.CanExecute = false
		}
		if _, err := integration.author.AuthorOperation(ctx, &denied, draft.WorkspaceID, "capture", nil); err == nil {
			t.Errorf("%s authority not enforced", kind)
		}
	}
	for _, capKind := range []string{"read", "write", "execute"} {
		policy := clonePermissionPolicy(opts.PermissionPolicy)
		switch capKind {
		case "read":
			policy.LocalMax.Read = false
		case "write":
			policy.LocalMax.Write = false
		case "execute":
			policy.LocalMax.Execute = false
		}
		adapter, err := newSessionAdapter(opts.ResolveSessionMeta, policy)
		if err != nil {
			t.Fatal(err)
		}
		integration.author.sessions = adapter
		if _, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "capture", nil); err == nil {
			t.Fatalf("local %s cap ignored", capKind)
		}
	}
	// Restored execution authority does not carry the disconnected browser's app
	// metadata. The canonical agent application cap still governs source work.
	for _, scope := range []string{"user", "application"} {
		policy := clonePermissionPolicy(opts.PermissionPolicy)
		readOnly := &config.PermissionSet{Read: true}
		if scope == "user" {
			policy.ByUser = map[string]*config.PermissionSet{meta.UserPublicID: readOnly}
		} else {
			policy.ByApp = map[string]*config.PermissionSet{"com.floegence.redeven.agent": readOnly}
		}
		adapter, err := newSessionAdapter(opts.ResolveSessionMeta, policy)
		if err != nil {
			t.Fatal(err)
		}
		integration.author.sessions = adapter
		restored := *meta
		restored.FloeApp = ""
		if _, err := integration.author.AuthorOperation(ctx, &restored, draft.WorkspaceID, "status", nil); err != nil {
			t.Fatalf("%s read cap denied status: %v", scope, err)
		}
		if _, err := integration.author.AuthorOperation(ctx, &restored, draft.WorkspaceID, "capture", nil); err == nil {
			t.Fatalf("restored authority bypassed %s cap", scope)
		}
	}
	// Source-only calls must not seed the Host session permission cache.
	fresh, err := newSessionAdapter(opts.ResolveSessionMeta, opts.PermissionPolicy)
	if err != nil {
		t.Fatal(err)
	}
	integration.author.sessions = fresh
	if _, err := integration.author.AuthorOperation(context.Background(), meta, draft.WorkspaceID, "status", nil); err != nil {
		t.Fatal(err)
	}
	stale, err := canonicalPluginSessionContextFromMeta(meta.ChannelID, meta)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := fresh.resolver.cache.Get(stale); ok {
		t.Fatal("source work recreated session authority")
	}
	if _, ok := sessionctx.FromContext(ctx); ok {
		t.Fatal("source work leaked session context")
	}
}

// Exercise actual admission, model context refresh, tool dispatch and explicit
// retry against published Floret and ReDevPlugin, with transport loss mid-turn.
func TestPluginConversationContinuesAcrossDisconnectAndRetry(t *testing.T) {
	root := t.TempDir()
	productStore, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = productStore.Close() })
	product := plugincreation.New(productStore)
	var live atomic.Pointer[session.Meta]
	meta := &session.Meta{ChannelID: "initial-channel", EndpointID: "environment", NamespacePublicID: "namespace", UserPublicID: "owner", FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true}
	live.Store(meta)
	opts := ownerScopeTestOptions(t, root)
	opts.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	opts.PluginCreation = product
	opts.ResolveSessionMeta = func(id string) (*session.Meta, bool) {
		current := live.Load()
		return current, current != nil && id == current.ChannelID
	}
	integration, err := New(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = integration.Close() })
	var phase atomic.Int32
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid fixture request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		emit := func(v any) { raw, _ := json.Marshal(v); fmt.Fprintf(w, "data: %s\n\n", raw); w.(http.Flusher).Flush() }
		output := []any{map[string]any{"type": "message", "id": "answer", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "CONTINUED"}}}}
		tools, _ := body["tools"].([]any)
		if len(tools) > 0 {
			if phase.Load() == 1 {
				http.Error(w, `{"error":{"message":"rejected fixture request","type":"invalid_request_error"}}`, 400)
				return
			}
			n := calls.Add(1)
			if n == 1 {
				live.Store(nil)
			}
			if n == 1 || n == 3 {
				output = []any{map[string]any{"type": "function_call", "id": fmt.Sprintf("item-%d", n), "call_id": fmt.Sprintf("call-%d", n), "name": "plugin_author_get_status", "arguments": "{}"}}
			} else if n == 2 || n == 4 {
				raw, _ := json.Marshal(body["input"])
				if !strings.Contains(string(raw), "source_directory") || strings.Contains(string(raw), "session is not available") {
					t.Error("managed status did not reach the next model request")
				}
			}
		}
		emit(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", calls.Load()), "status": "completed", "output": output}})
	}))
	t.Cleanup(server.Close)
	svc, err := ai.NewService(ai.Options{PluginCreation: product, StateDir: root, AgentHomeDir: root, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: "fixture/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "fixture", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	draft, err := product.Create(t.Context(), meta, "disconnect-flow")
	if err != nil {
		t.Fatal(err)
	}
	options := ai.RunOptions{NoUserInteraction: true, ToolAllowlist: []string{"plugin_author_get_status"}}
	receipt, err := svc.SendUserTurn(t.Context(), meta, ai.SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), PluginDraftID: draft.ID, Create: &ai.CreateThreadRequest{ClientRequestID: "first", PermissionType: config.AIPermissionFullAccess}, Input: ai.RunInput{Text: "Read project status."}, Options: options})
	if err != nil {
		t.Fatal(err)
	}
	wait := func(outcome string) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			view, err := svc.GetThread(t.Context(), meta, receipt.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if view.RunStatus == outcome {
				return
			}
			if view.RunStatus == "failed" && outcome != "failed" {
				t.Fatalf("continuation failed: %s %s", view.RunErrorCode, view.RunError)
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("turn did not settle")
	}
	wait("success")
	phase.Store(1)
	next := *meta
	next.ChannelID = "followup-channel"
	meta = &next
	live.Store(meta)
	_, err = svc.SendUserTurn(t.Context(), meta, ai.SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ThreadID: receipt.ThreadID, ClientRequestID: "followup", Input: ai.RunInput{Text: "Continue."}, Options: options})
	if err != nil {
		t.Fatal(err)
	}
	wait("failed")
	next = *meta
	next.ChannelID = "retry-channel"
	meta = &next
	live.Store(meta)
	phase.Store(2)
	if _, err = svc.RetryThreadContinuation(t.Context(), meta, receipt.ThreadID); err != nil {
		t.Fatal(err)
	}
	wait("success")
	if calls.Load() != 4 {
		t.Fatalf("model requests=%d, want 4", calls.Load())
	}
}
