package ai

import (
	"errors"
	"math"
	"strings"
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

func TestDeriveModelWindowCompactionThreshold(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		contextLimit    int
		maxOutputTokens int
		want            float64
	}{
		{
			name:            "default_when_context_limit_invalid",
			contextLimit:    0,
			maxOutputTokens: 2048,
			want:            nativeDefaultCompactThreshold,
		},
		{
			name:            "minimum_when_reserved_exceeds_context",
			contextLimit:    6000,
			maxOutputTokens: 5000,
			want:            nativeMinCompactThreshold,
		},
		{
			name:            "derived_ratio_for_regular_window",
			contextLimit:    16000,
			maxOutputTokens: 2000,
			want:            0.811, // (16000-(2000+1024))/16000
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := deriveModelWindowCompactionThreshold(tt.contextLimit, tt.maxOutputTokens)
			if math.Abs(got-tt.want) > 1e-9 {
				t.Fatalf("deriveModelWindowCompactionThreshold()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestResolveCompactionThreshold(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		configThreshold float64
		contextLimit    int
		maxOutputTokens int
		want            float64
	}{
		{
			name:            "uses_default_when_unset",
			configThreshold: 0,
			contextLimit:    128000,
			maxOutputTokens: 4096,
			want:            nativeDefaultCompactThreshold,
		},
		{
			name:            "config_lower_bound_is_clamped",
			configThreshold: 0.30,
			contextLimit:    128000,
			maxOutputTokens: 4096,
			want:            nativeMinCompactThreshold,
		},
		{
			name:            "window_limit_can_override_config",
			configThreshold: 0.90,
			contextLimit:    12000,
			maxOutputTokens: 3000,
			want:            0.6646666666666666, // (12000-(3000+1024))/12000
		},
		{
			name:            "window_below_minimum_still_clamps_to_min",
			configThreshold: 0.90,
			contextLimit:    6000,
			maxOutputTokens: 5000,
			want:            nativeMinCompactThreshold,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := resolveCompactionThreshold(tt.configThreshold, tt.contextLimit, tt.maxOutputTokens)
			if math.Abs(got-tt.want) > 1e-9 {
				t.Fatalf("resolveCompactionThreshold()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestPruneToolResultPayloads_KeepsRecentTurnsAndPreservesCallID(t *testing.T) {
	t.Parallel()

	oldPayload := strings.Repeat("A", 1200)
	recentPayload := strings.Repeat("B", 1200)
	latestPayload := strings.Repeat("C", 1200)

	messages := []Message{
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "u1"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "call_1", ToolName: "terminal.exec", ArgsJSON: `{"command":"ls"}`}}},
		{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_1", Text: oldPayload}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "u2"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "call_2", ToolName: "terminal.exec", ArgsJSON: `{"command":"pwd"}`}}},
		{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_2", Text: recentPayload}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "u3"}}},
		{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "call_3", ToolName: "terminal.exec", ArgsJSON: `{"command":"whoami"}`}}},
		{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_3", Text: latestPayload}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "u4"}}},
	}

	out, stats := pruneToolResultPayloads(messages, 10, 2, 32)
	if stats.PrunedParts != 1 {
		t.Fatalf("pruned_parts=%d, want 1", stats.PrunedParts)
	}
	if stats.ProtectedStartIndex != 4 {
		t.Fatalf("protected_start_index=%d, want 4", stats.ProtectedStartIndex)
	}

	oldResult, ok := toolResultTextForCallID(out, "call_1")
	if !ok {
		t.Fatalf("missing tool_result for call_1")
	}
	if !strings.Contains(oldResult, "[tool_result_compacted] call_id=call_1") {
		t.Fatalf("call_1 placeholder missing call_id, got=%q", oldResult)
	}
	if !strings.Contains(oldResult, "preview: ") {
		t.Fatalf("call_1 placeholder missing preview, got=%q", oldResult)
	}

	recentResult, ok := toolResultTextForCallID(out, "call_2")
	if !ok {
		t.Fatalf("missing tool_result for call_2")
	}
	if recentResult != recentPayload {
		t.Fatalf("call_2 should stay unpruned")
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

func toolResultTextForCallID(messages []Message, callID string) (string, bool) {
	for _, msg := range messages {
		for _, part := range msg.Content {
			if part.Type != "tool_result" {
				continue
			}
			if toolCallIDFromPart(part) != callID {
				continue
			}
			return part.Text, true
		}
	}
	return "", false
}
