package ai

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

type recordingFlowerProvider struct {
	req ModelGatewayRequest
}

func (p *recordingFlowerProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.req = req
	return ModelGatewayResult{FinishReason: "stop", Text: "ok"}, nil
}

type toolCallFlowerProvider struct {
	result ModelGatewayResult
}

func (p toolCallFlowerProvider) StreamTurn(context.Context, ModelGatewayRequest, func(StreamEvent)) (ModelGatewayResult, error) {
	return p.result, nil
}

type rejectedContinuationFlowerProvider struct {
	requests []ModelGatewayRequest
}

func (p *rejectedContinuationFlowerProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.requests = append(p.requests, req)
	return ModelGatewayResult{}, errors.New("invalid previous_response_id")
}

func TestFloretProviderAdapterRejectsRequestAfterRunExecutionCloses(t *testing.T) {
	recorder := &recordingFlowerProvider{}
	r := &run{}
	r.closeExecution()
	adapter := newFloretProviderAdapter(
		recorder,
		"openai_compatible",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
		withFloretRequestAdmission(r.beginExecutionAdmission),
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		ThreadID:      "thread_stopped",
		PromptScopeID: "thread_stopped",
		Model:         "gpt-5-mini",
		Messages:      []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "continue"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var streamErr error
	for event := range stream {
		if event.Type == flruntime.ModelEventError {
			streamErr = event.Err
		}
	}
	if !errors.Is(streamErr, ErrRunExecutionClosed) {
		t.Fatalf("provider stream error=%v, want %v", streamErr, ErrRunExecutionClosed)
	}
	if recorder.req.Model != "" {
		t.Fatalf("provider received request after execution closed: %#v", recorder.req)
	}
}

func TestFloretProviderAdapter_ReasoningSelectionControlsProviderRequest(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	capability := config.AIReasoningCapability{
		Kind:             "effort",
		SupportedLevels:  []string{"off", "high"},
		DefaultLevel:     "high",
		DisableSupported: true,
		WireShape:        "deepseek_reasoning_effort",
		DisableShape:     "thinking.type=disabled",
		SourceURLs:       []string{"https://api-docs.deepseek.com/guides/reasoning_model"},
		SourceCheckedAt:  "2026-06-23",
		Fixture:          "deepseek_v4_reasoning_effort",
	}
	adapter := newFloretProviderAdapter(
		recorder,
		"deepseek",
		"deepseek-v4-pro",
		ProviderControls{
			ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelHigh, BudgetTokens: 4096},
			ReasoningCapability: capability,
		},
		TurnBudgets{},
		"",
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		ThreadID:        "thread",
		PromptScopeID:   "thread",
		Model:           "deepseek-v4-pro",
		Messages:        []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "请生成标题"}},
		MaxOutputTokens: 64,
		Reasoning:       flruntime.ReasoningSelection{Level: flruntime.ReasoningLevelOff},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}
	if got := recorder.req.ProviderControls.ReasoningSelection; got.Level != config.AIReasoningLevelOff || got.BudgetTokens != 0 {
		t.Fatalf("ReasoningSelection=%+v, want off with no budget", got)
	}
	if recorder.req.ProviderControls.ReasoningCapability.WireShape != capability.WireShape {
		t.Fatalf("ReasoningCapability=%+v, want %q wire shape", recorder.req.ProviderControls.ReasoningCapability, capability.WireShape)
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
	sources         []SourceRef
	streamEvents    []StreamEvent
}

func (p reasoningFlowerProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p.streamReasoning != "" {
		onEvent(StreamEvent{Type: StreamEventThinkingDelta, Text: p.streamReasoning})
	}
	for _, event := range p.streamEvents {
		onEvent(event)
	}
	text := p.resultText
	if text == "" && !p.omitResultText {
		text = "final answer"
	}
	return ModelGatewayResult{
		FinishReason: "stop",
		Text:         text,
		Reasoning:    p.resultReasoning,
		Sources:      append([]SourceRef(nil), p.sources...),
	}, nil
}

func newFloretProviderAdapterRunTest(t *testing.T, provider ModelGateway) (*floretProviderAdapter, *run, *threadstore.Store, *[]any) {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: "env_floret_reasoning", ThreadID: "thread_floret_reasoning",
		PermissionType: config.AIPermissionFullAccess, WorkingDir: t.TempDir(),
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	events := make([]any, 0, 4)
	r := newFloretRuntimeTestRun(t, runOptions{
		RunID:         "run_floret_reasoning",
		EndpointID:    "env_floret_reasoning",
		ThreadID:      "thread_floret_reasoning",
		MessageID:     "msg_floret_reasoning",
		OnStreamEvent: func(ev any) { events = append(events, ev) },
	}, store)
	adapter := newFloretProviderAdapter(
		provider,
		"openai",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
	)
	return adapter, r, store, &events
}

func TestFloretProviderAdapter_UsesRedevenModelNameInsteadOfFloretPlaceholder(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5.2",
		ProviderControls{},
		TurnBudgets{},
		"",
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "redeven-model-adapter",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "hello"}},
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

func TestFloretProviderAdapter_FiltersDisabledCoreControlToolsFromRequest(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
		withDisabledFloretCoreControlTools("ask_user"),
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "hello"}},
		Tools: []fltools.ToolDefinition{
			{Name: "ask_user", InputSchema: map[string]any{"type": "object"}},
			{Name: "terminal.exec", InputSchema: map[string]any{"type": "object"}},
		},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}
	names := make([]string, 0, len(recorder.req.Tools))
	for _, tool := range recorder.req.Tools {
		names = append(names, strings.TrimSpace(tool.Name))
	}
	if containsString(names, "ask_user") {
		t.Fatalf("provider tools=%v, disabled ask_user must not be exposed", names)
	}
	if !containsString(names, "terminal.exec") {
		t.Fatalf("provider tools=%v, want terminal.exec preserved", names)
	}
}

func TestFloretProviderAdapter_ErrorsWhenDisabledCoreControlToolIsReturned(t *testing.T) {
	t.Parallel()

	adapter := newFloretProviderAdapter(
		toolCallFlowerProvider{result: ModelGatewayResult{
			FinishReason: "tool_calls",
			ToolCalls: []ToolCall{{
				ID:   "ask_1",
				Name: "ask_user",
				Args: map[string]any{"question": "Need input?"},
			}},
		}},
		"openai",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
		withDisabledFloretCoreControlTools("ask_user"),
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "hello"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var errorEvent *flruntime.ModelEvent
	var toolCallsEvent *flruntime.ModelEvent
	var doneEvent *flruntime.ModelEvent
	for event := range stream {
		switch event.Type {
		case flruntime.ModelEventError:
			ev := event
			errorEvent = &ev
		case flruntime.ModelEventToolCalls:
			ev := event
			toolCallsEvent = &ev
		case flruntime.ModelEventDone:
			ev := event
			doneEvent = &ev
		}
	}
	if errorEvent == nil || !strings.Contains(errorEvent.Reason, "ask_user") {
		t.Fatalf("error event=%#v, want disabled ask_user error", errorEvent)
	}
	if toolCallsEvent != nil {
		t.Fatalf("tool calls event=%#v, want disabled control call suppressed", toolCallsEvent)
	}
	if doneEvent != nil {
		t.Fatalf("done event=%#v, want no success terminal after disabled control call", doneEvent)
	}
}

func TestFloretProviderAdapter_UsesProjectedPreviousState(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Step:            1,
		Model:           "gpt-5-mini",
		Messages:        []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "full history"}},
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
	if len(recorder.req.Messages) != 1 || len(recorder.req.Messages[0].Content) != 1 || strings.TrimSpace(recorder.req.Messages[0].Content[0].Text) != "full history" {
		t.Fatalf("messages=%#v, want Floret-projected history", recorder.req.Messages)
	}
}

func TestFloretProviderAdapter_CompatibleResponsesRouteUsesProjectedPreviousState(t *testing.T) {
	t.Parallel()

	recorder := &recordingFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai_compatible",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		providerWebSearchModeExternalBrave,
	)
	if got := adapter.stateCompatibilityRoute(); got != "openai-responses" {
		t.Fatalf("state compatibility route=%q, want openai-responses", got)
	}
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:         "gpt-5-mini",
		Messages:      []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "search"}},
		PreviousState: &flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
		Tools: []fltools.ToolDefinition{{
			Name:        "web.search",
			InputSchema: fltools.StrictObject(map[string]any{"query": fltools.String("query")}, []string{"query"}),
		}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	for range stream {
	}
	if got := recorder.req.ProviderControls.PreviousResponseID; got != "resp_prev" {
		t.Fatalf("PreviousResponseID=%q, want resp_prev", got)
	}
}

func TestFloretProviderStateConversion_PreservesOpaqueAttributes(t *testing.T) {
	t.Parallel()

	original := &flruntime.ModelState{
		Kind: providerContinuationKindOpenAIResponses,
		ID:   "resp_state",
		Attributes: map[string]string{
			"cursor": "cur_1",
			"region": "iad",
		},
	}
	flower := floretProviderStateToFlower(original)
	if flower == nil {
		t.Fatalf("floretProviderStateToFlower returned nil")
	}
	flower.Attributes["cursor"] = "mutated"
	if original.Attributes["cursor"] != "cur_1" {
		t.Fatalf("original attributes mutated: %v", original.Attributes)
	}
	flower.Attributes["cursor"] = "cur_1"

	roundTrip, err := flowerProviderStateToFloret(flower)
	if err != nil {
		t.Fatalf("flowerProviderStateToFloret: %v", err)
	}
	if roundTrip == nil {
		t.Fatal("flowerProviderStateToFloret returned nil")
	}
	if roundTrip.Kind != original.Kind || roundTrip.ID != original.ID {
		t.Fatalf("roundTrip=%+v, want kind/id from original", roundTrip)
	}
	if roundTrip.Attributes["cursor"] != "cur_1" || roundTrip.Attributes["region"] != "iad" {
		t.Fatalf("roundTrip attributes=%v, want original attributes", roundTrip.Attributes)
	}
	roundTrip.Attributes["cursor"] = "changed"
	if flower.Attributes["cursor"] != "cur_1" {
		t.Fatalf("flower attributes mutated by roundTrip: %v", flower.Attributes)
	}
}

func TestFloretProviderStateConversion_RejectsIncompleteState(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name  string
		state *ModelGatewayState
	}{
		{name: "missing kind", state: &ModelGatewayState{ID: "resp_state"}},
		{name: "missing id", state: &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := flowerProviderStateToFloret(testCase.state); err == nil {
				t.Fatal("incomplete provider state was accepted")
			}
		})
	}
}

func TestFloretProviderAdapter_EmitsErrorForRejectedPreviousResponseIDWithoutReplay(t *testing.T) {
	t.Parallel()

	recorder := &rejectedContinuationFlowerProvider{}
	adapter := newFloretProviderAdapter(
		recorder,
		"openai",
		"gpt-5-mini",
		ProviderControls{},
		TurnBudgets{},
		"",
	)
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Step:            1,
		Model:           "gpt-5-mini",
		Messages:        []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "full history"}},
		PreviousState:   &flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
		MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var errorEvent *flruntime.ModelEvent
	var doneEvent *flruntime.ModelEvent
	for event := range stream {
		switch event.Type {
		case flruntime.ModelEventError:
			ev := event
			errorEvent = &ev
		case flruntime.ModelEventDone:
			ev := event
			doneEvent = &ev
		}
	}
	if len(recorder.requests) != 1 {
		t.Fatalf("request count=%d, want 1", len(recorder.requests))
	}
	if got := recorder.requests[0].ProviderControls.PreviousResponseID; got != "resp_prev" {
		t.Fatalf("PreviousResponseID=%q, want resp_prev", got)
	}
	if len(recorder.requests[0].Messages) != 1 || len(recorder.requests[0].Messages[0].Content) != 1 || strings.TrimSpace(recorder.requests[0].Messages[0].Content[0].Text) != "full history" {
		t.Fatalf("messages=%#v, want Floret-projected history", recorder.requests[0].Messages)
	}
	if errorEvent == nil || errorEvent.Err == nil || !strings.Contains(errorEvent.Reason, "previous_response_id") {
		t.Fatalf("error event=%#v, want rejected continuation error", errorEvent)
	}
	if doneEvent != nil {
		t.Fatalf("done event=%#v, want no terminal success after rejected continuation", doneEvent)
	}
}

func TestFloretProviderAdapter_StreamsReasoningWithoutMutatingRun(t *testing.T) {
	t.Parallel()

	adapter, r, _, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		streamReasoning: "Inspecting sources.",
		resultText:      "Final answer.",
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "inspect"}},
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
	if len(r.assistantBlocks) != 0 || len(*events) != 0 {
		t.Fatalf("provider adapter must not mutate run stream state: blocks=%#v events=%#v", r.assistantBlocks, *events)
	}

}

func TestFloretProviderAdapter_EmitsToolCallStreamEvents(t *testing.T) {
	t.Parallel()

	adapter, r, _, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		resultText: "Final answer.",
		streamEvents: []StreamEvent{
			{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: "call-1", Name: "read_file"}},
			{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: "call-1", Name: "read_file", ArgumentsJSON: `{"path":"secret.txt"}`}},
			{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: "call-1", Name: "read_file"}},
		},
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "inspect"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	got := make([]flruntime.ModelEventType, 0, 3)
	for event := range stream {
		switch event.Type {
		case flruntime.ModelEventToolCallStart, flruntime.ModelEventToolCallDelta, flruntime.ModelEventToolCallEnd:
			got = append(got, event.Type)
			if event.ToolCallStream == nil || event.ToolCallStream.ID != "call-1" || event.ToolCallStream.Name != "read_file" {
				t.Fatalf("tool call stream=%#v", event.ToolCallStream)
			}
		}
	}
	want := []flruntime.ModelEventType{
		flruntime.ModelEventToolCallStart,
		flruntime.ModelEventToolCallDelta,
		flruntime.ModelEventToolCallEnd,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool call stream events=%#v, want %#v", got, want)
	}
	if len(r.assistantBlocks) != 0 || len(*events) != 0 {
		t.Fatalf("provider adapter must not mutate run stream state: blocks=%#v events=%#v", r.assistantBlocks, *events)
	}
}

func TestFloretProviderAdapter_ResultReasoningFallbackDoesNotMutateRun(t *testing.T) {
	t.Parallel()

	adapter, r, _, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		resultReasoning: "Fallback reasoning.",
		omitResultText:  true,
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "answer"}},
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
	if len(r.assistantBlocks) != 0 || len(*events) != 0 {
		t.Fatalf("provider adapter must not mutate run stream state: blocks=%#v events=%#v", r.assistantBlocks, *events)
	}

}

func TestFloretProviderAdapter_EmitsSourcesWithoutMutatingRun(t *testing.T) {
	t.Parallel()

	adapter, r, _, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		resultText: "Final answer.",
		sources: []SourceRef{{
			Title: "Example docs",
			URL:   "https://example.test/docs",
		}},
	})
	stream, err := adapter.StreamModel(context.Background(), flruntime.ModelRequest{
		Model:    "gpt-5-mini",
		Messages: []flruntime.ModelMessage{{Role: flruntime.ModelMessageRoleUser, Text: "cite"}},
	})
	if err != nil {
		t.Fatalf("StreamModel: %v", err)
	}
	var sourceEvent *flruntime.ModelEvent
	for event := range stream {
		if event.Type == flruntime.ModelEventSources {
			ev := event
			sourceEvent = &ev
		}
	}
	if sourceEvent == nil || len(sourceEvent.Sources) != 1 || sourceEvent.Sources[0].URL != "https://example.test/docs" {
		t.Fatalf("source event=%#v", sourceEvent)
	}
	if len(r.collectedWebSources) != 0 || len(*events) != 0 {
		t.Fatalf("provider adapter must not mutate run source state: sources=%#v events=%#v", r.collectedWebSources, *events)
	}

}

func TestFloretProviderAdapter_ProjectsThinkingWithoutVisibleTextPollution(t *testing.T) {
	t.Parallel()

	_, r, _, _ := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{
		streamReasoning: "Inspecting transcript contract.",
		resultText:      "Final transcript answer.",
	})
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderReasoning, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationReasoningDelta, Text: "Inspecting transcript contract."}})
	sink.EmitEvent(flruntime.Event{Type: observation.EventTypeProviderDelta, Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "Final transcript answer."}})

	r.assistantCreatedAtUnixMs = 1700000000000
	assistantJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Final transcript answer." {
		t.Fatalf("assistantText=%q, want visible answer only", assistantText)
	}
	if !strings.Contains(assistantJSON, `"type":"thinking"`) || !strings.Contains(assistantJSON, "Inspecting transcript contract.") {
		t.Fatalf("assistant JSON missing thinking block: %s", assistantJSON)
	}

}

func TestFloretMessagesToFlowerRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	adapter := &floretProviderAdapter{}
	_, err := adapter.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{{Role: "developer", Text: "unsupported"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported model message role") {
		t.Fatalf("error=%v, want unsupported role rejection", err)
	}
}

func TestFloretMessagesToFlowerMapsGroupedAssistantToolCallsDirectly(t *testing.T) {
	t.Parallel()

	adapter := &floretProviderAdapter{}
	got, err := adapter.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{
		{Role: flruntime.ModelMessageRoleUser, Text: "inspect and edit"},
		{
			Role:      flruntime.ModelMessageRoleAssistant,
			Reasoning: "use both tools",
			ToolCalls: []fltools.ToolCall{
				{ID: "todo-1", Name: "write_todos", Args: `{"todos":[{"content":"inspect","status":"in_progress"}]}`},
				{ID: "shell-1", Name: "terminal.exec", Args: `{"command":"mkdir -p smoke"}`},
			},
		},
		{Role: flruntime.ModelMessageRoleTool, ToolResult: &flruntime.ModelToolResult{CallID: "todo-1", ToolName: "write_todos", Text: `{"status":"success","summary":"updated todos"}`}},
		{Role: flruntime.ModelMessageRoleTool, ToolResult: &flruntime.ModelToolResult{CallID: "shell-1", ToolName: "terminal.exec", Text: `{"status":"success","summary":"created directory"}`}},
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

func TestFloretMessagesToFlowerKeepsProviderSafeControlTextOpaque(t *testing.T) {
	t.Parallel()

	adapter := &floretProviderAdapter{}
	got, err := adapter.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{
		{Role: flruntime.ModelMessageRoleUser, Text: "ask a structured question"},
		{Role: flruntime.ModelMessageRoleAssistant, Text: `Host processed control signal "ask_user".`},
	})
	if err != nil {
		t.Fatalf("floretMessagesToFlower: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("messages=%d, want 2: %#v", len(got), got)
	}
	for _, msg := range got {
		if msg.Role == "tool" {
			t.Fatalf("provider-safe control text must stay opaque assistant text: %#v", got)
		}
		for _, part := range msg.Content {
			if part.Type == "tool_call" || part.ToolName == "ask_user" || part.ToolCallID != "" {
				t.Fatalf("control tool identity leaked into provider request mapping: %#v", got)
			}
		}
	}
	if got[1].Role != "assistant" || got[1].Content[0].Text != `Host processed control signal "ask_user".` {
		t.Fatalf("provider-safe control text mapping=%#v", got[1])
	}
}

func TestFloretMessagesToFlowerRejectsInvalidToolArgs(t *testing.T) {
	t.Parallel()

	adapter := &floretProviderAdapter{}
	_, err := adapter.floretMessagesToFlower(context.Background(), []flruntime.ModelMessage{{
		Role: flruntime.ModelMessageRoleAssistant,
		ToolCalls: []fltools.ToolCall{{
			ID:   "call-1",
			Name: "terminal.exec",
			Args: `{"command":`,
		}},
	}})
	if err == nil || !strings.Contains(err.Error(), "invalid JSON args") {
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
