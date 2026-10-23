package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSubagentModelPayloadKeepsCompleteEvidenceWithoutDisplayEchoes(t *testing.T) {
	report := strings.Repeat("完整报告🌸\n", 12000)
	failure := strings.Repeat("provider failure detail ", 1000)
	data := map[string]any{
		"action": "wait", "reason": "events", "target_ids": []string{"child"},
		"timeout_ms": 300000, "requested_timeout_ms": 300000, "timed_out": false,
		"items":    []map[string]any{{"thread_id": "child", "id": "child", "status": "completed", "task_description": "echoed mission", "last_message_preview": "partial report", "failure": map[string]any{"code": "provider", "message": failure}}},
		"handoffs": []map[string]any{{"thread_id": "child", "turn_id": "turn", "run_id": "run", "content": report}},
		"events":   map[string]any{"thread_id": "parent", "next_after_event_id": "next", "events": []map[string]any{{"id": "event", "source_thread_id": "child", "source_turn_id": "turn", "source_run_id": "run", "kind": "completed", "parent_thread_id": "parent", "admitted": false}}},
	}
	before, _ := json.Marshal(data)
	result, err := modelToolResultPayload(ToolResult{ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(data)
	if string(before) != string(after) {
		t.Fatal("model projection mutated Activity evidence")
	}
	out := result["data"].(map[string]any)
	if out["target_ids"] != nil || out["requested_timeout_ms"] != nil {
		t.Fatal("duplicate coordination fields retained")
	}
	item := out["items"].([]any)[0].(map[string]any)
	if item["id"] != nil || item["task_description"] != nil || item["last_message_preview"] != nil {
		t.Fatal("display echoes retained")
	}
	if item["failure"].(map[string]any)["message"] != failure || out["handoffs"].([]any)[0].(map[string]any)["content"] != report {
		t.Fatal("complete evidence truncated")
	}
	page := out["events"].(map[string]any)
	event := page["events"].([]any)[0].(map[string]any)
	if page["next_after_event_id"] != "next" || event["id"] != "event" || event["source_run_id"] != "run" {
		t.Fatal("event identity or paging lost")
	}
}

func TestSubagentModelPayloadRetainsExplicitDiscoveryAndMissingTargets(t *testing.T) {
	for _, action := range []string{subagentActionList, subagentActionInspect} {
		data := map[string]any{
			"action": action, "status": "partial", "requested_ids": []string{"child", "missing"},
			"items": []map[string]any{{"thread_id": "child", "task_description": "original mission", "last_message_preview": "available preview", "status": "completed"}},
		}
		result, err := modelToolResultPayload(ToolResult{ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
		if err != nil {
			t.Fatal(err)
		}
		out := result["data"].(map[string]any)
		if len(out["requested_ids"].([]any)) != 2 {
			t.Fatal("missing target identity lost")
		}
		item := out["items"].([]any)[0].(map[string]any)
		if item["task_description"] != "original mission" || item["last_message_preview"] != "available preview" {
			t.Fatal("explicit discovery evidence removed without a report")
		}
	}
}
