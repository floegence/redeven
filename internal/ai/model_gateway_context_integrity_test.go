package ai

import (
	"encoding/json"
	"errors"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestEnforceToolReferenceIntegrity_DropsOrphanToolResult(t *testing.T) {
	t.Parallel()

	messages := []Message{
		{
			Role: "tool",
			Content: []ContentPart{
				{Type: "tool_result", ToolCallID: "call_missing", Text: `{"status":"success"}`},
			},
		},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}},
	}

	out, stats := enforceToolReferenceIntegrity(messages, nil)
	if len(stats.OrphanToolCallIDs) != 1 || stats.OrphanToolCallIDs[0] != "call_missing" {
		t.Fatalf("orphan_ids=%v, want [call_missing]", stats.OrphanToolCallIDs)
	}
	if stats.DroppedToolResultParts != 1 {
		t.Fatalf("dropped_tool_result_parts=%d, want 1", stats.DroppedToolResultParts)
	}
	if stats.DroppedToolMessages != 1 {
		t.Fatalf("dropped_tool_messages=%d, want 1", stats.DroppedToolMessages)
	}
	if len(findMissingToolCallIDs(out)) != 0 {
		t.Fatalf("output still has missing tool call ids")
	}
	if len(out) != 1 || out[0].Role != "user" {
		t.Fatalf("output=%+v, want single user message", out)
	}
}

func TestBuildToolResultMessagesUsesJSONSafeErrorPayload(t *testing.T) {
	t.Parallel()

	messages := buildToolResultMessages([]ToolResult{{
		ToolID:   "call_timeout",
		ToolName: "terminal.exec",
		Status:   toolResultStatusTimeout,
		Data: map[string]any{
			"todos": []TodoItem{{
				ID:      "todo_1",
				Content: "Verify context payload",
				Status:  TodoStatusCompleted,
			}},
		},
		Error: &aitools.ToolError{
			Code:      aitools.ErrorCodeTimeout,
			Message:   "Tool execution timed out after 30000 ms",
			Retryable: true,
		},
	}}, []ToolCall{{ID: "call_timeout", Name: "terminal.exec"}})
	if len(messages) != 1 || len(messages[0].Content) != 1 {
		t.Fatalf("messages=%+v, want one tool result", messages)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(messages[0].Content[0].Text), &payload); err != nil {
		t.Fatalf("unmarshal tool result: %v", err)
	}
	errorPayload, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("error payload=%#v, want map", payload["error"])
	}
	if errorPayload["code"] != "TIMEOUT" || errorPayload["message"] != "Tool execution timed out after 30000 ms" || errorPayload["retryable"] != true {
		t.Fatalf("error payload=%#v", errorPayload)
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("data payload=%#v, want map", payload["data"])
	}
	todos, ok := data["todos"].([]any)
	if !ok || len(todos) != 1 {
		t.Fatalf("todos payload=%#v, want JSON array", data["todos"])
	}
	if _, ok := todos[0].(map[string]any); !ok {
		t.Fatalf("todo payload=%T, want JSON object", todos[0])
	}
}

func TestIsProviderToolCallReferenceError(t *testing.T) {
	t.Parallel()

	if !isProviderToolCallReferenceError(errors.New(`POST "https://api.moonshot.cn/v1/chat/completions": 400 Bad Request {"message":"Invalid request: tool_call_id is not found","type":"invalid_request_error"}`)) {
		t.Fatalf("expected provider tool_call_id reference error")
	}
	if isProviderToolCallReferenceError(errors.New("network timeout")) {
		t.Fatalf("unexpected classification for unrelated error")
	}
}

func TestEnforceToolReferenceIntegrity_DropsOutOfOrderToolResultPart(t *testing.T) {
	t.Parallel()

	messages := []Message{
		{
			Role: "assistant",
			Content: []ContentPart{
				{Type: "tool_result", ToolCallID: "call_1", Text: `{"status":"early"}`},
				{Type: "tool_call", ToolCallID: "call_1", ToolName: "terminal.exec", ArgsJSON: `{"command":"pwd"}`},
			},
		},
		{
			Role: "tool",
			Content: []ContentPart{
				{Type: "tool_result", ToolCallID: "call_1", Text: `{"status":"ok"}`},
			},
		},
	}

	out, stats := enforceToolReferenceIntegrity(messages, nil)
	if len(stats.OrphanToolCallIDs) != 1 || stats.OrphanToolCallIDs[0] != "call_1" {
		t.Fatalf("orphan_tool_call_ids=%v, want [call_1]", stats.OrphanToolCallIDs)
	}
	if stats.DroppedToolResultParts != 1 {
		t.Fatalf("dropped_tool_result_parts=%d, want 1", stats.DroppedToolResultParts)
	}
	if stats.DroppedToolMessages != 0 {
		t.Fatalf("dropped_tool_messages=%d, want 0", stats.DroppedToolMessages)
	}
	if len(out) != 2 {
		t.Fatalf("len(output)=%d, want 2", len(out))
	}
	if len(out[0].Content) != 1 || out[0].Content[0].Type != "tool_call" {
		t.Fatalf("first message should only keep tool_call, got=%+v", out[0].Content)
	}
	if len(findMissingToolCallIDs(out)) != 0 {
		t.Fatalf("output still has missing tool call ids")
	}
}
