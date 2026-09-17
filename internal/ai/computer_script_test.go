package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type scriptTestExecutor struct {
	fn func(context.Context, TargetToolCall) (TargetToolResult, error)
}

func (e scriptTestExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	return e.fn(ctx, call)
}

func scriptRuntimeFixture(t *testing.T, fn func(context.Context, TargetToolCall) (TargetToolResult, error)) (*ComputerUseRuntime, TargetToolCall) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is required for the computer script integration test")
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(helper), "../node_modules/quickjs-emscripten")); err != nil {
		t.Skip("Install the pinned UI dependencies to exercise QuickJS")
	}
	registry := NewTargetRegistry()
	for _, target := range []TargetDescriptor{{ID: "browser-main", Kind: "browser.managed"}, {ID: "test-target", Kind: "desktop.native"}} {
		if err := registry.Register(target); err != nil {
			t.Fatal(err)
		}
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{
		"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir()),
		"test-target":  scriptTestExecutor{fn},
	}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	return runtime, TargetToolCall{ThreadID: "thread", TurnID: "turn", RunID: "run", TargetID: "test-target", ToolCallID: "call", ToolName: "computer.exec", revalidate: func(ctx context.Context) error { return ctx.Err() }}
}

func executeTestScript(ctx context.Context, runtime *ComputerUseRuntime, call TargetToolCall, code string) (TargetToolResult, error) {
	call.Arguments, _ = json.Marshal(map[string]any{"code": code, "description": "Check controls and update the form"})
	return runtime.ExecuteTargetTool(ctx, call)
}

func TestComputerScriptNamespaceLifetimeAndPartialResult(t *testing.T) {
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		calls++
		if calls == 3 {
			return TargetToolResult{}, computerTargetFailure(call, "STALE_REFERENCE")
		}
		return TargetToolResult{Result: map[string]any{"action_executed": computerCallMutates(call)}}, nil
	})
	first, err := executeTestScript(t.Context(), runtime, call, `globalThis.count = 10; await ui.observe(); log(count);`)
	if err != nil || first.Result.(map[string]any)["action_executed"] != false {
		t.Fatalf("observation: %+v %v", first, err)
	}
	second, err := executeTestScript(t.Context(), runtime, call, `ui.assert(count === 10); count++; await ui.click(1, 2); try { await ui.ref('old').click(); } catch {} await ui.click(3, 4);`)
	if err != nil {
		t.Fatal(err)
	}
	payload := second.Result.(map[string]any)
	if calls != 3 || payload["completed"] != false || payload["script_error"] != "STALE_REFERENCE" || payload["action_executed"] != true {
		t.Fatalf("unsafe partial result: %+v; calls=%d", payload, calls)
	}
	if len(runtime.scripts) != 0 {
		t.Fatal("failed script namespace survived")
	}
	_, err = executeTestScript(t.Context(), runtime, call, `globalThis.count = 12;`)
	if err != nil {
		t.Fatal(err)
	}
	runtime.releaseComputerControl(call.ThreadID, call.RunID)
	if len(runtime.scripts) != 0 {
		t.Fatal("completed turn retained script state")
	}
}

func TestComputerScriptObservationOutput(t *testing.T) {
	observation := map[string]any{"document_id": "window:1", "nodes": []any{
		map[string]any{"ref": "a", "role": "button", "name": "Apply"},
		map[string]any{"ref": "b", "role": "textbox", "value": "before"},
		map[string]any{"ref": "c", "role": "heading", "name": "An unchanged description of the selected application and its current task, retained in the model context from the first complete observation"},
	}, "truncated": false}
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"observation": observation, "url": "https://example.test/work", "title": "Work"}}, nil
	})
	execute := func(code string) map[string]any {
		t.Helper()
		result, err := executeTestScript(t.Context(), runtime, call, code)
		if err != nil || result.Result.(map[string]any)["completed"] != true {
			t.Fatalf("observation script: %+v %v", result, err)
		}
		return result.Result.(map[string]any)
	}
	first := execute(`await ui.observe();`)["observation"].(map[string]any)
	if first["format"] != "full" {
		t.Fatalf("missing initial snapshot: %+v", first)
	}
	if first["url"] != "https://example.test/work" || first["title"] != "Work" {
		t.Fatalf("lost page identity: %+v", first)
	}
	unchanged := execute(`const state = await ui.observe(); ui.assert(state.observation.nodes.length === 3);`)["observation"].(map[string]any)
	if unchanged["format"] != "diff" || len(unchanged["nodes"].([]any)) != 0 {
		t.Fatalf("repeated tree: %+v", unchanged)
	}
	observation["nodes"] = []any{map[string]any{"ref": "b", "role": "textbox", "value": "after"}, observation["nodes"].([]any)[2]}
	local := execute(`const state = await ui.observe({emit:false}); ui.assert(state.observation.nodes[0].value === 'after'); log('checked');`)
	if local["observation"] != nil {
		t.Fatalf("local read leaked a tree: %+v", local)
	}
	changed := execute(`await ui.observe();`)["observation"].(map[string]any)
	if changed["format"] != "diff" || len(changed["nodes"].([]any)) != 1 || len(changed["removed_refs"].([]string)) != 1 {
		t.Fatalf("local read advanced the published baseline: %+v", changed)
	}
	for _, scenario := range []string{"full", "document", "subtree", "truncated"} {
		code := `await ui.observe();`
		switch scenario {
		case "full":
			code = `await ui.observe({full:true});`
		case "document":
			observation["document_id"] = "window:2"
		case "subtree":
			code = `await ui.observe({root_ref:'b'});`
		case "truncated":
			observation["truncated"] = true
		}
		got := execute(code)["observation"].(map[string]any)
		if got["format"] != "full" {
			t.Fatalf("%s reused a baseline: %+v", scenario, got)
		}
	}
}

func TestComputerScriptRevalidatesBeforeEveryOperation(t *testing.T) {
	dispatched := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		dispatched++
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	call.revalidate = func(context.Context) error {
		if dispatched == 1 {
			return errors.New("revoked")
		}
		return nil
	}
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.click(1, 2); await ui.click(3, 4);`)
	if err != nil || dispatched != 1 || result.Result.(map[string]any)["completed"] != false {
		t.Fatalf("revocation: calls=%d result=%+v err=%v", dispatched, result, err)
	}
}

func TestComputerScriptUnknownEffectNeverReplays(t *testing.T) {
	dispatched := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		dispatched++
		return TargetToolResult{}, errComputerEffectUnknown
	})
	_, err := executeTestScript(t.Context(), runtime, call, `try { await ui.click(1, 2); } catch {} await ui.click(3, 4);`)
	if !errors.Is(err, errComputerEffectUnknown) || dispatched != 1 || len(runtime.scripts) != 0 {
		t.Fatalf("uncertain effect: calls=%d err=%v", dispatched, err)
	}
}

func TestComputerScriptTakeoverDiscardsObservedContent(t *testing.T) {
	dispatched := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		dispatched++
		if dispatched == 1 {
			return TargetToolResult{Result: map[string]any{"observation": "prior content"}}, nil
		}
		return TargetToolResult{Result: map[string]any{"action_executed": true}, Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"secret_input"}}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.observe(); log('prior content'); await ui.click(1, 2); await ui.click(3, 4);`)
	if err != nil || result.Safety == nil || dispatched != 2 {
		t.Fatalf("takeover: %+v %v", result, err)
	}
	payload := result.Result.(map[string]any)
	if payload["logs"] != nil || payload["observation"] != nil || payload["action_executed"] != true || len(result.Attachments) != 0 {
		t.Fatalf("private projection: %+v", result)
	}
}

func TestComputerScriptInvalidationDropsPriorObservationWithoutReplayingAction(t *testing.T) {
	for _, refresh := range []bool{false, true} {
		t.Run(map[bool]string{false: "invalidated", true: "refreshed"}[refresh], func(t *testing.T) {
			dispatched := 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
				dispatched++
				switch dispatched {
				case 1:
					return TargetToolResult{Result: map[string]any{"observation": "old document"}}, nil
				case 2:
					return TargetToolResult{Result: map[string]any{"observation_invalidated": true, "action_executed": true}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
				default:
					return TargetToolResult{Result: map[string]any{"observation": "new document"}}, nil
				}
			})
			code := `await ui.observe(); const clicked = await ui.click(1, 2); ui.assert(clicked.observation_invalidated);`
			if refresh {
				code += `await ui.observe();`
			}
			result, err := executeTestScript(t.Context(), runtime, call, code)
			if err != nil || result.Safety != nil {
				t.Fatalf("unexpected failure or takeover: %+v %v", result, err)
			}
			payload := result.Result.(map[string]any)
			if payload["action_executed"] != true || payload["completed"] != true {
				t.Fatalf("lost confirmed action: %+v", payload)
			}
			if refresh {
				if dispatched != 3 || payload["observation"] != "new document" || payload["observation_invalidated"] == true {
					t.Fatalf("fresh observation unavailable: %+v; calls=%d", payload, dispatched)
				}
			} else if dispatched != 2 || payload["observation"] != nil || payload["observation_invalidated"] != true {
				t.Fatalf("stale observation escaped: %+v; calls=%d", payload, dispatched)
			}
		})
	}
}

func TestComputerScriptRevocationCancelsActiveOperation(t *testing.T) {
	entered := make(chan struct{})
	var once sync.Once
	runtime, call := scriptRuntimeFixture(t, func(ctx context.Context, _ TargetToolCall) (TargetToolResult, error) {
		once.Do(func() { close(entered) })
		<-ctx.Done()
		return TargetToolResult{}, ctx.Err()
	})
	done := make(chan error, 1)
	go func() { _, err := executeTestScript(t.Context(), runtime, call, `await ui.observe();`); done <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("script did not dispatch")
	}
	runtime.releaseScripts(func(key computerScriptKey) bool { return key.thread == call.ThreadID })
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("revocation blocked behind the active operation")
	}
	if len(runtime.scripts) != 0 {
		t.Fatal("revoked namespace survived")
	}
}

func TestComputerScriptTimeoutPreservesConfirmedPrefix(t *testing.T) {
	entered := make(chan struct{})
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		close(entered)
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go func() { <-entered; time.AfterFunc(100*time.Millisecond, cancel) }()
	result, err := executeTestScript(ctx, runtime, call, `await ui.click(1, 2); while (true) {}`)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("timeout: %v", err)
	}
	payload := result.Result.(map[string]any)
	if payload["action_executed"] != true || payload["completed"] != false || len(payload["completed_actions"].([]string)) != 1 {
		t.Fatalf("lost prefix: %+v", payload)
	}
	if len(runtime.scripts) != 0 {
		t.Fatal("cancelled namespace survived")
	}
}
