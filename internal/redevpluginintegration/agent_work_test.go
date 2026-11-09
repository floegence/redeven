package redevpluginintegration

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redevplugin/v3/pkg/capability"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

func TestAgentWorkRequestIsolationAndExplicitAuthorization(t *testing.T) {
	store, err := automation.Open(filepath.Join(t.TempDir(), "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	scope := sessionctx.Context{OwnerUserHash: "u", OwnerEnvHash: "e", OwnerSessionHash: "s", SessionChannelIDHash: "c", CanRead: true, CanWrite: true}
	cache := newSessionPermissionCache()
	cache.Put(resolvedSession{context: scope, permissions: sessionPermissions{read: true, write: true, execute: true}, ownerUser: "user", ownerEnvironment: "env"})
	adapter := &agentWorkAdapter{store: store, sessions: cache, directory: "/work"}
	binding := capability.ExecutionBinding{CapabilityID: "agent.work", RouteKind: capability.RouteCapability, Method: "agent.work.submit", PluginID: "inspection", PluginInstanceID: "installed-one", ActiveFingerprint: "fingerprint", OwnerUserHash: "u", OwnerEnvHash: "e", OwnerSessionHash: "s", SessionChannelIDHash: "c", Quota: capability.QuotaGrant{ExpiresAt: time.Now().UTC().Truncate(time.Second).Add(time.Hour)}, Target: capability.TargetDescriptor{Kind: "agent.work", Fields: map[string]any{"work_id": "report"}}}
	request := capability.Invocation{Execution: capability.ExecutionContext{ExecutionBinding: binding}, Arguments: map[string]any{"work_id": "report", "request_id": "original", "instruction": "Analyze the provided report", "context_json": "{\"healthy\":false}"}}
	ctx := sessionctx.WithContext(t.Context(), scope)
	result, err := adapter.Invoke(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	data := result.Data.(map[string]any)
	if data["state"] != "waiting" {
		t.Fatal("plugin request executed without review", data)
	}
	owner := automation.Owner{User: "user", Environment: "env"}
	w, err := store.Get(ctx, owner, data["execution_ref"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Grant(ctx, owner, w.ID); err == nil {
		t.Fatal("plugin granted its own model")
	}
	raw, _ := json.Marshal(w)
	if strings.Contains(string(raw), "fingerprint") || strings.Contains(string(raw), "owner_session_hash") {
		t.Fatal("private binding exposed")
	}
	again, err := adapter.Invoke(ctx, request)
	if err != nil || again.Data.(map[string]any)["execution_ref"] != w.ID {
		t.Fatal("duplicate request changed identity", err)
	}
	changed := request
	changed.Arguments = map[string]any{"work_id": "report", "request_id": "original", "instruction": "Different"}
	if _, err := adapter.Invoke(ctx, changed); err == nil {
		t.Fatal("payload conflict accepted")
	}
	foreign := request
	foreign.Execution.PluginInstanceID = "installed-two"
	foreign.Execution.Target = capability.TargetDescriptor{Kind: "agent.work", Fields: map[string]any{"work_id": "report"}}
	foreign.Execution.Method = "agent.work.get"
	if _, err := adapter.Invoke(ctx, foreign); err == nil {
		t.Fatal("foreign plugin read")
	}
	edited := w.Definition
	edited.Model = "test/model"
	if _, err := store.Save(ctx, owner, w.ID, w.Revision, edited); err != nil {
		t.Fatal("host model selection blocked", err)
	}
	again, err = adapter.Invoke(ctx, request)
	if err != nil || again.Data.(map[string]any)["execution_ref"] != w.ID {
		t.Fatal("host edits broke request identity", err)
	}
	request.Execution.Method = "agent.work.cancel"
	result, err = adapter.Invoke(ctx, request)
	if err != nil || result.Data.(map[string]any)["state"] != "cancelled" {
		t.Fatal(result, err)
	}
}
