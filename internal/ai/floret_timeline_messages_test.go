package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestListThreadMessagesErrorsWhenTerminalFloretProjectionIsMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		EndpointID:        "env_missing_projection",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
	thread, err := svc.CreateThread(ctx, meta, "missing projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "hello", 1000)
	if err := svc.threadsDB.UpsertRun(ctx, threadstore.RunRecord{
		RunID:         "run_missing_projection",
		EndpointID:    meta.EndpointID,
		ThreadID:      thread.ThreadID,
		MessageID:     "msg_assistant",
		State:         string(RunStateSuccess),
		EndedAtUnixMs: 2000,
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if _, err := svc.threadsDB.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             "msg_assistant",
		EndpointID:         meta.EndpointID,
		ThreadID:           thread.ThreadID,
		RunID:              "run_missing_projection",
		UserMessageID:      "msg_user",
		AssistantMessageID: "msg_assistant",
		CreatedAtUnixMs:    1000,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}

	_, err = svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err == nil || !strings.Contains(err.Error(), "missing Floret projection") {
		t.Fatalf("ListThreadMessages err=%v, want missing Floret projection", err)
	}
}

func TestListThreadMessagesAllowsRunningFloretTurnWithoutProjection(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		EndpointID:        "env_running_projection",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
	thread, err := svc.CreateThread(ctx, meta, "running projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendTimelineReadPathUserMessage(t, ctx, svc.threadsDB, meta.EndpointID, thread.ThreadID, "msg_user", "hello", 1000)
	if err := svc.threadsDB.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_running_projection",
		EndpointID: meta.EndpointID,
		ThreadID:   thread.ThreadID,
		MessageID:  "msg_assistant",
		State:      string(RunStateRunning),
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if _, err := svc.threadsDB.AppendConversationTurn(ctx, threadstore.ConversationTurn{
		TurnID:             "msg_assistant",
		EndpointID:         meta.EndpointID,
		ThreadID:           thread.ThreadID,
		RunID:              "run_running_projection",
		UserMessageID:      "msg_user",
		AssistantMessageID: "msg_assistant",
		CreatedAtUnixMs:    1000,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}

	listed, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(listed.Messages) != 1 {
		t.Fatalf("messages=%d, want only persisted user message while run is live", len(listed.Messages))
	}
}

func TestListThreadMessagesPaginatesBeyondFiveHundredMessages(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		EndpointID:        "env_deep_timeline",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
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
