package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestComputerPreparedClickDoesNotEnterCompletedActions(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		return computerObservationFailure(c, map[string]any{
			"action_executed": false, "preparation_executed": true, "observation_stage": "hit_test",
			"diagnostic": map[string]any{"phase": "evaluation", "method": "Runtime.callFunctionOn", "reason": "exception", "checkpoint": "target_ancestry"},
		}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.getByRole('link',{name:'Report'}).click(); log('unreachable');`)
	if err == nil {
		t.Fatal("expected interrupted hit test")
	}
	facts := result.Result.(map[string]any)
	if facts["action_executed"] != false || facts["preparation_executed"] != true || facts["needs_observation"] != true || len(facts["completed_actions"].([]string)) != 0 {
		t.Fatalf("fabricated click: %+v", facts)
	}
	if computerActivityFailurePhase(facts) != "prepared" || facts["diagnostic"].(map[string]any)["checkpoint"] != "target_ancestry" {
		t.Fatalf("lost phase: %+v", facts)
	}
}

func TestComputerFailedOperationPhaseDoesNotUseCompletedPrefix(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		var args map[string]any
		if err := json.Unmarshal(c.Arguments, &args); err != nil {
			t.Fatal(err)
		}
		if args["action"] == "key" {
			return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"action_executed": true}}, nil
		}
		return computerObservationFailure(c, map[string]any{
			"action_executed": false, "preparation_executed": true, "observation_stage": "hit_test",
		}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, `await ui.key('Escape'); await ui.getByRole('link',{name:'Report'}).click();`)
	if err == nil {
		t.Fatal("expected interrupted click")
	}
	facts := result.Result.(map[string]any)
	if facts["action_executed"] != true || !reflect.DeepEqual(facts["completed_actions"], []string{"key"}) || computerActivityFailurePhase(facts) != "prepared" {
		t.Fatalf("completed prefix hid failed operation: %+v", facts)
	}
}

func TestComputerNavigationTimeoutDataKeepsNamespaceAndExplicitRead(t *testing.T) {
	var calls []string
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls = append(calls, c.ToolName)
		if c.ToolName == "browser_navigate" {
			var args map[string]any
			if err := json.Unmarshal(c.Arguments, &args); err != nil {
				t.Fatal(err)
			}
			if args["wait_until"] != "domcontentloaded" || args["timeout_ms"] != float64(0) {
				t.Fatalf("options lost: %+v", args)
			}
			return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"command_acknowledged": true, "action_executed": true, "needs_observation": true, "observation_invalidated": true, "wait": map[string]any{"state": "timeout"}}}, nil
		}
		return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"observation": semanticTestTree()}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToCapture: true, SafeToSendToModel: true}}, nil
	})
	target, err := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
	if err != nil {
		t.Fatal(err)
	}
	target.Kind = "browser.connected"
	if err = runtime.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	result, err := executeTestScript(t.Context(), runtime, call, `globalThis.saved=42;const r=await browser.navigate('https://fixture.test',{wait_until:'domcontentloaded',timeout_ms:0});if(r.wait.state==='timeout')await ui.snapshot();log(saved);`)
	if err != nil {
		t.Fatal(err)
	}
	facts := result.Result.(map[string]any)
	if facts["context_reset"] != false || facts["completed"] != true || !reflect.DeepEqual(calls, []string{"browser_navigate", "computer_observe"}) {
		t.Fatalf("sealed timeout data: %+v %v", facts, calls)
	}
	result, err = executeTestScript(t.Context(), runtime, call, `log(saved);`)
	if err != nil || !reflect.DeepEqual(result.Result.(map[string]any)["logs"], []any{[]any{float64(42)}}) {
		t.Fatalf("lost namespace: %+v %v", result, err)
	}
}

func TestComputerDiagnosticCheckpointIsClosedAndPartialInputIsNotCompletion(t *testing.T) {
	for _, checkpoint := range []string{"target_ancestry", "private page content"} {
		d := computerOperationDiagnostic(map[string]any{"phase": "evaluation", "method": "Runtime.callFunctionOn", "reason": "exception", "checkpoint": checkpoint})
		if (d["checkpoint"] != nil) != (checkpoint == "target_ancestry") {
			t.Fatalf("unsafe checkpoint: %+v", d)
		}
	}
	if got := computerActivityFailurePhase(map[string]any{"action_executed": false, "preparation_executed": true, "input_progress": map[string]any{"observed": float64(1), "posted": float64(1)}}); got != "partial_input" {
		t.Fatal(got)
	}
	if got := computerActivityFailurePhase(map[string]any{"action_executed": true, "input_progress": map[string]any{"observed": float64(3), "posted": float64(3)}}); got != "effect_confirmed" {
		t.Fatalf("completed input mislabeled partial: %s", got)
	}
}
