package ai

import (
	"context"
	"testing"
)

func TestComputerObservationRecoveryFacts(t *testing.T) {
	for _, tc := range []struct {
		name, code  string
		stale, want bool
	}{
		{"local snapshot", `await ui.click(1,2); await ui.snapshot({emit:false});`, false, false},
		{"input after snapshot", `await ui.snapshot({emit:false}); await ui.click(1,2);`, false, true},
		{"stale without input", `await ui.ref('old').click();`, true, true},
		{"required wait", `await ui.ref('r').requireState({state:'enabled',timeout_ms:0});`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				if tc.stale {
					return computerBrowserStaleFixture(c)
				}
				if c.ToolName == "computer.observe" {
					return TargetToolResult{Result: map[string]any{"observation": semanticTestTree()}}, nil
				}
				return TargetToolResult{Result: map[string]any{"action_executed": computerCallMutates(c), "state": "timeout", "requested_state": "enabled"}}, nil
			})
			result, err := executeTestScript(t.Context(), runtime, call, tc.code)
			p := result.Result.(map[string]any)
			if p["needs_observation"] != tc.want || result.executionFacts.needsObservation != tc.want {
				t.Fatalf("inconsistent observation facts: %#v %+v %v", p, result.executionFacts, err)
			}
			if tc.name == "required wait" {
				d, _ := p["diagnostic"].(map[string]any)
				if p["failed_action"] != "wait" || p["failed_operation_index"] != 0 || d["method"] != "locator.requireState" || d["state"] != "enabled" || d["timeout_ms"] != 0 {
					t.Fatalf("lost condition: %#v", p)
				}
			}
		})
	}
}

func computerBrowserStaleFixture(c TargetToolCall) (TargetToolResult, error) {
	r, e, _ := computerBrowserFailure(c, false, "STALE_REFERENCE", map[string]any{"action_executed": false}, "local")
	return r, e
}

func TestComputerObservationIdentityWithoutTitle(t *testing.T) {
	target := TargetDescriptor{ID: "browser-test", Kind: "browser.managed"}
	for _, body := range []map[string]any{
		{"observation": semanticTestTree()},
		{"observation_status": "current"},
	} {
		p := targetToolResultPayload(TargetToolResult{Result: body}, target.ID, target).(map[string]any)
		if p["observation_status"] != "current" {
			t.Fatalf("missing current observation: %#v", p)
		}
	}
}

func TestComputerObservationFailureReason(t *testing.T) {
	call := TargetToolCall{TargetID: "browser-test", ToolName: "computer.screenshot"}
	result, err, valid := computerBrowserFailure(call, false, "TARGET_OBSERVATION_UNAVAILABLE", map[string]any{"action_executed": false, "observation_stage": "capture", "reason": "viewport_unstable"}, "local")
	if !valid || err == nil || result.Result.(map[string]any)["reason"] != "viewport_unstable" {
		t.Fatalf("lost reason: %+v %v", result, err)
	}
	for _, stage := range []string{"capture", "semantic_read"} {
		result, _, _ := computerBrowserFailure(call, false, "TARGET_OBSERVATION_UNAVAILABLE", map[string]any{"action_executed": false, "observation_stage": stage, "reason": "private-exception"}, "local")
		if result.Result.(map[string]any)["reason"] != nil {
			t.Fatal("raw observation reason escaped")
		}
	}
}

func TestComputerObservationScreenshotClearsRecovery(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		if c.ToolName == "computer.screenshot" {
			attachment.ResourceRef = "computer://" + c.TargetID + "/" + attachment.SHA256
			return TargetToolResult{TargetID: c.TargetID, frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{"frame_geometry": map[string]any{"frame": attachment.ResourceRef, "document_id": "d:1"}}}, nil
		}
		return TargetToolResult{Result: map[string]any{"action_executed": computerCallMutates(c)}}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, `await ui.click(1,2); await ui.screenshot();`)
	payload := result.Result.(map[string]any)
	if err != nil || payload["needs_observation"] != false || result.executionFacts.needsObservation || payload["observation_status"] != "current" {
		t.Fatalf("screenshot recovery: %#v %v", payload, err)
	}
	target := TargetDescriptor{ID: call.TargetID, Kind: "browser.managed"}
	projected := targetToolResultPayload(result, call.TargetID, target).(map[string]any)
	if projected["observation_status"] != "current" {
		t.Fatalf("screenshot projection: %#v", projected)
	}
	for _, flag := range []string{"needs_observation", "observation_invalidated", "effect_outcome_unknown"} {
		body := map[string]any{"observation_status": "current", "observation": semanticTestTree(), flag: true}
		p := targetToolResultPayload(TargetToolResult{Result: body}, target.ID, target).(map[string]any)
		if p["observation_status"] != "not_observed" {
			t.Fatalf("stale status: %#v", p)
		}
	}
}

func TestComputerObservationDiagnosticPrivacy(t *testing.T) {
	for _, raw := range []map[string]any{
		{"code": "CONDITION_TIMEOUT", "phase": "execution", "method": "locator.requireState", "state": "private-state", "timeout_ms": float64(0), "operation_index": float64(0)},
		{"code": "CONDITION_TIMEOUT", "phase": "execution", "method": "locator.requireState", "state": "text", "timeout_ms": float64(-1), "operation_index": float64(0)},
	} {
		d := computerScriptDiagnostic(raw, "await ui.snapshot()")
		if d["state"] != nil || d["timeout_ms"] != nil || d["operation_index"] != nil {
			t.Fatalf("unvalidated condition escaped: %#v", d)
		}
	}
	raw := map[string]any{"code": "CONDITION_TIMEOUT", "phase": "execution", "method": "locator.requireState", "state": "text", "timeout_ms": float64(0), "operation_index": float64(0), "equals": "private text", "stack": "private stack"}
	d := computerScriptDiagnostic(raw, "await ui.snapshot()")
	if d["equals"] != nil || d["stack"] != nil || d["state"] != "text" {
		t.Fatalf("condition diagnostic: %#v", d)
	}
}
