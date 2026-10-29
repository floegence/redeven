package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestComputerScriptConfirmedLogsSurviveLaterReadFailure(t *testing.T) {
	for _, stage := range []string{"semantic_read", "safety_scan", "capture", "metadata", "invalidated"} {
		t.Run(stage, func(t *testing.T) {
			calls := 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				calls++
				if calls == 1 {
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed content")}}, nil
				}
				if stage == "invalidated" {
					return TargetToolResult{Result: map[string]any{"observation_invalidated": true}}, nil
				}
				return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": stage, "observation": "unverified content"}, "fixture")
			})
			result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({emit:false}); log('confirmed content'); try { await ui.snapshot(); } catch { log('after failure'); } await ui.click(3,4);")
			p := result.Result.(map[string]any)
			if err == nil || calls != 2 || p["completed"] != false || p["context_reset"] != true || p["needs_observation"] != true {
				t.Fatalf("failure boundary changed: calls=%d result=%+v err=%v", calls, p, err)
			}
			if !reflect.DeepEqual(p["logs"], []any{[]any{"confirmed content"}}) || p["observation"] != nil || len(result.Attachments) != 0 {
				t.Fatalf("confirmed output lost or invalid observation retained: %+v", result)
			}
			body, _ := json.Marshal(result)
			if strings.Contains(string(body), "unverified content") || strings.Contains(string(body), "after failure") {
				t.Fatal("unconfirmed output crossed the failure boundary")
			}
		})
	}
}

func TestComputerBrowserExchangeFailureRetainsOnlyKnownBoundary(t *testing.T) {
	for _, tool := range []string{"browser.navigate", "computer.click", "computer.observe"} {
		for _, private := range []bool{false, true} {
			call := TargetToolCall{TargetID: "target", ToolName: tool}
			result, err, valid := computerBrowserFailure(call, private, "untrusted reply", map[string]any{"observation": "private content"}, "fixture")
			unknown := !private && computerCallMutates(call)
			if !valid || errors.Is(err, errComputerEffectUnknown) != unknown {
				t.Fatalf("effect classification changed: %s private=%v err=%v", tool, private, err)
			}
			if unknown {
				want := map[string]any{"stage": "helper_exchange", "reason": "response_unavailable", "needs_observation": true}
				if !reflect.DeepEqual(result.Result, want) {
					t.Fatalf("lost known exchange boundary: %+v", result)
				}
			} else if result.Result != nil {
				t.Fatalf("invented dispatch facts: %+v", result)
			}
		}
	}
}

func TestComputerProtocolDiagnosticMethodDoesNotRequireCode(t *testing.T) {
	want := map[string]any{"phase": "protocol", "method": "Runtime.evaluate"}
	for _, raw := range []map[string]any{
		{"phase": "protocol", "method": "Runtime.evaluate"},
		{"phase": "protocol", "method": "Runtime.evaluate", "message": "private content"},
	} {
		if got := computerOperationDiagnostic(raw); !reflect.DeepEqual(got, want) {
			t.Fatalf("known method lost: %#v", got)
		}
	}
}

func TestComputerScriptExchangeFailureRetainsConfirmedOutputAndBoundary(t *testing.T) {
	calls := 0
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		calls++
		if calls == 1 {
			return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed content")}}, nil
		}
		return computerBrowserExchangeFailure(inner, false, errors.New("private transport error"))
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({emit:false}); log('confirmed content'); await ui.click(1,2); await ui.click(3,4);")
	p := result.Result.(map[string]any)
	if !errors.Is(err, errComputerEffectUnknown) || calls != 2 || p["stage"] != "helper_exchange" || p["reason"] != "response_unavailable" || p["effect_outcome_unknown"] != true || p["completed"] != false {
		t.Fatalf("unknown exchange lost its boundary: %+v %v calls=%d", p, err, calls)
	}
	if !reflect.DeepEqual(p["logs"], []any{[]any{"confirmed content"}}) || !reflect.DeepEqual(p["completed_actions"], []string{"snapshot"}) {
		t.Fatalf("incorrect confirmed prefix: %+v", p)
	}
}

func TestComputerScriptProtocolMethodSurvivesWithoutCode(t *testing.T) {
	calls := 0
	want := map[string]any{"phase": "protocol", "method": "Runtime.evaluate"}
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		calls++
		return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "semantic_read", "diagnostic": map[string]any{"phase": "protocol", "method": "Runtime.evaluate", "message": "private page text"}}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot(); await ui.click(1,2);")
	p := result.Result.(map[string]any)
	if err == nil || calls != 1 || !reflect.DeepEqual(p["diagnostic"], want) || p["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" {
		t.Fatalf("lost method-only failure: %+v %v calls=%d", p, err, calls)
	}
}
