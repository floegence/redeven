package ai

import (
	"errors"
	"testing"
)

func TestCompactMessages_PrependsDeclarationForRetainedToolResult(t *testing.T) {
	t.Parallel()

	messages := []Message{
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "start"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "ack"}}},
		{
			Role: "assistant",
			Content: []ContentPart{
				{Type: "reasoning", Text: "need shell"},
				{Type: "tool_call", ToolCallID: "call_1", ToolName: "terminal.exec", ArgsJSON: `{"command":"pwd"}`},
			},
		},
		{
			Role: "tool",
			Content: []ContentPart{
				{Type: "tool_result", ToolCallID: "call_1", Text: `{"status":"success","summary":"ok"}`},
			},
		},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "filler-1"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "filler-2"}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "filler-3"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "filler-4"}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "filler-5"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "filler-6"}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "filler-7"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "filler-8"}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "filler-9"}}},
	}

	compacted, stats := compactMessages(messages)
	if stats.PrependedAssistantMessages < 1 {
		t.Fatalf("prepended_assistant_messages=%d, want >=1", stats.PrependedAssistantMessages)
	}

	missing := findMissingToolCallIDs(compacted)
	if len(missing) != 0 {
		t.Fatalf("missing_tool_call_ids=%v, want none", missing)
	}

	callDeclIdx := -1
	toolResultIdx := -1
	for idx, msg := range compacted {
		if callDeclIdx < 0 {
			for _, id := range toolCallIDsFromAssistantMessage(msg) {
				if id == "call_1" {
					callDeclIdx = idx
					break
				}
			}
		}
		if toolResultIdx >= 0 {
			continue
		}
		for _, part := range msg.Content {
			if part.Type == "tool_result" && toolCallIDFromPart(part) == "call_1" {
				toolResultIdx = idx
				break
			}
		}
	}
	if callDeclIdx < 0 {
		t.Fatalf("missing declaration for call_1")
	}
	if toolResultIdx < 0 {
		t.Fatalf("missing tool_result for call_1")
	}
	if callDeclIdx >= toolResultIdx {
		t.Fatalf("declaration index=%d must be before tool_result index=%d", callDeclIdx, toolResultIdx)
	}
}

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

func TestIsProviderToolCallReferenceError(t *testing.T) {
	t.Parallel()

	if !isProviderToolCallReferenceError(errors.New(`POST "https://api.moonshot.cn/v1/chat/completions": 400 Bad Request {"message":"Invalid request: tool_call_id is not found","type":"invalid_request_error"}`)) {
		t.Fatalf("expected provider tool_call_id reference error")
	}
	if isProviderToolCallReferenceError(errors.New("network timeout")) {
		t.Fatalf("unexpected classification for unrelated error")
	}
}
