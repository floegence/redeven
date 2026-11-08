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
	for _, tool := range []string{"browser_navigate", "computer_click", "computer_observe"} {
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

func TestComputerEvaluationDiagnosticRetainsOnlyClosedFacts(t *testing.T) {
	for _, method := range []string{"Runtime.evaluate", "Runtime.callFunctionOn"} {
		for _, reason := range []string{"exception", "invalid_result"} {
			want := map[string]any{"phase": "evaluation", "method": method, "reason": reason}
			raw := map[string]any{"phase": "evaluation", "method": method, "reason": reason, "code": -32000, "message": "private content", "exceptionDetails": "private stack"}
			if got := computerOperationDiagnostic(raw); !reflect.DeepEqual(got, want) {
				t.Fatalf("invalid evaluation diagnostic: %+v", got)
			}
			for _, field := range []string{"method", "reason"} {
				invalid := cloneAnyMap(raw)
				invalid[field] = "private content"
				if computerOperationDiagnostic(invalid) != nil {
					t.Fatal("accepted unbounded evaluation diagnostic")
				}
			}
		}
	}
}

func TestComputerScriptEvaluationFailureKeepsConfirmedPrefix(t *testing.T) {
	for _, stage := range []string{"frame_inventory", "safety_scan", "semantic_read", "capture", "metadata", "hit_test"} {
		t.Run(stage, func(t *testing.T) {
			calls := 0
			want := map[string]any{"phase": "evaluation", "method": "Runtime.evaluate", "reason": "exception"}
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				calls++
				if calls == 1 {
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed")}}, nil
				}
				return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": stage, "diagnostic": map[string]any{"phase": "evaluation", "method": "Runtime.evaluate", "reason": "exception", "message": "private"}}, "fixture")
			})
			result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({emit:false}); log('confirmed'); try { await ui.snapshot(); } catch {} await ui.click(1,2);")
			p := result.Result.(map[string]any)
			if err == nil || calls != 2 || p["completed"] != false || p["context_reset"] != true || p["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" || !reflect.DeepEqual(p["diagnostic"], want) || !reflect.DeepEqual(p["completed_actions"], []string{"snapshot"}) || !reflect.DeepEqual(p["logs"], []any{[]any{"confirmed"}}) {
				t.Fatalf("evaluation failure lost facts or continued: %+v %v calls=%d", p, err, calls)
			}
		})
	}
}

func TestComputerAdapterDiagnosticSurvivesScriptFailure(t *testing.T) {
	for _, method := range []string{"DOMSnapshot.captureSnapshot", "safety_scan", "semantic_read"} {
		for _, reason := range []string{"invalid_result", "internal_error"} {
			want := map[string]any{"phase": "adapter", "method": method, "reason": reason}
			raw := cloneAnyMap(want)
			raw["message"], raw["stack"], raw["code"] = "private page", "private stack", -32000
			if got := computerOperationDiagnostic(raw); !reflect.DeepEqual(got, want) {
				t.Fatalf("diagnostic changed: %+v", got)
			}
			for _, field := range []string{"method", "reason"} {
				invalid := cloneAnyMap(raw)
				invalid[field] = "private page"
				if computerOperationDiagnostic(invalid) != nil {
					t.Fatal("unbounded diagnostic accepted")
				}
			}
			calls := 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				calls++
				if calls == 1 {
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("confirmed")}}, nil
				}
				return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "safety_scan", "diagnostic": raw}, "fixture")
			})
			result, err := executeTestScript(t.Context(), runtime, call, "await ui.snapshot({emit:false}); log('confirmed'); try { await ui.snapshot(); } catch {} await ui.key('Enter');")
			payload := result.Result.(map[string]any)
			if err == nil || calls != 2 || !reflect.DeepEqual(payload["diagnostic"], want) || payload["context_reset"] != true || !reflect.DeepEqual(payload["logs"], []any{[]any{"confirmed"}}) {
				t.Fatalf("failure boundary lost: %+v %v calls=%d", payload, err, calls)
			}
		}
	}
}

func TestComputerAdapterReasonAppearsInActivityWithoutPrivateData(t *testing.T) {
	payload := map[string]any{"diagnostic": map[string]any{"phase": "adapter", "method": "safety_scan", "reason": "internal_error", "message": "private page"}}
	body, err := json.Marshal(computerActivityResultRows("computer_exec", payload))
	if err != nil || !strings.Contains(string(body), "internal_error") || strings.Contains(string(body), "private page") {
		t.Fatalf("activity diagnostic changed: %s %v", body, err)
	}
}

func TestComputerBranchableSnapshotInvalidation(t *testing.T) {
	for _, mode := range []string{"invalidated", "protocol", "privacy", "effect", "preparation", "input", "permission", "candidate", "cancellation"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				calls++
				if calls > 1 {
					return TargetToolResult{Result: map[string]any{"observation": semanticFixtureText("Recovered")}}, nil
				}
				if mode == "privacy" {
					return TargetToolResult{Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"secret_input"}}}, nil
				}
				if mode == "protocol" {
					return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "semantic_read", "diagnostic": map[string]any{"phase": "protocol", "method": "Runtime.evaluate"}}, "fixture")
				}
				facts := map[string]any{"observation_invalidated": true, "action_executed": mode == "effect", "preparation_executed": mode == "preparation", "reason": "document_changed", "observation_stage": "semantic_read"}
				if mode == "cancellation" {
					cancel()
				}
				if mode == "candidate" {
					facts["reason"] = "candidate_changed"
				}
				if mode == "input" {
					facts["input_progress"] = map[string]any{"stage": "input_delivery", "posted": float64(1), "observed": float64(1), "expected": float64(2)}
				}
				return TargetToolResult{Result: facts}, nil
			})
			if mode == "permission" {
				call.revalidate = func(context.Context) error {
					if calls > 0 {
						return errors.New("revoked")
					}
					return nil
				}
			}
			result, err := executeTestScript(ctx, runtime, call, "globalThis.saved=41; const read=await ui.snapshot({on_invalidated:'return'}); if(read.status==='invalidated'){log(read); await ui.snapshot();} saved++;")
			p := result.Result.(map[string]any)
			if mode == "invalidated" {
				if err != nil || calls != 2 || p["context_reset"] != false || p["completed"] != true {
					t.Fatalf("branch failed: %+v %v calls=%d", p, err, calls)
				}
				if !reflect.DeepEqual(p["completed_actions"], []string{"snapshot"}) {
					t.Fatalf("invalid read counted as complete: %+v", p)
				}
				_, err = executeTestScript(t.Context(), runtime, call, "ui.assert(saved===42);")
				if err != nil {
					t.Fatal(err)
				}
			} else if calls != 1 || p["context_reset"] != true {
				t.Fatalf("unsafe continuation: %+v %v calls=%d", p, err, calls)
			}
			if mode == "candidate" && p["reason"] != "candidate_changed" {
				t.Fatalf("candidate loss mislabeled: %+v", p)
			}
		})
	}
}

func TestComputerScriptCompilationErrorKeepsNamespace(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		t.Fatal("must not dispatch")
		return TargetToolResult{}, nil
	})
	_, err := executeTestScript(t.Context(), runtime, call, "globalThis.saved={count:7};")
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"const invalid = ;"} {
		result, err := executeTestScript(t.Context(), runtime, call, code)
		if err == nil || result.Result.(map[string]any)["context_reset"] != false {
			t.Fatalf("healthy local error retired VM: %+v %v", result, err)
		}
		_, err = executeTestScript(t.Context(), runtime, call, "ui.assert(saved.count===7);")
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestComputerActionabilityFinalOutput(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		result, err, _ := computerBrowserFailure(inner, false, "ELEMENT_NOT_ACTIONABLE", map[string]any{"action_executed": false, "actionability": map[string]any{"stage": "precondition", "connected": true, "visible": true, "enabled": false, "node_type": float64(1), "bounds": []any{float64(2), float64(3), float64(20), float64(10)}, "tested_point": map[string]any{"x": float64(30), "y": float64(40)}, "viewport": map[string]any{"clientWidth": float64(800), "clientHeight": float64(600)}, "preparation": map[string]any{"scroll_into_view": false, "stability_timeout_ms": float64(0)}, "layout_stable": false, "failed_checks": []any{"layout_stable", "private_text"}, "previous_quads": []any{[]any{float64(1), float64(2), float64(3), float64(4), float64(5), float64(6), float64(7), float64(8)}}, "current_quads": []any{[]any{float64(2), float64(2), float64(3), float64(4), float64(5), float64(6), float64(7), float64(8)}}, "sample_interval_ms": float64(32), "private_text": "must stay private"}}, "fixture")
		return result, err
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.getByRole('button',{name:'Disabled'}).click();")
	if err == nil {
		t.Fatal("disabled click accepted")
	}
	facts, _ := result.Result.(map[string]any)["actionability"].(map[string]any)
	if facts["enabled"] != false || facts["stage"] != "precondition" || facts["private_text"] != nil || len(toAnySlice(facts["bounds"])) != 4 || facts["tested_point"] == nil || facts["preparation"] == nil || facts["layout_stable"] != false || len(toAnySlice(facts["previous_quads"])) != 1 || facts["sample_interval_ms"] != float64(32) || !reflect.DeepEqual(toAnySlice(facts["failed_checks"]), []any{"layout_stable"}) {
		t.Fatalf("actionability facts lost or leaked: %#v", facts)
	}
}

func TestComputerExplicitInvalidationCoversReadonlyLocators(t *testing.T) {
	for _, expression := range []string{
		"ui.getByRole('main').text({on_invalidated:'return'})",
		"ui.getByRole('main').node({on_invalidated:'return'})",
		"ui.getByRole('main').read({on_invalidated:'return'})",
		"ui.getByRole('main').snapshot({on_invalidated:'return'})",
		"ui.getByRole('main').source({on_invalidated:'return'})",
		"ui.getByRole('main').geometry({on_invalidated:'return'})",
		"ui.getByRole('main').query({on_invalidated:'return'})",
		"ui.getByRole('main').count({on_invalidated:'return'})",
		"ui.getByRole('table').rows({on_invalidated:'return'})",
		"ui.getByRole('main').selection({on_invalidated:'return'})",
		"ui.getByRole('link').attribute('title',{on_invalidated:'return'})",
		"ui.getByRole('link').getAttribute('href',{on_invalidated:'return'})",
		"ui.screenshot({on_invalidated:'return'})",
	} {
		t.Run(expression, func(t *testing.T) {
			calls := 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				calls++
				if strings.Contains(string(c.Arguments), "on_invalidated") {
					t.Fatal("guest option leaked to adapter")
				}
				return TargetToolResult{Result: map[string]any{"action_executed": false, "observation_invalidated": true, "reason": "document_changed", "observation_stage": "semantic_read"}}, nil
			})
			target, err := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Kind, target.Ready, target.State = "browser.connected", true, "ready"
			if err = runtime.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			result, err := executeTestScript(t.Context(), runtime, call, "globalThis.saved=42;const result=await "+expression+";ui.assert(result.status==='invalidated');ui.assert(result.text===undefined);log(result);")
			payload := result.Result.(map[string]any)
			if err != nil || calls != 1 || payload["context_reset"] != false || payload["completed"] != true {
				t.Fatalf("explicit data contract: %+v %v calls=%d", payload, err, calls)
			}
			if _, err = executeTestScript(t.Context(), runtime, call, "ui.assert(saved===42)"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestComputerInvalidatedWaitPreservesDeadlineFacts(t *testing.T) {
	want := map[string]any{"requested_state": "visible", "timeout_ms": float64(20), "elapsed_ms": float64(24), "samples": float64(2)}
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "safety_scan", "observation_invalidated": true, "reason": "document_changed", "wait": want}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.getByRole('button').waitFor({timeout_ms:20});")
	payload := result.Result.(map[string]any)
	if err == nil || !reflect.DeepEqual(payload["wait"], want) || payload["observation_stage"] != "safety_scan" {
		t.Fatalf("lost deadline facts: %+v %v", payload, err)
	}
	for _, key := range []string{"requested_state", "timeout_ms", "elapsed_ms", "samples"} {
		invalid := cloneAnyMap(want)
		invalid[key] = "private content"
		if computerWaitFacts(invalid) != nil {
			t.Fatalf("accepted invalid %s", key)
		}
	}
}

func TestComputerActionabilityProjectionIsIdempotent(t *testing.T) {
	raw := map[string]any{"stage": "hit_or_layout", "receives": false, "layout_stable": true, "failed_checks": []any{"receives", "private_text"}}
	first := computerActionabilityFacts(raw)
	second := computerActionabilityFacts(first)
	if !reflect.DeepEqual(first, second) || len(toAnySlice(second["failed_checks"])) != 1 {
		t.Fatalf("actionability projection changed facts: first=%#v second=%#v", first, second)
	}
}

func TestComputerUnretainedReferencePreservesFinalReason(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
		return computerObservationFailure(inner, map[string]any{"action_executed": false, "observation_stage": "semantic_read", "reason": "reference_not_retained"}, "fixture")
	})
	result, err := executeTestScript(t.Context(), runtime, call, "await ui.ref('unretained').click();")
	facts := result.Result.(map[string]any)
	if err == nil || facts["reason"] != "reference_not_retained" || facts["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" || facts["failed_operation_phase"] != "not_dispatched" || len(toAnySlice(facts["completed_actions"])) != 0 || facts["context_reset"] != true {
		t.Fatalf("unretained reference lost its factual boundary: %+v %v", result, err)
	}
}

func TestComputerScriptErrorCodesPreserveActionAndArgumentCauses(t *testing.T) {
	for cause, expected := range map[string]string{"ELEMENT_NOT_ACTIONABLE": "ELEMENT_NOT_ACTIONABLE", "SCRIPT_ARGUMENT_ERROR": "INVALID_ARGUMENTS"} {
		if got := string(computerScriptErrorCode(cause)); got != expected {
			t.Fatalf("%s projected as %s, want %s", cause, got, expected)
		}
	}
}
