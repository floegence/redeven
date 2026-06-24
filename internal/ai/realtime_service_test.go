package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type slowOpenAIMock struct {
	delay time.Duration
}

func (m slowOpenAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	_, _ = io.ReadAll(r.Body)
	_ = r.Body.Close()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	writeRealtimeSSE(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         "resp_realtime_test_1",
			"created_at": time.Now().Unix(),
			"model":      "gpt-5-mini",
		},
	})
	time.Sleep(m.delay)
	writeRealtimeSSE(w, f, map[string]any{
		"type":  "response.output_text.delta",
		"delta": "working",
	})
	writeRealtimeSSE(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_realtime_test_1",
			"model":  "gpt-5-mini",
			"status": "completed",
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
				"output_tokens_details": map[string]any{
					"reasoning_tokens": 0,
				},
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func writeRealtimeSSE(w io.Writer, f http.Flusher, payload any) {
	b, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func newRealtimeTestService(t *testing.T, delay time.Duration) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(slowOpenAIMock{delay: delay}.handle))
	t.Cleanup(server.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(server.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            t.TempDir(),
		AgentHomeDir:        t.TempDir(),
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestStartRunDetached_ImmediateCancelStillStopsRun(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 2*time.Second)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_cancel_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("run still active after cancel")
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing")
	}
	if strings.TrimSpace(view.RunStatus) != "canceled" {
		t.Fatalf("run_status=%q, want canceled", view.RunStatus)
	}
	if strings.Contains(view.LastMessagePreview, "Canceled.") {
		t.Fatalf("last_message_preview must not include cancellation notice: %q", view.LastMessagePreview)
	}
}

func TestListActiveThreadRuns_ReturnsDetachedRunSnapshot(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 2*time.Second)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_snapshot_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("expected active run")
	}

	runs := svc.ListActiveThreadRuns(meta.EndpointID)
	if len(runs) != 1 {
		t.Fatalf("active run count=%d, want=1", len(runs))
	}
	if runs[0].ThreadID != th.ThreadID {
		t.Fatalf("thread_id=%q, want=%q", runs[0].ThreadID, th.ThreadID)
	}
	if runs[0].RunID != runID {
		t.Fatalf("run_id=%q, want=%q", runs[0].RunID, runID)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run still active after cancel")
}

func TestFlowerLiveEventsProjectRealtimeEventsProgressively(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_events",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_live",
		UserPublicID:      "u_live",
		UserEmail:         "u_live@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "live", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_live_projection_1"
	r := newRun(runOptions{
		RunID:               runID,
		EndpointID:          meta.EndpointID,
		ThreadID:            th.ThreadID,
		MessageID:           "msg_live_projection_1",
		UserPublicID:        meta.UserPublicID,
		SessionMeta:         &meta,
		ThreadsDB:           svc.threadsDB,
		PersistOpTimeout:    time.Second,
		ToolApprovalTimeout: time.Minute,
	})
	r.toolApprovals["tool_live_projection_1"] = &toolApprovalRequest{
		decision:      make(chan bool, 1),
		toolName:      "terminal.exec",
		requestedAtMs: time.Now().UnixMilli(),
	}
	svc.mu.Lock()
	svc.runs[runID] = r
	svc.activeRunByTh[runThreadKey(meta.EndpointID, th.ThreadID)] = runID
	svc.mu.Unlock()

	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventMessageStart{Type: "message-start", MessageID: r.messageID})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: 0, BlockType: "markdown"})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: 0, Delta: "working"})

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	gotKinds := make([]FlowerLiveKind, 0, len(resp.Events))
	for _, ev := range resp.Events {
		gotKinds = append(gotKinds, ev.Kind)
	}
	wantKinds := []FlowerLiveKind{
		FlowerLiveRunStarted,
		FlowerLiveTimelineReplaced,
		FlowerLiveMessageStarted,
		FlowerLiveTimelineReplaced,
		FlowerLiveMessageBlockStart,
		FlowerLiveTimelineReplaced,
		FlowerLiveMessageBlockDelta,
		FlowerLiveTimelineReplaced,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	if err := assertNoFullMessageInDelta(resp.Events[6]); err != nil {
		t.Fatalf("delta payload shape: %v", err)
	}
	if strings.Contains(string(resp.Events[6].Payload), "active_run") {
		t.Fatalf("delta payload contains old live shape: %s", string(resp.Events[6].Payload))
	}

	finalMessage := `{"id":"msg_live_projection_1","role":"assistant","status":"complete","content":"done","created_at_ms":1700000000000,"blocks":[{"type":"markdown","content":"done"}]}`
	svc.broadcastTranscriptMessage(meta.EndpointID, th.ThreadID, runID, 1, finalMessage, time.Now().UnixMilli())

	next, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, resp.NextCursor, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after transcript: %v", err)
	}
	if len(next.Events) != 2 {
		t.Fatalf("next events=%d, want 2", len(next.Events))
	}
	if got := next.Events[0].Kind; got != FlowerLiveMessageCommitted {
		t.Fatalf("kind=%q, want message.committed", got)
	}
	if got := next.Events[1].Kind; got != FlowerLiveTimelineReplaced {
		t.Fatalf("kind=%q, want timeline.replaced", got)
	}
	var committed FlowerLiveMessageCommittedPayload
	if !decodeFlowerPayload(next.Events[0].Payload, &committed) {
		t.Fatalf("failed to decode committed payload: %s", string(next.Events[0].Payload))
	}
	if len(committed.Message) == 0 {
		t.Fatalf("message payload is empty")
	}
}

func TestFlowerLiveModelIOStatusProjectsProviderLifecycle(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_model_io",
		NamespacePublicID: "ns_live_model_io",
		ChannelID:         "ch_live_model_io",
		UserPublicID:      "u_live_model_io",
		UserEmail:         "model-io@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "model io", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	runID := "run_model_io_1"

	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventMessageStart{Type: "message-start", MessageID: "msg_model_io_1"})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventModelIOStatus{
		Type:        "model-io-status",
		Phase:       string(FlowerModelIOPhaseWaitingResponse),
		RunID:       runID,
		StepIndex:   1,
		UpdatedAtMs: 10_001,
	})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventModelIOStatus{
		Type:        "model-io-status",
		Phase:       string(FlowerModelIOPhaseStreaming),
		RunID:       runID,
		StepIndex:   1,
		UpdatedAtMs: 10_002,
	})
	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	gotKinds := make([]FlowerLiveKind, 0, len(resp.Events))
	for _, ev := range resp.Events {
		gotKinds = append(gotKinds, ev.Kind)
	}
	wantKinds := []FlowerLiveKind{
		FlowerLiveRunStarted,
		FlowerLiveTimelineReplaced,
		FlowerLiveMessageStarted,
		FlowerLiveTimelineReplaced,
		FlowerLiveModelIOUpdated,
		FlowerLiveModelIOUpdated,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	var payload FlowerLiveModelIOUpdatedPayload
	if !decodeFlowerPayload(resp.Events[5].Payload, &payload) || payload.Status == nil {
		t.Fatalf("failed to decode model io payload: %s", string(resp.Events[5].Payload))
	}
	if payload.Status.Phase != FlowerModelIOPhaseStreaming || payload.Status.RunID != runID || payload.Status.StepIndex != 1 {
		t.Fatalf("model io status=%#v", payload.Status)
	}

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if bootstrap.LiveState.ModelIO == nil || bootstrap.LiveState.ModelIO.Phase != FlowerModelIOPhaseStreaming {
		t.Fatalf("bootstrap model_io=%#v", bootstrap.LiveState.ModelIO)
	}
}

func TestFlowerLiveModelIOStatusIgnoresStaleRunClear(t *testing.T) {
	state := FlowerLiveMaterializedState{}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: "run-new",
		Kind:  FlowerLiveRunStarted,
		Payload: mustFlowerPayload(FlowerLiveRunStartedPayload{
			RunID:     "run-new",
			MessageID: "msg-new",
			Status:    string(RunStateRunning),
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: "run-new",
		Kind:  FlowerLiveModelIOUpdated,
		Payload: mustFlowerPayload(FlowerLiveModelIOUpdatedPayload{Status: &FlowerModelIOStatus{
			Phase:       FlowerModelIOPhaseStreaming,
			RunID:       "run-new",
			UpdatedAtMs: 10_000,
		}}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:   "run-old",
		Kind:    FlowerLiveModelIOUpdated,
		Payload: mustFlowerPayload(FlowerLiveModelIOUpdatedPayload{}),
	})
	if state.ModelIO == nil || state.ModelIO.RunID != "run-new" {
		t.Fatalf("stale clear removed model_io: %#v", state.ModelIO)
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		Kind:    FlowerLiveModelIOUpdated,
		Payload: mustFlowerPayload(FlowerLiveModelIOUpdatedPayload{}),
	})
	if state.ModelIO == nil || state.ModelIO.RunID != "run-new" {
		t.Fatalf("unidentified clear removed model_io: %#v", state.ModelIO)
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: "run-old",
		Kind:  FlowerLiveModelIOUpdated,
		Payload: mustFlowerPayload(FlowerLiveModelIOUpdatedPayload{Status: &FlowerModelIOStatus{
			Phase:       FlowerModelIOPhaseWaitingResponse,
			RunID:       "run-old",
			UpdatedAtMs: 10_010,
		}}),
	})
	if state.ModelIO == nil || state.ModelIO.RunID != "run-new" || state.ModelIO.Phase != FlowerModelIOPhaseStreaming {
		t.Fatalf("stale set replaced model_io: %#v", state.ModelIO)
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: "run-old",
		Kind:  FlowerLiveRunStatusChanged,
		Payload: mustFlowerPayload(FlowerLiveRunStatusChangedPayload{
			RunID:  "run-old",
			Status: string(RunStateSuccess),
		}),
	})
	if state.ModelIO == nil || state.ModelIO.RunID != "run-new" {
		t.Fatalf("stale terminal removed model_io: %#v", state.ModelIO)
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: "run-new",
		Kind:  FlowerLiveRunStatusChanged,
		Payload: mustFlowerPayload(FlowerLiveRunStatusChangedPayload{
			RunID:  "run-new",
			Status: string(RunStateSuccess),
		}),
	})
	if state.ModelIO != nil {
		t.Fatalf("matching terminal left model_io: %#v", state.ModelIO)
	}
}

func TestFlowerLiveContextUsageAndCompactionMaterializedState(t *testing.T) {
	t.Parallel()

	state := FlowerLiveMaterializedState{}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "run-context",
		AtUnixMs: 10_000,
		Kind:     FlowerLiveContextUsageUpdated,
		Payload: mustFlowerPayload(FlowerLiveUsageUpdatedPayload{Usage: FlowerContextUsage{
			RunID:                  "run-context",
			StepIndex:              1,
			Phase:                  "projected_request",
			InputTokens:            620,
			ContextWindowTokens:    1000,
			ThresholdTokens:        900,
			RequestSafeLimitTokens: 800,
			OutputHeadroomTokens:   200,
			UsedRatio:              0.62,
			ThresholdRatio:         0.9,
			PressureStatus:         "stable",
			Source:                 "full_request_estimate",
		}}),
	})
	if state.ContextUsage == nil || state.ContextUsage.InputTokens != 620 || state.ContextUsage.UpdatedAtMs != 10_000 {
		t.Fatalf("context usage=%#v", state.ContextUsage)
	}

	start := FlowerContextCompaction{
		OperationID:  "run-context:compact:1:pre_request:threshold",
		RunID:        "run-context",
		StepIndex:    1,
		Phase:        "start",
		Status:       "compacting",
		Trigger:      "pre_request",
		Reason:       "threshold",
		TokensBefore: 920,
	}
	startDecoration := FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + start.OperationID,
		Kind:         "context_compaction",
		Anchor: FlowerTimelineAnchor{
			TargetKind: "message",
			MessageID:  "msg_context_projection",
			Edge:       "after",
		},
		Compaction: start,
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "run-context",
		AtUnixMs: 10_001,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload:  mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: start, TimelineDecoration: startDecoration}),
	})
	if len(state.ContextCompactions) != 1 || state.ContextCompactions[0].Status != "compacting" {
		t.Fatalf("context compactions after start=%#v", state.ContextCompactions)
	}
	if len(state.TimelineDecorations) != 1 || state.TimelineDecorations[0].DecorationID == "" || state.TimelineDecorations[0].Compaction.Status != "compacting" {
		t.Fatalf("timeline decorations after start=%#v", state.TimelineDecorations)
	}

	complete := start
	complete.Phase = "complete"
	complete.Status = "compacted"
	complete.CompactionID = "compact-1"
	complete.CompactionGeneration = 1
	complete.CompactionWindowID = "window-1"
	complete.TokensAfterEstimate = 210
	completeDecoration := startDecoration
	completeDecoration.Compaction = complete
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "run-context",
		AtUnixMs: 10_002,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload:  mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: complete, TimelineDecoration: completeDecoration}),
	})
	if len(state.ContextCompactions) != 1 || state.ContextCompactions[0].Status != "compacted" || state.ContextCompactions[0].CompactionID != "compact-1" {
		t.Fatalf("context compactions after complete=%#v", state.ContextCompactions)
	}
	if len(state.TimelineDecorations) != 1 || state.TimelineDecorations[0].Compaction.Status != "compacted" || state.TimelineDecorations[0].Compaction.TokensAfterEstimate != 210 {
		t.Fatalf("timeline decorations after complete=%#v", state.TimelineDecorations)
	}
	if got := strings.TrimSpace(state.TimelineDecorations[0].Anchor.MessageID); got != "msg_context_projection" {
		t.Fatalf("timeline decoration anchor=%q, want msg_context_projection", got)
	}
	clone := cloneFlowerLiveMaterializedState(state)
	clone.ContextCompactions[0].Status = "mutated"
	if state.ContextCompactions[0].Status != "compacted" {
		t.Fatalf("clone mutated source context compactions: %#v", state.ContextCompactions)
	}
}

func TestFlowerLiveContextActivityBroadcastsThreadPatch(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_context_patch",
		NamespacePublicID: "ns_live_context_patch",
		ChannelID:         "ch_live_context_patch",
		UserPublicID:      "u_live_context_patch",
		UserEmail:         "context-patch@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "context patch", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_context_patch"
	usage := FlowerContextUsage{
		RunID:               runID,
		StepIndex:           1,
		Phase:               "projected_request",
		InputTokens:         910,
		ContextWindowTokens: 1000,
		UsedRatio:           0.91,
		PressureStatus:      "near_threshold",
		UpdatedAtMs:         time.Now().UnixMilli(),
	}
	if err := svc.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  meta.EndpointID,
		ThreadID:    th.ThreadID,
		RunID:       runID,
		StreamKind:  "context",
		EventType:   "context.usage.updated",
		PayloadJSON: string(mustFlowerPayload(FlowerLiveUsageUpdatedPayload{Usage: usage})),
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("AppendRunEvent usage: %v", err)
	}
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventContextUsage{
		Type:  "context-usage",
		Usage: usage,
	})

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var gotKinds []FlowerLiveKind
	for _, event := range resp.Events {
		gotKinds = append(gotKinds, event.Kind)
	}
	wantKinds := []FlowerLiveKind{
		FlowerLiveContextUsageUpdated,
		FlowerLiveThreadPatched,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	var payload FlowerLiveThreadPatchedPayload
	if !decodeFlowerPayload(resp.Events[1].Payload, &payload) {
		t.Fatalf("failed to decode thread patch payload: %s", string(resp.Events[1].Payload))
	}
	if strings.TrimSpace(payload.Patch.LastContextRunID) != runID {
		t.Fatalf("thread patch last_context_run_id=%q, want %q", payload.Patch.LastContextRunID, runID)
	}
}

func TestFlowerLiveContextCompactionCompleteKeepsRunActive(t *testing.T) {
	t.Parallel()

	state := FlowerLiveMaterializedState{}
	runID := "run-context-active"
	messageID := "msg-context-active"

	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: runID,
		Kind:  FlowerLiveRunStarted,
		Payload: mustFlowerPayload(FlowerLiveRunStartedPayload{
			RunID:     runID,
			MessageID: messageID,
			Status:    string(RunStateRunning),
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: runID,
		Kind:  FlowerLiveModelIOUpdated,
		Payload: mustFlowerPayload(FlowerLiveModelIOUpdatedPayload{Status: &FlowerModelIOStatus{
			Phase:       FlowerModelIOPhaseStreaming,
			RunID:       runID,
			StepIndex:   1,
			UpdatedAtMs: 10_000,
		}}),
	})

	start := FlowerContextCompaction{
		OperationID:  "run-context-active:compact:1:pre_request:threshold",
		RunID:        runID,
		StepIndex:    1,
		Phase:        "start",
		Status:       "compacting",
		Trigger:      "pre_request",
		Reason:       "threshold",
		TokensBefore: 920,
	}
	startDecoration := FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + start.OperationID,
		Kind:         "context_compaction",
		Anchor: FlowerTimelineAnchor{
			TargetKind: "message",
			MessageID:  messageID,
			Edge:       "after",
		},
		Compaction: start,
	}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    runID,
		AtUnixMs: 10_001,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload:  mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: start, TimelineDecoration: startDecoration}),
	})
	complete := start
	complete.Phase = "complete"
	complete.Status = "compacted"
	complete.TokensAfterEstimate = 210
	completeDecoration := startDecoration
	completeDecoration.Compaction = complete
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    runID,
		AtUnixMs: 10_002,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload:  mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: complete, TimelineDecoration: completeDecoration}),
	})

	run, ok := state.Runs[runID]
	if !ok || run.Status != string(RunStateRunning) || run.MessageID != messageID {
		t.Fatalf("run after compacted=%#v ok=%v, want active running run", run, ok)
	}
	if state.ModelIO == nil || state.ModelIO.RunID != runID || state.ModelIO.Phase != FlowerModelIOPhaseStreaming {
		t.Fatalf("model_io after compacted=%#v, want active streaming model io", state.ModelIO)
	}
	if len(state.ContextCompactions) != 1 || state.ContextCompactions[0].Status != "compacted" {
		t.Fatalf("context compactions after compacted=%#v", state.ContextCompactions)
	}
	if len(state.TimelineDecorations) != 1 || state.TimelineDecorations[0].Compaction.Status != "compacted" {
		t.Fatalf("timeline decorations after compacted=%#v", state.TimelineDecorations)
	}

	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: runID,
		Kind:  FlowerLiveMessageBlockStart,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockStartedPayload{
			MessageID:  messageID,
			BlockIndex: 0,
			BlockType:  "markdown",
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID: runID,
		Kind:  FlowerLiveMessageBlockDelta,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockDeltaPayload{
			MessageID:  messageID,
			BlockIndex: 0,
			Delta:      "continued after compaction",
		}),
	})

	run, ok = state.Runs[runID]
	if !ok || run.Status != string(RunStateRunning) {
		t.Fatalf("run after post-compaction delta=%#v ok=%v, want still running", run, ok)
	}
	if state.ModelIO == nil || state.ModelIO.RunID != runID {
		t.Fatalf("post-compaction delta cleared model_io: %#v", state.ModelIO)
	}
	draft := state.Messages[messageID]
	if len(draft.Blocks) != 1 || !strings.Contains(draft.Blocks[0].Content, "continued after compaction") {
		t.Fatalf("draft after post-compaction delta=%#v", draft)
	}
}

func TestRunContextCompactionAnchorRemainsStableAcrossOperationEvents(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_anchor_stable",
		NamespacePublicID: "ns_anchor_stable",
		ChannelID:         "ch_anchor_stable",
		UserPublicID:      "u_anchor_stable",
		UserEmail:         "anchor-stable@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
	svc := newTestService(t, nil)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "anchor stable", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendFlowerTimelineTestMessage(t, svc.threadsDB, meta.EndpointID, th.ThreadID, "message-before-compact", "assistant", "visible output before compact", 1_000)

	r := newRun(runOptions{
		RunID:            "run-anchor-stable",
		EndpointID:       meta.EndpointID,
		ThreadID:         th.ThreadID,
		MessageID:        "message-anchor-stable",
		ThreadsDB:        svc.threadsDB,
		PersistOpTimeout: 2 * time.Second,
	})
	if _, err := r.EnqueueManualCompaction(context.Background(), flruntime.ManualCompactionRequest{
		RequestID:   "manual-request-1",
		Source:      "slash_command",
		RequestedAt: time.UnixMilli(9_999),
	}); err != nil {
		t.Fatalf("EnqueueManualCompaction: %v", err)
	}

	r.muAssistant.Lock()
	blockIndex := len(r.assistantBlocks)
	r.assistantBlocks = append(r.assistantBlocks, ActivityTimelineBlock{
		Type: "activity-timeline",
		ActivityTimeline: observation.ActivityTimeline{
			SchemaVersion: observation.ActivityTimelineSchemaVersion,
			Items: []observation.ActivityItem{{
				ItemID: "tool-after-start",
				Kind:   "tool",
				Status: observation.ActivityStatusSuccess,
			}},
		},
	})
	r.muAssistant.Unlock()

	r.applyFloretCompaction(&observation.CompactionEvent{
		OperationID:  "run-anchor-stable:compact:1:manual:manual-request-1",
		RequestID:    "manual-request-1",
		RunID:        "run-anchor-stable",
		Phase:        observation.CompactionPhaseStart,
		Status:       observation.CompactionStatusRunning,
		Trigger:      "manual",
		Reason:       "manual",
		TokensBefore: 900,
		ObservedAt:   time.UnixMilli(10_000),
	})

	r.applyFloretCompaction(&observation.CompactionEvent{
		OperationID:          "run-anchor-stable:compact:1:manual:manual-request-1",
		RequestID:            "manual-request-1",
		RunID:                "run-anchor-stable",
		Phase:                observation.CompactionPhaseComplete,
		Status:               observation.CompactionStatusCompacted,
		Trigger:              "manual",
		Reason:               "manual",
		CompactionID:         "compact-anchor-stable",
		CompactionGeneration: 1,
		CompactionWindowID:   "window-anchor-stable",
		TokensBefore:         900,
		TokensAfterEstimate:  300,
		ObservedAt:           time.UnixMilli(10_001),
	})

	anchor := r.contextCompactionAnchor("run-anchor-stable:compact:1:manual:manual-request-1")
	if got := strings.TrimSpace(anchor.TargetKind); got != "block" {
		t.Fatalf("anchor target_kind=%q, want block", got)
	}
	if got := strings.TrimSpace(anchor.MessageID); got != "message-before-compact" {
		t.Fatalf("anchor message_id=%q, want message-before-compact", got)
	}
	if anchor.BlockIndex == nil || *anchor.BlockIndex != 0 {
		t.Fatalf("anchor block_index=%v, want 0", anchor.BlockIndex)
	}
	if got := strings.TrimSpace(anchor.ActivityItemID); got != "" {
		t.Fatalf("anchor activity_item_id=%q, want empty", got)
	}
	if got := strings.TrimSpace(anchor.Edge); got != "after" {
		t.Fatalf("anchor edge=%q, want after", got)
	}
	if blockIndex != 0 {
		t.Fatalf("test setup block index=%d, want 0", blockIndex)
	}
}

func TestFlowerLiveBootstrapRestoresPersistedContextState(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_context_restore",
		NamespacePublicID: "ns_live_context_restore",
		ChannelID:         "ch_live_context_restore",
		UserPublicID:      "u_live_context_restore",
		UserEmail:         "context-restore@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "context restore", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_context_restore"
	now := time.Now().UnixMilli()
	if err := svc.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		RunID:      runID,
		StreamKind: "context",
		EventType:  "context.usage.updated",
		PayloadJSON: string(mustFlowerPayload(FlowerLiveUsageUpdatedPayload{Usage: FlowerContextUsage{
			RunID:               runID,
			StepIndex:           1,
			Phase:               "projected_request",
			InputTokens:         910,
			ContextWindowTokens: 1000,
			UsedRatio:           0.91,
			PressureStatus:      "near_threshold",
			UpdatedAtMs:         10_000,
		}})),
		AtUnixMs: now,
	}); err != nil {
		t.Fatalf("AppendRunEvent usage: %v", err)
	}
	compaction := FlowerContextCompaction{
		OperationID:         "compact-restore",
		RunID:               runID,
		StepIndex:           1,
		Phase:               "complete",
		Status:              "compacted",
		TokensBefore:        920,
		TokensAfterEstimate: 240,
		UpdatedAtMs:         10_002,
	}
	decoration := FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + compaction.OperationID,
		Kind:         "context_compaction",
		Anchor: FlowerTimelineAnchor{
			TargetKind: "message",
			MessageID:  "msg_context_restore",
			Edge:       "after",
		},
		Compaction: compaction,
	}
	if err := svc.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  meta.EndpointID,
		ThreadID:    th.ThreadID,
		RunID:       runID,
		StreamKind:  "context",
		EventType:   "context.compaction.updated",
		PayloadJSON: string(mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: compaction, TimelineDecoration: decoration})),
		AtUnixMs:    now + 2,
	}); err != nil {
		t.Fatalf("AppendRunEvent compaction: %v", err)
	}

	svc.mu.Lock()
	delete(svc.flowerLiveByThread, runThreadKey(meta.EndpointID, th.ThreadID))
	svc.mu.Unlock()

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if bootstrap.LiveState.ContextUsage == nil || bootstrap.LiveState.ContextUsage.InputTokens != 910 {
		t.Fatalf("bootstrap context usage=%#v", bootstrap.LiveState.ContextUsage)
	}
	if len(bootstrap.LiveState.ContextCompactions) != 1 || bootstrap.LiveState.ContextCompactions[0].OperationID != "compact-restore" {
		t.Fatalf("bootstrap context compactions=%#v", bootstrap.LiveState.ContextCompactions)
	}
	if len(bootstrap.LiveState.TimelineDecorations) != 1 || bootstrap.LiveState.TimelineDecorations[0].Compaction.Status != "compacted" {
		t.Fatalf("bootstrap timeline decorations=%#v", bootstrap.LiveState.TimelineDecorations)
	}
	if got := strings.TrimSpace(bootstrap.LiveState.TimelineDecorations[0].Anchor.MessageID); got != "msg_context_restore" {
		t.Fatalf("bootstrap timeline decoration anchor=%q, want msg_context_restore", got)
	}
}

func TestFlowerLiveResyncSignalDoesNotConsumeEventSequence(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_resync_seq",
		NamespacePublicID: "ns_live_resync_seq",
		ChannelID:         "ch_live_resync_seq",
		UserPublicID:      "u_live_resync_seq",
		UserEmail:         "resync-seq@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "resync seq", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	first := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		Kind:       FlowerLiveThreadPatched,
		Payload:    mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{ThreadID: th.ThreadID, Title: "first"}}),
	})
	second := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		Kind:       FlowerLiveThreadPatched,
		Payload:    mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{ThreadID: th.ThreadID, Title: "second"}}),
	})
	if first.Seq != 1 || second.Seq != 2 {
		t.Fatalf("initial seqs=%d,%d want 1,2", first.Seq, second.Seq)
	}

	threadKey := runThreadKey(meta.EndpointID, th.ThreadID)
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[threadKey]
	if stream == nil || len(stream.Events) != 2 {
		svc.mu.Unlock()
		t.Fatalf("missing live stream")
	}
	stream.Events = stream.Events[1:]
	nextSeqBeforeResync := stream.NextSeq
	svc.mu.Unlock()

	resync, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, first.Seq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents expired cursor: %v", err)
	}
	if len(resync.Events) != 1 || resync.Events[0].Kind != FlowerLiveResyncRequired {
		t.Fatalf("resync events=%#v, want stream.resync_required", resync.Events)
	}
	if resync.Events[0].Seq != first.Seq || resync.NextCursor != first.Seq {
		t.Fatalf("resync seq/cursor=%d/%d, want stale cursor %d", resync.Events[0].Seq, resync.NextCursor, first.Seq)
	}
	svc.mu.Lock()
	nextSeqAfterResync := svc.flowerLiveByThread[threadKey].NextSeq
	svc.mu.Unlock()
	if nextSeqAfterResync != nextSeqBeforeResync {
		t.Fatalf("resync consumed seq: next before=%d after=%d", nextSeqBeforeResync, nextSeqAfterResync)
	}

	third := svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		Kind:       FlowerLiveThreadPatched,
		Payload:    mustFlowerPayload(FlowerLiveThreadPatchedPayload{Patch: FlowerLiveThreadPatch{ThreadID: th.ThreadID, Title: "third"}}),
	})
	if third.Seq != nextSeqBeforeResync {
		t.Fatalf("third seq=%d, want preserved next seq %d", third.Seq, nextSeqBeforeResync)
	}
	next, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, second.Seq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after retained cursor: %v", err)
	}
	if len(next.Events) != 1 || next.Events[0].Seq != third.Seq {
		t.Fatalf("next events=%#v, want third event seq %d", next.Events, third.Seq)
	}
}

func TestFlowerLiveApprovalRequestedCarriesExpectedSeq(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_approval_seq",
		NamespacePublicID: "ns_live_approval_seq",
		ChannelID:         "ch_live_approval_seq",
		UserPublicID:      "u_live_approval_seq",
		UserEmail:         "approval-seq@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "approval seq", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_live_approval_seq"
	r := newRun(runOptions{
		RunID:               runID,
		EndpointID:          meta.EndpointID,
		ThreadID:            th.ThreadID,
		MessageID:           "msg_live_approval_seq",
		UserPublicID:        meta.UserPublicID,
		SessionMeta:         &meta,
		ThreadsDB:           svc.threadsDB,
		PersistOpTimeout:    time.Second,
		ToolApprovalTimeout: time.Minute,
	})
	r.toolApprovals["tool_live_approval_seq"] = &toolApprovalRequest{
		decision:      make(chan bool, 1),
		toolName:      "terminal.exec",
		requestedAtMs: time.Now().UnixMilli(),
	}
	svc.mu.Lock()
	svc.runs[runID] = r
	svc.activeRunByTh[runThreadKey(meta.EndpointID, th.ThreadID)] = runID
	svc.mu.Unlock()

	block := newActivityTimelineBlock(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      th.ThreadID,
		TurnID:        r.messageID,
		TraceID:       runID,
		Summary: observation.ActivitySummary{
			Status:         observation.ActivityStatusWaiting,
			Severity:       observation.ActivitySeverityBlocking,
			NeedsAttention: true,
			TotalItems:     1,
			Counts:         observation.ActivityCounts{Waiting: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:           "item_live_approval_seq",
			ToolID:           "tool_live_approval_seq",
			ToolName:         "terminal.exec",
			Kind:             observation.ActivityKindApproval,
			Status:           observation.ActivityStatusWaiting,
			Severity:         observation.ActivitySeverityBlocking,
			NeedsAttention:   true,
			RequiresApproval: true,
			ApprovalState:    "requested",
		}},
	}, nil)
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventBlockSet{
		Type:       "block-set",
		MessageID:  r.messageID,
		BlockIndex: 0,
		Block:      block,
	})

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var approvalEvent *FlowerLiveEvent
	for i := range resp.Events {
		if resp.Events[i].Kind == FlowerLiveApprovalRequested {
			approvalEvent = &resp.Events[i]
			break
		}
	}
	if approvalEvent == nil {
		t.Fatalf("missing approval.requested event: %#v", resp.Events)
	}
	var payload FlowerLiveApprovalPayload
	if !decodeFlowerPayload(approvalEvent.Payload, &payload) {
		t.Fatalf("failed to decode approval payload: %s", string(approvalEvent.Payload))
	}
	if payload.Action.ExpectedSeq != approvalEvent.Seq {
		t.Fatalf("expected_seq=%d, want event seq %d", payload.Action.ExpectedSeq, approvalEvent.Seq)
	}
	if payload.Action.Revision <= 0 {
		t.Fatalf("revision=%d, want positive revision", payload.Action.Revision)
	}
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventBlockSet{
		Type:       "block-set",
		MessageID:  r.messageID,
		BlockIndex: 0,
		Block:      block,
	})
	duplicateResp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, approvalEvent.Seq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after duplicate approval activity: %v", err)
	}
	var duplicatePayload FlowerLiveApprovalPayload
	var duplicateSeq int64
	for _, event := range duplicateResp.Events {
		if event.Kind == FlowerLiveApprovalRequested {
			duplicateSeq = event.Seq
			if !decodeFlowerPayload(event.Payload, &duplicatePayload) {
				t.Fatalf("failed to decode duplicate approval payload: %s", string(event.Payload))
			}
			break
		}
	}
	if duplicateSeq <= approvalEvent.Seq {
		t.Fatalf("duplicate approval seq=%d, want after original seq %d", duplicateSeq, approvalEvent.Seq)
	}
	if duplicatePayload.Action.ExpectedSeq != payload.Action.ExpectedSeq {
		t.Fatalf("duplicate expected_seq=%d, want original expected_seq %d", duplicatePayload.Action.ExpectedSeq, payload.Action.ExpectedSeq)
	}
	if duplicatePayload.Action.CanApprove != payload.Action.CanApprove {
		t.Fatalf("duplicate can_approve=%v, want original can_approve %v", duplicatePayload.Action.CanApprove, payload.Action.CanApprove)
	}
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, runID, streamEventBlockDelta{
		Type:       "text-delta",
		MessageID:  r.messageID,
		BlockIndex: 1,
		Delta:      "continued after approval request",
	})
	advanced, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, payload.Action.ExpectedSeq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after unrelated event: %v", err)
	}
	if len(advanced.Events) == 0 {
		t.Fatalf("missing event after approval request")
	}
	if _, err := svc.SubmitFlowerApproval(&meta, SubmitFlowerApprovalRequest{
		ThreadID:    th.ThreadID,
		RunID:       runID,
		ActionID:    payload.Action.ActionID,
		ToolID:      payload.Action.ToolID,
		Approved:    false,
		ExpectedSeq: payload.Action.ExpectedSeq,
		Revision:    payload.Action.Revision,
	}); err != nil {
		t.Fatalf("SubmitFlowerApproval with event payload: %v", err)
	}
	resolved, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, advanced.NextCursor, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after approval submit: %v", err)
	}
	var resolvedPayload FlowerLiveApprovalPayload
	for _, event := range resolved.Events {
		if event.Kind == FlowerLiveApprovalResolved {
			if !decodeFlowerPayload(event.Payload, &resolvedPayload) {
				t.Fatalf("failed to decode resolved payload: %s", string(event.Payload))
			}
			break
		}
	}
	if resolvedPayload.Action.ActionID == "" {
		t.Fatalf("missing approval.resolved event after submit: %#v", resolved.Events)
	}
	if resolvedPayload.Action.ExpectedSeq != payload.Action.ExpectedSeq {
		t.Fatalf("resolved expected_seq=%d, want original requested seq %d", resolvedPayload.Action.ExpectedSeq, payload.Action.ExpectedSeq)
	}
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap after approval submit: %v", err)
	}
	if _, ok := bootstrap.LiveState.ApprovalActions[payload.Action.ActionID]; ok {
		t.Fatalf("resolved approval still present in live materialized state")
	}
}

func TestFlowerLiveApprovalSnapshotCarriesFloretApprovalContext(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		RunID:     "run_floret_approval_context",
		ThreadID:  "thread_floret_approval_context",
		MessageID: "msg_floret_approval_context",
	})
	r.toolApprovals["tool_floret_approval_context"] = &toolApprovalRequest{
		decision:      make(chan bool, 1),
		toolName:      "apply_patch",
		argsHash:      "abc123",
		effects:       []string{"write"},
		flags:         []string{"destructive", "args_hash:abc123"},
		targets:       []FlowerSafeTarget{{Kind: "file", Label: "added.txt", URI: "file:added.txt"}},
		requestedAtMs: 1700000000000,
		expiresAtMs:   1700000060000,
	}

	action, ok := r.snapshotToolApproval("tool_floret_approval_context")
	if !ok {
		t.Fatal("snapshotToolApproval returned false")
	}
	if action.ActionID != flowerApprovalActionID("run_floret_approval_context", "tool_floret_approval_context") {
		t.Fatalf("ActionID=%q", action.ActionID)
	}
	if action.ToolName != "apply_patch" {
		t.Fatalf("ToolName=%q, want apply_patch", action.ToolName)
	}
	if action.Summary.Description != "Review access to added.txt before this tool runs." {
		t.Fatalf("Description=%q", action.Summary.Description)
	}
	if !reflect.DeepEqual(action.Summary.Effects, []string{"write"}) {
		t.Fatalf("Effects=%#v", action.Summary.Effects)
	}
	if !reflect.DeepEqual(action.Summary.Flags, []string{"destructive", "args_hash:abc123"}) {
		t.Fatalf("Flags=%#v", action.Summary.Flags)
	}
	if !reflect.DeepEqual(action.Summary.Targets, []FlowerSafeTarget{{Kind: "file", Label: "added.txt", URI: "file:added.txt"}}) {
		t.Fatalf("Targets=%#v", action.Summary.Targets)
	}
}

func TestFlowerLiveMaterializedStatePrunesTerminalRuns(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_prune_run",
		NamespacePublicID: "ns_live_prune_run",
		ChannelID:         "ch_live_prune_run",
		UserPublicID:      "u_live_prune_run",
		UserEmail:         "prune-run@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "prune run", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_live_prune_terminal"
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		RunID:      runID,
		Kind:       FlowerLiveRunStarted,
		Payload:    mustFlowerPayload(FlowerLiveRunStartedPayload{RunID: runID, MessageID: "msg_live_prune_terminal", Status: string(RunStateRunning)}),
	})
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap running: %v", err)
	}
	if _, ok := bootstrap.LiveState.Runs[runID]; !ok {
		t.Fatalf("running run missing from live materialized state")
	}

	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		RunID:      runID,
		Kind:       FlowerLiveRunStatusChanged,
		Payload:    mustFlowerPayload(FlowerLiveRunStatusChangedPayload{RunID: runID, Status: string(RunStateSuccess)}),
	})
	bootstrap, err = svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap terminal: %v", err)
	}
	if _, ok := bootstrap.LiveState.Runs[runID]; ok {
		t.Fatalf("terminal run still present in live materialized state")
	}
}

func TestApproveToolRejectsDuplicateDecision(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_approval_duplicate"})
	ch := make(chan bool, 1)
	r.mu.Lock()
	r.toolApprovals["tool_approval_duplicate"] = &toolApprovalRequest{decision: ch}
	r.mu.Unlock()

	if err := r.approveTool("tool_approval_duplicate", true); err != nil {
		t.Fatalf("approveTool first decision: %v", err)
	}
	if err := r.approveTool("tool_approval_duplicate", false); !errors.Is(err, ErrRunChanged) {
		t.Fatalf("approveTool duplicate decision err=%v, want %v", err, ErrRunChanged)
	}

	select {
	case got := <-ch:
		if !got {
			t.Fatalf("duplicate decision replaced the accepted approval")
		}
	default:
		t.Fatalf("first approval decision was not delivered")
	}
}

func TestApproveToolRejectsDuplicateAfterDecisionConsumed(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{RunID: "run_approval_consumed_duplicate"})
	ch := make(chan bool, 1)
	r.mu.Lock()
	r.toolApprovals["tool_approval_consumed_duplicate"] = &toolApprovalRequest{decision: ch}
	r.mu.Unlock()

	if err := r.approveTool("tool_approval_consumed_duplicate", true); err != nil {
		t.Fatalf("approveTool first decision: %v", err)
	}
	if got := <-ch; !got {
		t.Fatalf("first decision=%v, want true", got)
	}
	if err := r.approveTool("tool_approval_consumed_duplicate", false); !errors.Is(err, ErrRunChanged) {
		t.Fatalf("approveTool duplicate consumed decision err=%v, want %v", err, ErrRunChanged)
	}
}

func TestFlowerLiveThreadSummaryUpdateIncludesThreadPatch(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_summary",
		NamespacePublicID: "ns_live_summary",
		ChannelID:         "ch_live_summary",
		UserPublicID:      "u_live_summary",
		UserEmail:         "live-summary@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "before title", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.RenameThread(ctx, &meta, th.ThreadID, "after title"); err != nil {
		t.Fatalf("RenameThread: %v", err)
	}
	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	if len(resp.Events) == 0 {
		t.Fatalf("events=0, want thread patch")
	}
	var patch *FlowerLiveEvent
	for i := range resp.Events {
		if resp.Events[i].Kind == FlowerLiveThreadPatched {
			patch = &resp.Events[i]
			break
		}
	}
	if patch == nil {
		t.Fatalf("events=%#v, want thread.patched", resp.Events)
	}
	var payload FlowerLiveThreadPatchedPayload
	if !decodeFlowerPayload(patch.Payload, &payload) {
		t.Fatalf("thread.patched event missing payload: %#v", patch)
	}
	if strings.TrimSpace(payload.Patch.Title) != "after title" {
		t.Fatalf("thread patch title=%q, want after title", payload.Patch.Title)
	}
	if want := strings.TrimSpace(th.ModelID); strings.TrimSpace(payload.Patch.ModelID) != want {
		t.Fatalf("thread patch model_id=%q, want %q", payload.Patch.ModelID, want)
	}
	if !payload.Patch.ReasoningSelectionSet {
		t.Fatalf("thread patch missing reasoning_selection presence")
	}
	if payload.Patch.ReasoningSelection == nil || payload.Patch.ReasoningSelection.Level != config.AIReasoningLevelMedium {
		t.Fatalf("thread patch reasoning_selection=%+v, want medium", payload.Patch.ReasoningSelection)
	}
	if !payload.Patch.ReasoningCapabilitySet || payload.Patch.ReasoningCapability == nil {
		t.Fatalf("thread patch missing reasoning_capability")
	}
}

func TestFlowerLiveThreadSummaryClearsReasoningForUnsupportedModel(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_reasoning_clear",
		NamespacePublicID: "ns_live_reasoning_clear",
		ChannelID:         "ch_live_reasoning_clear",
		UserPublicID:      "u_live_reasoning_clear",
		UserEmail:         "live-reasoning-clear@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	svc.mu.Lock()
	svc.cfg = &config.AIConfig{
		Providers: []config.AIProvider{{
			ID:      "compat",
			Type:    "openai_compatible",
			BaseURL: "https://example.invalid/v1",
			Models:  []config.AIProviderModel{{ModelName: "plain-model"}},
		}},
	}
	svc.mu.Unlock()

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "plain", "compat/plain-model", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.RenameThread(ctx, &meta, th.ThreadID, "plain renamed"); err != nil {
		t.Fatalf("RenameThread: %v", err)
	}
	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var payload FlowerLiveThreadPatchedPayload
	found := false
	for i := range resp.Events {
		if resp.Events[i].Kind != FlowerLiveThreadPatched {
			continue
		}
		if decodeFlowerPayload(resp.Events[i].Payload, &payload) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("events=%#v, want thread.patched", resp.Events)
	}
	if !payload.Patch.ReasoningSelectionSet || payload.Patch.ReasoningSelection != nil {
		t.Fatalf("reasoning_selection=%+v set=%v, want explicit null", payload.Patch.ReasoningSelection, payload.Patch.ReasoningSelectionSet)
	}
	if !payload.Patch.ReasoningCapabilitySet || payload.Patch.ReasoningCapability != nil {
		t.Fatalf("reasoning_capability=%+v set=%v, want explicit null", payload.Patch.ReasoningCapability, payload.Patch.ReasoningCapabilitySet)
	}
}

func TestGetThreadAndListThreadsExposeLastContextRunID(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  meta.EndpointID,
		ThreadID:    th.ThreadID,
		RunID:       "run_ctx_1",
		StreamKind:  "context",
		EventType:   "context.usage.updated",
		PayloadJSON: "{}",
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("AppendRunEvent: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got := strings.TrimSpace(view.LastContextRunID); got != "run_ctx_1" {
		t.Fatalf("GetThread LastContextRunID=%q, want %q", got, "run_ctx_1")
	}

	list, err := svc.ListThreads(ctx, &meta, 20, "")
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(list.Threads) != 1 {
		t.Fatalf("len(list.Threads)=%d, want 1", len(list.Threads))
	}
	if got := strings.TrimSpace(list.Threads[0].LastContextRunID); got != "run_ctx_1" {
		t.Fatalf("ListThreads LastContextRunID=%q, want %q", got, "run_ctx_1")
	}
}
