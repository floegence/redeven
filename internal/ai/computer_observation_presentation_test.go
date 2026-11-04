package ai

import (
	"context"
	"fmt"
	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"reflect"
	"strings"
	"testing"
)

func TestComputerObservationPresentationPreservesDiagnosis(t *testing.T) {
	for _, code := range []string{"TARGET_OBSERVATION_UNAVAILABLE", "SCRIPT_ARGUMENT_ERROR", "EFFECT_OUTCOME_UNKNOWN"} {
		t.Run(code, func(t *testing.T) {
			activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.exec", Status: toolResultStatusError,
				Error: &aitools.ToolError{Code: aitools.ErrorCode(code), Message: "Computer script stopped before completion"}, Data: map[string]any{"action_executed": true, "observation_status": "not_observed"}})
			if err != nil {
				t.Fatal(err)
			}
			payload := activity.Payload.(fltools.StructuredActivityPayload)
			if payload.Error == nil || payload.Error.Code != code {
				t.Fatalf("lost diagnostic: %#v", payload.Error)
			}
			projected := activityPayloadActivityErrorMap(*payload.Error)
			if projected["code"] != code {
				t.Fatalf("lost public diagnostic: %#v", projected)
			}
			unavailable := false
			for _, chip := range activity.Chips {
				if chip.Kind == "computer_observation" && chip.Value == "unavailable" {
					unavailable = true
				}
			}
			if unavailable != (code == "TARGET_OBSERVATION_UNAVAILABLE") {
				t.Fatalf("incorrect observation classification: %#v", activity.Chips)
			}
		})
	}
}

func TestComputerScriptNavigationReceiptAndReadFailureKeepIndependentOutcomes(t *testing.T) {
	for _, failedRead := range []bool{false, true} {
		t.Run(fmt.Sprint(failedRead), func(t *testing.T) {
			navigations, reads, inputs := 0, 0, 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				if c.ToolName == "browser.navigate" {
					navigations++
					return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"navigation_stage": "load", "action_executed": true, "needs_observation": true, "observation_invalidated": true}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
				}
				if c.ToolName == "computer.observe" {
					reads++
					return computerObservationFailure(c, map[string]any{"action_executed": false, "observation_stage": "safety_scan"}, "fixture")
				}
				inputs++
				return TargetToolResult{}, nil
			})
			target, err := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Kind, target.Ready, target.State = "browser.connected", true, "ready"
			if err := runtime.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			code := "const receipt=await browser.navigate('https://example.test'); log(receipt.navigation_stage);"
			if failedRead {
				code += "await ui.snapshot(); await ui.key('Enter');"
			}
			result, err := executeTestScript(t.Context(), runtime, call, code)
			payload := result.Result.(map[string]any)
			if (err != nil) != failedRead || payload["completed"] != !failedRead || navigations != 1 || inputs != 0 || reads != map[bool]int{false: 0, true: 1}[failedRead] {
				t.Fatalf("incorrect execution: %+v error=%v nav=%d reads=%d input=%d", result, err, navigations, reads, inputs)
			}
			if payload["action_executed"] != true || payload["needs_observation"] != true || payload["observation"] != nil || !reflect.DeepEqual(payload["completed_actions"], []string{"navigate"}) {
				t.Fatalf("receipt lost or observation fabricated: %+v", payload)
			}
			if failedRead && payload["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" {
				t.Fatalf("read error lost: %+v", payload)
			}
		})
	}
}

func TestComputerScriptInputReceiptRetainsFactsAndIndependentRead(t *testing.T) {
	for _, mode := range []string{"receipt", "fresh_read", "failed_read"} {
		t.Run(mode, func(t *testing.T) {
			inputs, reads := 0, 0
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				if c.ToolName == "computer.observe" {
					reads++
					if mode == "failed_read" {
						return computerObservationFailure(c, map[string]any{"action_executed": false, "observation_stage": "safety_scan"}, "fixture")
					}
					return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"observation": semanticTestTree()}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToCapture: true, SafeToSendToModel: true}}, nil
				}
				inputs++
				return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"action_executed": true, "needs_observation": true, "observation_invalidated": true, "post_action_check": map[string]any{"state": "unavailable", "diagnostic": map[string]any{"phase": "protocol", "method": "Runtime.evaluate"}}}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
			})
			target, err := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Kind, target.Ready, target.State = "browser.connected", true, "ready"
			if err = runtime.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			code := "const r=await ui.key('ArrowDown'); log(r.post_action_check);"
			if mode != "receipt" {
				code += "await ui.snapshot();"
			}
			result, err := executeTestScript(t.Context(), runtime, call, code)
			payload := result.Result.(map[string]any)
			if (err != nil) != (mode == "failed_read") || inputs != 1 || payload["completed"] != (mode != "failed_read") {
				t.Fatalf("receipt/read outcome: %+v error=%v inputs=%d", payload, err, inputs)
			}
			if (reads > 0) != (mode != "receipt") || payload["needs_observation"] != (mode != "fresh_read") {
				t.Fatalf("read state: %+v reads=%d", payload, reads)
			}
			if !strings.Contains(fmt.Sprint(payload["logs"]), "Runtime.evaluate") {
				t.Fatalf("lost receipt diagnostic: %+v", payload)
			}
			if mode == "fresh_read" {
				observation := payload["observation"].(map[string]any)
				if observation["read_options"] == nil {
					t.Fatalf("lost read options: %+v", observation)
				}
			}
		})
	}
}

func TestComputerBudgetPresentationRetainsCanonicalFailure(t *testing.T) {
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolID: "budget", ToolName: "computer.exec", Status: toolResultStatusError, Error: &aitools.ToolError{Code: "TIMEOUT", Message: "Time limit reached"}, Data: map[string]any{"budget_exhausted": "time", "completed_actions": []string{"snapshot"}}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, chip := range activity.Chips {
		if chip.Kind == "computer_budget" && chip.Value == "time" {
			found = true
		}
	}
	if !found {
		t.Fatalf("budget fact absent: %+v", activity)
	}
}

func TestComputerNarrowReadHasSeparatePresentationFacts(t *testing.T) {
	runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"text": "Source fact", "truncated": false, "scope": "element", "source": "browser_dom", "property": "innerText", "document_id": "sample", "frame_id": "frame", "ref": "ref"}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToSendToModel: true, SafeToCapture: true}}, nil
	})
	target, err := runtime.registry.ResolveTarget(t.Context(), call.TargetID)
	if err != nil {
		t.Fatal(err)
	}
	target.Kind, target.Ready, target.State = "browser.connected", true, "ready"
	if err = runtime.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	result, err := executeTestScript(t.Context(), runtime, call, "const {text}=await ui.getByRole('main').text();log(text)")
	if err != nil {
		t.Fatal(err)
	}
	payload := result.Result.(map[string]any)
	if payload["observation_status"] != "not_observed" || len(toAnySlice(payload["completed_reads"])) != 1 || payload["frame_geometry"] != nil {
		t.Fatalf("read invented snapshot: %+v", payload)
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: payload})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, chip := range activity.Chips {
		if chip.Kind == "computer_observation" && chip.Value == "not_observed" {
			t.Fatal("successful scoped read shown as unread")
		}
		if chip.Kind == "computer_read" && chip.Value == "completed" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing scoped read fact")
	}
}

func TestComputerObservationPresentationKeepsLifecycleAndReadFacts(t *testing.T) {
	payload := map[string]any{
		"invalidation":    map[string]any{"scope": "safety", "event": "Page.frameDetached", "frame_id": "child", "page_text": "not a diagnostic"},
		"wait":            map[string]any{"requested_state": "visible", "timeout_ms": float64(12000), "elapsed_ms": float64(417), "samples": float64(2), "page_text": "not a diagnostic"},
		"completed_reads": []any{map[string]any{"operation_index": 0, "action": "text", "scope": "element", "source": "browser_dom", "document_id": "document", "frame_id": "main", "ref": "ref"}},
	}
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer.exec", Status: toolResultStatusError, Error: &aitools.ToolError{Code: "TARGET_OBSERVATION_UNAVAILABLE", Message: "Read interrupted"}, Data: payload})
	if err != nil {
		t.Fatal(err)
	}
	rows := activity.Payload.(fltools.StructuredActivityPayload).Rows
	for _, key := range []string{"invalidation", "wait", "completed_reads"} {
		found := false
		for _, row := range rows {
			if row.Title != key {
				continue
			}
			found = true
			want := payload[key]
			if key == "invalidation" {
				want = computerInvalidationFacts(want)
			}
			if key == "wait" {
				want = computerWaitFacts(want)
			}
			if row.Content != toolDetailValue(want) || row.Format != fltools.StructuredActivityRowFormatCode {
				t.Fatalf("%s facts changed: %+v", key, row)
			}
		}
		if !found {
			t.Errorf("missing %s in public Activity rows: %+v", key, rows)
		}
	}
}
