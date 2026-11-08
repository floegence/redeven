package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestComputerCoreExampleEmitsObservationWithoutLoggingRawNodes(t *testing.T) {
	for _, browser := range []bool{false, true} {
		guide, _ := computerScriptHelp("core", browser)
		_, example, found := strings.Cut(guide, "Example: ")
		if !found {
			t.Fatal("core example missing")
		}
		example, _, _ = strings.Cut(example, "\n")
		example, _, _ = strings.Cut(example, " Details:")
		nodes := make([]any, 180)
		for i := range nodes {
			nodes[i] = semanticFixtureNode(string(rune('a'+i)), "text", strings.Repeat("source ", 90))
		}
		raw, _ := json.Marshal(nodes)
		if len(raw) <= 65536 {
			t.Fatal("fixture must exceed the log budget")
		}
		calls := 0
		rt, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
			calls++
			if inner.ToolName != "computer_observe" {
				t.Fatalf("example dispatched %s", inner.ToolName)
			}
			return TargetToolResult{Result: map[string]any{"observation": map[string]any{"semantic_schema_version": 2, "document_id": "example:1", "nodes": nodes, "total": len(nodes), "truncated": false}}}, nil
		})
		result, err := executeTestScript(t.Context(), rt, call, example)
		if err != nil {
			t.Fatal(err)
		}
		payload := result.Result.(map[string]any)
		observation, _ := payload["observation"].(map[string]any)
		if calls != 1 || observation["encoding"] != "tree_text" || !strings.Contains(anyToString(observation["tree"]), "source") || len(toAnySlice(payload["logs"])) != 0 {
			t.Fatalf("example did not emit bounded observation: calls=%d payload=%#v", calls, payload)
		}
		published, err := floretToolResultFromFlower(nil, ToolResult{ToolID: call.ToolCallID, ToolName: "computer_exec", Status: toolResultStatusSuccess, Data: payload})
		if err != nil || !strings.Contains(published.Text, "tree_text") || !strings.Contains(published.Text, "source") {
			t.Fatalf("model lost example output: %v", err)
		}
	}
}

func TestComputerRuntimeHelpExplainsOutputScopesOnDemand(t *testing.T) {
	for _, browser := range []bool{false, true} {
		core, _ := computerScriptHelp("core", browser)
		runtime, _ := computerScriptHelp("runtime", browser)
		for _, term := range []string{"data:{", "completed_actions", "completed_reads", "read_outcomes", "source_truncated", "output_truncated", "outer truncated", "32 KiB", "384 KiB", "context_reset=true", "source"} {
			if !strings.Contains(runtime, term) {
				t.Errorf("runtime help omits %q", term)
			}
		}
		if strings.Contains(core, "data:{") || strings.Contains(core, "read_outcomes") {
			t.Fatal("detailed output contract entered core help")
		}
	}
}
