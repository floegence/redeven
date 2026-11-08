package ai

import (
	"context"
	"encoding/json"
	"fmt"
	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"strings"
	"testing"
)

func TestComputerCollectionFactsSurviveGuestErrorAndFinalModelEncoding(t *testing.T) {
	for _, count := range []int{0, 2} {
		t.Run(string(rune('0'+count)), func(t *testing.T) {
			rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				items := []any{}
				for i := 0; i < count; i++ {
					items = append(items, map[string]any{"ref": string(rune('a' + i)), "role": "link", "name": "source"})
				}
				return TargetToolResult{Result: map[string]any{"items": items, "total": count, "scope": "loaded_accessibility_tree", "document_id": "page:5", "truncated": false}}, nil
			})
			target, _ := rt.registry.ResolveTarget(t.Context(), call.TargetID)
			target.Kind = "browser.connected"
			if e := rt.registry.Update(target); e != nil {
				t.Fatal(e)
			}
			result, err := executeTestScript(t.Context(), rt, call, "await ui.getByRole('link').query(); const missing=undefined; log(missing.ref);")
			if err == nil {
				t.Fatal("expected guest fault")
			}
			encoded, e := encodeModelToolResult(ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusError, Data: result.Result})
			if e != nil {
				t.Fatal(e)
			}
			var wire map[string]any
			if json.Unmarshal(encoded.text, &wire) != nil {
				t.Fatal("invalid wire")
			}
			data := wire["data"].(map[string]any)
			reads, ok := data["read_outcomes"].([]any)
			if !ok {
				t.Fatalf("missing read outcome: %+v", data)
			}
			got := reads[0].(map[string]any)
			if got["total"] != float64(count) || got["returned_count"] != float64(count) || got["truncated"] != false {
				t.Fatalf("lost collection facts: %+v", got)
			}
		})
	}
}
func TestComputerReadOutcomeExcludesContentAndRejectsInventedCounts(t *testing.T) {
	got := computerReadOutcome(map[string]any{"action": "query"}, 0, "completed", map[string]any{"total": -1, "items": []any{}, "truncated": false, "secret": "never"})
	if got["total"] != nil || got["secret"] != nil {
		t.Fatal(got)
	}
}
func TestComputerFailedReadClassificationKeepsCanonicalFailure(t *testing.T) {
	activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer_exec", Status: toolResultStatusError, Error: &aitools.ToolError{Code: "ELEMENT_NOT_FOUND", Message: "missing"}, Data: map[string]any{"action_executed": true, "completed_actions": []any{"click"}, "failed_action": "read", "failed_operation_index": 1}})
	if err != nil {
		t.Fatal(err)
	}
	payload := activity.Payload.(fltools.StructuredActivityPayload)
	if payload.Error == nil || payload.Error.Code != "ELEMENT_NOT_FOUND" {
		t.Fatalf("canonical failure changed: %+v", payload.Error)
	}
	found := false
	for _, chip := range activity.Chips {
		if chip.Kind == "computer_failed_read" && chip.Value == "read" {
			found = true
		}
	}
	if !found {
		t.Fatalf("lost failure facts: %+v", activity)
	}
}

func TestComputerRetiredLinkSummaryDiagnosticReachesFinalModel(t *testing.T) {
	calls := 0
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		calls++
		return TargetToolResult{}, nil
	})
	target, _ := rt.registry.ResolveTarget(t.Context(), call.TargetID)
	target.Kind = "browser.connected"
	if e := rt.registry.Update(target); e != nil {
		t.Fatal(e)
	}
	result, err := executeTestScript(t.Context(), rt, call, "await ui.getByRole('link').linkSummary();")
	if err == nil || calls != 0 {
		t.Fatalf("retired read dispatched: %d %v", calls, err)
	}
	encoded, e := encodeModelToolResult(ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusError, Data: result.Result})
	if e != nil {
		t.Fatal(e)
	}
	var wire map[string]any
	if json.Unmarshal(encoded.text, &wire) != nil {
		t.Fatal("invalid wire")
	}
	data := wire["data"].(map[string]any)
	diagnostic := data["diagnostic"].(map[string]any)
	if diagnostic["field"] != "method" || diagnostic["expected"] != "precise_attribute_read" {
		t.Fatalf("lost migration: %+v", data)
	}
}

func TestComputerFrameSourceIdentityReachesGuestReceiptsAndModelTree(t *testing.T) {
	rt, call := scriptRuntimeFixture(t, func(_ context.Context, _ TargetToolCall) (TargetToolResult, error) {
		observation := semanticFixtureText("Parent facts")
		nodes := observation["nodes"].([]any)
		for _, value := range nodes {
			node := value.(map[string]any)
			node["frame_id"] = "main"
			node["frame_document_id"] = "main:4"
		}
		observation["document_id"] = "page:5"
		return TargetToolResult{Result: map[string]any{"observation": observation}}, nil
	})
	result, err := executeTestScript(t.Context(), rt, call, "const s=await ui.snapshot(); log(s.nodes[0].frame_document_id);")
	if err != nil {
		t.Fatal(err)
	}
	encoded, e := encodeModelToolResult(ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: result.Result})
	if e != nil {
		t.Fatal(e)
	}
	var wire map[string]any
	if json.Unmarshal(encoded.text, &wire) != nil {
		t.Fatal("invalid wire")
	}
	data := wire["data"].(map[string]any)
	if !strings.Contains(string(encoded.text), "frame_document_id") || !strings.Contains(string(encoded.text), "main:4") || !strings.Contains(string(encoded.text), "page:5") {
		t.Fatalf("lost identity: %+v", data)
	}
}

func TestComputerReadFailureSummaryNeverReclassifiesGuestFaultOrUnknownEffect(t *testing.T) {
	for _, code := range []aitools.ErrorCode{"SCRIPT_FAILED", "EFFECT_OUTCOME_UNKNOWN", "TARGET_OBSERVATION_UNAVAILABLE"} {
		activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "computer_exec", Status: toolResultStatusError, Error: &aitools.ToolError{Code: code, Message: "fixture"}, Data: map[string]any{"action_executed": true, "completed_actions": []any{"click"}, "failed_action": "text"}})
		if err != nil {
			t.Fatal(err)
		}
		for _, chip := range activity.Chips {
			if chip.Kind == "computer_failed_read" {
				t.Fatalf("untyped summary reclassified %s", code)
			}
		}
	}
}

func TestComputerSnapshotReceiptsRetainSourceCompletenessWithoutEmission(t *testing.T) {
	for _, method := range []string{"ui.snapshot", "ui.observe", "ui.ref('a').snapshot"} {
		t.Run(method, func(t *testing.T) {
			calls := 0
			rt, call := scriptRuntimeFixture(t, func(_ context.Context, c TargetToolCall) (TargetToolResult, error) {
				if c.ToolName == "computer.action" {
					return TargetToolResult{Result: map[string]any{"semantic_schema_version": 2, "node": semanticFixtureNode("a", "text", "hidden source content")}}, nil
				}
				calls++
				return TargetToolResult{Result: map[string]any{"observation": map[string]any{"semantic_schema_version": 2, "document_id": "source:3", "nodes": []any{semanticFixtureNode("a", "text", "hidden source content")}, "total": 3, "truncated": true}}}, nil
			})
			result, err := executeTestScript(t.Context(), rt, call, "await "+method+"({root_ref:'a',limit:1,emit:false}); log('explicit prefix');")
			if err != nil {
				t.Fatal(err)
			}
			published, err := floretToolResultFromFlower(nil, ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: result.Result})
			if err != nil {
				t.Fatal(err)
			}
			var text map[string]any
			if err := json.Unmarshal([]byte(published.Text), &text); err != nil {
				t.Fatal(err)
			}
			for _, wire := range []map[string]any{text, published.Structured} {
				data := wire["data"].(map[string]any)
				reads := data["read_outcomes"].([]any)
				read := reads[len(reads)-1].(map[string]any)
				if fmt.Sprint(read["total"]) != "3" || fmt.Sprint(read["returned_count"]) != "1" || read["source_truncated"] != true || read["truncated"] != true || read["root_ref"] != "a" || fmt.Sprint(read["limit"]) != "1" || read["document_id"] != "source:3" {
					t.Fatalf("lost source completeness: %#v", read)
				}
				if wire["truncated"] != false || data["truncated"] != false || data["observations"] != nil || data["observation"] != nil {
					t.Fatalf("source and output loss conflated: %#v", wire)
				}
			}
			if calls != 1 || strings.Contains(published.Text, "hidden source content") {
				t.Fatalf("hidden content or repeated read: %d %s", calls, published.Text)
			}
		})
	}
}
