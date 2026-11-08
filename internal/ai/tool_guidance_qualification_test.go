package ai

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Synthetic first-step probes. The live lane records proposals but never starts
// children, contacts a Runtime or executes model-proposed tools.
func toolGuidanceQualificationCases() []promptQualificationCase {
	return []promptQualificationCase{
		{name: "tool_guidance_child_inspect", runtimeSurface: true, input: "The direct child references returned for this parent are child-a and child-b. Inspect both children's complete available reports in a single call now.", wantTools: []string{"subagents"}, check: func(result ModelGatewayResult) error {
			if len(result.ToolCalls) != 1 {
				return fmt.Errorf("expected one inspection")
			}
			args := result.ToolCalls[0].Args
			raw, _ := json.Marshal(args)
			if _, err := decodeSubagentsToolInput(raw); err != nil {
				return fmt.Errorf("invalid child action: %v", err)
			}
			if args["action"] != "inspect" {
				return fmt.Errorf("expected report inspection")
			}
			refs := []string{}
			if target, ok := args["target"].(string); ok {
				refs = append(refs, target)
			}
			if ids, ok := args["ids"].([]any); ok {
				for _, id := range ids {
					refs = append(refs, fmt.Sprint(id))
				}
			}
			slices.Sort(refs)
			refs = slices.Compact(refs)
			if !slices.Equal(refs, []string{"child-a", "child-b"}) {
				return fmt.Errorf("inspection changed child references")
			}
			return nil
		}},
		{name: "tool_guidance_cancel_receipt", runtimeSurface: true, input: "Cancel all unfinished direct children of this parent. After the cancellation receipt, report only the confirmed facts as JSON with boolean fields all_stopped and effects_rolled_back; do not call more tools.", history: promptQualificationReceipt("subagents", `{"action":"close_all"}`, `{"accepted_count":2,"stopped_count":1,"closed_count":1}`), noTools: true, check: func(result ModelGatewayResult) error {
			text := strings.TrimSpace(result.Text)
			if strings.HasPrefix(text, "```") {
				_, body, ok := strings.Cut(text, "\n")
				if !ok {
					return fmt.Errorf("missing JSON body")
				}
				text, _, ok = strings.Cut(body, "```")
				if !ok {
					return fmt.Errorf("unclosed JSON block")
				}
			}
			var facts map[string]any
			if json.Unmarshal([]byte(strings.TrimSpace(text)), &facts) != nil || facts["all_stopped"] != false || facts["effects_rolled_back"] != false {
				return fmt.Errorf("cancellation admission confused with settlement or rollback")
			}
			return nil
		}},
		{name: "tool_guidance_direct_service", runtimeSurface: true, input: "Inspect this referenced Web Service now: runtime_ref=local:local, owner=managed_service, service_id=service-metrics, display name Metrics, port 8080. The service reference has no canvas. Its exact binding is already provided; retrieve the service description and workspace.", wantTools: []string{"tessiven.inspect"}, check: func(result ModelGatewayResult) error {
			if len(result.ToolCalls) != 1 {
				return fmt.Errorf("expected one resource inspection")
			}
			args := result.ToolCalls[0].Args
			binding, ok := args["binding"].(map[string]any)
			if !ok || args["action"] != "inspect" || args["runtime_ref"] != "local:local" || binding["owner"] != "managed_service" || binding["resourceId"] != "service-metrics" {
				return fmt.Errorf("inspection changed resource identity")
			}
			for _, key := range []string{"canvas_id", "version_id", "instance_id"} {
				if _, ok := args[key]; ok {
					return fmt.Errorf("direct binding gained canvas field %s", key)
				}
			}
			return nil
		}},
	}
}

func TestToolGuidanceQualificationOracles(t *testing.T) {
	cases := toolGuidanceQualificationCases()
	good := []ModelGatewayResult{
		{ToolCalls: []ToolCall{{Name: "subagents", Args: map[string]any{"action": "inspect", "target": "child-a", "ids": []any{"child-b", "child-a"}}}}},
		{Text: `{"all_stopped":false,"effects_rolled_back":false}`},
		{ToolCalls: []ToolCall{{Name: "tessiven.inspect", Args: map[string]any{"action": "inspect", "runtime_ref": "local:local", "binding": map[string]any{"owner": "managed_service", "resourceId": "service-metrics"}}}}},
	}
	bad := []ModelGatewayResult{
		{ToolCalls: []ToolCall{{Name: "subagents", Args: map[string]any{"action": "inspect", "target": "child-a", "scope": "current_thread"}}}},
		{Text: `{"all_stopped":true,"effects_rolled_back":false}`},
		{ToolCalls: []ToolCall{{Name: "tessiven.inspect", Args: map[string]any{"action": "inspect", "runtime_ref": "local:local", "canvas_id": "service-metrics"}}}},
	}
	if err := cases[1].check(ModelGatewayResult{Text: "```json\n{\"all_stopped\":false,\"effects_rolled_back\":false}\n```\nOne child is confirmed stopped."}); err != nil {
		t.Fatal(err)
	}
	if err := cases[1].check(ModelGatewayResult{Text: `{"all_stopped":false,"effects_rolled_back":true}`}); err == nil {
		t.Fatal("rollback claim accepted")
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, defs := promptQualificationSurface(t, tc)
			if issues := evaluatePromptQualificationResponse(t, tc, defs, good[i]); len(issues) != 0 {
				t.Fatalf("valid proposal rejected: %v", issues)
			}
			if issues := evaluatePromptQualificationResponse(t, tc, defs, bad[i]); len(issues) == 0 {
				t.Fatal("invalid proposal accepted")
			}
		})
	}
}
