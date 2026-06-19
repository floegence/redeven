package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type capturingTurnProvider struct {
	mu       sync.Mutex
	requests []TurnRequest
}

func (p *capturingTurnProvider) StreamTurn(_ context.Context, req TurnRequest, _ func(StreamEvent)) (TurnResult, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	p.mu.Unlock()
	return TurnResult{FinishReason: "stop", Text: "done"}, nil
}

func (p *capturingTurnProvider) firstRequest() TurnRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.requests) == 0 {
		return TurnRequest{}
	}
	return p.requests[0]
}

func TestRunNativeProjectsWebSearchToolThroughFloretGateway(t *testing.T) {
	t.Parallel()

	provider := &capturingTurnProvider{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_web_search_tool",
		ThreadID:  "thread_floret_web_search_tool",
		MessageID: "msg_floret_web_search_tool",
	})
	err := r.runNative(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "search the web"},
		Options: RunOptions{
			Mode: config.AIModePlan,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
		WebSearch: &config.AIProviderWebSearch{
			Mode: config.AIProviderWebSearchModeBrave,
		},
	}, "sk-test", "search the web", provider)
	if err != nil {
		t.Fatalf("runNative: %v", err)
	}
	req := provider.firstRequest()
	if !containsString(toolDefNames(req.Tools), "web.search") {
		t.Fatalf("provider tools=%v, want web.search", toolDefNames(req.Tools))
	}
	if req.WebSearchMode != providerWebSearchModeExternalBrave {
		t.Fatalf("WebSearchMode=%q, want %q", req.WebSearchMode, providerWebSearchModeExternalBrave)
	}
}

func toolDefNames(defs []ToolDef) []string {
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		if name := strings.TrimSpace(def.Name); name != "" {
			out = append(out, name)
		}
	}
	return out
}

func TestFloretEventSinkDoesNotProjectSanitizedProviderText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID:                 "msg_floret_event",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_delta", Message: "text"})
	sink.EmitEvent(flruntime.Event{Type: "provider_reasoning", Message: "thinking"})

	if len(r.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("provider event sink wrote assistant output: blocks=%#v events=%#v", r.assistantBlocks, events)
	}
}

func TestFloretEventSinkProjectsStreamObservationDeltas(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := &run{
		messageID:                 "msg_floret_stream",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationReasoningDelta, Text: "thinking"}})
	sink.EmitEvent(flruntime.Event{Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "answer"}})

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want thinking and markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	thinking, ok := r.assistantBlocks[0].(*persistedThinkingBlock)
	if !ok || thinking.Content != "thinking" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want thinking", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	markdown, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || markdown.Content != "answer" {
		t.Fatalf("assistantBlocks[1]=%T %+v, want answer", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	if len(events) != 4 {
		t.Fatalf("stream events=%d, want block start/delta pairs: %#v", len(events), events)
	}
}

func TestFloretEventSinkPreservesWhitespaceStreamObservationDeltas(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                 "msg_floret_stream_whitespace",
		onStreamEvent:             func(any) {},
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	for _, text := range []string{"foo", " ", "bar", "\n"} {
		sink.EmitEvent(flruntime.Event{Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: text}})
	}
	for _, text := range []string{"think", " ", "step", "\n"} {
		sink.EmitEvent(flruntime.Event{Stream: &flruntime.StreamObservation{Type: flruntime.StreamObservationReasoningDelta, Text: text}})
	}

	var markdown *persistedMarkdownBlock
	var thinking *persistedThinkingBlock
	for _, block := range r.assistantBlocks {
		switch typed := block.(type) {
		case *persistedMarkdownBlock:
			markdown = typed
		case *persistedThinkingBlock:
			thinking = typed
		}
	}
	if markdown == nil || markdown.Content != "foo bar\n" {
		t.Fatalf("markdown=%#v, want preserved whitespace", markdown)
	}
	if thinking == nil || thinking.Content != "think step\n" {
		t.Fatalf("thinking=%#v, want preserved whitespace", thinking)
	}
}

func TestFloretEventSinkRecordsSourceObservations(t *testing.T) {
	t.Parallel()

	r := &run{}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Sources: []flruntime.SourceRef{{
		Title: "Example docs",
		URL:   "https://example.test/docs",
	}}})

	if len(r.collectedWebSourceOrder) != 1 {
		t.Fatalf("source order=%#v", r.collectedWebSourceOrder)
	}
	got := r.collectedWebSources["https://example.test/docs"]
	if got.Title != "Example docs" || got.URL != "https://example.test/docs" {
		t.Fatalf("source=%#v", got)
	}
}

func TestRedevenFloretGatewayConfigDoesNotCarryProviderConfiguration(t *testing.T) {
	t.Parallel()

	cfg := redevenFloretAdapterConfig("system", floretContextPolicy(1000, 800, 200))
	if cfg.Provider != flconfig.ProviderFake {
		t.Fatalf("provider=%q, want fake adapter identity", cfg.Provider)
	}
	if cfg.Model != "redeven-model-adapter" {
		t.Fatalf("model=%q, want adapter placeholder", cfg.Model)
	}
	if cfg.BaseURL != "" || cfg.APIKey != "" {
		t.Fatalf("Floret config must not carry Redeven provider endpoint or secret: base_url=%q api_key=%q", cfg.BaseURL, cfg.APIKey)
	}
}

func TestProjectFloretTaskCompleteCreatesMarkdownWhenNoVisibleTextExists(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_task_complete"
	r.threadID = "thread_floret_task_complete"
	r.messageID = "msg_floret_task_complete"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.recordObservationActivityEvent(observation.Event{
		Type:     observation.EventTypeControlSignal,
		ToolID:   "call_task_complete",
		ToolName: "task_complete",
		ToolKind: "control",
		Activity: &observation.ActivityPresentation{
			Label:    "task_complete",
			Renderer: observation.ActivityRendererCompletion,
			Payload:  map[string]any{"result": "Done."},
		},
	})

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status: flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:       "task_complete",
				CallID:     "call_task_complete",
				Payload:    map[string]any{"result": "Done."},
				OutputText: "Done.",
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	var blockSets []streamEventBlockSet
	for _, ev := range events {
		if bs, ok := ev.(streamEventBlockSet); ok {
			blockSets = append(blockSets, bs)
		}
	}
	if len(blockSets) != 2 {
		t.Fatalf("block-set events=%d, want activity update and canonical markdown: %#v", len(blockSets), blockSets)
	}
	if blockSets[0].BlockIndex != 0 {
		t.Fatalf("activity block-set index=%d, want 0", blockSets[0].BlockIndex)
	}
	if blockSets[1].BlockIndex != 1 {
		t.Fatalf("canonical block-set index=%d, want 1", blockSets[1].BlockIndex)
	}
	canonicalEvent, ok := blockSets[1].Block.(persistedMarkdownBlock)
	if !ok || canonicalEvent.Content != "Done." {
		t.Fatalf("canonical block-set block=%T %+v, want Done. markdown", blockSets[1].Block, blockSets[1].Block)
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want 2: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("block[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	text, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || text.Content != "Done." {
		t.Fatalf("block[1]=%T %+v, want final markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}
}

func TestProjectFloretTaskCompletePreservesStreamedMarkdownAfterActivity(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_task_complete_streamed"
	r.threadID = "thread_floret_task_complete_streamed"
	r.messageID = "msg_floret_task_complete_streamed"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.ensureAssistantMessageStarted()
	if err := r.appendTextDelta("Detailed analysis report."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_lookup",
		ToolName:   "terminal.exec",
		ToolKind:   "tool",
		Result:     "lookup complete",
		ObservedAt: time.Now(),
	})
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status: flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:       "task_complete",
				CallID:     "call_task_complete",
				Payload:    map[string]any{"result": "Execution summary."},
				OutputText: "Execution summary.",
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events[beforeProjectEventCount:] {
		if bs, ok := ev.(streamEventBlockSet); ok {
			if block, ok := bs.Block.(persistedMarkdownBlock); ok {
				t.Fatalf("unexpected markdown block-set after task_complete: index=%d block=%#v", bs.BlockIndex, block)
			}
		}
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want streamed markdown plus activity timeline: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Detailed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Detailed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
	}
}

func TestProjectFloretNaturalStopCreatesCanonicalMarkdownWithoutTextDelta(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_natural_stop"
	r.threadID = "thread_floret_natural_stop"
	r.messageID = "msg_floret_natural_stop"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_lookup",
		ToolName:   "terminal.exec",
		ToolKind:   "tool",
		Result:     "lookup complete",
		ObservedAt: time.Now(),
	})

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events {
		if _, ok := ev.(streamEventBlockDelta); ok {
			t.Fatalf("unexpected text delta event: %#v", ev)
		}
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want activity timeline plus canonical markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	text, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || text.Content != "Canonical answer." {
		t.Fatalf("assistantBlocks[1]=%T %+v, want canonical markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}
}

func TestProjectFloretNaturalStopPreservesStreamedMarkdownAfterActivity(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_natural_stop_streamed"
	r.threadID = "thread_floret_natural_stop_streamed"
	r.messageID = "msg_floret_natural_stop_streamed"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.ensureAssistantMessageStarted()
	if err := r.appendTextDelta("Streamed analysis report."); err != nil {
		t.Fatalf("appendTextDelta: %v", err)
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     "tool_lookup",
		ToolName:   "terminal.exec",
		ToolKind:   "tool",
		Result:     "lookup complete",
		ObservedAt: time.Now(),
	})
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events[beforeProjectEventCount:] {
		if bs, ok := ev.(streamEventBlockSet); ok {
			if block, ok := bs.Block.(persistedMarkdownBlock); ok {
				t.Fatalf("unexpected markdown block-set after natural stop: index=%d block=%#v", bs.BlockIndex, block)
			}
		}
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want streamed markdown plus activity timeline: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Streamed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Streamed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
	}
}

func TestFlowerMessagesToFloretRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	_, err := flowerMessagesToFloret([]Message{{Role: "developer"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported role") {
		t.Fatalf("error=%v, want unsupported role rejection", err)
	}
}

func TestProjectFloretResultIgnoresDetachedRun(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_detached_result"
	r.threadID = "thread_floret_detached_result"
	r.messageID = "msg_floret_detached_result"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.markDetached()

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Output:  "Late final answer.",
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult completed: %v", err)
	}
	err = r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status:  flruntime.TurnStatusWaiting,
			Metrics: flruntime.RunMetrics{Steps: 2},
			Signal: &flruntime.TurnSignal{
				Name: "ask_user",
				Payload: map[string]any{
					"questions": []any{map[string]any{"id": "q1", "question": "Late question?"}},
				},
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult waiting: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none after detach: %#v", len(events), events)
	}
	if r.getEndReason() != "" || r.getFinalizationReason() != "" {
		t.Fatalf("detached result mutated final state: end=%q final=%q", r.getEndReason(), r.getFinalizationReason())
	}
	if r.waitingPrompt != nil {
		t.Fatalf("detached waiting result set waiting prompt: %#v", r.waitingPrompt)
	}
	raw, text, _, err := r.snapshotAssistantMessageJSONWithStatus("canceled")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if text != "" {
		t.Fatalf("assistant text=%q, want empty canceled boundary", text)
	}
	var msg persistedMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if msg.Status != "canceled" || len(msg.Blocks) != 0 {
		t.Fatalf("snapshot status=%q blocks=%d, want canceled empty boundary", msg.Status, len(msg.Blocks))
	}
}
