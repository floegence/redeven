package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestFlowerLiveBootstrapReadsCanonicalFloretContextAfterServiceRestart(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	newService := func() *Service {
		svc, err := NewService(Options{
			Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
			StateDir:     stateDir,
			AgentHomeDir: agentHomeDir,
			Shell:        "/bin/bash",
		})
		if err != nil {
			t.Fatalf("NewService: %v", err)
		}
		return svc
	}

	ctx := context.Background()
	meta := testSendTurnMeta()
	first := newService()
	thread, err := first.CreateThread(ctx, meta, "canonical context", "", "", "")
	if err != nil {
		_ = first.Close()
		t.Fatalf("CreateThread: %v", err)
	}
	host := newTestFloretHostFromService(t, first, thread.ThreadID, "canonical context answer")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID),
		TurnID:   "turn_context_restart",
		RunID:    "run_context_restart",
		Input:    flruntime.TurnInput{Text: "record canonical context"},
	}); err != nil {
		_ = first.Close()
		t.Fatalf("RunTurn: %v", err)
	}
	maintenance, err := first.openFloretMaintenanceHost(ctx, thread.ThreadID)
	if err != nil {
		_ = first.Close()
		t.Fatalf("openFloretMaintenanceHost: %v", err)
	}
	snapshot, err := maintenance.ReadThreadContext(ctx, flruntime.ThreadID(thread.ThreadID))
	if err != nil {
		_ = first.Close()
		t.Fatalf("ReadThreadContext: %v", err)
	}
	if snapshot.Usage == nil {
		_ = first.Close()
		t.Fatal("canonical context usage is missing")
	}
	wantUsage, err := flowerContextUsageFromFloret(snapshot.Usage)
	if err != nil {
		_ = first.Close()
		t.Fatalf("flowerContextUsageFromFloret: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close first service twice: %v", err)
	}

	restarted := newService()
	t.Cleanup(func() { _ = restarted.Close() })
	bootstrap, err := restarted.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if bootstrap.LiveState.ContextUsage == nil || !reflect.DeepEqual(*bootstrap.LiveState.ContextUsage, wantUsage) {
		t.Fatalf("bootstrap context usage=%#v, want canonical %#v", bootstrap.LiveState.ContextUsage, wantUsage)
	}
}

func newRealtimeTestService(t *testing.T, delay time.Duration) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(slowOpenAIMock{delay: delay}.handle))
	t.Cleanup(server.Close)

	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
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
	if strings.TrimSpace(view.RunStatus) != "idle" {
		t.Fatalf("run_status=%q, want idle before Floret accepts the canceled command", view.RunStatus)
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
	r := newRunWithProductStoreForTest(t, runOptions{
		RunID:               runID,
		EndpointID:          meta.EndpointID,
		ThreadID:            th.ThreadID,
		TurnID:              "turn_live_projection_1",
		MessageID:           "msg_live_projection_1",
		UserPublicID:        meta.UserPublicID,
		SessionMeta:         &meta,
		PersistOpTimeout:    time.Second,
		ToolApprovalTimeout: time.Minute,
	}, svc.threadsDB)
	r.toolApprovals["tool_live_projection_1"] = &toolApprovalRequest{
		decision:      make(chan bool, 1),
		toolName:      "terminal.exec",
		requestedAtMs: time.Now().UnixMilli(),
	}
	svc.mu.Lock()
	svc.runs[runID] = r
	svc.activeRunByTh[runThreadKey(meta.EndpointID, th.ThreadID)] = runID
	svc.mu.Unlock()

	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, r.turnID, runID, streamEventMessageStart{Type: "message-start", MessageID: r.messageID})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, r.turnID, runID, streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: 0, BlockType: "markdown"})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, r.turnID, runID, streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: 0, Delta: "working"})

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
		FlowerLiveMessageStarted,
		FlowerLiveMessageBlockStart,
		FlowerLiveMessageBlockDelta,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	for _, event := range resp.Events {
		if event.TurnID != r.turnID {
			t.Fatalf("event turn_id=%q, want %q", event.TurnID, r.turnID)
		}
	}
	var started FlowerLiveMessageStartedPayload
	if !decodeFlowerPayload(resp.Events[1].Payload, &started) || started.MessageID != r.messageID || started.MessageID == r.turnID {
		t.Fatalf("message.started identity=%#v turn_id=%q, want distinct message and turn identities", started, resp.Events[1].TurnID)
	}
	if err := assertNoFullMessageInDelta(resp.Events[3]); err != nil {
		t.Fatalf("delta payload shape: %v", err)
	}
	if strings.Contains(string(resp.Events[3].Payload), "active_run") {
		t.Fatalf("delta payload contains old live shape: %s", string(resp.Events[3].Payload))
	}

}

func TestFlowerLiveStreamingDeltasDoNotEmitTimelineReplacements(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_many_deltas",
		NamespacePublicID: "ns_live_many_deltas",
		ChannelID:         "ch_live_many_deltas",
		UserPublicID:      "u_live_many_deltas",
		UserEmail:         "many-deltas@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "many deltas", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_live_many_deltas"
	messageID := "msg_live_many_deltas"
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, messageID, runID, streamEventMessageStart{Type: "message-start", MessageID: messageID})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, messageID, runID, streamEventBlockStart{Type: "block-start", MessageID: messageID, BlockIndex: 0, BlockType: "markdown"})
	for i := 0; i < 1000; i++ {
		svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, messageID, runID, streamEventBlockDelta{Type: "block-delta", MessageID: messageID, BlockIndex: 0, Delta: "x"})
	}

	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(meta.EndpointID, th.ThreadID)]
	events := append([]FlowerLiveEvent(nil), stream.Events...)
	svc.mu.Unlock()
	if len(events) != 1003 {
		t.Fatalf("events len=%d, want 1003", len(events))
	}
	deltas := 0
	for _, event := range events {
		switch event.Kind {
		case FlowerLiveMessageBlockDelta:
			deltas++
		case FlowerLiveTimelineReplaced:
			t.Fatalf("ordinary streaming delta produced timeline.replaced event: %#v", event)
		}
	}
	if deltas != 1000 {
		t.Fatalf("delta count=%d, want 1000", deltas)
	}
}

func TestFlowerLiveActivityTimelineProjectsThroughMessageBlockSet(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_activity_block",
		NamespacePublicID: "ns_live_activity_block",
		ChannelID:         "ch_live_activity_block",
		UserPublicID:      "u_live_activity_block",
		UserEmail:         "activity-block@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "activity block", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_live_activity_block"
	messageID := "msg_live_activity_block"
	activity := newActivityTimelineBlock(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      th.ThreadID,
		TurnID:        messageID,
		TraceID:       runID,
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityNormal,
			TotalItems: 1,
			Counts:     observation.ActivityCounts{Success: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:   "item_live_activity_block",
			ToolID:   "tool_live_activity_block",
			ToolName: "terminal.exec",
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusSuccess,
			Severity: observation.ActivitySeverityNormal,
		}},
	}, nil)
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, messageID, runID, streamEventMessageStart{Type: "message-start", MessageID: messageID})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, messageID, runID, streamEventBlockSet{
		Type:       "block-set",
		MessageID:  messageID,
		BlockIndex: 0,
		Block:      activity,
	})

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	gotKinds := make([]FlowerLiveKind, 0, len(resp.Events))
	var blockSetPayload FlowerLiveMessageBlockSetPayload
	for _, event := range resp.Events {
		gotKinds = append(gotKinds, event.Kind)
		if event.Kind == FlowerLiveTimelineReplaced {
			t.Fatalf("activity block generated timeline.replaced event: %#v", event)
		}
		if event.Kind == FlowerLiveMessageBlockSet && !decodeFlowerPayload(event.Payload, &blockSetPayload) {
			t.Fatalf("decode block_set payload: %s", string(event.Payload))
		}
	}
	wantKinds := []FlowerLiveKind{
		FlowerLiveRunStarted,
		FlowerLiveMessageStarted,
		FlowerLiveMessageBlockSet,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	blockPayload, ok := blockSetPayload.Block.(map[string]any)
	if !ok {
		t.Fatalf("block_set payload type=%T, want object", blockSetPayload.Block)
	}
	if got := strings.TrimSpace(fmt.Sprint(blockPayload["type"])); got != activityTimelineBlockType {
		t.Fatalf("block_set type=%q, want activity timeline", got)
	}
	rawBlock, err := json.Marshal(blockPayload)
	if err != nil {
		t.Fatalf("marshal activity block payload: %v", err)
	}
	if !strings.Contains(string(rawBlock), `"status":"success"`) {
		t.Fatalf("activity block payload did not carry success status: %s", string(rawBlock))
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

	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, "turn_model_io_1", runID, streamEventMessageStart{Type: "message-start", MessageID: "msg_model_io_1"})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, "turn_model_io_1", runID, streamEventModelIOStatus{
		Type:        "model-io-status",
		Phase:       string(FlowerModelIOPhaseWaitingResponse),
		RunID:       runID,
		StepIndex:   1,
		UpdatedAtMs: 10_001,
	})
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, "turn_model_io_1", runID, streamEventModelIOStatus{
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
		FlowerLiveMessageStarted,
		FlowerLiveModelIOUpdated,
		FlowerLiveModelIOUpdated,
	}
	if !reflect.DeepEqual(gotKinds, wantKinds) {
		t.Fatalf("event kinds=%#v, want %#v", gotKinds, wantKinds)
	}
	var payload FlowerLiveModelIOUpdatedPayload
	if !decodeFlowerPayload(resp.Events[3].Payload, &payload) || payload.Status == nil {
		t.Fatalf("failed to decode model io payload: %s", string(resp.Events[3].Payload))
	}
	if payload.Status.Phase != FlowerModelIOPhaseStreaming || payload.Status.RunID != runID || payload.Status.StepIndex != 1 {
		t.Fatalf("model io status=%#v", payload.Status)
	}

	svc.mu.Lock()
	state := svc.flowerLiveMaterializedStateLocked(meta.EndpointID, th.ThreadID)
	svc.mu.Unlock()
	if state.ModelIO == nil || state.ModelIO.Phase != FlowerModelIOPhaseStreaming {
		t.Fatalf("live model_io=%#v", state.ModelIO)
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
	if got := state.ThreadPatch.RunStatus; got != string(RunStateRunning) {
		t.Fatalf("stale terminal changed thread run status=%q, want running", got)
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
			UpdatedAtMs:            10_000,
		}}),
	})
	if state.ContextUsage == nil || state.ContextUsage.InputTokens != 620 || state.ContextUsage.UpdatedAtMs != 10_000 {
		t.Fatalf("context usage=%#v", state.ContextUsage)
	}

	start := FlowerContextCompaction{
		OperationID:  "run-context:compact:1:pre_request:threshold",
		RequestID:    "request-context",
		RunID:        "run-context",
		StepIndex:    1,
		Phase:        "start",
		Status:       "compacting",
		Trigger:      "pre_request",
		Reason:       "threshold",
		Source:       "automatic",
		TokensBefore: 920,
		UpdatedAtMs:  10_001,
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
	complete.TokensAfterEstimate = 210
	complete.UpdatedAtMs = 10_002
	completeDecoration := startDecoration
	completeDecoration.Compaction = complete
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "run-context",
		AtUnixMs: 10_002,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload:  mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: complete, TimelineDecoration: completeDecoration}),
	})
	if len(state.ContextCompactions) != 1 || state.ContextCompactions[0].Status != "compacted" || state.ContextCompactions[0].OperationID != start.OperationID {
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

func TestFlowerLiveContextCompactionCompleteKeepsRunActive(t *testing.T) {
	t.Parallel()

	state := FlowerLiveMaterializedState{}
	runID := "run-context-active"
	turnID := "turn-context-active"
	messageID := "msg-context-active"

	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: "thread-compaction",
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveRunStarted,
		Payload: mustFlowerPayload(FlowerLiveRunStartedPayload{
			RunID:     runID,
			TurnID:    turnID,
			MessageID: messageID,
			Status:    string(RunStateRunning),
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: "thread-compaction",
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageStarted,
		Payload: mustFlowerPayload(FlowerLiveMessageStartedPayload{
			MessageID: messageID, Role: "assistant", Status: "streaming", CreatedAtMs: 10_000,
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
		RequestID:    "request-context-active",
		RunID:        runID,
		StepIndex:    1,
		Phase:        "start",
		Status:       "compacting",
		Trigger:      "pre_request",
		Reason:       "threshold",
		Source:       "automatic",
		TokensBefore: 920,
		UpdatedAtMs:  10_001,
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
	complete.UpdatedAtMs = 10_002
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
		ThreadID: "thread-compaction",
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockStart,
		Payload: mustFlowerPayload(FlowerLiveMessageBlockStartedPayload{
			MessageID:  messageID,
			BlockIndex: 0,
			BlockType:  "markdown",
		}),
	})
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		ThreadID: "thread-compaction",
		TurnID:   turnID,
		RunID:    runID,
		Kind:     FlowerLiveMessageBlockDelta,
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

func TestFlowerLiveContextStateRejectsMissingCanonicalIdentity(t *testing.T) {
	t.Parallel()

	state := FlowerLiveMaterializedState{}
	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "envelope-run",
		AtUnixMs: 10_000,
		Kind:     FlowerLiveContextUsageUpdated,
		Payload: mustFlowerPayload(FlowerLiveUsageUpdatedPayload{Usage: FlowerContextUsage{
			Phase:          "projected_request",
			PressureStatus: "stable",
		}}),
	})
	if state.ContextUsage != nil {
		t.Fatalf("context usage without canonical identity was accepted: %#v", state.ContextUsage)
	}

	applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
		RunID:    "envelope-run",
		AtUnixMs: 10_001,
		Kind:     FlowerLiveContextCompactionUpdated,
		Payload: mustFlowerPayload(FlowerLiveContextCompactionUpdatedPayload{Compaction: FlowerContextCompaction{
			OperationID: "floret-operation",
			RunID:       "floret-run",
			Phase:       "complete",
			Status:      "compacted",
			UpdatedAtMs: 10_001,
		}}),
	})
	if len(state.ContextCompactions) != 0 {
		t.Fatalf("compaction without request and source identity was accepted: %#v", state.ContextCompactions)
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
	host := newTestFloretHostFromService(t, svc, th.ThreadID, "visible output before compact")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(th.ThreadID), TurnID: "message-before-compact", RunID: "run-before-compact", Input: flruntime.TurnInput{Text: "prepare"}}); err != nil {
		t.Fatalf("seed canonical timeline: %v", err)
	}

	r := newRunWithProductStoreForTest(t, runOptions{
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, th.ThreadID),
		RunID:            "run-anchor-stable",
		EndpointID:       meta.EndpointID,
		ThreadID:         th.ThreadID,
		MessageID:        "message-anchor-stable",
		PersistOpTimeout: 2 * time.Second,
	}, svc.threadsDB)
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
		OperationID:         "run-anchor-stable:compact:1:manual:manual-request-1",
		RequestID:           "manual-request-1",
		RunID:               "run-anchor-stable",
		Phase:               observation.CompactionPhaseComplete,
		Status:              observation.CompactionStatusCompacted,
		Trigger:             "manual",
		Reason:              "manual",
		TokensBefore:        900,
		TokensAfterEstimate: 300,
		ObservedAt:          time.UnixMilli(10_001),
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

func TestFlowerLiveCanonicalApprovalQueueSupportsIdentityCheckedResolution(t *testing.T) {
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
	turnID := "turn_live_approval_seq"
	r := newRunWithProductStoreForTest(t, runOptions{
		RunID:               runID,
		EndpointID:          meta.EndpointID,
		ThreadID:            th.ThreadID,
		TurnID:              turnID,
		MessageID:           "msg_live_approval_seq",
		UserPublicID:        meta.UserPublicID,
		HostCapabilities:    bindTestRunHostCapabilities(t, svc, meta.EndpointID, th.ThreadID),
		SessionMeta:         &meta,
		PersistOpTimeout:    time.Second,
		ToolApprovalTimeout: time.Minute,
		OnStreamEvent: func(ev any) {
			svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, turnID, runID, ev)
		},
	}, svc.threadsDB)
	requestedAt := time.Now()
	record := flruntime.ApprovalRecord{
		ApprovalID:         "approval_live_approval_seq",
		RootThreadID:       flruntime.ThreadID(th.ThreadID),
		EffectAttemptID:    "effect_live_approval_seq",
		ToolCallID:         "tool_live_approval_seq",
		ToolName:           "terminal.exec",
		ToolKind:           "local",
		RunID:              flruntime.RunID(r.id),
		ThreadID:           flruntime.ThreadID(th.ThreadID),
		TurnID:             flruntime.TurnID(r.turnID),
		Step:               2,
		BatchIndex:         0,
		BatchSize:          1,
		State:              "requested",
		Revision:           3,
		QueueSequence:      1,
		RequestedAt:        requestedAt,
		UpdatedAt:          requestedAt,
		ArgsHash:           "args_live_approval_seq",
		RequestFingerprint: "fingerprint_live_approval_seq",
		Resources: []flruntime.ApprovalResource{
			{Kind: "command", Value: "pwd; sleep 15; date"},
			{Kind: "working_directory", Value: "/repo"},
		},
		Effects:   []string{"shell"},
		OpenWorld: true,
	}
	queue := flruntime.ApprovalQueue{
		RootThreadID: flruntime.ThreadID(th.ThreadID), Generation: 7, Revision: 11,
		CurrentApprovalID: record.ApprovalID, Items: []flruntime.ApprovalRecord{record}, GeneratedAt: requestedAt,
	}
	host := &recordingFloretHost{approvalQueue: queue}
	host.resolveApproval = func(req flruntime.ResolveApprovalRequest) (flruntime.ResolveApprovalResult, error) {
		resolvedAt := time.Now()
		resolvedRecord := record
		resolvedRecord.State = "rejected"
		resolvedRecord.DecisionID = req.DecisionID
		resolvedRecord.Reason = "user_rejected"
		resolvedRecord.Revision++
		resolvedRecord.UpdatedAt = resolvedAt
		resolvedRecord.ResolvedAt = resolvedAt
		resolvedQueue := flruntime.ApprovalQueue{
			RootThreadID: queue.RootThreadID, Generation: queue.Generation, Revision: queue.Revision + 1, GeneratedAt: resolvedAt,
		}
		host.mu.Lock()
		host.approvalQueue = resolvedQueue
		host.mu.Unlock()
		return flruntime.ResolveApprovalResult{
			Receipt: flruntime.ApprovalDecisionReceipt{
				DecisionID: req.DecisionID, ApprovalID: record.ApprovalID, RootThreadID: queue.RootThreadID,
				Decision: req.Decision, State: "rejected", Reason: "user_rejected",
				QueueGeneration: queue.Generation, QueueRevision: resolvedQueue.Revision,
				ApprovalRevision: resolvedRecord.Revision, SubmittedAt: resolvedAt, ResolvedAt: resolvedAt,
			},
			Queue: resolvedQueue, Approval: resolvedRecord,
		}, nil
	}
	r.setActiveFloretHost(host)
	actions, err := r.flowerApprovalActionsFromFloretQueue(queue)
	if err != nil || len(actions) != 1 {
		t.Fatalf("pending approvals mapped to %d Flower actions: %#v", len(actions), actions)
	}
	svc.mu.Lock()
	svc.runs[runID] = r
	svc.activeRunByTh[runThreadKey(meta.EndpointID, th.ThreadID)] = runID
	svc.mu.Unlock()

	if err := r.syncFloretApprovalQueue(ctx); err != nil {
		t.Fatal(err)
	}

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var approvalEvent *FlowerLiveEvent
	for i := range resp.Events {
		if resp.Events[i].Kind == FlowerLiveApprovalQueueReplaced {
			approvalEvent = &resp.Events[i]
			break
		}
	}
	if approvalEvent == nil {
		t.Fatalf("missing approval.queue_replaced event: %#v", resp.Events)
	}
	var payload FlowerLiveApprovalQueuePayload
	if !decodeFlowerPayload(approvalEvent.Payload, &payload) {
		t.Fatalf("failed to decode approval payload: %s", string(approvalEvent.Payload))
	}
	if len(payload.Actions) != 1 {
		t.Fatalf("approval actions=%#v, want one canonical action", payload.Actions)
	}
	action := payload.Actions[0]
	if action.ExpectedSeq != approvalEvent.Seq {
		t.Fatalf("expected_seq=%d, want event seq %d", action.ExpectedSeq, approvalEvent.Seq)
	}
	if action.Revision <= 0 {
		t.Fatalf("revision=%d, want positive revision", action.Revision)
	}
	if action.SurfaceEpoch != 7 {
		t.Fatalf("surface_epoch=%d, want 7", action.SurfaceEpoch)
	}
	if action.Summary.Command != "pwd; sleep 15; date" || action.Summary.Cwd != "/repo" {
		t.Fatalf("summary=%#v, want command and cwd from Floret resources", action.Summary)
	}
	if action.Summary.Label != "pwd; sleep 15; date" {
		t.Fatalf("summary label=%q, want command label", action.Summary.Label)
	}
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap with pending approval: %v", err)
	}
	if _, ok := bootstrap.LiveState.ApprovalActions[action.ActionID]; !ok {
		t.Fatalf("pending approval missing from bootstrap live state")
	}
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, r.turnID, runID, streamEventBlockSet{
		Type:       "block-set",
		MessageID:  r.messageID,
		BlockIndex: 0,
		Block: newActivityTimelineBlock(observation.ActivityTimeline{
			SchemaVersion: observation.ActivityTimelineSchemaVersion,
			RunID:         runID,
			ThreadID:      th.ThreadID,
			TurnID:        r.turnID,
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
				Kind:             observation.ActivityKindTool,
				Status:           observation.ActivityStatusWaiting,
				Severity:         observation.ActivitySeverityBlocking,
				NeedsAttention:   true,
				RequiresApproval: true,
				ApprovalState:    "requested",
			}},
		}, nil),
	})
	duplicateResp, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, approvalEvent.Seq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after duplicate approval activity: %v", err)
	}
	for _, event := range duplicateResp.Events {
		if event.Kind == FlowerLiveApprovalQueueReplaced {
			t.Fatalf("activity timeline generated a canonical approval queue event: %#v", event)
		}
	}
	svc.broadcastStreamEvent(meta.EndpointID, th.ThreadID, r.turnID, runID, streamEventBlockDelta{
		Type:       "text-delta",
		MessageID:  r.messageID,
		BlockIndex: 1,
		Delta:      "continued after approval request",
	})
	advanced, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, action.ExpectedSeq, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after unrelated event: %v", err)
	}
	if len(advanced.Events) == 0 {
		t.Fatalf("missing event after approval request")
	}
	validRequest := SubmitFlowerApprovalRequest{
		ThreadID:        th.ThreadID,
		RunID:           runID,
		Origin:          action.Origin,
		ActionID:        action.ActionID,
		ToolID:          action.ToolID,
		Approved:        false,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: payload.ApprovalQueue.Generation,
		QueueRevision:   payload.ApprovalQueue.Revision,
		IdempotencyKey:  "decision-live-approval-seq-reject",
	}
	invalidRequests := []struct {
		name   string
		mutate func(*SubmitFlowerApprovalRequest)
	}{
		{name: "missing origin", mutate: func(req *SubmitFlowerApprovalRequest) { req.Origin = "" }},
		{name: "wrong origin", mutate: func(req *SubmitFlowerApprovalRequest) { req.Origin = FlowerApprovalOriginDelegatedSubagent }},
		{name: "wrong action", mutate: func(req *SubmitFlowerApprovalRequest) { req.ActionID = "approval:other" }},
		{name: "wrong run", mutate: func(req *SubmitFlowerApprovalRequest) { req.RunID = "run-other" }},
		{name: "wrong tool", mutate: func(req *SubmitFlowerApprovalRequest) { req.ToolID = "tool-other" }},
		{name: "stale generation", mutate: func(req *SubmitFlowerApprovalRequest) { req.QueueGeneration-- }},
		{name: "stale queue revision", mutate: func(req *SubmitFlowerApprovalRequest) { req.QueueRevision-- }},
		{name: "stale approval revision", mutate: func(req *SubmitFlowerApprovalRequest) { req.Revision-- }},
	}
	for _, tc := range invalidRequests {
		invalid := validRequest
		invalid.IdempotencyKey = "invalid-" + strings.ReplaceAll(tc.name, " ", "-")
		tc.mutate(&invalid)
		if _, submitErr := svc.SubmitFlowerApproval(&meta, invalid); submitErr == nil {
			t.Fatalf("%s approval unexpectedly resolved", tc.name)
		}
		host.mu.Lock()
		resolveCalls := len(host.resolveApprovalReq)
		host.mu.Unlock()
		if resolveCalls != 0 {
			t.Fatalf("%s approval called ResolveApproval %d times", tc.name, resolveCalls)
		}
	}
	approvalReceipt, err := svc.SubmitFlowerApproval(&meta, validRequest)
	if err != nil {
		t.Fatalf("SubmitFlowerApproval with event payload: %v", err)
	}
	assertFlowerApprovalReceiptCursor(t, svc, meta.EndpointID, th.ThreadID, action.ActionID, approvalReceipt)
	host.mu.Lock()
	if len(host.resolveApprovalReq) != 1 {
		host.mu.Unlock()
		t.Fatalf("ResolveApproval calls=%d, want 1", len(host.resolveApprovalReq))
	}
	resolveReq := host.resolveApprovalReq[0]
	host.mu.Unlock()
	if resolveReq.ExpectedRootThreadID != queue.RootThreadID || resolveReq.ExpectedGeneration != queue.Generation ||
		resolveReq.ExpectedRevision != queue.Revision || resolveReq.ExpectedCurrent.ApprovalID != record.ApprovalID ||
		resolveReq.ExpectedCurrent.EffectAttemptID != record.EffectAttemptID || resolveReq.ExpectedApprovalRevision != record.Revision ||
		resolveReq.Decision != flruntime.ApprovalDecisionReject {
		t.Fatalf("ResolveApproval request=%#v", resolveReq)
	}
	resolved, err := svc.ListFlowerThreadLiveEvents(ctx, &meta, th.ThreadID, advanced.NextCursor, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents after approval submit: %v", err)
	}
	var resolvedPayload FlowerLiveApprovalQueuePayload
	for _, event := range resolved.Events {
		if event.Kind == FlowerLiveApprovalQueueReplaced {
			if !decodeFlowerPayload(event.Payload, &resolvedPayload) {
				t.Fatalf("failed to decode resolved payload: %s", string(event.Payload))
			}
			break
		}
	}
	if resolvedPayload.ApprovalQueue.Revision != queue.Revision+1 || len(resolvedPayload.Actions) != 0 {
		t.Fatalf("resolved canonical queue=%#v actions=%#v", resolvedPayload.ApprovalQueue, resolvedPayload.Actions)
	}
	svc.mu.Lock()
	state := svc.flowerLiveMaterializedStateLocked(meta.EndpointID, th.ThreadID)
	svc.mu.Unlock()
	if _, ok := state.ApprovalActions[action.ActionID]; ok {
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
	requestedAt := time.UnixMilli(1700000000000)
	record := flruntime.ApprovalRecord{
		ApprovalID:         "approval_floret_approval_context",
		RootThreadID:       "thread_floret_approval_context",
		EffectAttemptID:    "effect_floret_approval_context",
		ToolCallID:         "tool_floret_approval_context",
		ToolName:           "apply_patch",
		ToolKind:           "local",
		RunID:              flruntime.RunID("run_floret_approval_context"),
		ThreadID:           flruntime.ThreadID("thread_floret_approval_context"),
		TurnID:             flruntime.TurnID("msg_floret_approval_context"),
		Step:               4,
		BatchIndex:         0,
		BatchSize:          1,
		State:              "requested",
		Revision:           2,
		QueueSequence:      1,
		RequestedAt:        requestedAt,
		UpdatedAt:          requestedAt,
		RequestFingerprint: "fingerprint_floret_approval_context",
		Resources: []flruntime.ApprovalResource{
			{Kind: "file", Value: "added.txt"},
		},
		Effects:     []string{"write"},
		Destructive: true,
		ArgsHash:    "abc123",
	}
	queue := flruntime.ApprovalQueue{
		RootThreadID: "thread_floret_approval_context", Generation: 9, Revision: 13,
		CurrentApprovalID: record.ApprovalID, Items: []flruntime.ApprovalRecord{record}, GeneratedAt: requestedAt,
	}
	action, err := r.flowerApprovalActionFromFloretRecord(record, queue)
	if err != nil {
		t.Fatalf("flowerApprovalActionFromFloretRecord: %v", err)
	}
	if action.ActionID != flowerApprovalActionID("run_floret_approval_context", "tool_floret_approval_context") {
		t.Fatalf("ActionID=%q", action.ActionID)
	}
	if action.ToolName != "apply_patch" {
		t.Fatalf("ToolName=%q, want apply_patch", action.ToolName)
	}
	if action.Revision != 2 || action.SurfaceEpoch != 9 || action.StepID != "step:4" {
		t.Fatalf("revision=%d epoch=%d step_id=%q", action.Revision, action.SurfaceEpoch, action.StepID)
	}
	if action.Summary.Description != "Review access to added.txt before this tool runs." {
		t.Fatalf("Description=%q", action.Summary.Description)
	}
	if !reflect.DeepEqual(action.Summary.Effects, []string{"write"}) {
		t.Fatalf("Effects=%#v", action.Summary.Effects)
	}
	if !reflect.DeepEqual(action.Summary.Flags, []string{"destructive"}) {
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
	if got := bootstrap.LiveState.ThreadPatch.RunStatus; got != string(RunStateSuccess) {
		t.Fatalf("terminal thread patch run_status=%q, want success", got)
	}
}

func TestFlowerLiveTerminalRunStatusSettlesMaterializedState(t *testing.T) {
	t.Parallel()

	statuses := []RunState{RunStateSuccess, RunStateCanceled, RunStateFailed, RunStateTimedOut}
	for _, status := range statuses {
		status := status
		t.Run(string(status), func(t *testing.T) {
			t.Parallel()

			runID := "run_terminal_" + string(status)
			prompt := &RequestUserInputPrompt{PromptID: "prompt_" + string(status)}
			state := FlowerLiveMaterializedState{
				ThreadPatch: FlowerLiveThreadPatch{
					RunStatus:     string(RunStateWaitingUser),
					RunErrorCode:  "old_error",
					RunError:      "old error",
					WaitingPrompt: prompt,
				},
				Runs: map[string]FlowerLiveRunState{
					runID: {
						RunID:         runID,
						Status:        string(RunStateWaitingUser),
						MessageID:     "msg_" + string(status),
						WaitingPrompt: prompt,
						ErrorCode:     "old_error",
						Error:         "old error",
					},
				},
				ModelIO:         &FlowerModelIOStatus{RunID: runID, Phase: FlowerModelIOPhaseStreaming},
				ApprovalActions: map[string]FlowerApprovalAction{},
				InputRequests: map[string]RequestUserInputPrompt{
					prompt.PromptID: *prompt,
				},
			}
			errorCode := ""
			errorMessage := ""
			if status == RunStateFailed {
				errorCode = "tool_error"
				errorMessage = "tool failed"
			}
			applyFlowerLiveEventToMaterializedState(&state, nil, FlowerLiveEvent{
				RunID:    runID,
				AtUnixMs: 22_000,
				Kind:     FlowerLiveRunStatusChanged,
				Payload: mustFlowerPayload(FlowerLiveRunStatusChangedPayload{
					RunID:     runID,
					Status:    string(status),
					ErrorCode: errorCode,
					Error:     errorMessage,
				}),
			})

			if _, ok := state.Runs[runID]; ok {
				t.Fatalf("terminal run still present: %#v", state.Runs[runID])
			}
			if state.ModelIO != nil {
				t.Fatalf("terminal run left model_io: %#v", state.ModelIO)
			}
			if len(state.InputRequests) != 0 {
				t.Fatalf("terminal run left input requests: %#v", state.InputRequests)
			}
			if state.ThreadPatch.RunStatus != string(status) {
				t.Fatalf("thread patch run_status=%q, want %q", state.ThreadPatch.RunStatus, status)
			}
			if state.ThreadPatch.RunUpdatedAtUnixMs != 22_000 {
				t.Fatalf("run_updated_at_ms=%d, want 22000", state.ThreadPatch.RunUpdatedAtUnixMs)
			}
			if state.ThreadPatch.WaitingPrompt != nil {
				t.Fatalf("thread patch left waiting prompt: %#v", state.ThreadPatch.WaitingPrompt)
			}
			if state.ThreadPatch.RunErrorCode != errorCode || state.ThreadPatch.RunError != errorMessage {
				t.Fatalf("thread patch error=(%q,%q), want (%q,%q)", state.ThreadPatch.RunErrorCode, state.ThreadPatch.RunError, errorCode, errorMessage)
			}
		})
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
		CurrentModelID: "compat/plain-model",
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
