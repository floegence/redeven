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
	th, err := svc.CreateThread(ctx, &meta, "before title", "", "", "")
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
