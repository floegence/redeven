package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/session"
)

func TestOrdinaryFlowerSurfaceDoesNotExposeOwnedWorkTools(t *testing.T) {
	r := newRun(runOptions{AgentHomeDir: t.TempDir(), SessionMeta: testSendTurnMeta(), ThreadID: "ordinary"})
	surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, FlowerPermissionFullAccess)
	if err != nil {
		t.Fatal(err)
	}
	if len(surface.FloretToolItems) == 0 {
		t.Fatal("ordinary surface unexpectedly empty")
	}
	for _, item := range surface.FloretToolItems {
		name := item.Definition.Name
		if strings.HasPrefix(name, "automation_") || strings.HasPrefix(name, "plugin_author_") || strings.HasPrefix(name, "tessiven_") {
			t.Fatal("owner-specific tool leaked into ordinary model surface", name)
		}
	}
}

func TestAutomationResultAcknowledgementDoesNotReplayWholeContext(t *testing.T) {
	store, err := automation.Open(filepath.Join(t.TempDir(), "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta := testSendTurnMeta()
	owner, _ := automation.OwnerFromSession(meta)
	d := automation.Definition{Title: "Bounded acknowledgement", Goal: "Retain evidence without echoing it", Model: "test/model", WorkingDirectory: t.TempDir(), MaxConcurrent: 1, TimeoutSeconds: 60, Nodes: []automation.Node{{ID: "inspect", Title: "Inspect", Kind: "agent", Instruction: "Submit a result"}}}
	w, err := store.Create(t.Context(), owner, "create", d)
	if err != nil {
		t.Fatal(err)
	}
	p, err := store.Publish(t.Context(), owner, w.ID, w.Revision, automation.Grant{Enabled: true, Model: d.Model, WorkingDirectory: d.WorkingDirectory, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: "namespace", App: "app", Read: true, Write: true, Execute: true}})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.CreateRun(t.Context(), owner, w.ID, "run", p.Version, "test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	current, err = store.UpdateRun(t.Context(), owner, current.ID, func(r *automation.Run) error {
		r.Attempts = []automation.Attempt{{ID: "attempt", NodeID: "inspect", State: "submitted", ContextRevision: r.ContextRevision}}
		r.Artifacts = []automation.Artifact{{ID: "prior-report", Content: strings.Repeat("retained artifact", 20000)}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.BindThread(t.Context(), owner, w.ID, current.ID, "attempt", "thread"); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: d.WorkingDirectory, SessionMeta: meta, ThreadID: "thread"})
	r.host.automation = store
	r.host.authorityThreadID = "thread"
	result, err := r.execAutomationTool(t.Context(), meta, "automation_submit_result", map[string]any{"result_json": "{\"ok\":true}"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if len(raw) > 2048 || strings.Contains(string(raw), "retained artifact") {
		t.Fatalf("mutation acknowledgement replays retained context: %d bytes", len(raw))
	}
	var receipt struct {
		Accepted  bool   `json:"accepted"`
		AttemptID string `json:"attempt_id"`
	}
	if err = json.Unmarshal(raw, &receipt); err != nil || !receipt.Accepted || receipt.AttemptID != "attempt" {
		t.Fatal("missing exact submission acknowledgement", string(raw), err)
	}
}

func TestAutomationCanonicalExecutionPublishesResultAndSharedContext(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	var captured string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, rawTool := range body["tools"].([]any) {
			tool := rawTool.(map[string]any)
			name, _ := tool["name"].(string)
			if function, ok := tool["function"].(map[string]any); ok {
				name, _ = function["name"].(string)
			}
			if name != "automation_read_context" && name != "automation_contribute" && name != "automation_submit_result" {
				t.Errorf("ungranted tool reached autonomous provider: %s", name)
			}
		}
		raw, _ := json.Marshal(body)
		mu.Lock()
		calls++
		n := calls
		captured += string(raw)
		mu.Unlock()
		if n == 1 {
			writeEncodingIntegrationCall(w, "automation_submit_result", "result-one", `{"result_json":"{\"ok\":true}"}`)
			return
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Result submitted.")
	}))
	defer provider.Close()
	opts := encodingIntegrationOptions(t, provider.URL, &encodingComputerExecutor{})
	store, err := automation.Open(filepath.Join(t.TempDir(), "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta := testSendTurnMeta()
	meta.FloeApp = "com.floegence.redeven.agent"
	meta.ChannelID = ""
	meta.SessionKind = "automation"
	owner, _ := automation.OwnerFromSession(meta)
	opts.Automation = store
	opts.AutomationAuthorize = func(ctx context.Context, o automation.Owner, r automation.Run) (*session.Meta, error) {
		g, e := store.Grant(ctx, o, r.WorkflowID)
		if e != nil || !g.Enabled {
			return nil, automation.ErrUnauthorized
		}
		return meta, nil
	}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	d := automation.Definition{Title: "Inspection", Goal: "Evidence across the entire workflow", Model: "openai/gpt-5-mini", WorkingDirectory: opts.AgentHomeDir, MaxConcurrent: 2, TimeoutSeconds: 30, Nodes: []automation.Node{{ID: "inspect", Title: "Inspect", Kind: "agent", Instruction: "Observe and submit result", OutputSchema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}`)}}}
	flow, err := store.Create(t.Context(), owner, "flow", d)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := store.Publish(t.Context(), owner, flow.ID, flow.Revision, automation.Grant{Enabled: true, Model: d.Model, WorkingDirectory: d.WorkingDirectory, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: meta.NamespacePublicID, App: meta.FloeApp, Read: true, Write: true, Execute: true}})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(t.Context(), owner, flow.ID, "request", pub.Version, "test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	engine := &automation.Engine{Store: store, Executor: AutomationExecutor{Service: svc}}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	for run.Status != "completed" {
		if err = engine.Step(ctx, owner, run.ID); err != nil {
			t.Fatal(err)
		}
		run, err = store.Run(ctx, owner, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status == "failed" {
			current, _ := svc.threadRuntime.View(ctx, identity.ThreadID(run.Attempts[0].ThreadID))
			raw, _ := json.Marshal(current.Failure)
			t.Fatalf("run failed: %s", raw)
		}
		select {
		case <-ctx.Done():
			t.Fatalf("timeout: %+v", run)
		case <-time.After(15 * time.Millisecond):
		}
	}
	if len(run.Contributions) != 1 || string(run.Contributions[0].Data) != `{"ok":true}` {
		t.Fatal(run.Contributions)
	}
	mu.Lock()
	text := captured
	mu.Unlock()
	if !strings.Contains(text, "Shared workflow context") || !strings.Contains(text, d.Goal) {
		t.Fatal("shared brief missing at model boundary")
	}
	current, err := svc.threadRuntime.View(ctx, identity.ThreadID(run.Attempts[0].ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if current.Context == nil || current.Context.ModelContext == nil || current.Context.ModelContext.UsedAt == nil {
		t.Fatal("missing canonical loaded-context evidence")
	}
	if _, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{StorageGeneration: svc.storageGeneration, ThreadID: run.Attempts[0].ThreadID, ClientRequestID: "ordinary-takeover", Input: RunInput{Text: "change this run"}}); !errors.Is(err, automation.ErrUnauthorized) {
		t.Fatal("ordinary route took over node", err)
	}
	if err = svc.requireInteractiveThreadAuthority(ctx, meta.EndpointID, run.Attempts[0].ThreadID); !errors.Is(err, automation.ErrUnauthorized) {
		t.Fatal("ordinary mutation accepted", err)
	}
	receipt, err := svc.AutomationContextReceipt(ctx, meta, run.ID, run.Attempts[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	receiptJSON, _ := json.Marshal(receipt)
	if !strings.Contains(string(receiptJSON), "used_at") || !strings.Contains(string(receiptJSON), d.Goal) {
		t.Fatal("canonical context receipt incomplete", string(receiptJSON))
	}
	scope, err := svc.threadQueryScope(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range scope.ThreadIDs {
		if id.String() == run.Attempts[0].ThreadID {
			t.Fatal("run thread leaked through query")
		}
	}
	restored, restoreErr := svc.restoreFloretEffectRequest(ctx, flruntime.AgentRequest{ThreadID: current.ThreadID, TurnID: current.TurnID, RequestKey: run.Attempts[0].RequestID, TurnKind: "qualification"})
	if restoreErr != nil || !restored.req.Options.NoUserInteraction || restored.meta.FloeApp != meta.FloeApp || restored.meta.ChannelID != "" || restored.meta.SessionKind != "automation" {
		t.Fatal("background authority restore", restoreErr)
	}
	threadID := run.Attempts[0].ThreadID
	if err := svc.requireBackgroundThreadAuthority(ctx, meta, threadID); err != nil {
		t.Fatal("channel-free delegated authority rejected", err)
	}
	for _, mutation := range []func(*session.Meta){
		func(m *session.Meta) { m.SessionKind = "" },
		func(m *session.Meta) { m.UserPublicID = "foreign" },
		func(m *session.Meta) { m.NamespacePublicID = "foreign" },
		func(m *session.Meta) { m.FloeApp = "foreign" },
	} {
		untrusted := *meta
		mutation(&untrusted)
		if err := svc.requireBackgroundThreadAuthority(ctx, &untrusted, threadID); err == nil {
			t.Fatal("mismatched background principal accepted")
		}
	}
	if err := svc.requireBackgroundThreadAuthority(ctx, meta, "unbound-thread"); err == nil {
		t.Fatal("session kind alone authorized an unbound thread")
	}
	if err := store.Revoke(ctx, owner, flow.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.restoreFloretEffectRequest(ctx, flruntime.AgentRequest{ThreadID: current.ThreadID, TurnID: current.TurnID, RequestKey: run.Attempts[0].RequestID, TurnKind: "qualification"}); !errors.Is(err, automation.ErrUnauthorized) {
		t.Fatal("revoked restart accepted", err)
	}
	if err := svc.requireBackgroundThreadAuthority(ctx, meta, threadID); !errors.Is(err, automation.ErrUnauthorized) {
		t.Fatal("revoked background effect accepted", err)
	}
	foreign := *meta
	foreign.UserPublicID = "foreign"
	if _, err = svc.GetThread(ctx, &foreign, run.Attempts[0].ThreadID); !errors.Is(err, automation.ErrNotFound) {
		t.Fatal("foreign thread read", err)
	}
	list, err := svc.ListThreads(ctx, meta, 50, "")
	if err != nil || len(list.Threads) != 0 {
		t.Fatal("run thread leaked to ordinary list", err)
	}
}
