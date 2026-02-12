package ai

import (
	"strings"
	"testing"
)

func TestBuildToolCallMessages(t *testing.T) {
	t.Parallel()

	calls := []ToolCall{
		{
			ID:   "call_1",
			Name: "terminal.exec",
			Args: map[string]any{"command": "pwd", "cwd": "/tmp"},
		},
	}

	msgs := buildToolCallMessages(calls)
	if len(msgs) != 1 {
		t.Fatalf("messages=%d, want 1", len(msgs))
	}
	if msgs[0].Role != "assistant" {
		t.Fatalf("role=%q, want assistant", msgs[0].Role)
	}
	if len(msgs[0].Content) != 1 {
		t.Fatalf("content length=%d, want 1", len(msgs[0].Content))
	}
	part := msgs[0].Content[0]
	if part.Type != "tool_call" {
		t.Fatalf("type=%q, want tool_call", part.Type)
	}
	if part.ToolCallID != "call_1" {
		t.Fatalf("tool_call_id=%q, want call_1", part.ToolCallID)
	}
	if part.ToolName != "terminal.exec" {
		t.Fatalf("tool_name=%q, want terminal.exec", part.ToolName)
	}
	if part.ArgsJSON == "" {
		t.Fatalf("args_json must not be empty")
	}
}

func TestBuildOpenAIInput_EncodesFunctionCallAndOutput(t *testing.T) {
	t.Parallel()

	msgs := []Message{
		{
			Role: "assistant",
			Content: []ContentPart{{
				Type:       "tool_call",
				ToolCallID: "call_1",
				ToolName:   "terminal.exec",
				ArgsJSON:   `{"command":"pwd","cwd":"/tmp"}`,
			}},
		},
		{
			Role: "tool",
			Content: []ContentPart{{
				Type:       "tool_result",
				ToolCallID: "call_1",
				Text:       `{"status":"success"}`,
			}},
		},
	}

	items, instructions := buildOpenAIInput(msgs, false)
	if instructions != "" {
		t.Fatalf("instructions=%q, want empty", instructions)
	}
	if len(items) != 2 {
		t.Fatalf("items=%d, want 2", len(items))
	}
	if items[0].OfFunctionCall == nil {
		t.Fatalf("first item must be function_call")
	}
	if items[0].OfFunctionCall.CallID != "call_1" {
		t.Fatalf("function_call call_id=%q, want call_1", items[0].OfFunctionCall.CallID)
	}
	if items[0].OfFunctionCall.Name != "terminal_exec" {
		t.Fatalf("function_call name=%q, want terminal_exec", items[0].OfFunctionCall.Name)
	}
	if items[0].OfFunctionCall.Arguments != `{"command":"pwd","cwd":"/tmp"}` {
		t.Fatalf("function_call arguments=%q, want %q", items[0].OfFunctionCall.Arguments, `{"command":"pwd","cwd":"/tmp"}`)
	}
	if items[1].OfFunctionCallOutput == nil {
		t.Fatalf("second item must be function_call_output")
	}
	if items[1].OfFunctionCallOutput.CallID != "call_1" {
		t.Fatalf("function_call_output call_id=%q, want call_1", items[1].OfFunctionCallOutput.CallID)
	}
}

func TestBuildOpenAIInput_AssistantHistoryUsesOutputText(t *testing.T) {
	t.Parallel()

	msgs := []Message{
		{
			Role: "assistant",
			Content: []ContentPart{{
				Type: "text",
				Text: "previous assistant summary",
			}},
		},
	}

	items, _ := buildOpenAIInput(msgs, true)
	if len(items) != 1 {
		t.Fatalf("items=%d, want 1", len(items))
	}
	if items[0].OfOutputMessage == nil {
		t.Fatalf("assistant history must encode as output message")
	}
	out := items[0].OfOutputMessage
	if !strings.HasPrefix(out.ID, "msg_") {
		t.Fatalf("id=%q, want prefix msg_", out.ID)
	}
	if out.Status != "completed" {
		t.Fatalf("status=%q, want completed", out.Status)
	}
	if len(out.Content) != 1 {
		t.Fatalf("output content len=%d, want 1", len(out.Content))
	}
	if out.Content[0].OfOutputText == nil {
		t.Fatalf("output content must be output_text")
	}
	if out.Content[0].OfOutputText.Text != "previous assistant summary" {
		t.Fatalf("text=%q, want previous assistant summary", out.Content[0].OfOutputText.Text)
	}
}
