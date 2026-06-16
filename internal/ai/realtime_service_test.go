package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		Options:  RunOptions{MaxSteps: 1},
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
		Options:  RunOptions{MaxSteps: 1},
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

func TestFlowerLiveUpdatesProjectRealtimeEventsProgressively(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_live_updates",
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
	r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: "working"}}
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

	resp, err := svc.ListFlowerThreadLiveUpdates(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveUpdates: %v", err)
	}
	if len(resp.Updates) != 1 {
		t.Fatalf("updates=%d, want 1", len(resp.Updates))
	}
	if got := resp.Updates[0].Kind; got != FlowerLiveActiveRunPatched {
		t.Fatalf("kind=%q, want active_run.patched", got)
	}
	if resp.Updates[0].ActiveRun == nil || strings.TrimSpace(resp.Updates[0].ActiveRun.RunID) != runID {
		t.Fatalf("active_run=%#v, want run %q", resp.Updates[0].ActiveRun, runID)
	}
	if got := resp.Updates[0].ActiveRun.LastEventSeq; got != resp.Updates[0].Seq {
		t.Fatalf("last_event_seq=%d, want update seq %d", got, resp.Updates[0].Seq)
	}
	if len(resp.Updates[0].ActiveRun.ApprovalActions) != 1 {
		t.Fatalf("approval_actions=%d, want 1", len(resp.Updates[0].ActiveRun.ApprovalActions))
	}
	action := resp.Updates[0].ActiveRun.ApprovalActions[0]
	if action.Revision != 1 {
		t.Fatalf("approval revision=%d, want 1", action.Revision)
	}
	if action.ExpectedSeq != resp.Updates[0].Seq {
		t.Fatalf("approval expected_seq=%d, want update seq %d", action.ExpectedSeq, resp.Updates[0].Seq)
	}

	finalMessage := `{"id":"msg_live_projection_1","role":"assistant","status":"complete","content":"done","created_at_ms":1700000000000,"blocks":[{"type":"markdown","content":"done"}]}`
	svc.broadcastTranscriptMessage(meta.EndpointID, th.ThreadID, runID, 1, finalMessage, time.Now().UnixMilli())

	next, err := svc.ListFlowerThreadLiveUpdates(ctx, &meta, th.ThreadID, resp.NextCursor, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveUpdates after transcript: %v", err)
	}
	if len(next.Updates) != 1 {
		t.Fatalf("next updates=%d, want 1", len(next.Updates))
	}
	if got := next.Updates[0].Kind; got != FlowerLiveMessageAppended {
		t.Fatalf("kind=%q, want message.appended", got)
	}
	if !next.Updates[0].ClearActiveRun {
		t.Fatalf("final transcript update must clear active run")
	}
	if len(next.Updates[0].Message) == 0 {
		t.Fatalf("message payload is empty")
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
	resp, err := svc.ListFlowerThreadLiveUpdates(ctx, &meta, th.ThreadID, 0, 10)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveUpdates: %v", err)
	}
	if len(resp.Updates) == 0 {
		t.Fatalf("updates=0, want thread patch")
	}
	var patch *FlowerThreadLiveUpdate
	for i := range resp.Updates {
		if resp.Updates[i].Kind == FlowerLiveThreadPatched {
			patch = &resp.Updates[i]
			break
		}
	}
	if patch == nil {
		t.Fatalf("updates=%#v, want thread.patched", resp.Updates)
	}
	if patch.Thread == nil {
		t.Fatalf("thread.patched update missing thread payload: %#v", patch)
	}
	if strings.TrimSpace(patch.Thread.Title) != "after title" {
		t.Fatalf("thread patch title=%q, want after title", patch.Thread.Title)
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
