package ai

import "testing"

func TestBuildAssistantHistoryMessage_TextOnly(t *testing.T) {
	t.Parallel()

	msg, ok := buildAssistantHistoryMessage("summarize findings", "internal reasoning", nil)
	if !ok {
		t.Fatalf("expected assistant history message")
	}
	if msg.Role != "assistant" {
		t.Fatalf("role=%q, want assistant", msg.Role)
	}
	if len(msg.Content) != 1 {
		t.Fatalf("content length=%d, want 1", len(msg.Content))
	}
	if msg.Content[0].Type != "text" {
		t.Fatalf("content[0].type=%q, want text", msg.Content[0].Type)
	}
	if msg.Content[0].Text != "summarize findings" {
		t.Fatalf("content[0].text=%q, want summarize findings", msg.Content[0].Text)
	}
}

func TestBuildAssistantHistoryMessage_MixedTurn(t *testing.T) {
	t.Parallel()

	msg, ok := buildAssistantHistoryMessage("checked file", "verify cwd before command execution", []ToolCall{
		{
			ID:   "call_1",
			Name: "terminal.exec",
			Args: map[string]any{"command": "pwd", "cwd": "/tmp"},
		},
	})
	if !ok {
		t.Fatalf("expected assistant history message")
	}
	if len(msg.Content) != 3 {
		t.Fatalf("content length=%d, want 3", len(msg.Content))
	}
	if msg.Content[0].Type != "text" || msg.Content[0].Text != "checked file" {
		t.Fatalf("content[0]=%+v, want text checked file", msg.Content[0])
	}
	if msg.Content[1].Type != "reasoning" || msg.Content[1].Text != "verify cwd before command execution" {
		t.Fatalf("content[1]=%+v, want reasoning", msg.Content[1])
	}
	if msg.Content[2].Type != "tool_call" {
		t.Fatalf("content[2].type=%q, want tool_call", msg.Content[2].Type)
	}
	if msg.Content[2].ToolCallID != "call_1" {
		t.Fatalf("tool_call_id=%q, want call_1", msg.Content[2].ToolCallID)
	}
}

func TestBuildToolCallMessages(t *testing.T) {
	t.Parallel()

	calls := []ToolCall{
		{
			ID:   "call_1",
			Name: "terminal.exec",
			Args: map[string]any{"command": "pwd", "cwd": "/tmp"},
		},
	}

	msgs := buildToolCallMessages(calls, "verify cwd before command execution")
	if len(msgs) != 1 {
		t.Fatalf("messages=%d, want 1", len(msgs))
	}
	if msgs[0].Role != "assistant" {
		t.Fatalf("role=%q, want assistant", msgs[0].Role)
	}
	if len(msgs[0].Content) != 2 {
		t.Fatalf("content length=%d, want 2", len(msgs[0].Content))
	}
	reasoning := msgs[0].Content[0]
	if reasoning.Type != "reasoning" {
		t.Fatalf("type=%q, want reasoning", reasoning.Type)
	}
	if reasoning.Text != "verify cwd before command execution" {
		t.Fatalf("reasoning=%q, want verify cwd before command execution", reasoning.Text)
	}
	part := msgs[0].Content[1]
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

	items, instructions := buildOpenAIInput(msgs)
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

	items, _ := buildOpenAIInput(msgs)
	if len(items) != 1 {
		t.Fatalf("items=%d, want 1", len(items))
	}
	if items[0].OfMessage == nil {
		t.Fatalf("assistant history must encode as message item")
	}
	msg := items[0].OfMessage
	if msg.Role != "assistant" {
		t.Fatalf("role=%q, want assistant", msg.Role)
	}
	if msg.Content.OfString.Value != "previous assistant summary" {
		t.Fatalf("content=%q, want previous assistant summary", msg.Content.OfString.Value)
	}
}

func TestBuildOpenAIInput_AssistantMixedTurnPreservesTextAndFunctionCall(t *testing.T) {
	t.Parallel()

	msgs := []Message{
		{
			Role: "assistant",
			Content: []ContentPart{
				{Type: "text", Text: "checked file"},
				{Type: "reasoning", Text: "verify cwd before command execution"},
				{Type: "tool_call", ToolCallID: "call_1", ToolName: "terminal.exec", ArgsJSON: `{"command":"pwd","cwd":"/tmp"}`},
			},
		},
	}

	items, _ := buildOpenAIInput(msgs)
	if len(items) != 2 {
		t.Fatalf("items=%d, want 2", len(items))
	}
	if items[0].OfMessage == nil {
		t.Fatalf("first item must be assistant message")
	}
	if items[0].OfMessage.Role != "assistant" {
		t.Fatalf("role=%q, want assistant", items[0].OfMessage.Role)
	}
	if items[0].OfMessage.Content.OfString.Value != "checked file" {
		t.Fatalf("content=%q, want checked file", items[0].OfMessage.Content.OfString.Value)
	}
	if items[1].OfFunctionCall == nil {
		t.Fatalf("second item must be function_call")
	}
	if items[1].OfFunctionCall.CallID != "call_1" {
		t.Fatalf("call_id=%q, want call_1", items[1].OfFunctionCall.CallID)
	}
}
