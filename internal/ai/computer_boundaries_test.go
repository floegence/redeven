package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestComputerContractCurrentIdentityAndFailureFacts(t *testing.T) {
	target := TargetDescriptor{ID: "browser-contract", Kind: "browser.managed", DisplayName: "Chrome — about:blank"}
	for _, tc := range []struct {
		body         map[string]any
		name, status string
	}{
		{map[string]any{}, target.ID, "not_observed"},
		{map[string]any{"title": "Current page"}, "Current page", "not_observed"},
		{map[string]any{"observation": map[string]any{"title": "New page", "document_id": "doc-1"}}, "New page", "current"},
	} {
		got := targetToolResultPayload(TargetToolResult{Result: tc.body}, target.ID, target).(map[string]any)
		if got["target_name"] != tc.name || got["observation_status"] != tc.status || got["discovery_name"] != target.DisplayName {
			t.Fatalf("identity: %#v", got)
		}
	}
	diag := map[string]any{"phase": "validation", "field": "key", "expected": "key_chord", "recovery": "correct_arguments", "secret": "never retain"}
	got, err, valid := computerBrowserFailure(TargetToolCall{TargetID: target.ID, ToolName: "computer.key"}, false, "INVALID_REQUEST", map[string]any{"action_executed": false, "diagnostic": diag}, "local")
	if !valid || err == nil {
		t.Fatal("invalid key lost its failure")
	}
	payload := got.Result.(map[string]any)
	encoded, _ := json.Marshal(payload)
	if strings.Contains(string(encoded), "never retain") || computerActivityFailurePhase(payload) != "validation" {
		t.Fatalf("diagnostic: %s", encoded)
	}
	for _, tc := range []struct {
		p     map[string]any
		phase string
	}{
		{map[string]any{"action_executed": true, "diagnostic": diag}, "effect_confirmed"},
		{map[string]any{"preparation_executed": true}, "prepared"},
		{map[string]any{"effect_outcome_unknown": true, "action_executed": true}, "unknown"},
	} {
		if computerActivityFailurePhase(tc.p) != tc.phase {
			t.Fatal("effect precedence changed")
		}
	}
	if computerTargetContract(target)["image_coordinates"] != true || computerTargetContract(TargetDescriptor{Kind: "desktop.native"})["image_coordinates"] != false {
		t.Fatal("backend contract overstated support")
	}
}

func TestComputerContractRepeatedObservationAdvisoryResets(t *testing.T) {
	var out computerObservationOutput
	tree, _ := normalizeComputerObservation(semanticTestTree())
	out.render(tree, "scope", false)
	if out.render(tree, "scope", false).(map[string]any)["advisory"] != nil {
		t.Fatal("warned on first repeated read")
	}
	if out.render(tree, "scope", false).(map[string]any)["advisory"] == nil {
		t.Fatal("missing bounded repeated-read advice")
	}
	if out.render(tree, "other", false).(map[string]any)["advisory"] != nil {
		t.Fatal("scope change retained advice")
	}
}

func TestComputerContractScriptPreservesFrameAndDiagnostic(t *testing.T) {
	calls := 0
	body, attachment := computerFrameFixture(t)
	host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		calls++
		if c.ToolName == "computer.screenshot" {
			attachment.ResourceRef = "computer://" + c.TargetID + "/" + attachment.SHA256
			return TargetToolResult{TargetID: c.TargetID, frameBytes: body, Attachments: []TargetToolAttachment{attachment}, Result: map[string]any{"frame_geometry": map[string]any{"frame": attachment.ResourceRef, "document_id": "d:1"}}}, nil
		}
		result, err, _ := computerBrowserFailure(c, false, "INVALID_REQUEST", map[string]any{"action_executed": false, "diagnostic": map[string]any{"phase": "validation", "field": "key", "expected": "key_chord", "recovery": "correct_arguments"}}, "local")
		return result, err
	})
	result, err := executeTestScript(t.Context(), host, call, "await ui.screenshot(); await ui.key('Meta+Equal');")
	payload := result.Result.(map[string]any)
	if err == nil || calls != 2 || payload["frame_geometry"] == nil || computerArgumentDiagnostic(payload["diagnostic"]) == nil {
		t.Fatalf("script facts lost: %#v %v calls=%d", payload, err, calls)
	}
}

func TestComputerContractNativeRejectsImageBeforeDispatch(t *testing.T) {
	calls := 0
	host, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{}, nil
	})
	target, err := host.registry.ResolveTarget(t.Context(), call.TargetID)
	if err != nil {
		t.Fatal(err)
	}
	target.Kind = "desktop.native"
	if err = host.registry.Update(target); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // The rejection must also release the target gate.
		call.ToolName = "computer.click"
		call.Arguments = json.RawMessage(`{"x":1,"y":1,"coordinate_space":"image_pixels","frame":"old","document_id":"old"}`)
		_, err = host.ExecuteTargetTool(t.Context(), call)
		if err == nil || calls != 0 {
			t.Fatalf("unsupported coordinates dispatched: %v calls=%d", err, calls)
		}
	}
}
