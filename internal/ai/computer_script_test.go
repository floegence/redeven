package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
		result := map[string]any{"action_executed": computerCallMutates(call)}
		if call.ToolName == "computer.observe" {
			result["observation"] = map[string]any{"semantic_schema_version": 2, "document_id": "fixture:1", "nodes": []any{}, "truncated": false}
		}
		return TargetToolResult{Result: result}, nil
	})
	first, err := executeTestScript(t.Context(), runtime, call, `globalThis.count = 10; await ui.observe(); log(count);`)
	if err != nil || first.Result.(map[string]any)["action_executed"] != false {
		t.Fatalf("observation: %+v %v", first, err)
	}
	second, err := executeTestScript(t.Context(), runtime, call, `ui.assert(count === 10); count++; await ui.click(1, 2); try { await ui.ref('old').click(); } catch {} await ui.click(3, 4);`)
	var scriptErr *computerScriptExecutionError
	if !errors.As(err, &scriptErr) {
		t.Fatalf("partial script must fail execution: %v", err)
	}
	payload := second.Result.(map[string]any)
	if calls != 3 || payload["completed"] != false || payload["script_error"] != "STALE_REFERENCE" || payload["action_executed"] != true {
		t.Fatalf("unsafe partial result: %+v; calls=%d", payload, calls)
	}
	if payload["failed_operation_index"] != 1 || payload["failed_action"] != "click" || payload["needs_observation"] != true || payload["effect_outcome_unknown"] != false {
		t.Fatalf("recovery facts lost: %#v", payload)
	}
	if len(runtime.scripts) != 0 || payload["context_reset"] != true {
		t.Fatal("failed invocation retained its namespace")
	}
	_, err = executeTestScript(t.Context(), runtime, call, `ui.assert(typeof count === "undefined"); globalThis.count = 12;`)
	if err != nil {
		t.Fatal(err)
	}
	runtime.releaseComputerControl(call.ThreadID, call.RunID)
	if len(runtime.scripts) != 0 {
		t.Fatal("completed turn retained script state")
	}
}

func TestComputerScriptObservationOutput(t *testing.T) {
	observation := map[string]any{"semantic_schema_version": 2, "document_id": "window:1", "nodes": []any{
		semanticFixtureNode("a", "button", "Apply"),
		semanticFixtureNode("b", "textbox", "Search"),
		semanticFixtureNode("c", "heading", "An unchanged description of the selected application and its current task, retained in the model context from the first complete observation"),
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
	observation["nodes"].([]any)[1].(map[string]any)["value"] = "after"
	observation["nodes"] = []any{observation["nodes"].([]any)[1], observation["nodes"].([]any)[2]}
	local := execute(`const state = await ui.observe({emit:false}); ui.assert(state.observation.nodes[0].value === 'after'); ui.assert(state.observation.url === 'https://example.test/work' && state.observation.title === 'Work'); log('checked');`)
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
	var scriptErr *computerScriptExecutionError
	if !errors.As(err, &scriptErr) || dispatched != 1 || result.Result.(map[string]any)["completed"] != false {
		t.Fatalf("revocation: calls=%d result=%+v err=%v", dispatched, result, err)
	}
}

func TestComputerScriptFailureRetainsSafePartialOutput(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.click(1, 2); log('Clicked first button'); throw new Error('private exception contents');`)
	var scriptErr *computerScriptExecutionError
	if !errors.As(err, &scriptErr) || strings.Contains(err.Error(), "private exception") {
		t.Fatalf("execution failure was lost or leaked: %v", err)
	}
	payload := result.Result.(map[string]any)
	body, _ := json.Marshal(payload)
	if payload["completed"] != false || !strings.Contains(string(body), "Clicked first button") || strings.Contains(string(body), "private exception") {
		t.Fatalf("partial logs missing or unsafe: %s", body)
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

func TestComputerScriptUncertainResultRetainsCompletedPrefixAndProgress(t *testing.T) {
	dispatched := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		dispatched++
		if dispatched == 1 {
			return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
		}
		return TargetToolResult{ExecutionLocation: "macos_desktop", Result: map[string]any{
			"input_progress": map[string]any{"posted": 1, "observed": 0, "expected": 2, "private": "hidden"},
			"stage":          "input_delivery", "reason": "receipt_timeout", "target_state": "available",
			"observation": semanticFixtureText("current document"),
		}}, errComputerEffectUnknown
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.click(1, 2); try { await ui.click(3, 4); } catch {} await ui.click(5, 6);`)
	if !errors.Is(err, errComputerEffectUnknown) || dispatched != 2 || len(runtime.scripts) != 0 {
		t.Fatalf("uncertain operation resumed: calls=%d err=%v", dispatched, err)
	}
	payload := result.Result.(map[string]any)
	prefix, _ := payload["completed_actions"].([]string)
	if len(prefix) != 1 || prefix[0] != "pointer_click" || payload["operations"] != 2 || payload["completed"] != false || payload["action_executed"] != true {
		t.Fatalf("completed prefix changed: %+v", payload)
	}
	progress, _ := payload["input_progress"].(map[string]any)
	observation, _ := payload["observation"].(map[string]any)
	if progress["private"] != nil {
		t.Fatal("unknown-effect receipt leaked unrecognized fields")
	}
	if progress["posted"] != int64(1) || progress["observed"] != int64(0) || progress["expected"] != int64(2) || payload["stage"] != "input_delivery" || payload["reason"] != "receipt_timeout" || payload["target_state"] != "available" || observation["document_id"] != "current document" || result.ExecutionLocation != "macos_desktop" {
		t.Fatalf("uncertain facts lost: %+v", result)
	}
	if payload["effect_outcome_unknown"] != true || payload["failed_operation_index"] != 1 || payload["failed_action"] != "pointer_click" {
		t.Fatalf("failed operation identity lost: %+v", payload)
	}
}

func TestComputerScriptUncertaintyRequiresObservationWithoutConfirmedInput(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		result, err, _ := computerBrowserFailure(inner, false, "EFFECT_OUTCOME_UNKNOWN", map[string]any{"stage": "input_delivery", "reason": "response_unavailable"}, "connected_browser")
		return result, err
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.key('PageDown');")
	payload := result.Result.(map[string]any)
	if !errors.Is(err, errComputerEffectUnknown) || payload["needs_observation"] != true || !result.executionFacts.needsObservation || payload["action_executed"] != false || payload["stage"] != "input_delivery" || payload["reason"] != "response_unavailable" {
		t.Fatalf("missing uncertain recovery facts: %+v %v", result, err)
	}
}

func TestComputerScriptFocusRejectionRetainsKnownFailure(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		result, err, _ := computerBrowserFailure(inner, false, "ELEMENT_NOT_ACTIONABLE", map[string]any{"action_executed": false, "stage": "focus", "reason": "not_focusable"}, "connected_browser")
		return result, err
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.ref('document').press('PageDown');")
	payload := result.Result.(map[string]any)
	if err == nil || errors.Is(err, errComputerEffectUnknown) || payload["effect_outcome_unknown"] != false || payload["action_executed"] != false || payload["stage"] != "focus" || payload["reason"] != "not_focusable" {
		t.Fatalf("focus rejection facts lost: %+v %v", result, err)
	}
}

func TestComputerScriptTakeoverDiscardsObservedContent(t *testing.T) {
	dispatched := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		dispatched++
		if dispatched == 1 {
			return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("prior content")}}, nil
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
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("old document")}}, nil
				case 2:
					return TargetToolResult{Result: map[string]any{"observation_invalidated": true, "action_executed": true}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
				default:
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("new document")}}, nil
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
				if dispatched != 3 || payload["observation"].(map[string]any)["document_id"] != "new document" || payload["observation_invalidated"] == true {
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
	result, err := executeTestScript(ctx, runtime, call, `await ui.click(1, 2); log('confirmed-prefix'); while (true) {}`)
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
	if logs, ok := payload["logs"].([]any); !ok || len(logs) != 1 {
		t.Fatalf("timeout lost explicit log: %#v", payload)
	}
}

func TestComputerScriptArgumentRepairFields(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) {
		t.Fatal("invalid arguments dispatched")
		return TargetToolResult{}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "await ui.snapshot({limit:1200});")
	if err == nil {
		t.Fatal("missing rejection")
	}
	diagnostic := result.Result.(map[string]any)["diagnostic"].(map[string]any)
	if diagnostic["method"] != "ui.snapshot" || diagnostic["field"] != "limit" || diagnostic["expected"] != "integer_1_1000" || diagnostic["example"] == nil {
		t.Fatalf("incomplete diagnostic: %#v", diagnostic)
	}
}

func TestComputerScriptScrollCoordinatesAndSemanticRouting(t *testing.T) {
	var calls []TargetToolCall
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		calls = append(calls, inner)
		return TargetToolResult{Result: map[string]any{}}, nil
	})
	_, err := executeTestScript(t.Context(), rt, call, "await ui.scrollAt(12,34,80); await ui.ref('area').scroll(40);")
	if err != nil || len(calls) != 2 || calls[0].ToolName != "computer.scroll" || calls[1].ToolName != "computer.action" {
		t.Fatalf("routing: %#v %v", calls, err)
	}
	var args map[string]any
	_ = json.Unmarshal(calls[0].Arguments, &args)
	if args["x"] != float64(12) || args["y"] != float64(34) || args["delta_y"] != float64(80) {
		t.Fatalf("coordinates lost: %#v", args)
	}
}

func TestComputerScriptCannotSupplyHostAuthorization(t *testing.T) {
	for _, key := range []string{"full_access", "allowed_origins", "allowed_navigation_urls", "allowed_apps", "allow_foreground"} {
		t.Run(key, func(t *testing.T) {
			_, err := computerScriptOperation(TargetToolCall{}, map[string]any{"action": "observe", key: true})
			var denied *targetToolPolicyError
			if !errors.As(err, &denied) || denied.code != "target_not_allowed" {
				t.Fatalf("script supplied host authorization: %v", err)
			}
		})
	}
}

func TestComputerScriptReadFailurePreservesConfirmedPrefixWithoutContentOrReplay(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		calls++
		if calls == 1 {
			return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("previous page content")}}, nil
		}
		return computerObservationFailure(call, map[string]any{"action_executed": true, "observation_stage": "safety_scan", "diagnostic": map[string]any{"phase": "protocol", "method": "DOMSnapshot.captureSnapshot", "code": float64(-32000), "message": "private exception"}}, "fixture")
	})
	result, err := executeTestScript(t.Context(), host, call, `await ui.observe(); log('previous page content'); await ui.click(1,2); await ui.click(3,4);`)
	var failure *computerScriptExecutionError
	if !errors.As(err, &failure) || failure.code != "TARGET_OBSERVATION_UNAVAILABLE" || calls != 2 || result.Safety != nil {
		t.Fatalf("unsafe read result: %+v %v calls=%d", result, err, calls)
	}
	payload := result.Result.(map[string]any)
	if payload["action_executed"] != true || payload["observation"] != nil || payload["logs"] != nil || len(result.Attachments) != 0 {
		t.Fatalf("lost progress or exposed stale content: %+v", payload)
	}
	diagnostic, _ := payload["diagnostic"].(map[string]any)
	if diagnostic["phase"] != "protocol" || diagnostic["method"] != "DOMSnapshot.captureSnapshot" || diagnostic["code"] != float64(-32000) || diagnostic["message"] != nil {
		t.Fatalf("diagnostic lost or leaked: %+v", payload)
	}
	actions := payload["completed_actions"].([]string)
	if len(actions) != 2 || actions[1] != "pointer_click" {
		t.Fatalf("confirmed click lost: %+v", payload)
	}
}

func TestComputerScriptHelpAndStrictWaitPreserveEffects(t *testing.T) {
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		var input map[string]any
		_ = json.Unmarshal(c.Arguments, &input)
		if input["action"] == "wait" {
			return TargetToolResult{Result: map[string]any{"state": "timeout", "requested_state": "visible"}}, nil
		}
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.help('core'); await ui.type('hello'); await ui.ref('r').requireState({timeout_ms:0}); await ui.type('bad');")
	if err == nil || calls != 2 {
		t.Fatalf("calls=%d err=%v result=%+v", calls, err, result)
	}
	payload := result.Result.(map[string]any)
	if payload["script_error"] != "CONDITION_TIMEOUT" || payload["action_executed"] != true || !strings.Contains(fmt.Sprint(payload["logs"]), "ui.snapshot") {
		t.Fatalf("lost help or prefix: %+v", payload)
	}
	result, err = executeTestScript(t.Context(), runtime, call, "await ui.type('hello'); await ui.help('unknown');")
	if err == nil || result.Result.(map[string]any)["action_executed"] != true {
		t.Fatalf("help failure lost effects: %+v %v", result, err)
	}
}

func TestComputerScriptCompactSnapshotAndNativeCapability(t *testing.T) {
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{Result: map[string]any{"observation": map[string]any{"semantic_schema_version": 2, "document_id": "d", "nodes": []any{semanticFixtureNode("r", "AXButton", "Apply")}, "truncated": false}}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot();")
	if err != nil {
		t.Fatal(err)
	}
	node := result.Result.(map[string]any)["observation"].(map[string]any)["nodes"].([]any)[0].(map[string]any)
	if node["role"] != "button" || node["canonical_role"] != nil || node["platform_role"] != nil {
		t.Fatalf("noncompact node: %+v", node)
	}
	// The locked execution path must also reject browser-only operations.
	raw, _ := json.Marshal(map[string]any{"action": "table", "selector": map[string]any{"ref": "r"}})
	call.ToolName = "computer.action"
	call.Arguments = raw
	_, err = runtime.ExecuteTargetTool(t.Context(), call)
	if err == nil || calls != 1 {
		t.Fatalf("native table dispatched: %d %v", calls, err)
	}
}

func TestComputerScriptReferenceDiagnosticReportsContextReset(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"observation": map[string]any{"semantic_schema_version": 2, "document_id": "fixture:1", "nodes": []any{}, "truncated": false}}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, "globalThis.pages=[1,2,3];\nawait ui.observe();\nsetTimeout(()=>{},1)")
	if err == nil {
		t.Fatal("expected reference rejection")
	}
	payload := result.Result.(map[string]any)
	diagnostic, _ := payload["diagnostic"].(map[string]any)
	if payload["context_reset"] != true || diagnostic["line"] != 3 || diagnostic["symbol"] != "setTimeout" {
		t.Fatalf("missing recovery facts: %#v", payload)
	}
	next, err := executeTestScript(t.Context(), runtime, call, "ui.assert(typeof pages==='undefined')")
	if err != nil || next.Result.(map[string]any)["completed"] != true {
		t.Fatalf("lost data: %#v %v", next, err)
	}
}

func TestComputerCompactObservationBoundsAndDetailedReads(t *testing.T) {
	nodes := []any{}
	for i := 0; i < 450; i++ {
		node := semanticFixtureNode(fmt.Sprintf("r%016x", i), "cell", fmt.Sprintf("Value %d", i))
		node["frame_id"] = "internal-frame"
		node["bounds"] = map[string]any{"x": 1, "y": 2, "width": 30, "height": 40}
		nodes = append(nodes, node)
	}
	tree := map[string]any{"document_id": "fixture:1", "nodes": nodes, "truncated": false, "total": 450}
	var output computerObservationOutput
	compact := output.render(tree, "all", false).(map[string]any)
	body, _ := json.Marshal(compact)
	if len(body) > 32768 || compact["detail"] != "compact" || strings.Contains(string(body), "internal-frame") {
		t.Fatalf("invalid compact output: %d bytes", len(body))
	}
	if len(compact["nodes"].([]any)) < 450 && compact["output_truncated"] != true {
		t.Fatal("undisclosed omitted nodes")
	}
	full := output.render(tree, "all", true).(map[string]any)
	if len(full["nodes"].([]any)) != 450 || full["nodes"].([]any)[0].(map[string]any)["bounds"] == nil {
		t.Fatal("detailed read lost facts")
	}
	if nodes[0].(map[string]any)["bounds"] == nil {
		t.Fatal("projection mutated authority")
	}
	t.Logf("450-node compact observation: %d bytes", len(body))
}

func TestComputerScriptFailureDiscardsDormantPromise(t *testing.T) {
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{Result: map[string]any{"observation": map[string]any{"semantic_schema_version": 2, "document_id": "fixture:1", "nodes": []any{}, "truncated": false}}}, nil
	})
	result, err := executeTestScript(t.Context(), runtime, call, `globalThis.wake=undefined; new Promise(resolve=>{globalThis.wake=resolve}).then(()=>ui.click(1,2)); missingSymbol();`)
	if err == nil || result.Result.(map[string]any)["context_reset"] != true {
		t.Fatalf("failure retained namespace: %v %v", result, err)
	}
	_, err = executeTestScript(t.Context(), runtime, call, `ui.assert(typeof wake==='undefined'); await ui.observe();`)
	if err != nil || calls != 1 {
		t.Fatalf("dormant promise crossed invocation: calls=%d error=%v", calls, err)
	}
}

func TestComputerCompactObservationTruncationAndModeBoundary(t *testing.T) {
	nodes := []any{map[string]any{"ref": "root", "role": "table", "name": "Data", "child_refs": []any{}, "states": map[string]any{}}}
	for i := 0; i < 250; i++ {
		ref := fmt.Sprintf("r%016x", i)
		node := semanticFixtureNode(ref, "cell", strings.Repeat("content", 50))
		node["parent_ref"] = "root"
		nodes = append(nodes, node)
		nodes[0].(map[string]any)["child_refs"] = append(nodes[0].(map[string]any)["child_refs"].([]any), ref)
	}
	tree := map[string]any{"document_id": "fixture:1", "nodes": nodes, "truncated": false, "focus_ref": "r00000000000000f9"}
	var output computerObservationOutput
	compact := output.render(tree, "all", false).(map[string]any)
	body, _ := json.Marshal(compact)
	if len(body) > 32768 || compact["output_truncated"] != true || compact["focus_ref"] != nil || compact["nodes"].([]any)[0].(map[string]any)["children_truncated"] != true {
		t.Fatalf("invalid truncated projection: %d bytes", len(body))
	}
	for _, raw := range compact["nodes"].([]any)[1:] {
		if raw.(map[string]any)["parent_ref"] != "root" {
			t.Fatal("lost parent")
		}
	}
	small := map[string]any{"document_id": "fixture:1", "nodes": nodes[:1], "truncated": false}
	output.render(small, "all", true)
	if next := output.render(small, "all", false).(map[string]any); next["format"] != "full" {
		t.Fatalf("detail switch reused diff baseline: %#v", next)
	}
}

func TestComputerScriptNativeScrollUsesCoordinateRoute(t *testing.T) {
	var tool string
	var args map[string]any
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		tool = inner.ToolName
		_ = json.Unmarshal(inner.Arguments, &args)
		return TargetToolResult{Result: map[string]any{}}, nil
	})
	_, err := executeTestScript(t.Context(), rt, call, "await ui.scroll(539);")
	if err != nil {
		t.Fatal(err)
	}
	if tool != "computer.scroll" || args["selector"] != nil {
		t.Fatalf("unexpected routing: %s %#v", tool, args)
	}
	t.Logf("documented ui.scroll dispatches %s without selector: %#v", tool, args)
}
func TestComputerScriptScreenshotInvalidationPreservesRecoveryFacts(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{TargetID: inner.TargetID, Result: map[string]any{"observation_invalidated": true, "action_executed": false}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToCapture: false, SafeToSendToModel: false}}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "await ui.screenshot();")
	p := result.Result.(map[string]any)
	if err == nil || p["completed"] != false || p["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" || p["observation_invalidated"] != true || p["needs_observation"] != true {
		t.Fatalf("unexpected: %#v %v", p, err)
	}
}
func TestComputerScriptUnknownEffectPreservesExplicitPrefixLog(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{}, errComputerEffectUnknown
	})
	result, err := executeTestScript(t.Context(), rt, call, "log('completed-safe-read'); await ui.click(1,2);")
	p := result.Result.(map[string]any)
	if !errors.Is(err, errComputerEffectUnknown) || p["logs"] == nil {
		t.Fatalf("unexpected: %#v %v", p, err)
	}
}

func TestComputerScriptScreenshotInvalidationRejectsInconsistentFrames(t *testing.T) {
	for _, kind := range []string{"wrong_target", "unexpected_bytes", "capture_allowed", "missing_safety"} {
		t.Run(kind, func(t *testing.T) {
			rt, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				result := TargetToolResult{TargetID: inner.TargetID, Result: map[string]any{"observation_invalidated": true}, Safety: &InteractionSafetyDecision{Level: "routine"}}
				switch kind {
				case "wrong_target":
					result.TargetID = "other"
				case "unexpected_bytes":
					result.frameBytes = []byte("bad image")
				case "capture_allowed":
					result.Safety.SafeToCapture = true
				case "missing_safety":
					result.Safety = nil
				}
				return result, nil
			})
			result, err := executeTestScript(t.Context(), rt, call, "await ui.screenshot();")
			if err == nil || len(result.Attachments) != 0 {
				t.Fatalf("invalid frame accepted: %#v %v", result, err)
			}
		})
	}
}

func TestComputerScriptLogBudgetUsesWireUTF8Bytes(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) { return TargetToolResult{}, nil })
	result, err := executeTestScript(t.Context(), rt, call, "log('<>&中'.repeat(10000));")
	if err != nil {
		t.Fatal(err)
	}
	logs := result.Result.(map[string]any)["logs"].([]any)
	if len(logs) != 1 || len(logs[0].([]any)[0].(string)) != 60000 {
		t.Fatal("safe bounded UTF-8 log lost")
	}
}

func TestComputerScriptUnknownEffectWithTakeoverDiscardsContent(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{Result: map[string]any{"observation": map[string]any{"text": "private-observation"}}, Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"user_control"}}}, errComputerEffectUnknown
	})
	result, err := executeTestScript(t.Context(), rt, call, "log('private-prefix'); await ui.click(1,2);")
	payload := result.Result.(map[string]any)
	if !errors.Is(err, errComputerEffectUnknown) || payload["logs"] != nil || payload["observation"] != nil || len(result.Attachments) != 0 {
		t.Fatalf("takeover leaked output: %#v %v", result, err)
	}
}

func TestComputerNativeDragHelpDescribesTimingContract(t *testing.T) {
	for _, topic := range []string{"core", "visual"} {
		help, ok := computerScriptHelp(topic, false)
		if !ok {
			t.Fatalf("missing native %s help", topic)
		}
		for _, contract := range []string{"duration_ms", "integer 0..5000", "0 adds no delay", "overhead may extend", "window-local"} {
			if !strings.Contains(help, contract) {
				t.Errorf("native %s help omits %q", topic, contract)
			}
		}
	}
}

func TestComputerCompletedWaitSurvivesLaterGuestError(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{Result: map[string]any{"state": "visible", "requested_state": "visible"}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, "await ui.ref('r').requireState({state:'visible',timeout_ms:0}); const missing=undefined; log(missing.value);")
	if err == nil || calls != 1 {
		t.Fatalf("expected one completed wait followed by guest error: %v %d", err, calls)
	}
	payload := result.Result.(map[string]any)
	actions := payload["completed_actions"].([]string)
	if len(actions) != 1 || actions[0] != "wait" || payload["completed"] != false || payload["script_error"] != "SCRIPT_TYPE_ERROR" {
		t.Fatalf("completed wait was erased: %+v", payload)
	}
}

func TestComputerPausedScriptRetainsPartialInputReceipt(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{Result: map[string]any{"action_executed": false, "input_progress": map[string]any{"stage": "input_delivery", "posted": float64(3), "observed": float64(3), "expected": float64(10), "private": "hidden"}}, Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"target_focus_changed"}}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, "await ui.drag(10,20,30,40,500); await ui.key('Enter');")
	if err != nil || calls != 1 || result.Safety == nil {
		t.Fatalf("pause contract: %+v %v", result, err)
	}
	payload := result.Result.(map[string]any)
	progress, ok := payload["input_progress"].(map[string]any)
	if !ok || progress["posted"] != int64(3) || progress["observed"] != int64(3) || progress["expected"] != int64(10) || progress["private"] != nil {
		t.Fatalf("partial input lost or leaked: %+v", payload)
	}
	execution, _ := computerBlockedExecution(call, TargetDescriptor{ID: call.TargetID}, *result.Safety, result)
	blocked := execution.Payload.(map[string]any)
	blockedProgress, _ := blocked["input_progress"].(map[string]any)
	if blockedProgress["posted"] != int64(3) || blockedProgress["observed"] != int64(3) || blockedProgress["expected"] != int64(10) || blockedProgress["private"] != nil {
		t.Fatal("model output lost or leaked partial input receipt")
	}
	if len(payload["completed_actions"].([]string)) != 0 {
		t.Fatal("partial input reported as completed drag")
	}
}
