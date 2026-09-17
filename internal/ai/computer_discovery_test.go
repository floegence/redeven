package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestComputerDiscoveryToolsDoNotRequireAPreselectedTarget(t *testing.T) {
	definitions := map[string]ToolDef{}
	for _, definition := range builtInComputerToolDefinitions() {
		definitions[definition.Name] = definition
	}
	for _, name := range []string{"computer.targets", "computer.select_target"} {
		definition, exists := definitions[name]
		if !exists {
			t.Fatalf("agent cannot discover and choose its own target: missing %s", name)
		}
		var schema struct {
			Properties map[string]json.RawMessage `json:"properties"`
		}
		if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		if _, exists := schema.Properties["target"]; exists {
			t.Fatalf("%s depends on a selected target", name)
		}
		if name == "computer.select_target" && schema.Properties["candidate_ref"] == nil {
			t.Fatal("selection must use a Runtime-issued candidate reference")
		}
	}
}

func TestComputerCandidateSelectionPreservesBindingWhenBusyOrStale(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	if err := store.SetComputerTarget(t.Context(), "thread-first", "browser-main"); err != nil {
		t.Fatal(err)
	}
	target := TargetDescriptor{ID: "desktop-main", Kind: "desktop.window", DisplayName: "Notes", Ready: true}
	if err := host.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	candidate, err := host.rememberComputerCandidate("thread-first", ComputerCandidate{TargetID: target.ID, Kind: target.Kind, DisplayName: target.DisplayName, State: "ready"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget(target.ID)
	control.threadID, control.runID = "thread-second", "other-run"
	call := TargetToolCall{ThreadID: "thread-first", RunID: "run", TurnID: "turn", ToolCallID: "select", ToolName: "computer.select_target"}
	if _, err := host.SelectComputerCandidate(t.Context(), call, candidate.CandidateRef, ToolTargetPolicy{}); err == nil {
		t.Fatal("selection stole an occupied target")
	}
	selected, err := store.GetComputerTarget(t.Context(), call.ThreadID)
	if err != nil || selected != "browser-main" || len(executor.calls) != 0 {
		t.Fatalf("rejected selection changed work: %s %v %+v", selected, err, executor.calls)
	}
	if _, err := host.computerCandidate("thread-second", candidate.CandidateRef); err == nil {
		t.Fatal("candidate crossed thread authority")
	}
	control.threadID, control.runID = "", ""
	host.registry.remove(target.ID)
	if _, err := host.SelectComputerCandidate(t.Context(), call, candidate.CandidateRef, ToolTargetPolicy{}); err == nil {
		t.Fatal("stale candidate selected a different target")
	}
}

func TestComputerDefaultBrowserPlansAreIsolatedAndReadOnly(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	first, err := host.ResolveTargetForThread(t.Context(), "thread-first", "current")
	if err != nil {
		t.Fatal(err)
	}
	second, err := host.ResolveTargetForThread(t.Context(), "thread-second", "current")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || first.ID == "browser-main" || first.connection == nil || second.connection == nil {
		t.Fatalf("default pages are not isolated: %+v %+v", first, second)
	}
	selected, err := store.GetComputerTarget(t.Context(), "thread-first")
	if err != nil || selected != "" || len(executor.calls) != 0 {
		t.Fatalf("resource planning performed execution: %s %v", selected, err)
	}
	if err := store.SetComputerTarget(t.Context(), "thread-first", first.ID); err != nil {
		t.Fatal(err)
	}
	for _, alias := range []string{"current", first.ID} {
		if _, err := host.ResolveTargetForThread(t.Context(), "thread-first", alias); err == nil {
			t.Fatalf("lost stored page was silently recreated through %q", alias)
		}
	}

	host.extension = &computerExtensionHub{profiles: map[string]*computerExtensionClient{"personal": {profile: ComputerExtensionProfile{ID: "personal", Name: "Personal"}}}}
	personal, err := host.defaultThreadBrowser("thread-first")
	if err != nil || personal.connection.ExtensionProfileID != "personal" || personal.ID == first.ID {
		t.Fatalf("personal browser not preferred: %+v %v", personal, err)
	}
	host.extension.profiles["work"] = &computerExtensionClient{profile: ComputerExtensionProfile{ID: "work", Name: "Work"}}
	if _, err := host.defaultThreadBrowser("thread-first"); err == nil {
		t.Fatal("ambiguous personal profiles were chosen arbitrarily")
	}
	host.extension = nil
}

func TestComputerScriptReturnsPopupProgressWithoutUserInput(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{TargetID: call.TargetID, Safety: &InteractionSafetyDecision{Level: "routine"}, Result: map[string]any{"target_changed": true, "opener_tab_id": "parent", "opened_pages": []any{map[string]any{"url": "https://example.test/child"}}, "action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, `await ui.click(10,20); await ui.click(30,40);`)
	if err != nil {
		t.Fatal(err)
	}
	payload := result.Result.(map[string]any)
	if calls != 1 || payload["target_changed"] != true || payload["completed"] != false || payload["action_executed"] != true || payload["opener_tab_id"] != "parent" || len(payload["completed_actions"].([]string)) != 1 {
		t.Fatalf("popup progress lost or action repeated: calls=%d %+v", calls, payload)
	}
	if result.Safety != nil && result.Safety.Level == "takeover" {
		t.Fatal("popup invented a user takeover")
	}
}

func TestComputerAutonomousManagedPagesAndPopupSelection(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires the pinned Chromium integration fixture")
	}
	host, _, store, _ := computerBindingFixture(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	host.executors["browser-main"] = NewPlaywrightTargetExecutor(node, helper, t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/child" {
			_, _ = w.Write([]byte(`<title>Task details</title><h1>Child result</h1><input aria-label="Draft" value="unsaved">`))
			return
		}
		_, _ = w.Write([]byte(`<title>Task start</title><button onclick="window.open('/child')">Open details</button>`))
	}))
	defer server.Close()
	runs := []*run{}
	for _, thread := range []string{"thread-first", "thread-second"} {
		r := &run{threadID: thread, targetResolver: host, targetToolExecutor: host}
		bindTargetTestRun(t, r)
		runs = append(runs, r)
		result, err := r.execTargetTool(t.Context(), "start", "browser.navigate", map[string]any{"url": server.URL})
		if err != nil {
			t.Fatal(err)
		}
		if result.(targetToolExecution).inputRequired != nil {
			t.Fatal("full access required manual browser setup")
		}
	}
	first, _ := store.GetComputerTarget(t.Context(), "thread-first")
	second, _ := store.GetComputerTarget(t.Context(), "thread-second")
	if first == second || first == "browser-main" {
		t.Fatalf("tasks share a browser page: %s %s", first, second)
	}
	r := runs[0]
	runID, threadID, turnID := r.floretCanonicalIdentity()
	args, _ := json.Marshal(map[string]string{"description": "Open task details", "code": `await ui.getByRole('button',{name:'Open details'}).click(); await ui.getByRole('button',{name:'Open details'}).click();`})
	completed, err := host.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: threadID, TurnID: turnID, RunID: runID, TargetID: first, ToolCallID: "popup", ToolName: "computer.exec", Arguments: args, revalidate: func(ctx context.Context) error { return ctx.Err() }})
	if err != nil {
		t.Fatal(err)
	}
	payload := completed.Result.(map[string]any)
	if takeoverResult(completed, nil) || payload["target_changed"] != true || len(payload["completed_actions"].([]string)) != 1 {
		t.Fatalf("popup did not return completed progress: %+v", completed)
	}
	// Inventory includes the real opener identity, so same-URL tabs do not
	// establish a relationship by title or URL alone.
	selection := TargetToolCall{ThreadID: threadID, TurnID: turnID, RunID: runID, ToolCallID: "select", ToolName: "computer.select_target"}
	inventory, err := host.ComputerTargets(t.Context(), selection, ToolTargetPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	var child ComputerCandidate
	children := 0
	for _, candidate := range inventory.Candidates {
		if candidate.URL == server.URL+"/child" {
			child = candidate
			children++
		}
	}
	if children != 1 || child.OpenerTabID != payload["opener_tab_id"] {
		t.Fatalf("popup identity mismatch: %+v %+v", child, payload)
	}
	if _, err = host.SelectComputerCandidate(t.Context(), selection, child.CandidateRef, ToolTargetPolicy{}); err != nil {
		t.Fatal(err)
	}
	result, err := r.execTargetTool(t.Context(), "verify", "computer.observe", nil)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(result.(targetToolExecution).Payload)
	if !strings.Contains(string(body), "Child result") || !strings.Contains(string(body), "unsaved") {
		t.Fatalf("selected page lost state: %s", body)
	}
	if _, err = r.execTargetTool(t.Context(), "occupied", "computer.observe", map[string]any{"target": second}); err == nil {
		t.Fatal("another task page was stolen")
	}
	selected, _ := store.GetComputerTarget(t.Context(), "thread-first")
	if selected == second {
		t.Fatal("rejected operation changed the binding")
	}
}

func TestComputerSelectionRechecksQueuedAuthorityAndCannotBypassPrivateControl(t *testing.T) {
	for _, reason := range []string{"revocation", "cancellation", "private_control"} {
		t.Run(reason, func(t *testing.T) {
			host, executor, store, _ := computerBindingFixture(t)
			if err := store.SetComputerTarget(t.Context(), "thread-first", "browser-main"); err != nil {
				t.Fatal(err)
			}
			target, _ := host.ResolveTarget(t.Context(), "desktop-main")
			gate := host.controlForTarget(target.ID)
			gate.gate <- struct{}{}
			entered := make(chan struct{})
			var calls atomic.Int32
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", ToolName: "computer.select_target", revalidate: func(ctx context.Context) error {
				if calls.Add(1) == 1 {
					close(entered)
					return ctx.Err()
				}
				if reason == "revocation" {
					return errors.New("revoked")
				}
				return ctx.Err()
			}}
			done := make(chan error, 1)
			go func() { _, err := host.selectComputerTarget(ctx, call, target); done <- err }()
			<-entered
			if reason == "cancellation" {
				cancel()
			}
			if reason == "private_control" {
				control := host.controlForTarget("browser-main")
				control.mu.Lock()
				control.threadID, control.user = "thread-first", true
				control.mu.Unlock()
			}
			<-gate.gate
			if err := <-done; err == nil {
				t.Fatal("selection bypassed current authority")
			}
			selected, _ := store.GetComputerTarget(t.Context(), "thread-first")
			if selected != "browser-main" || len(executor.calls) != 0 {
				t.Fatalf("rejected selection changed state: %s %+v", selected, executor.calls)
			}
			gate.mu.Lock()
			owned := gate.threadID
			gate.mu.Unlock()
			if owned != "" {
				t.Fatalf("rejected selection claimed target: %s", owned)
			}
		})
	}
}

func TestComputerAutonomousCDPPagesPreserveExistingTab(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires pinned Chromium")
	}
	host, _, store, _ := computerBindingFixture(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	host.executors["browser-main"] = NewPlaywrightTargetExecutor(node, helper, t.TempDir())
	source, err := host.ConnectBrowser(t.Context(), ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true})
	if err != nil {
		t.Fatal(err)
	}
	adapter := host.executors[source.ID].(*PlaywrightTargetExecutor)
	connected, err := host.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: adapter.CDPURL, TabID: adapter.TabID, ProfileID: adapter.BrowserContextID})
	if err != nil {
		t.Fatal(err)
	}
	// This test's disposable CDP browser is exposed through the personal-browser
	// adapter; it never connects to a user's daily browser.
	if connected.ID == source.ID { // Remove only the managed attachment in this fixture before establishing CDP ownership.
		if err := host.disconnectBrowser(t.Context(), source.ID); err != nil {
			t.Fatal(err)
		}
		connected, err = host.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: adapter.CDPURL, TabID: adapter.TabID, ProfileID: adapter.BrowserContextID})
		if err != nil {
			t.Fatal(err)
		}
	}
	original := host.executors[connected.ID]
	ids := []string{}
	for _, thread := range []string{"thread-first", "thread-second"} {
		planned, err := host.ResolveTargetForThread(t.Context(), thread, "current")
		if err != nil {
			t.Fatal(err)
		}
		if planned.Kind != "browser.connected" {
			t.Fatalf("personal CDP browser was not preferred: %+v", planned)
		}
		target, err := host.selectComputerTarget(t.Context(), TargetToolCall{ThreadID: thread, TurnID: "turn", RunID: thread, ToolName: "computer.select_target"}, planned)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, target.ID)
		selected, _ := store.GetComputerTarget(t.Context(), thread)
		if selected != target.ID {
			t.Fatal("target not bound")
		}
	}
	if ids[0] == ids[1] || ids[0] == connected.ID || ids[1] == connected.ID || host.executors[connected.ID] != original {
		t.Fatalf("CDP conversations replaced an existing tab: %v", ids)
	}
	tabs, err := host.BrowserTabs(t.Context(), adapter.CDPURL)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tab := range tabs {
		if tab.ID == adapter.TabID {
			found = true
		}
	}
	if !found {
		t.Fatal("existing CDP page was closed")
	}
}

func TestComputerSelectionRejectsUnavailableReadinessWithoutBinding(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	executor.readinessErr = &TargetStartupError{Code: "TARGET_PERMISSION_REQUIRED", Reason: "accessibility_required"}
	target, _ := host.ResolveTarget(t.Context(), "desktop-main")
	_, err := host.selectComputerTarget(t.Context(), TargetToolCall{ThreadID: "thread-first", RunID: "run", ToolName: "computer.select_target"}, target)
	if err == nil || ComputerSelectionErrorCode(err) != "target_permission_required" {
		t.Fatalf("unavailable readiness: %v", err)
	}
	selected, _ := store.GetComputerTarget(t.Context(), "thread-first")
	if selected != "" || len(executor.calls) != 0 {
		t.Fatalf("unready target was bound: %s %+v", selected, executor.calls)
	}
}
