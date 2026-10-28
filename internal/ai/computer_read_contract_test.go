package ai

import (
	"context"
	"encoding/json"
	"testing"
)

func TestComputerRequiredReadResult(t *testing.T) {
	cases := []struct{ name, code string }{
		{"snapshot", "const x=await ui.snapshot({emit:false}); log(x.nodes.length);"},
		{"node", "await ui.ref('fixture').node();"},
		{"text", "await ui.ref('fixture').text();"},
		{"query", "await ui.ref('fixture').query();"},
		{"count", "await ui.ref('fixture').count();"},
		{"rows", "await ui.ref('fixture').rows();"},
		{"screenshot", "await ui.screenshot();"},
		{"requireState", "await ui.ref('fixture').requireState({state:'visible',timeout_ms:0}); log('CONDITION_ASSUMED');"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inputs, reads := 0, 0
			rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				var args map[string]any
				_ = json.Unmarshal(c.Arguments, &args)
				if c.ToolName == "computer.key" || args["action"] == "key" {
					inputs++
					return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"action_executed": true}}, nil
				}
				reads++
				return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"observation_invalidated": true, "action_executed": false}, Safety: &InteractionSafetyDecision{Level: "routine", SafeToCapture: false, SafeToSendToModel: false}}, nil
			})
			target, err := rt.registry.ResolveTarget(t.Context(), call.TargetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Kind = "browser.connected"
			if err = rt.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			result, err := executeTestScript(t.Context(), rt, call, tc.code+" await ui.key('Enter');")
			if reads == 0 {
				t.Fatalf("fixture did not reach read boundary: %v", err)
			}
			p, _ := result.Result.(map[string]any)
			t.Logf("error=%v inputs=%d completed=%v actions=%v script_error=%v logs=%v", err, inputs, p["completed"], p["completed_actions"], p["script_error"], p["logs"])
			if err == nil || inputs != 0 {
				t.Errorf("required read returned without usable value and allowed continuation")
			}
			if tc.name == "node" && p["script_error"] == "SCRIPT_TYPE_ERROR" {
				t.Errorf("missing adapter value misclassified as guest type error")
			}
		})
	}
}

func TestComputerReadSuccessContracts(t *testing.T) {
	cases := []struct {
		name, tool    string
		args, payload map[string]any
	}{
		{"snapshot", "computer.observe", nil, map[string]any{"observation": semanticTestTree()}},
		{"node", "computer.action", map[string]any{"action": "read"}, map[string]any{"semantic_schema_version": 2, "node": semanticFixtureNode("r", "button", "Button")}},
		{"empty_text", "computer.action", map[string]any{"action": "text"}, map[string]any{"text": "", "truncated": false, "scope": "rendered_element"}},
		{"empty_query", "computer.action", map[string]any{"action": "query"}, map[string]any{"items": []any{}, "total": 0, "truncated": false, "scope": "loaded_accessibility_tree", "document_id": "d"}},
		{"empty_table", "computer.action", map[string]any{"action": "table"}, map[string]any{"rows": []any{}, "total": 0, "truncated": false, "scope": "loaded_accessibility_tree", "document_id": "d"}},
		{"null_attribute", "computer.action", map[string]any{"action": "attribute", "attribute": "title"}, map[string]any{"attribute": "title", "value": nil}},
		{"condition_met", "computer.action", map[string]any{"action": "wait", "state": "enabled"}, map[string]any{"state": "enabled"}},
		{"condition_timeout", "computer.action", map[string]any{"action": "wait", "state": "visible"}, map[string]any{"state": "timeout", "requested_state": "visible"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args, _ := json.Marshal(tc.args)
			call := TargetToolCall{ToolName: tc.tool, Arguments: args}
			if !computerReadResultValid(call, TargetToolResult{Result: tc.payload}) {
				t.Fatal("valid value rejected")
			}
			if computerReadResultValid(call, TargetToolResult{Result: map[string]any{}}) {
				t.Fatal("absent result accepted")
			}
			for key := range tc.payload {
				if key == "semantic_schema_version" {
					continue
				} // Checked by semantic normalizer.
				broken := cloneAnyMap(tc.payload)
				delete(broken, key)
				if computerReadResultValid(call, TargetToolResult{Result: broken}) {
					t.Errorf("missing required field %s accepted", key)
				}
			}
			invalid := cloneAnyMap(tc.payload)
			invalid["observation_invalidated"] = true
			if computerReadResultValid(call, TargetToolResult{Result: invalid}) {
				t.Fatal("invalidated value accepted")
			}
		})
	}
}

func TestComputerActionInvalidationAllowsExplicitFreshRead(t *testing.T) {
	inputs := 0
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		if c.ToolName == "computer.observe" {
			return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"observation": semanticTestTree()}}, nil
		}
		inputs++
		return TargetToolResult{TargetID: c.TargetID, Result: map[string]any{"action_executed": true, "observation_invalidated": true}, Safety: &InteractionSafetyDecision{Level: "routine"}}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "await ui.click(1,2); await ui.snapshot({emit:false});")
	if err != nil || inputs != 1 || result.Result.(map[string]any)["completed"] != true || result.Result.(map[string]any)["needs_observation"] != false {
		t.Fatalf("legitimate action/read composition rejected: %v %+v", err, result)
	}
}
