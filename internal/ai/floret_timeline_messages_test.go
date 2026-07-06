package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestListThreadMessagesErrorsWhenSuccessfulTerminalFloretProjectionIsMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_success_missing_projection")
	thread, err := svc.CreateThread(ctx, meta, "missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "hello", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_missing_projection", "msg_user", "msg_assistant", threadstore.RunRecord{
		State:         string(RunStateSuccess),
		EndedAtUnixMs: 2000,
	})

	_, err = svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err == nil || !strings.Contains(err.Error(), "missing Floret projection") {
		t.Fatalf("ListThreadMessages err=%v, want missing Floret projection", err)
	}
}

func TestListThreadMessagesProjectsFailedTerminalRunWhenFloretProjectionIsMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_failed_missing_projection")
	thread, err := svc.CreateThread(ctx, meta, "failed missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "continue", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_failed_projection", "msg_user", "msg_assistant", threadstore.RunRecord{
		State:           string(RunStateFailed),
		ErrorCode:       runErrorCodeFloretEngineFailed,
		ErrorMessage:    "Floret provider history has unresolved tool call",
		StartedAtUnixMs: 1000,
		EndedAtUnixMs:   2000,
	})

	listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(listed.Messages) != 2 {
		t.Fatalf("messages=%d, want user message plus terminal diagnostic", len(listed.Messages))
	}
	diag := decodeTimelineDiagnosticForTest(t, listed.Messages[1])
	if diag.ID != "msg_assistant" || diag.Role != "assistant" || diag.Status != "error" {
		t.Fatalf("diagnostic identity/status=%+v", diag)
	}
	if !strings.Contains(diag.Error, "Flower could not finish this turn because the orchestration engine failed.") {
		t.Fatalf("diagnostic error=%q, want Floret engine user-facing copy", diag.Error)
	}
	if len(diag.Blocks) != 1 || diag.Blocks[0].Type != "markdown" || !strings.Contains(diag.Blocks[0].Content, diag.Error) {
		t.Fatalf("diagnostic blocks=%+v, want one markdown block with diagnostic text", diag.Blocks)
	}
	for _, block := range diag.Blocks {
		if block.Type == "activity-timeline" {
			t.Fatalf("diagnostic blocks=%+v, want no Floret activity projection", diag.Blocks)
		}
	}
}

func TestListThreadMessagesProjectsRuntimeRestartedCanceledRunWhenFloretProjectionIsMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_canceled_missing_projection")
	thread, err := svc.CreateThread(ctx, meta, "canceled missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "continue", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_canceled_projection", "msg_user", "msg_assistant", threadstore.RunRecord{
		State:           string(RunStateCanceled),
		ErrorCode:       threadstore.RuntimeRestartedRunErrorCode,
		ErrorMessage:    threadstore.RuntimeRestartedRunErrorMessage,
		StartedAtUnixMs: 1000,
		EndedAtUnixMs:   2000,
	})

	listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(listed.Messages) != 2 {
		t.Fatalf("messages=%d, want user message plus canceled diagnostic", len(listed.Messages))
	}
	diag := decodeTimelineDiagnosticForTest(t, listed.Messages[1])
	if diag.ID != "msg_assistant" || diag.Role != "assistant" || diag.Status != "canceled" {
		t.Fatalf("diagnostic identity/status=%+v", diag)
	}
	if !strings.Contains(diag.Error, threadstore.RuntimeRestartedRunErrorMessage) {
		t.Fatalf("diagnostic error=%q, want runtime restart copy", diag.Error)
	}
	for _, block := range diag.Blocks {
		if block.Type == "activity-timeline" {
			t.Fatalf("diagnostic blocks=%+v, want no Floret activity projection", diag.Blocks)
		}
	}
}

func TestListThreadMessagesProjectsTimedOutTerminalRunWhenFloretProjectionIsMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_timed_out_missing_projection")
	thread, err := svc.CreateThread(ctx, meta, "timed out missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "continue", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_timed_out_projection", "msg_user", "msg_assistant", threadstore.RunRecord{
		State:           string(RunStateTimedOut),
		StartedAtUnixMs: 1000,
		EndedAtUnixMs:   2000,
	})

	listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(listed.Messages) != 2 {
		t.Fatalf("messages=%d, want user message plus timed out diagnostic", len(listed.Messages))
	}
	diag := decodeTimelineDiagnosticForTest(t, listed.Messages[1])
	if diag.ID != "msg_assistant" || diag.Role != "assistant" || diag.Status != "error" {
		t.Fatalf("diagnostic identity/status=%+v", diag)
	}
	if !strings.Contains(diag.Error, "Flower timed out before this reply finished.") {
		t.Fatalf("diagnostic error=%q, want timeout copy", diag.Error)
	}
	for _, block := range diag.Blocks {
		if block.Type == "activity-timeline" {
			t.Fatalf("diagnostic blocks=%+v, want no Floret activity projection", diag.Blocks)
		}
	}
}

func TestGetFlowerThreadLiveBootstrapKeepsTimelineReadableWhenFailedTurnLacksProjection(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_bootstrap_missing_projection")
	thread, err := svc.CreateThread(ctx, meta, "bootstrap missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user_1", "first", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_failed_projection", "msg_user_1", "msg_assistant_1", threadstore.RunRecord{
		State:           string(RunStateFailed),
		ErrorCode:       runErrorCodeFloretEngineFailed,
		ErrorMessage:    "Floret provider history has unresolved tool call",
		StartedAtUnixMs: 1000,
		EndedAtUnixMs:   2000,
	})
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user_2", "continue", 3000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_live_projection", "msg_user_2", "msg_assistant_2", threadstore.RunRecord{
		State:           string(RunStateRunning),
		StartedAtUnixMs: 3000,
	})
	injectTimelineReadPathLiveAssistant(t, svc, meta.EndpointID, thread.ThreadID, "run_live_projection", "msg_assistant_2", "new reply partial", 4000)

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	gotIDs := make([]string, 0, len(bootstrap.TimelineMessages))
	for _, message := range bootstrap.TimelineMessages {
		gotIDs = append(gotIDs, message.MessageID)
	}
	wantIDs := []string{"msg_user_1", "msg_assistant_1", "msg_user_2", "msg_assistant_2"}
	if strings.Join(gotIDs, ",") != strings.Join(wantIDs, ",") {
		t.Fatalf("timeline ids=%v, want %v", gotIDs, wantIDs)
	}
	if got := bootstrap.TimelineMessages[1]; got.Status != "error" || !strings.Contains(got.Content, "orchestration engine failed") {
		t.Fatalf("failed diagnostic message=%+v", got)
	}
	if got := bootstrap.TimelineMessages[3]; got.Status != "streaming" || !got.ActiveCursor || got.Content != "new reply partial" {
		t.Fatalf("live assistant message=%+v", got)
	}
}

func TestListThreadMessagesAllowsRunningFloretTurnWithoutProjection(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_running_projection")
	thread, err := svc.CreateThread(ctx, meta, "running projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "hello", 1000)
	appendTimelineReadPathTurn(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "run_running_projection", "msg_user", "msg_assistant", threadstore.RunRecord{
		State: string(RunStateRunning),
	})

	listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(listed.Messages) != 1 {
		t.Fatalf("messages=%d, want only persisted user message while run is live", len(listed.Messages))
	}
}

func TestForkThreadReadsForkedFloretProjectionWithoutShadowTranscript(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_fork_floret_projection")
	source, err := svc.CreateThread(ctx, meta, "source projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	const (
		sourceTurnID = "turn_source_projection"
		sourceRunID  = "run_source_projection"
		fullAnswer   = "Forked Floret projection body with a final sentence that must render from the destination thread."
	)
	storePath, err := floretThreadStorePath(svc.stateDir)
	if err != nil {
		t.Fatalf("floretThreadStorePath: %v", err)
	}
	host := openTestFloretHost(t, storePath, fullAnswer)
	if _, err := host.StartThread(ctx, flruntime.StartThreadRequest{ThreadID: flruntime.ThreadID(source.ThreadID)}); err != nil {
		_ = host.Close()
		t.Fatalf("StartThread: %v", err)
	}
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(source.ThreadID),
		TurnID:   flruntime.TurnID(sourceTurnID),
		RunID:    flruntime.RunID(sourceRunID),
		Input:    "write the projection-only answer",
	}); err != nil {
		_ = host.Close()
		t.Fatalf("RunTurn: %v", err)
	}
	if err := host.Close(); err != nil {
		t.Fatalf("Close seed Floret host: %v", err)
	}

	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, source.ThreadID, "msg_user_source", "hello", 1000)
	if _, err := svc.threadsDB.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             sourceTurnID,
		EndpointID:         meta.EndpointID,
		ThreadID:           source.ThreadID,
		RunID:              sourceRunID,
		UserMessageID:      "msg_user_source",
		AssistantMessageID: sourceTurnID,
		CreatedAtUnixMs:    1100,
	}); err != nil {
		t.Fatalf("AppendConversationTurn source: %v", err)
	}

	forked, err := svc.ForkThread(ctx, meta, source.ThreadID, "Projection fork")
	if err != nil {
		t.Fatalf("ForkThread: %v", err)
	}
	if forked.ThreadID == "" || forked.ThreadID == source.ThreadID {
		t.Fatalf("forked thread id=%q source=%q", forked.ThreadID, source.ThreadID)
	}

	transcriptRows, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, forked.ThreadID, 10, 0)
	if err != nil {
		t.Fatalf("ListMessages fork: %v", err)
	}
	if len(transcriptRows) != 1 || transcriptRows[0].Role != "user" {
		t.Fatalf("fork transcript rows=%+v, want only user transcript", transcriptRows)
	}

	turns, err := svc.threadsDB.ListConversationTurns(ctx, meta.EndpointID, forked.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListConversationTurns fork: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("fork turns=%d, want 1", len(turns))
	}
	if turns[0].TurnID == sourceTurnID || turns[0].RunID == sourceRunID {
		t.Fatalf("fork turn leaked source Floret identity: %+v", turns[0])
	}
	if turns[0].TurnID == "" || turns[0].RunID == "" || turns[0].AssistantMessageID != turns[0].TurnID || turns[0].UserMessageID != transcriptRows[0].MessageID {
		t.Fatalf("fork turn identity mismatch: %+v transcript=%+v", turns[0], transcriptRows)
	}

	maintenance, err := svc.openFloretMaintenanceHost()
	if err != nil {
		t.Fatalf("openFloretMaintenanceHost: %v", err)
	}
	projection, err := maintenance.ReadTurnProjection(ctx, flruntime.ReadTurnProjectionRequest{
		ThreadID: flruntime.ThreadID(forked.ThreadID),
		TurnID:   flruntime.TurnID(turns[0].TurnID),
		RunID:    flruntime.RunID(turns[0].RunID),
	})
	if closeErr := maintenance.Close(); closeErr != nil {
		t.Fatalf("Close maintenance host: %v", closeErr)
	}
	if err != nil {
		t.Fatalf("ReadTurnProjection fork: %v turn=%+v", err, turns[0])
	}
	if got := floretProjectionAssistantTextForTest(projection); got != fullAnswer {
		t.Fatalf("direct fork projection text=%q, want %q; projection=%#v", got, fullAnswer, projection)
	}

	listed, err := svc.ListThreadMessages(ctx, meta, forked.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages fork: %v", err)
	}
	if len(listed.Messages) != 2 {
		t.Fatalf("fork timeline messages=%d, want user plus Floret projection", len(listed.Messages))
	}
	rawAssistant := threadMessageRawForTest(t, listed.Messages[1])
	var assistant struct {
		ID     string `json:"id"`
		Role   string `json:"role"`
		Status string `json:"status"`
		Blocks []struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(rawAssistant, &assistant); err != nil {
		t.Fatalf("decode fork assistant %s: %v", string(rawAssistant), err)
	}
	if assistant.ID != turns[0].TurnID || assistant.Role != "assistant" || assistant.Status != "complete" {
		t.Fatalf("fork assistant identity/status=%+v turn=%+v", assistant, turns[0])
	}
	if len(assistant.Blocks) != 1 || assistant.Blocks[0].Type != "markdown" || assistant.Blocks[0].Content != fullAnswer {
		t.Fatalf("fork assistant blocks=%+v, want full Floret projection body", assistant.Blocks)
	}

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, forked.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap fork: %v", err)
	}
	if len(bootstrap.TimelineMessages) != 2 {
		t.Fatalf("bootstrap timeline messages=%d, want 2", len(bootstrap.TimelineMessages))
	}
	if got := bootstrap.TimelineMessages[1]; got.MessageID != turns[0].TurnID || got.Status != "complete" || got.Content != fullAnswer {
		t.Fatalf("bootstrap assistant=%+v turn=%+v", got, turns[0])
	}
}

func TestListThreadMessagesPaginatesBeyondFiveHundredMessages(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineReadPathMeta("env_deep_timeline")
	thread, err := svc.CreateThread(ctx, meta, "deep timeline", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	for i := 0; i < 505; i++ {
		id := fmt.Sprintf("msg_%03d", i)
		appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, id, "hello "+id, int64(1000+i))
	}

	beforeID := int64(0)
	total := 0
	var finalPageIDs []string
	for {
		listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 100, beforeID)
		if err != nil {
			t.Fatalf("ListThreadMessages(before=%d): %v", beforeID, err)
		}
		pageIDs := make([]string, 0, len(listed.Messages))
		for _, message := range listed.Messages {
			pageIDs = append(pageIDs, timelineMessageIDForTest(t, message))
		}
		total += len(pageIDs)
		finalPageIDs = pageIDs
		if !listed.HasMore {
			break
		}
		beforeID = listed.NextBeforeID
	}
	if total != 505 {
		t.Fatalf("total messages=%d, want 505", total)
	}
	if len(finalPageIDs) != 5 || finalPageIDs[0] != "msg_000" || finalPageIDs[len(finalPageIDs)-1] != "msg_004" {
		t.Fatalf("final page ids=%v, want msg_000..msg_004", finalPageIDs)
	}
}

func floretProjectionAssistantTextForTest(projection flruntime.ThreadTurnProjection) string {
	var parts []string
	for _, segment := range projection.Segments {
		if segment.Kind != flruntime.ThreadTurnProjectionSegmentAssistantText {
			continue
		}
		if text := strings.TrimSpace(segment.Text); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

func timelineReadPathMeta(endpointID string) *session.Meta {
	return &session.Meta{
		EndpointID:        endpointID,
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
}

func appendTimelineReadPathTurn(t *testing.T, ctx context.Context, store *threadstore.Store, endpointID string, threadID string, runID string, userMessageID string, assistantMessageID string, rec threadstore.RunRecord) {
	t.Helper()
	createdAt := rec.StartedAtUnixMs
	if createdAt <= 0 {
		createdAt = 1000
	}
	rec.RunID = runID
	rec.EndpointID = endpointID
	rec.ThreadID = threadID
	rec.MessageID = assistantMessageID
	if err := store.UpsertRun(ctx, rec); err != nil {
		t.Fatalf("UpsertRun(%s): %v", runID, err)
	}
	if _, err := store.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             assistantMessageID,
		EndpointID:         endpointID,
		ThreadID:           threadID,
		RunID:              runID,
		UserMessageID:      userMessageID,
		AssistantMessageID: assistantMessageID,
		CreatedAtUnixMs:    createdAt,
	}); err != nil {
		t.Fatalf("AppendConversationTurn(%s): %v", assistantMessageID, err)
	}
}

func appendTimelineReadPathUserMessage(t *testing.T, ctx context.Context, store *threadstore.Store, endpointID string, threadID string, messageID string, text string, at int64) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"id":        messageID,
		"role":      "user",
		"status":    "complete",
		"timestamp": at,
		"blocks": []map[string]string{{
			"type":    "markdown",
			"content": text,
		}},
	})
	if err != nil {
		t.Fatalf("marshal user message: %v", err)
	}
	if _, err := store.AppendMessage(ctx, endpointID, threadID, threadstore.Message{
		MessageID:       messageID,
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: at,
		UpdatedAtUnixMs: at,
		TextContent:     text,
		MessageJSON:     string(raw),
	}, "u_test", "u_test@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
}

func injectTimelineReadPathLiveAssistant(t *testing.T, svc *Service, endpointID string, threadID string, runID string, messageID string, content string, createdAtMs int64) {
	t.Helper()
	state := FlowerLiveMaterializedState{
		Messages: map[string]FlowerLiveMessageDraft{
			messageID: {
				MessageID:   messageID,
				Role:        "assistant",
				Status:      "streaming",
				CreatedAtMs: createdAtMs,
				Blocks:      []FlowerLiveBlock{{Type: "markdown", Content: content}},
			},
		},
		Runs: map[string]FlowerLiveRunState{
			runID: {RunID: runID, Status: string(RunStateRunning), MessageID: messageID},
		},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
	}
	svc.mu.Lock()
	svc.flowerLiveByThread[runThreadKey(endpointID, threadID)] = &flowerLiveThreadStream{
		NextSeq:       1,
		State:         state,
		ApprovalIndex: map[string]FlowerApprovalState{},
	}
	svc.mu.Unlock()
}

func timelineMessageIDForTest(t *testing.T, message any) string {
	t.Helper()
	raw := threadMessageRawForTest(t, message)
	var rec struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatalf("decode timeline message id %s: %v", string(raw), err)
	}
	return strings.TrimSpace(rec.ID)
}

type timelineDiagnosticForTest struct {
	ID     string `json:"id"`
	Role   string `json:"role"`
	Status string `json:"status"`
	Error  string `json:"error"`
	Blocks []struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	} `json:"blocks"`
}

func decodeTimelineDiagnosticForTest(t *testing.T, message any) timelineDiagnosticForTest {
	t.Helper()
	raw := threadMessageRawForTest(t, message)
	var rec timelineDiagnosticForTest
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatalf("decode timeline diagnostic %s: %v", string(raw), err)
	}
	return rec
}
