package ai

import (
	"context"
	"strings"
	"testing"
)

func TestComputerFieldIntegritySurvivesNormalizationAndCompactOutput(t *testing.T) {
	tree := semanticTestTree()
	node := tree["nodes"].([]any)[1].(map[string]any)
	for _, field := range []string{"name", "description", "value"} {
		node[field] = strings.Repeat("🙂", 2000)
		node[field+"_truncated"] = true
	}
	normalized, err := normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []map[string]any{normalized, compactComputerObservation(normalized)} {
		n := result["nodes"].([]any)[1].(map[string]any)
		for _, field := range []string{"name", "description", "value"} {
			if n[field+"_truncated"] != true {
				t.Fatalf("%s integrity lost", field)
			}
		}
	}
}

func TestComputerFieldIntegrityRejectsInvalidMetadata(t *testing.T) {
	for _, field := range []string{"name", "description", "value"} {
		tree := semanticTestTree()
		node := tree["nodes"].([]any)[1].(map[string]any)
		node[field+"_truncated"] = "true"
		if _, err := normalizeComputerObservation(tree); err == nil {
			t.Fatalf("accepted nonboolean %s metadata", field)
		}
	}
}

func TestComputerFieldIntegrityReadDiagnosticSurvivesScriptFailure(t *testing.T) {
	for _, tc := range []struct{ method, expected, code string }{
		{"locator.attribute", "attribute_max_2000", "await ui.getByRole('button',{name:'Long'}).attribute('title'); await ui.key('Enter');"},
		{"locator.text", "html_element", "await ui.getByRole('document').text(); await ui.key('Enter');"},
	} {
		t.Run(tc.method, func(t *testing.T) {
			calls := 0
			host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				calls++
				result, err, valid := computerBrowserFailure(c, false, "TARGET_CAPABILITY_UNAVAILABLE", map[string]any{"action_executed": false, "diagnostic": map[string]any{"phase": "read", "method": tc.method, "expected": tc.expected, "recovery": "choose_supported_read", "secret": "untrusted"}}, "local")
				if !valid {
					t.Fatal("invalid capability rejection")
				}
				return result, err
			})
			target, err := host.registry.ResolveTarget(t.Context(), call.TargetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Kind = "browser.connected"
			if err := host.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			result, err := executeTestScript(t.Context(), host, call, tc.code)
			payload, ok := result.Result.(map[string]any)
			if !ok {
				t.Fatalf("fixture result unavailable: %v", err)
			}
			diagnostic, _ := payload["diagnostic"].(map[string]any)
			if err == nil || calls != 1 || diagnostic["expected"] != tc.expected || diagnostic["secret"] != nil || payload["action_executed"] != false {
				t.Fatalf("failure facts lost or input dispatched: calls=%d payload=%+v err=%v", calls, payload, err)
			}
		})
	}
}

func TestComputerFieldIntegrityReadSuccessBounds(t *testing.T) {
	for _, length := range []int{1999, 2000, 2100} {
		full := strings.Repeat("🙂", length)
		for _, flag := range []any{nil, false, true, "true"} {
			item := map[string]any{"ref": "r", "role": "button", "name": full}
			if flag != nil {
				item["name_truncated"] = flag
			}
			payload := map[string]any{"items": []any{item}, "total": float64(1), "document_id": "d", "scope": "loaded_accessibility_tree", "truncated": false}
			valid := computerReadResultValid(TargetToolCall{ToolName: "computer.action", Arguments: []byte("{\"action\":\"query\"}")}, TargetToolResult{Result: payload})
			want := length <= 2000 && (flag == nil || flag == false || flag == true && length == 2000)
			if valid != want {
				t.Fatalf("query length=%d flag=%v accepted=%v", length, flag, valid)
			}
		}
		valid := computerReadResultValid(TargetToolCall{ToolName: "computer.action", Arguments: []byte("{\"action\":\"attribute\",\"attribute\":\"title\"}")}, TargetToolResult{Result: map[string]any{"attribute": "title", "value": full}})
		if valid != (length <= 2000) {
			t.Fatalf("attribute length=%d accepted=%v", length, valid)
		}
	}
}

func TestComputerFieldIntegrityGuestAndObservationDiff(t *testing.T) {
	tree := semanticTestTree()
	node := tree["nodes"].([]any)[1].(map[string]any)
	for _, field := range []string{"name", "description", "value"} {
		node[field] = strings.Repeat("中", 2000)
		node[field+"_truncated"] = true
	}
	host, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
		payload := map[string]any{"action_executed": false, "semantic_schema_version": 2}
		if c.ToolName == "computer.observe" {
			payload["observation"] = tree
		} else {
			payload["node"] = node
		}
		return TargetToolResult{TargetID: c.TargetID, Result: payload}, nil
	})
	result, err := executeTestScript(t.Context(), host, call, "const s=await ui.snapshot({full:true}); const n=await ui.ref('input').node(); for(const field of ['name','description','value']) {ui.assert(s.nodes[1][field+'_truncated']===true);ui.assert(n[field+'_truncated']===true);} log('integrity-confirmed');")
	if err != nil {
		t.Fatalf("guest metadata lost: %v %+v", err, result)
	}
	var out computerObservationOutput
	normalized, err := normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	out.render(normalized, "scope", false)
	delete(node, "value_truncated")
	normalized, err = normalizeComputerObservation(tree)
	if err != nil {
		t.Fatal(err)
	}
	changed := out.render(normalized, "scope", false).(map[string]any)
	found := false
	for _, raw := range changed["nodes"].([]any) {
		n := raw.(map[string]any)
		if n["ref"] == "input" {
			found = true
			if n["value_truncated"] != nil || n["name_truncated"] != true {
				t.Fatal("diff concealed integrity change")
			}
		}
	}
	if !found {
		t.Fatal("integrity-only change absent from diff")
	}
}
