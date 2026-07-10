package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type capturingTurnProvider struct {
	mu       sync.Mutex
	requests []ModelGatewayRequest
}

func (p *capturingTurnProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	p.mu.Unlock()
	return ModelGatewayResult{FinishReason: "stop", Text: "done"}, nil
}

func (p *capturingTurnProvider) firstRequest() ModelGatewayRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.requests) == 0 {
		return ModelGatewayRequest{}
	}
	return p.requests[0]
}

type streamedEmptyTaskCompleteProvider struct{}

func (streamedEmptyTaskCompleteProvider) StreamTurn(_ context.Context, _ ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "OK, continuing works."})
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID:   "call_task_complete_empty",
			Name: "task_complete",
			Args: map[string]any{},
		}},
	}, nil
}

type permissionDowngradeToolCallProvider struct {
	store      *threadstore.Store
	endpointID string
	threadID   string
	mu         sync.Mutex
	calls      int
	requests   []ModelGatewayRequest
}

func (p *permissionDowngradeToolCallProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, _ func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.calls++
	callIndex := p.calls
	p.requests = append(p.requests, req)
	p.mu.Unlock()
	if callIndex > 1 {
		return ModelGatewayResult{FinishReason: "stop", Text: "stale tool was rejected"}, nil
	}
	if err := p.store.UpdateThreadPermissionType(ctx, p.endpointID, p.threadID, config.AIPermissionReadonly); err != nil {
		return ModelGatewayResult{}, err
	}
	return ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID:   "call_terminal_after_downgrade",
			Name: "terminal.exec",
			Args: map[string]any{"command": "echo stale", "cwd": "/tmp"},
		}},
	}, nil
}

func (p *permissionDowngradeToolCallProvider) request(index int) ModelGatewayRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if index < 0 || index >= len(p.requests) {
		return ModelGatewayRequest{}
	}
	return p.requests[index]
}

type naturalCompactionProvider struct {
	mu       sync.Mutex
	requests []ModelGatewayRequest
}

func (p *naturalCompactionProvider) StreamTurn(_ context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	callIndex := len(p.requests)
	p.mu.Unlock()

	if callIndex == 1 {
		return ModelGatewayResult{FinishReason: "stop", Text: strings.Repeat("older assistant context ", 10000)}, nil
	}
	if callIndex == 2 {
		return ModelGatewayResult{FinishReason: "stop", Text: "Older context checkpoint summary."}, nil
	}
	onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "continued after natural compact"})
	return ModelGatewayResult{FinishReason: "stop"}, nil
}

func (p *naturalCompactionProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

func TestRunFloretHostedTurnCompletesEmptyTaskCompleteFromStreamedText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_empty_task_complete_streamed",
		ThreadID:  "thread_floret_empty_task_complete_streamed",
		MessageID: "msg_floret_empty_task_complete_streamed",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "finish with streamed text and task_complete"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "finish", streamedEmptyTaskCompleteProvider{})
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if got := r.getFinalizationReason(); got != "task_complete" {
		t.Fatalf("finalizationReason=%q, want task_complete", got)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "OK, continuing works." {
		t.Fatalf("assistantText=%q, want streamed final answer", assistantText)
	}
	if !hasFloretMarkdownContent(events, "OK, continuing works.") {
		t.Fatalf("events missing streamed markdown content: %#v", events)
	}
}

func TestRunFloretHostedTurnEmitsContextUsageFromPublishedHost(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	provider := &capturingTurnProvider{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_context_usage_projection",
		ThreadID:  "thread_floret_context_usage_projection",
		MessageID: "msg_floret_context_usage_projection",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "verify the published Floret host emits context status"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 128000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "verify context usage", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}

	usages := contextUsagesFromStreamEvents(events)
	if len(usages) == 0 {
		t.Fatalf("events missing context usage: %#v", events)
	}
	first := usages[0]
	if first.RunID != r.id ||
		first.Phase != observation.ContextPhaseProjectedRequest ||
		first.InputTokens <= 0 ||
		first.ContextWindowTokens <= 0 ||
		strings.TrimSpace(first.PressureStatus) == "" {
		t.Fatalf("context usage=%#v", first)
	}
}

func TestRunFloretHostedTurnInjectsAskFlowerLinkedContext(t *testing.T) {
	t.Parallel()

	provider := &capturingTurnProvider{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_linked_context",
		ThreadID:  "thread_floret_linked_context",
		MessageID: "msg_floret_linked_context",
	})

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{
			Text: "what is this process",
			Attachments: []RunAttachmentIn{{
				Name:     "notes.txt",
				MimeType: "text/plain",
				URL:      "/_redeven_proxy/api/ai/uploads/upl_notes",
			}},
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: "monitoring"},
				Context: []ContextActionContextItem{{
					Kind:         "process_snapshot",
					PID:          12264,
					Name:         "Codex (Service)",
					Username:     "tangjianyin",
					CPUPercent:   0.12,
					MemoryBytes:  575668224,
					Platform:     "darwin",
					CapturedAtMs: 1783677600000,
				}},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 128000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "verify linked context", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	requestText := modelGatewayRequestText(provider.firstRequest())
	for _, want := range []string{"what is this process", "Host-provided supplemental context", "process_snapshot", "pid: 12264", "Codex (Service)", "Attachment: notes.txt (text/plain)", "attachment_metadata"} {
		if !strings.Contains(requestText, want) {
			t.Fatalf("provider request missing %q:\n%s", want, requestText)
		}
	}
	if strings.Contains(requestText, "/_redeven_proxy/api/ai/uploads/") {
		t.Fatalf("provider request leaked upload URL:\n%s", requestText)
	}
}

func TestRunFloretHostedTurnRefreshesPermissionBeforeDispatch(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	const endpointID = "env_floret_dynamic_permission"
	const threadID = "thread_floret_dynamic_permission"
	const runID = "run_floret_dynamic_permission"
	if err := store.CreateThread(ctx, threadstore.Thread{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Title:           "dynamic permission",
		PermissionType:  config.AIPermissionApprovalRequired,
		CreatedAtUnixMs: 1,
		UpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			EndpointID: endpointID,
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     runID,
		ThreadID:  threadID,
		MessageID: "msg_floret_dynamic_permission",
	})
	r.endpointID = endpointID
	r.threadsDB = store

	provider := &permissionDowngradeToolCallProvider{
		store:      store,
		endpointID: endpointID,
		threadID:   threadID,
	}
	err = r.runFloretHostedTurn(ctx, RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "run stale terminal call"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "run stale terminal call", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}

	secondRequest := provider.request(1)
	var sawRejectedToolResult bool
	for _, message := range secondRequest.Messages {
		if message.Role != "tool" {
			continue
		}
		for _, part := range message.Content {
			if part.ToolCallID != "call_terminal_after_downgrade" {
				continue
			}
			if strings.Contains(part.Text, "unknown tool") || strings.Contains(part.Text, "permission") {
				sawRejectedToolResult = true
			}
		}
	}
	if !sawRejectedToolResult {
		t.Fatalf("second provider request missing rejected stale tool result: %#v", secondRequest.Messages)
	}
	runEvents, err := store.ListRunEvents(ctx, endpointID, runID, 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	var sawReadonlyUpdate bool
	for _, event := range runEvents {
		if event.EventType != "tool_surface.updated" || !strings.Contains(event.PayloadJSON, `"permission_type":"readonly"`) {
			continue
		}
		sawReadonlyUpdate = true
	}
	if !sawReadonlyUpdate {
		t.Fatalf("missing readonly tool_surface.updated event: %#v", runEvents)
	}
}

func TestRunFloretHostedTurnNaturalCompactionContinuesStreaming(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 16)
	provider := &naturalCompactionProvider{}
	stateDir := t.TempDir()
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateDir,
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_natural_compact_streaming",
		ThreadID:  "thread_floret_natural_compact_streaming",
		MessageID: "msg_floret_natural_compact_streaming",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "seed old context"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 50000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "seed", provider)
	if err != nil {
		t.Fatalf("seed runFloretHostedTurn: %v", err)
	}

	events = events[:0]
	r = newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateDir,
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_natural_compact_streaming_next",
		ThreadID:  "thread_floret_natural_compact_streaming",
		MessageID: "msg_floret_natural_compact_streaming_next",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err = r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "continue after compacting"},
		Options: RunOptions{
			PermissionType:  config.AIPermissionApprovalRequired,
			MaxInputTokens:  48000,
			MaxOutputTokens: 500,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 50000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "continue", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if provider.requestCount() < 3 {
		t.Fatalf("provider request count=%d, want seed, summary, and post-compaction provider requests", provider.requestCount())
	}
	if got := r.getFinalizationReason(); got != "natural_stop" {
		t.Fatalf("finalizationReason=%q, want natural_stop", got)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "continued after natural compact" {
		t.Fatalf("assistantText=%q, want post-compaction streamed output", assistantText)
	}
	if !hasFloretMarkdownContent(events, "continued after natural compact") {
		t.Fatalf("events missing post-compaction markdown content: %#v", events)
	}
	if got := compactStatusesFromStreamEvents(events); len(got) < 2 || got[0] != "compacting" || got[len(got)-1] != "compacted" {
		t.Fatalf("compaction statuses=%#v, want compacting -> compacted", got)
	}
}

func TestRunFloretHostedTurnManualCompactionNoopContinuesStreaming(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 16)
	provider := &capturingTurnProvider{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		AIConfig:     &config.AIConfig{},
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
			CanAdmin:   true,
		},
		RunID:     "run_floret_manual_noop_streaming",
		ThreadID:  "thread_floret_manual_noop_streaming",
		MessageID: "msg_floret_manual_noop_streaming",
	})
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.pendingManualCompaction = &flruntime.ManualCompactionRequest{
		RequestID:   "manual-noop-request",
		Source:      "slash_command",
		RequestedAt: time.UnixMilli(1_000),
	}
	r.contextCompactionAnchors = map[string]FlowerTimelineAnchor{
		"manual-noop-request": {
			TargetKind: "message",
			MessageID:  "msg_floret_manual_noop_streaming",
			Edge:       "after",
		},
	}

	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "short turn with manual compact"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
		ModelCapability: contextmodel.ModelCapability{
			MaxContextTokens: 256000,
		},
	}, config.AIProvider{
		ID:      "compat",
		Type:    "openai_compatible",
		BaseURL: "https://example.test/v1",
	}, "sk-test", "manual noop", provider)
	if err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}
	if got := compactStatusesFromStreamEvents(events); len(got) == 0 || got[len(got)-1] != "noop" {
		t.Fatalf("compaction statuses=%#v, want terminal noop", got)
	}
	if r.activeManualCompactionID != "" {
		t.Fatalf("activeManualCompactionID=%q, want cleared after noop", r.activeManualCompactionID)
	}
	if _, ok := r.completeManualCompactionIDs["manual-noop-request"]; !ok {
		t.Fatalf("completeManualCompactionIDs=%#v, want noop request recorded complete", r.completeManualCompactionIDs)
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "done" {
		t.Fatalf("assistantText=%q, want provider response after noop", assistantText)
	}
}

func hasFloretMarkdownContent(events []any, content string) bool {
	for _, ev := range events {
		if blockDelta, ok := ev.(streamEventBlockDelta); ok && blockDelta.Delta == content {
			return true
		}
		if blockSet, ok := ev.(streamEventBlockSet); ok {
			if block, ok := blockSet.Block.(persistedMarkdownBlock); ok && block.Content == content {
				return true
			}
			if block, ok := blockSet.Block.(persistedTextBlock); ok && block.Content == content {
				return true
			}
		}
	}
	return false
}

func modelGatewayRequestText(req ModelGatewayRequest) string {
	var b strings.Builder
	for _, msg := range req.Messages {
		for _, part := range msg.Content {
			if text := strings.TrimSpace(part.Text); text != "" {
				if b.Len() > 0 {
					b.WriteString("\n\n")
				}
				b.WriteString(text)
			}
		}
	}
	return b.String()
}

func compactStatusesFromStreamEvents(events []any) []string {
	out := make([]string, 0, 2)
	for _, ev := range events {
		if compaction, ok := ev.(streamEventContextCompaction); ok {
			out = append(out, strings.TrimSpace(compaction.Compaction.Status))
		}
	}
	return out
}

func contextUsagesFromStreamEvents(events []any) []FlowerContextUsage {
	out := make([]FlowerContextUsage, 0, 2)
	for _, ev := range events {
		if usage, ok := ev.(streamEventContextUsage); ok {
			out = append(out, usage.Usage)
		}
	}
	return out
}

func TestRunFloretHostedTurnProjectsWebSearchToolThroughFloretGateway(t *testing.T) {
	t.Parallel()

	provider := &capturingTurnProvider{}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
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
	err := r.runFloretHostedTurn(t.Context(), RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "search the web"},
		Options: RunOptions{
			PermissionType: config.AIPermissionReadonly,
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
		t.Fatalf("runFloretHostedTurn: %v", err)
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
	if len(events) != 5 {
		t.Fatalf("stream events=%d, want model io plus block start/delta pairs: %#v", len(events), events)
	}
	if _, ok := events[0].(streamEventModelIOStatus); !ok {
		t.Fatalf("events[0]=%T, want model io status", events[0])
	}
}

func TestFloretEventSinkProjectsToolCallStreamObservationToModelIO(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		messageID:                 "msg_floret_tool_stream",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Stream: &flruntime.StreamObservation{
		Type: flruntime.StreamObservationToolCallDelta,
		ToolCallStream: &flruntime.ModelToolCallStream{
			ID:   "call-1",
			Name: "read_file",
		},
		Attempt: 2,
	}})

	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no message block for tool call stream observation", r.assistantBlocks)
	}
	if len(events) != 1 {
		t.Fatalf("events=%#v, want one model io status event", events)
	}
	modelIO, ok := events[0].(streamEventModelIOStatus)
	if !ok {
		t.Fatalf("event=%T, want streamEventModelIOStatus", events[0])
	}
	if modelIO.Phase != string(FlowerModelIOPhaseStreaming) || modelIO.StepIndex != 2 {
		t.Fatalf("modelIO=%#v, want streaming step 2", modelIO)
	}
}

func TestFloretEventSinkProjectsContextObservations(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		id:            "run_context_projection",
		threadID:      "thread_context_projection",
		messageID:     "msg_context_projection",
		onStreamEvent: func(ev any) { events = append(events, ev) },
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		RunID: "msg_context_projection",
		ContextStatus: &observation.ContextStatus{
			RunID:    "msg_context_projection",
			ThreadID: "thread_context_projection",
			TurnID:   "msg_context_projection",
			Step:     1,
			Phase:    observation.ContextPhaseProjectedRequest,
			ContextPressure: flconfig.ContextPressure{
				ProjectedInputTokens: 600,
				ContextWindowTokens:  1000,
				ThresholdTokens:      900,
				RequestSafeLimit:     800,
				OutputHeadroomTokens: 200,
				Source:               flconfig.PressureSourceFullRequestEstimate,
			},
			UsedRatio:      0.6,
			ThresholdRatio: 0.9,
			Status:         observation.ContextStatusStable,
			ObservedAt:     time.UnixMilli(10_000),
		},
	})
	sink.EmitEvent(flruntime.Event{
		RunID: "run_context_projection",
		Compaction: &observation.CompactionEvent{
			RunID:               "run_context_projection",
			ThreadID:            "thread_context_projection",
			TurnID:              "msg_context_projection",
			Step:                1,
			OperationID:         "run_context_projection:compact:1:pre_request:threshold",
			Phase:               observation.CompactionPhaseStart,
			Status:              observation.CompactionStatusRunning,
			Trigger:             "pre_request",
			Reason:              "threshold",
			TokensBefore:        920,
			TokensAfterEstimate: 0,
			ObservedAt:          time.UnixMilli(10_001),
		},
	})

	if len(events) != 2 {
		t.Fatalf("events=%#v, want context usage and compaction", events)
	}
	usage, ok := events[0].(streamEventContextUsage)
	if !ok {
		t.Fatalf("events[0]=%T, want streamEventContextUsage", events[0])
	}
	if usage.Usage.RunID != "run_context_projection" ||
		usage.Usage.Phase != observation.ContextPhaseProjectedRequest ||
		usage.Usage.InputTokens != 600 ||
		usage.Usage.ContextWindowTokens != 1000 ||
		usage.Usage.PressureStatus != observation.ContextStatusStable {
		t.Fatalf("usage=%#v", usage.Usage)
	}
	compaction, ok := events[1].(streamEventContextCompaction)
	if !ok {
		t.Fatalf("events[1]=%T, want streamEventContextCompaction", events[1])
	}
	if compaction.Compaction.OperationID == "" ||
		compaction.Compaction.Status != "compacting" ||
		compaction.Compaction.Phase != observation.CompactionPhaseStart {
		t.Fatalf("compaction=%#v", compaction.Compaction)
	}
}

func TestHostManagedContextCompactionDefersLiveProjection(t *testing.T) {
	t.Parallel()

	_, r, store, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{})
	r.hostManagedContextCompaction = true
	r.activeManualCompactionID = "manual-host-managed"

	r.applyFloretCompaction(&observation.CompactionEvent{
		RunID:               "run_floret_reasoning",
		ThreadID:            "thread_floret_reasoning",
		TurnID:              "msg_floret_reasoning",
		Step:                1,
		OperationID:         "run_floret_reasoning:compact:1:manual:manual-host-managed",
		RequestID:           "manual-host-managed",
		Phase:               observation.CompactionPhaseComplete,
		Status:              observation.CompactionStatusCompacted,
		Trigger:             "manual",
		Reason:              "manual",
		TokensBefore:        1_000,
		TokensAfterEstimate: 300,
		ObservedAt:          time.UnixMilli(30_000),
	})

	if len(*events) != 0 {
		t.Fatalf("stream events=%#v, want host-managed compaction to defer live projection", *events)
	}
	runEvents, err := store.ListRunEvents(context.Background(), "env_floret_reasoning", "run_floret_reasoning", 10)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	for _, event := range runEvents {
		if event.EventType == string(FlowerLiveContextCompactionUpdated) {
			t.Fatalf("unexpected persisted live compaction event: %#v", event)
		}
	}
	completed := r.getCompletedContextCompaction()
	if completed.OperationID != "run_floret_reasoning:compact:1:manual:manual-host-managed" {
		t.Fatalf("completed compaction=%#v, want operation retained", completed)
	}
	if r.activeManualCompactionID != "" {
		t.Fatalf("activeManualCompactionID=%q, want cleared", r.activeManualCompactionID)
	}
	if _, ok := r.completeManualCompactionIDs["manual-host-managed"]; !ok {
		t.Fatalf("completeManualCompactionIDs=%#v, want manual request recorded complete", r.completeManualCompactionIDs)
	}
}

func TestFloretEventSinkPersistsCompactionDebugWithoutProjectingTimeline(t *testing.T) {
	t.Parallel()

	_, r, store, events := newFloretProviderAdapterRunTest(t, reasoningFlowerProvider{})
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		Type: floretEventContextCompactDebug,
		CompactionDebug: &observation.CompactionDebugEvent{
			RunID:                        "run_floret_reasoning",
			ThreadID:                     "thread_floret_reasoning",
			TurnID:                       "msg_floret_reasoning",
			Step:                         3,
			OperationID:                  "op_compact_debug",
			RequestID:                    "req_compact_debug",
			Stage:                        observation.CompactionDebugStageRequestValidation,
			Status:                       observation.CompactionDebugStatusRetrying,
			Trigger:                      "manual",
			Reason:                       "slash_command",
			Source:                       "manual",
			CompactionConvergenceAttempt: 2,
			TokensBefore:                 101_000,
			TokensAfterEstimate:          45_000,
			RequestSafeLimit:             80_000,
			HardLimitExceeded:            true,
			DurationMS:                   1234,
			ProviderStateKind:            "responses",
			NextAction:                   "provider_request",
			Error:                        "validation pressure still high",
			ObservedAt:                   time.UnixMilli(20_000),
		},
	})
	sink.EmitEvent(flruntime.Event{
		Type: floretEventContextCompactDebug,
		CompactionDebug: &observation.CompactionDebugEvent{
			RunID:       "run_floret_reasoning",
			ThreadID:    "thread_floret_reasoning",
			TurnID:      "msg_floret_reasoning",
			Step:        3,
			OperationID: "op_compact_debug",
			RequestID:   "req_compact_debug",
			Stage:       observation.CompactionDebugStagePreflight,
			Status:      observation.CompactionDebugStatusFailed,
			Trigger:     "manual",
			Reason:      "manual",
			Source:      "slash_command",
			Error:       "compaction manager is required when context exceeds policy",
			ObservedAt:  time.UnixMilli(20_100),
		},
	})

	if len(*events) != 0 {
		t.Fatalf("stream events=%#v, want no UI projection for compaction debug", *events)
	}
	runEvents, err := store.ListRunEvents(context.Background(), "env_floret_reasoning", "run_floret_reasoning", 10)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if len(runEvents) != 2 {
		t.Fatalf("run events=%#v, want exactly two debug events", runEvents)
	}
	if runEvents[0].EventType != "floret.context.compact.debug" || runEvents[0].StreamKind != string(RealtimeStreamKindContext) {
		t.Fatalf("run event=%#v, want context compaction debug", runEvents[0])
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(runEvents[0].PayloadJSON), &payload); err != nil {
		t.Fatalf("payload json: %v", err)
	}
	for key, want := range map[string]string{
		"operation_id":        "op_compact_debug",
		"request_id":          "req_compact_debug",
		"stage":               observation.CompactionDebugStageRequestValidation,
		"status":              observation.CompactionDebugStatusRetrying,
		"provider_state_kind": "responses",
		"next_action":         "provider_request",
		"error":               "validation pressure still high",
	} {
		if got := strings.TrimSpace(anyToString(payload[key])); got != want {
			t.Fatalf("payload[%s]=%q, want %q in %#v", key, got, want, payload)
		}
	}
	if payload["tokens_before"] != float64(101_000) ||
		payload["tokens_after_estimate"] != float64(45_000) ||
		payload["request_safe_limit"] != float64(80_000) ||
		payload["duration_ms"] != float64(1234) ||
		payload["observed_at_unix_ms"] != float64(20_000) ||
		payload["hard_limit_exceeded"] != true {
		t.Fatalf("payload numeric fields=%#v", payload)
	}
	if err := json.Unmarshal([]byte(runEvents[1].PayloadJSON), &payload); err != nil {
		t.Fatalf("preflight payload json: %v", err)
	}
	for key, want := range map[string]string{
		"operation_id": "op_compact_debug",
		"request_id":   "req_compact_debug",
		"stage":        observation.CompactionDebugStagePreflight,
		"status":       observation.CompactionDebugStatusFailed,
		"source":       "slash_command",
		"error":        "compaction manager is required when context exceeds policy",
	} {
		if got := strings.TrimSpace(anyToString(payload[key])); got != want {
			t.Fatalf("preflight payload[%s]=%q, want %q in %#v", key, got, want, payload)
		}
	}
}

func TestFloretActivityClearsModelIOBeforeLocalToolExecution(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 3)
	r := &run{
		id:            "run_model_io_activity",
		threadID:      "thread_model_io_activity",
		messageID:     "msg_model_io_activity",
		onStreamEvent: func(ev any) { events = append(events, ev) },
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_finish", Step: 1, FinishReason: "tool_calls"})
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		RunID:      "run_model_io_activity",
		ThreadID:   "thread_model_io_activity",
		TurnID:     "msg_model_io_activity",
		ToolID:     "tool_read",
		ToolName:   "file.read",
		ToolKind:   "local",
		ObservedAt: time.Now(),
	})

	var modelIOEvents []streamEventModelIOStatus
	for _, ev := range events {
		if modelIO, ok := ev.(streamEventModelIOStatus); ok {
			modelIOEvents = append(modelIOEvents, modelIO)
		}
	}
	if len(modelIOEvents) != 2 {
		t.Fatalf("model IO events=%#v, want finalizing then clear", modelIOEvents)
	}
	if modelIOEvents[0].Phase != string(FlowerModelIOPhaseFinalizing) {
		t.Fatalf("first model IO=%#v, want finalizing", modelIOEvents[0])
	}
	if modelIOEvents[1].Phase != "" || modelIOEvents[1].RunID != "run_model_io_activity" {
		t.Fatalf("second model IO=%#v, want clear for run", modelIOEvents[1])
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

	cfg := redevenFloretAdapterConfig("system", floretModelContextPolicy(1000, 200), config.AIReasoningSelection{Level: config.AIReasoningLevelLow})
	if cfg.Provider != "" {
		t.Fatalf("provider=%q, want empty transport field", cfg.Provider)
	}
	if cfg.Model != "" {
		t.Fatalf("model=%q, want empty transport field", cfg.Model)
	}
	if cfg.BaseURL != "" || cfg.APIKey != "" {
		t.Fatalf("Floret config must not carry Redeven provider endpoint or secret: base_url=%q api_key=%q", cfg.BaseURL, cfg.APIKey)
	}
	if cfg.Reasoning.Level != config.AIReasoningLevelLow {
		t.Fatalf("reasoning=%+v, want low selection", cfg.Reasoning)
	}
	identity := redevenFloretGatewayIdentity(" provider-a ", " gpt-test ")
	if identity.Provider != "provider-a" || identity.Model != "gpt-test" {
		t.Fatalf("identity=%+v, want trimmed provider id/model", identity)
	}
	if identity == redevenFloretGatewayIdentity("provider-b", "gpt-test") {
		t.Fatalf("gateway identity must distinguish same-type providers by provider id")
	}
}

func TestProjectFloretTaskCompleteDoesNotCreateTranscriptMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_task_complete"
	r.threadID = "thread_floret_task_complete"
	r.messageID = "msg_floret_task_complete"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
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
		permissionTypeString(FlowerPermissionApprovalRequired),
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
	if len(blockSets) != 0 {
		t.Fatalf("block-set events=%d, want no local activity or markdown projection: %#v", len(blockSets), blockSets)
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks len=%d, want no local task_complete transcript projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
}

func TestProjectFloretTaskCompletePreservesStreamedMarkdown(t *testing.T) {
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
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
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
		permissionTypeString(FlowerPermissionApprovalRequired),
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
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want only streamed markdown without local activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Detailed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Detailed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
	}
}

func TestProjectFloretNaturalStopDoesNotCreateTranscriptMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_natural_stop"
	r.threadID = "thread_floret_natural_stop"
	r.messageID = "msg_floret_natural_stop"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	for _, ev := range events {
		if _, ok := ev.(streamEventBlockDelta); ok {
			t.Fatalf("unexpected text delta event: %#v", ev)
		}
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks len=%d, want no local transcript or activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
}

func TestProjectFloretNaturalStopDoesNotUseResultOutputAsTranscriptFallback(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_natural_stop_no_fallback"
	r.threadID = "thread_floret_natural_stop_no_fallback"
	r.messageID = "msg_floret_natural_stop_no_fallback"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Output:  "This must come from Floret detail events instead.",
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if r.hasNonEmptyAssistantText() {
		t.Fatalf("assistant blocks gained text from result output fallback: %#v", r.assistantBlocks)
	}
	for _, ev := range events {
		switch typed := ev.(type) {
		case streamEventBlockDelta:
			t.Fatalf("unexpected transcript delta from result output: %#v", typed)
		case streamEventBlockSet:
			if block, ok := typed.Block.(persistedMarkdownBlock); ok && strings.Contains(block.Content, "Floret detail events") {
				t.Fatalf("unexpected transcript block from result output: %#v", typed)
			}
		}
	}
}

func TestProjectFloretNaturalStopPreservesStreamedMarkdown(t *testing.T) {
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
	beforeProjectEventCount := len(events)

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusCompleted,
			Output: "Canonical answer.",
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
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
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want only streamed markdown without local activity projection: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	text, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || text.Content != "Streamed analysis report." {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved streamed markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	_, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Streamed analysis report." {
		t.Fatalf("assistantText=%q, want streamed markdown report", assistantText)
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
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCompleted,
			Output:  "Late final answer.",
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err != nil {
		t.Fatalf("projectFloretResult completed: %v", err)
	}
	err = r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
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
		permissionTypeString(FlowerPermissionApprovalRequired),
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

func TestProjectFloretCancelledResultUsesCanceledLifecycle(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_cancelled"
	r.threadID = "thread_floret_cancelled"
	r.messageID = "msg_floret_cancelled"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCancelled,
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if got := r.getEndReason(); got != "canceled" {
		t.Fatalf("endReason=%q, want canceled", got)
	}
	if got := r.getFinalizationReason(); got != "canceled" {
		t.Fatalf("finalizationReason=%q, want canceled", got)
	}
	for _, ev := range events {
		if _, ok := ev.(streamEventError); ok {
			t.Fatalf("cancelled result emitted error event: %#v", events)
		}
	}
}

func TestProjectFloretCancelledResultWithDeadlineUsesTimedOutLifecycle(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_cancelled_timeout"
	r.threadID = "thread_floret_cancelled_timeout"
	r.messageID = "msg_floret_cancelled_timeout"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	ctx, cancel := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
	defer cancel()

	err := r.projectFloretResult(
		ctx,
		flruntime.TurnResult{
			Status:  flruntime.TurnStatusCancelled,
			Metrics: flruntime.RunMetrics{Steps: 1},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}
	if got := r.getEndReason(); got != "timed_out" {
		t.Fatalf("endReason=%q, want timed_out", got)
	}
	if got := r.getFinalizationReason(); got != "timed_out" {
		t.Fatalf("finalizationReason=%q, want timed_out", got)
	}
	for _, ev := range events {
		if _, ok := ev.(streamEventError); ok {
			t.Fatalf("cancelled timeout result emitted error event: %#v", events)
		}
	}
}

func TestProjectFloretUnknownWaitingSignalFailsAsUnsupportedSignal(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_unknown_waiting"
	r.threadID = "thread_unknown_waiting"
	r.messageID = "msg_unknown_waiting"

	err := r.projectFloretResult(
		t.Context(),
		flruntime.TurnResult{
			Status: flruntime.TurnStatusWaiting,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:   "legacy_unknown_signal",
				CallID: "call_unknown_waiting",
				Payload: map[string]any{
					"source":  "legacy_unknown_signal",
					"summary": "Need to edit files.",
				},
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		permissionTypeString(FlowerPermissionApprovalRequired),
	)
	if err == nil {
		t.Fatalf("projectFloretResult should reject unknown waiting signal")
	}
	if !strings.Contains(err.Error(), "unsupported waiting control signal") {
		t.Fatalf("error=%v, want unsupported waiting control signal", err)
	}
}
