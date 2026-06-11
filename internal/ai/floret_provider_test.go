package ai

import (
	"context"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/provider"
	flsession "github.com/floegence/floret/session"
)

type recordingFlowerProvider struct {
	req TurnRequest
}

func (p *recordingFlowerProvider) StreamTurn(_ context.Context, req TurnRequest, _ func(StreamEvent)) (TurnResult, error) {
	p.req = req
	return TurnResult{FinishReason: "stop", Text: "ok"}, nil
}

func TestFloretProviderAdapter_DisableReasoningControlsProviderRequest(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"deepseek",
		"deepseek-v4-pro",
		"plan",
		ProviderControls{ThinkingBudgetTokens: 4096},
		TurnBudgets{MaxSteps: 1},
		"",
		nil,
		nil,
		nil,
	)
	stream, err := adapter.Stream(context.Background(), flprovider.Request{
		SessionID:        "thread",
		LogicalRequestID: "thread_title",
		Model:            "deepseek-v4-pro",
		Messages:         []flsession.Message{{Role: flsession.User, Content: "请生成标题"}},
		MaxOutputTokens:  64,
		DisableReasoning: true,
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	for range stream {
	}
	if !recorder.req.ProviderControls.DisableReasoning {
		t.Fatalf("DisableReasoning=false, want true")
	}
	if recorder.req.ProviderControls.ThinkingBudgetTokens != 0 {
		t.Fatalf("ThinkingBudgetTokens=%d, want 0", recorder.req.ProviderControls.ThinkingBudgetTokens)
	}
	if recorder.req.Budgets.MaxOutputToken != 64 {
		t.Fatalf("MaxOutputToken=%d, want 64", recorder.req.Budgets.MaxOutputToken)
	}
}

func TestFloretMessagesToFlower_GroupsConsecutiveAssistantToolCalls(t *testing.T) {
	t.Parallel()

	got, err := floretMessagesToFlower([]flsession.Message{
		{Role: flsession.User, Content: "inspect and edit"},
		{Role: flsession.Assistant, Content: "tool_call", Reasoning: "use both tools", ToolCallID: "todo-1", ToolName: "write_todos", ToolArgs: `{"todos":[{"content":"inspect","status":"in_progress"}]}`},
		{Role: flsession.Assistant, Content: "tool_call", Reasoning: "use both tools", ToolCallID: "shell-1", ToolName: "terminal.exec", ToolArgs: `{"command":"mkdir -p smoke"}`},
		{Role: flsession.Tool, Content: `{"status":"success","summary":"updated todos"}`, ToolCallID: "todo-1", ToolName: "write_todos"},
		{Role: flsession.Tool, Content: `{"status":"success","summary":"created directory"}`, ToolCallID: "shell-1", ToolName: "terminal.exec"},
	})
	if err != nil {
		t.Fatalf("floretMessagesToFlower: %v", err)
	}

	if len(got) != 4 {
		t.Fatalf("messages=%d, want 4: %#v", len(got), got)
	}
	if got[1].Role != "assistant" {
		t.Fatalf("grouped role=%q, want assistant", got[1].Role)
	}
	if len(got[1].Content) != 3 {
		t.Fatalf("assistant content length=%d, want reasoning plus two tool calls: %#v", len(got[1].Content), got[1].Content)
	}
	if got[1].Content[0].Type != "reasoning" || got[1].Content[0].Text != "use both tools" {
		t.Fatalf("content[0]=%#v, want deduplicated reasoning", got[1].Content[0])
	}
	firstCall := got[1].Content[1]
	if firstCall.Type != "tool_call" || firstCall.ToolCallID != "todo-1" || firstCall.ToolName != "write_todos" {
		t.Fatalf("first grouped tool call=%#v", firstCall)
	}
	secondCall := got[1].Content[2]
	if secondCall.Type != "tool_call" || secondCall.ToolCallID != "shell-1" || secondCall.ToolName != "terminal.exec" {
		t.Fatalf("second grouped tool call=%#v", secondCall)
	}
	if got[2].Role != "tool" || got[2].Content[0].ToolCallID != "todo-1" {
		t.Fatalf("first tool result should immediately follow grouped call: %#v", got[2])
	}
	if got[3].Role != "tool" || got[3].Content[0].ToolCallID != "shell-1" {
		t.Fatalf("second tool result should immediately follow grouped call: %#v", got[3])
	}
}

func TestFloretMessagesToFlower_ProjectsControlToolHistoryAsProviderSafeText(t *testing.T) {
	t.Parallel()

	got, err := floretMessagesToFlower([]flsession.Message{
		{Role: flsession.User, Content: "ask a structured question"},
		{Role: flsession.Assistant, Content: "tool_call", ToolCallID: "ask-1", ToolName: "ask_user", ToolArgs: `{"questions":[]}`},
		{Role: flsession.Tool, Content: "ask_user was rejected because reason_code is missing or invalid.", ToolCallID: "ask-1", ToolName: "ask_user"},
		{Role: flsession.Assistant, Content: "tool_call", ToolCallID: "ask-2", ToolName: "ask_user", ToolArgs: `{"questions":[{"id":"q1"}]}`},
	})
	if err != nil {
		t.Fatalf("floretMessagesToFlower: %v", err)
	}

	if len(got) != 4 {
		t.Fatalf("messages=%d, want 4: %#v", len(got), got)
	}
	for _, msg := range got {
		if msg.Role == "tool" {
			t.Fatalf("control tool history must not be sent as provider tool role: %#v", got)
		}
		for _, part := range msg.Content {
			if part.Type == "tool_call" || part.ToolName == "ask_user" || part.ToolCallID != "" {
				t.Fatalf("control tool identity leaked into provider history: %#v", got)
			}
		}
	}
	if got[1].Role != "assistant" || got[1].Content[0].Text != "Agent requested structured user input." {
		t.Fatalf("control call projection=%#v", got[1])
	}
	if !strings.Contains(got[2].Content[0].Text, "Host processed control signal \"ask_user\"") ||
		!strings.Contains(got[2].Content[0].Text, "reason_code is missing") {
		t.Fatalf("control result projection=%#v", got[2])
	}
}

func TestFloretMessagesToFlower_RejectsOrphanOrdinaryToolResult(t *testing.T) {
	t.Parallel()

	_, err := floretMessagesToFlower([]flsession.Message{
		{Role: flsession.User, Content: "continue"},
		{Role: flsession.Tool, Content: `{"status":"success"}`, ToolCallID: "read-1", ToolName: "file.read"},
	})
	if err == nil || !strings.Contains(err.Error(), "without a preceding assistant tool call") {
		t.Fatalf("error=%v, want orphan ordinary tool result rejection", err)
	}
}

func TestFloretMessagesToFlowerRejectsInvalidToolArgs(t *testing.T) {
	t.Parallel()

	_, err := floretMessagesToFlower([]flsession.Message{{
		Role:       flsession.Assistant,
		ToolCallID: "call-1",
		ToolName:   "terminal.exec",
		ToolArgs:   `{"command":`,
	}})
	if err == nil || !strings.Contains(err.Error(), "invalid Floret assistant tool args") {
		t.Fatalf("error=%v, want invalid tool args", err)
	}
}

func TestFlowerToolsFromFloretRejectsInvalidSchema(t *testing.T) {
	t.Parallel()

	_, err := flowerToolsFromFloret([]flprovider.ToolDefinition{{
		Name:        "terminal.exec",
		InputSchema: map[string]any{"bad": func() {}},
	}})
	if err == nil || !strings.Contains(err.Error(), "invalid Floret tool schema") {
		t.Fatalf("error=%v, want invalid tool schema", err)
	}
}
