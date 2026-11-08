package ai

import (
	"context"
	"encoding/json"
	flruntime "github.com/floegence/floret/v7/runtime"
	"reflect"
	"testing"
)

func TestComputerQueryPreservesSourceRoleAndCanonicalLocatorVocabulary(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"scope": "loaded_accessibility_tree", "document_id": "doc", "items": []any{map[string]any{"ref": "static", "role": "StaticText", "name": "source text"}, map[string]any{"ref": "unknown", "role": "custom-role", "name": "unchanged"}}, "total": 2, "truncated": false}}, nil
	})
	target, _ := rt.registry.ResolveTarget(t.Context(), call.TargetID)
	target.Kind = "browser.connected"
	if err := rt.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	result, err := executeTestScript(t.Context(), rt, call, "const {items,total,truncated}=await ui.getByRole('text').query(); log({items,total,truncated});")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := encodeModelToolResult(ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: result.Result})
	if err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	if json.Unmarshal(encoded.text, &p) != nil {
		t.Fatal("invalid model output")
	}
	logs := p["data"].(map[string]any)["logs"].([]any)
	var logged map[string]any
	if decodeLoggedValue(logs[0], &logged) != nil {
		t.Fatalf("missing query: %v", logs)
	}
	items := logged["items"].([]any)
	for i, want := range []struct{ role, platform, name string }{{"text", "StaticText", "source text"}, {"other", "custom-role", "unchanged"}} {
		item := items[i].(map[string]any)
		if item["role"] != want.role || item["platform_role"] != want.platform || item["name"] != want.name {
			t.Fatalf("lossy projection: %v", item)
		}
	}
}

func TestComputerScreenshotOriginalLocatorReachesGuestAndModel(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		attachment.ResourceRef = "computer://" + c.TargetID + "/" + attachment.SHA256
		return TargetToolResult{TargetID: c.TargetID, frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{}}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "const image=await ui.screenshot();log(image.image);")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := encodeModelToolResult(ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: result.Result, Attachments: []ToolAttachment{{ResourceRef: attachment.ResourceRef, Name: attachment.Name, MIMEType: attachment.MIMEType, SizeBytes: attachment.SizeBytes, SHA256: attachment.SHA256}}})
	if err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	_ = json.Unmarshal(encoded.text, &p)
	data := p["data"].(map[string]any)
	metadata := data["output_order"].([]any)[0].(map[string]any)["image"].(map[string]any)
	descriptor := flruntime.MessageAttachment{ResourceRef: attachment.ResourceRef, Name: attachment.Name, MIMEType: attachment.MIMEType, SizeBytes: attachment.SizeBytes}
	locator, err := descriptor.Locator()
	if err != nil {
		t.Fatal(err)
	}
	if metadata["locator"] != locator || metadata["coordinate_space"] != "original_image_pixels" || metadata["width"].(float64) < 1 || metadata["height"].(float64) < 1 {
		t.Fatalf("missing original image descriptor: %v", metadata)
	}
	var logged map[string]any
	_ = decodeLoggedValue(data["logs"].([]any)[0], &logged)
	if !reflect.DeepEqual(logged, metadata) {
		t.Fatalf("guest/model descriptor differs: %v / %v", logged, metadata)
	}
}

func TestComputerClipboardRejectionKeepsTypedReasonAtScriptBoundary(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		result, err, _ := computerBrowserFailure(c, false, "TARGET_NOT_ALLOWED", map[string]any{"action_executed": false, "diagnostic": map[string]any{"phase": "permission", "method": "ui.key", "reason": "clipboard_shortcut_requires_explicit_operation", "page_text": "must not pass"}}, "fixture")
		return result, err
	})
	result, err := executeTestScript(t.Context(), rt, call, "await ui.key('Meta+C');")
	p := result.Result.(map[string]any)
	d, _ := p["diagnostic"].(map[string]any)
	if err == nil || p["script_error"] != "TARGET_NOT_ALLOWED" || computerScriptErrorCode("TARGET_NOT_ALLOWED") != "TARGET_NOT_ALLOWED" || d["reason"] != "clipboard_shortcut_requires_explicit_operation" || d["page_text"] != nil {
		t.Fatalf("lost typed rejection: %v %v", err, p)
	}
}

func TestComputerReadInterruptionDoesNotClaimAnUndispatchedAction(t *testing.T) {
	call := TargetToolCall{ToolName: "computer_observe"}
	result, _ := computerObservationFailure(call, map[string]any{"action_executed": false, "observation_invalidated": true, "reason": "document_changed", "observation_stage": "semantic_read"}, "fixture")
	if phase := computerActivityFailurePhase(result.Result.(map[string]any)); phase != "" {
		t.Fatalf("read mistaken for action: %s", phase)
	}
}

func decodeLoggedValue(value any, out any) error {
	values := toAnySlice(value)
	body, err := json.Marshal(values[0])
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

func TestComputerIncompleteInvalidatedInputKeepsPreparationAndPartialProgress(t *testing.T) {
	for _, tc := range []struct {
		phase string
		extra map[string]any
	}{
		{"prepared", map[string]any{"preparation_executed": true}},
		{"partial_input", map[string]any{"input_progress": map[string]any{"stage": "input_delivery", "posted": float64(2), "observed": float64(1)}}},
	} {
		t.Run(tc.phase, func(t *testing.T) {
			rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				facts := cloneAnyMap(tc.extra)
				facts["action_executed"], facts["observation_invalidated"], facts["reason"], facts["observation_stage"] = false, true, "document_changed", "hit_test"
				return TargetToolResult{TargetID: c.TargetID, Result: facts}, nil
			})
			result, err := executeTestScript(t.Context(), rt, call, "await ui.click(1,2);await ui.key('Enter');")
			p := result.Result.(map[string]any)
			if err == nil || p["failed_operation_phase"] != tc.phase || len(p["completed_actions"].([]string)) != 0 {
				t.Fatalf("partial facts confused with completion or no dispatch: %v %v", err, p)
			}
		})
	}
}

func TestComputerExplicitDelayReceiptIsCompletedWithoutInventingInput(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		if c.ToolName == "computer_observe" {
			return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"observation": semanticTestTree()}}, nil
		}
		return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"action_executed": false, "observation_invalidated": true, "needs_observation": true, "mechanism": "browser_input_sequence", "completed_events": 1}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
	})
	target, _ := rt.registry.ResolveTarget(t.Context(), call.TargetID)
	target.Kind = "browser.connected"
	if err := rt.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	result, err := executeTestScript(t.Context(), rt, call, "await ui.input([{type:'wait',duration_ms:100}]);await ui.snapshot({emit:false});")
	p := result.Result.(map[string]any)
	if err != nil || p["completed"] != true || p["action_executed"] != false || !reflect.DeepEqual(p["completed_actions"], []string{"input_sequence", "snapshot"}) {
		t.Fatalf("delay mistaken for undispatched input: %v %v", err, p)
	}
}
