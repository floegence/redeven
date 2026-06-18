package ai

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	openai "github.com/openai/openai-go"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

type recordingFlowerProvider struct {
	req TurnRequest
}

func (p *recordingFlowerProvider) StreamTurn(_ context.Context, req TurnRequest, _ func(StreamEvent)) (TurnResult, error) {
	p.req = req
	return TurnResult{FinishReason: "stop", Text: "ok"}, nil
}

type replayingFlowerProvider struct {
	requests []TurnRequest
}

func (p *replayingFlowerProvider) StreamTurn(_ context.Context, req TurnRequest, _ func(StreamEvent)) (TurnResult, error) {
	p.requests = append(p.requests, req)
	if len(p.requests) == 1 {
		return TurnResult{}, &openai.Error{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_previous_response_id",
			Param:      "previous_response_id",
			Type:       "invalid_request_error",
			Message:    "invalid previous_response_id",
		}
	}
	return TurnResult{
		FinishReason: "stop",
		Text:         "ok",
		ProviderState: &TurnProviderState{
			ContinuationKind: providerContinuationKindOpenAIResponses,
			ContinuationID:   "resp_next",
		},
	}, nil
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
		TurnBudgets{},
		"",
		nil,
		nil,
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		ThreadID:         "thread",
		PromptScopeID:    "thread",
		Model:            "deepseek-v4-pro",
		Messages:         []flruntime.ModelMessage{{Role: "user", Content: "请生成标题"}},
		MaxOutputTokens:  64,
		DisableReasoning: true,
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
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

type reasoningFlowerProvider struct {
	streamReasoning string
	resultReasoning string
	resultText      string
	omitResultText  bool
}

func (p reasoningFlowerProvider) StreamTurn(_ context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p.streamReasoning != "" {
		onEvent(StreamEvent{Type: StreamEventThinkingDelta, Text: p.streamReasoning})
	}
	text := p.resultText
	if text == "" && !p.omitResultText {
		text = "final answer"
	}
	return TurnResult{
		FinishReason: "stop",
		Text:         text,
		Reasoning:    p.resultReasoning,
	}, nil
}

func newFloretProviderAdapterRunTest(t *testing.T, provider Provider) (*floretProviderAdapter, *run, *threadstore.Store, *[]any) {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.CreateThread(context.Background(), threadstore.Thread{
		EndpointID: "env_floret_reasoning",
		ThreadID:   "thread_floret_reasoning",
		Title:      "Floret reasoning",
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	events := make([]any, 0, 4)
	r := &run{
		id:                        "run_floret_reasoning",
		endpointID:                "env_floret_reasoning",
		threadID:                  "thread_floret_reasoning",
		messageID:                 "msg_floret_reasoning",
		threadsDB:                 store,
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		nextBlockIndex:            0,
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	adapter := newFloretProviderAdapter(
		provider,
		"openai",
		"gpt-5-mini",
		"act",
		ProviderControls{},
		TurnBudgets{},
		"",
		nil,
		nil,
	)
	adapter.bindStreamRun(r)
	return adapter, r, store, &events
}

func TestFloretProviderAdapter_UsesRedevenModelNameInsteadOfFloretPlaceholder(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5.2",
		"act",
		ProviderControls{},
		TurnBudgets{},
		"",
		nil,
		nil,
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "redeven-model-adapter",
		Messages: []flruntime.ModelMessage{{Role: "user", Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}
	if recorder.req.Model != "gpt-5.2" {
		t.Fatalf("model=%q, want Redeven-owned model name", recorder.req.Model)
	}
}

func TestFloretProviderAdapter_UsesProjectedPreviousState(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5-mini",
		"act",
		ProviderControls{},
		TurnBudgets{},
		"",
		[]flruntime.TranscriptMessage{{Role: "user", Content: "resume turn"}},
		nil,
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Step:            1,
		Model:           "gpt-5-mini",
		Messages:        []flruntime.ModelMessage{{Role: "user", Content: "full history"}},
		PreviousState:   &flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
		MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}
	if recorder.req.ProviderControls.PreviousResponseID != "resp_prev" {
		t.Fatalf("PreviousResponseID=%q, want resp_prev", recorder.req.ProviderControls.PreviousResponseID)
	}
	if len(recorder.req.Messages) != 1 || messageTextForFloret(recorder.req.Messages[0], true) != "resume turn" {
		t.Fatalf("messages=%#v, want projected resume history", recorder.req.Messages)
	}
}

func TestFloretProviderAdapter_ReplaysWithoutRejectedPreviousResponseID(t *testing.T) {
	t.Parallel()

	recorder := &replayingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5-mini",
		"act",
		ProviderControls{},
		TurnBudgets{},
		"",
		[]flruntime.TranscriptMessage{{Role: "user", Content: "resume turn"}},
		nil,
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Step:            1,
		Model:           "gpt-5-mini",
		Messages:        []flruntime.ModelMessage{{Role: "user", Content: "full history"}},
		PreviousState:   &flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
		MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var terminal *flruntime.ModelEvent
	for event := range stream {
		if event.Type == flruntime.ModelEventDone {
			ev := event
			terminal = &ev
		}
	}
	if len(recorder.requests) != 2 {
		t.Fatalf("request count=%d, want 2", len(recorder.requests))
	}
	if got := recorder.requests[0].ProviderControls.PreviousResponseID; got != "resp_prev" {
		t.Fatalf("first PreviousResponseID=%q, want resp_prev", got)
	}
	if got := recorder.requests[1].ProviderControls.PreviousResponseID; got != "" {
		t.Fatalf("replay PreviousResponseID=%q, want empty", got)
	}
	if len(recorder.requests[1].Messages) != 1 || messageTextForFloret(recorder.requests[1].Messages[0], true) != "full history" {
		t.Fatalf("replay messages=%#v, want full projected history", recorder.requests[1].Messages)
	}
	if terminal == nil || terminal.ResponseState == nil || terminal.ResponseState.ID != "resp_next" {
		t.Fatalf("terminal event=%#v, want resp_next state", terminal)
	}
}

func TestFloretProviderAdapter_KeepsLastNonNilProviderState(t *testing.T) {
	t.Parallel()

	adapter := newFloretProviderAdapter(
		&recordingFlowerProvider{},
		"openai",
		"gpt-5-mini",
		"act",
		ProviderControls{},
		TurnBudgets{},
		"",
		nil,
		nil,
	)
	adapter.setCurrentProviderState(&flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_keep"})
	adapter.setCurrentProviderState(nil)
	got := adapter.currentProviderState()
	if got == nil || got.ID != "resp_keep" {
		t.Fatalf("currentProviderState=%#v, want last non-nil state", got)
	}
}

func TestFloretProviderAdapter_StreamsReasoningWithoutRunEvent(t *testing.T) {
	t.Parallel()

	adapter, r, store, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		streamReasoning: "Inspecting sources.",
		resultText:      "Final answer.",
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: "user", Content: "inspect"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var reasoningEventSeen bool
	for event := range stream {
		if event.Type == flruntime.ModelEventReasoning && event.Text == "Inspecting sources." {
			reasoningEventSeen = true
		}
	}
	if !reasoningEventSeen {
		t.Fatalf("missing ModelEventReasoning for streamed reasoning")
	}

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want thinking and markdown blocks: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	thinking, ok := r.assistantBlocks[0].(*persistedThinkingBlock)
	if !ok || thinking == nil || thinking.Content != "Inspecting sources." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want streamed thinking block", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	markdown, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || markdown == nil || markdown.Content != "Final answer." {
		t.Fatalf("assistantBlocks[1]=%T %+v, want final markdown block", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	if len(*events) != 4 {
		t.Fatalf("stream events=%d, want thinking start/delta and markdown start/delta: %#v", len(*events), *events)
	}
	if ev, ok := (*events)[0].(streamEventBlockStart); !ok || ev.BlockType != "thinking" || ev.BlockIndex != 0 {
		t.Fatalf("event[0]=%T %+v, want thinking block-start", (*events)[0], (*events)[0])
	}
	if ev, ok := (*events)[1].(streamEventBlockDelta); !ok || ev.BlockIndex != 0 || ev.Delta != "Inspecting sources." {
		t.Fatalf("event[1]=%T %+v, want thinking block-delta", (*events)[1], (*events)[1])
	}

	runEvents, err := store.ListRunEvents(context.Background(), "env_floret_reasoning", "run_floret_reasoning", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if len(runEvents) != 0 {
		t.Fatalf("run events=%#v, want none for streamed reasoning", runEvents)
	}
}

func TestFloretProviderAdapter_ResultReasoningFallbackWithoutRunEvent(t *testing.T) {
	t.Parallel()

	adapter, r, store, _ := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		resultReasoning: "Fallback reasoning.",
		omitResultText:  true,
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: "user", Content: "answer"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var reasoningEventSeen bool
	for event := range stream {
		if event.Type == flruntime.ModelEventReasoning && event.Text == "Fallback reasoning." {
			reasoningEventSeen = true
		}
	}
	if !reasoningEventSeen {
		t.Fatalf("missing ModelEventReasoning for result reasoning fallback")
	}

	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want thinking block: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	thinking, ok := r.assistantBlocks[0].(*persistedThinkingBlock)
	if !ok || thinking == nil || thinking.Content != "Fallback reasoning." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want fallback thinking block", r.assistantBlocks[0], r.assistantBlocks[0])
	}

	runEvents, err := store.ListRunEvents(context.Background(), "env_floret_reasoning", "run_floret_reasoning", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if len(runEvents) != 0 {
		t.Fatalf("run events=%#v, want none for fallback reasoning", runEvents)
	}
}

func TestFloretProviderAdapter_PersistsThinkingInTranscriptOnly(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	adapter, r, store, _ := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		streamReasoning: "Inspecting transcript contract.",
		resultText:      "Final transcript answer.",
	})
	stream, err := adapter.StreamModel(ctx, flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: "user", Content: "answer"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}

	r.assistantCreatedAtUnixMs = 1700000000000
	assistantJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Final transcript answer." {
		t.Fatalf("assistantText=%q, want visible answer only", assistantText)
	}
	if !strings.Contains(assistantJSON, `"type":"thinking"`) || !strings.Contains(assistantJSON, "Inspecting transcript contract.") {
		t.Fatalf("assistant JSON missing thinking block: %s", assistantJSON)
	}

	if _, err := store.AppendMessage(ctx, "env_floret_reasoning", "thread_floret_reasoning", threadstore.Message{
		ThreadID:        "thread_floret_reasoning",
		EndpointID:      "env_floret_reasoning",
		MessageID:       "msg_floret_reasoning",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: assistantAt,
		UpdatedAtUnixMs: assistantAt,
		TextContent:     assistantText,
		MessageJSON:     assistantJSON,
	}, "", ""); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	messages, _, _, err := store.ListMessages(ctx, "env_floret_reasoning", "thread_floret_reasoning", 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages=%d, want 1", len(messages))
	}
	if messages[0].TextContent != "Final transcript answer." {
		t.Fatalf("TextContent=%q, want visible answer only", messages[0].TextContent)
	}
	if !strings.Contains(messages[0].MessageJSON, `"type":"thinking"`) || !strings.Contains(messages[0].MessageJSON, "Inspecting transcript contract.") {
		t.Fatalf("persisted message JSON missing thinking block: %s", messages[0].MessageJSON)
	}

	runEvents, err := store.ListRunEvents(ctx, "env_floret_reasoning", "run_floret_reasoning", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if len(runEvents) != 0 {
		t.Fatalf("run events=%#v, want none for transcript reasoning", runEvents)
	}
}

func TestFloretMessagesToFlowerRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	_, err := floretMessagesToFlower([]flruntime.ModelMessage{{Role: "developer", Content: "unsupported"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported Floret model message role") {
		t.Fatalf("error=%v, want unsupported role rejection", err)
	}
}

func TestFloretMessagesToFlower_GroupsConsecutiveAssistantToolCalls(t *testing.T) {
	t.Parallel()

	got, err := floretMessagesToFlower([]flruntime.ModelMessage{
		{Role: "user", Content: "inspect and edit"},
		{Role: "assistant", Content: "tool_call", Reasoning: "use both tools", ToolCallID: "todo-1", ToolName: "write_todos", ToolArgs: `{"todos":[{"content":"inspect","status":"in_progress"}]}`},
		{Role: "assistant", Content: "tool_call", Reasoning: "use both tools", ToolCallID: "shell-1", ToolName: "terminal.exec", ToolArgs: `{"command":"mkdir -p smoke"}`},
		{Role: "tool", Content: `{"status":"success","summary":"updated todos"}`, ToolCallID: "todo-1", ToolName: "write_todos"},
		{Role: "tool", Content: `{"status":"success","summary":"created directory"}`, ToolCallID: "shell-1", ToolName: "terminal.exec"},
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

	got, err := floretMessagesToFlower([]flruntime.ModelMessage{
		{Role: "user", Content: "ask a structured question"},
		{Role: "assistant", Content: "tool_call", ToolCallID: "ask-1", ToolName: "ask_user", ToolArgs: `{"questions":[]}`},
		{Role: "tool", Content: "ask_user was rejected because reason_code is missing or invalid.", ToolCallID: "ask-1", ToolName: "ask_user"},
		{Role: "assistant", Content: "tool_call", ToolCallID: "ask-2", ToolName: "ask_user", ToolArgs: `{"questions":[{"id":"q1"}]}`},
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

	_, err := floretMessagesToFlower([]flruntime.ModelMessage{
		{Role: "user", Content: "continue"},
		{Role: "tool", Content: `{"status":"success"}`, ToolCallID: "read-1", ToolName: "file.read"},
	})
	if err == nil || !strings.Contains(err.Error(), "without a preceding assistant tool call") {
		t.Fatalf("error=%v, want orphan ordinary tool result rejection", err)
	}
}

func TestFloretMessagesToFlowerRejectsInvalidToolArgs(t *testing.T) {
	t.Parallel()

	_, err := floretMessagesToFlower([]flruntime.ModelMessage{{
		Role:       "assistant",
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

	_, err := flowerToolsFromFloret([]fltools.ToolDefinition{{
		Name:        "terminal.exec",
		InputSchema: map[string]any{"bad": func() {}},
	}})
	if err == nil || !strings.Contains(err.Error(), "invalid Floret tool schema") {
		t.Fatalf("error=%v, want invalid tool schema", err)
	}
}
