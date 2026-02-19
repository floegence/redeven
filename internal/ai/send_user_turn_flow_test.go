package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	contextmodel "github.com/floegence/redeven-agent/internal/ai/context/model"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func newSendTurnTestService(t *testing.T) *Service {
	t.Helper()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models: []config.AIProviderModel{
					{ModelName: "gpt-5-mini"},
					{ModelName: "gpt-4o-mini"},
				},
			},
		},
	}

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir:         t.TempDir(),
		FSRoot:           t.TempDir(),
		Shell:            "/bin/bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   2 * time.Second,
		RunIdleTimeout:   1 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			// Keep tests offline: force provider-key resolution to fail before any remote call.
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func testSendTurnMeta() *session.Meta {
	return &session.Meta{
		ChannelID:         "ch_send_turn_test",
		EndpointID:        "env_send_turn_test",
		UserPublicID:      "u_send_turn_test",
		UserEmail:         "u_send_turn_test@example.com",
		NamespacePublicID: "ns_send_turn_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
}

func TestSendUserTurn_ExpectedRunChanged_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "conflict", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_active_send_turn_conflict"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}

	// Simulate an active run for expected_run_id conflict checks.
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = activeRunID
	svc.runs[activeRunID] = &run{
		id:         activeRunID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}
	svc.mu.Unlock()

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:      th.ThreadID,
		Model:         "openai/gpt-5-mini",
		ExpectedRunID: "run_expected_but_stale",
		Input: RunInput{
			Text: "hello conflict",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err == nil {
		t.Fatalf("SendUserTurn expected ErrRunChanged, got nil")
	}
	if !errors.Is(err, ErrRunChanged) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrRunChanged)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on run_changed conflict, got %d", len(msgs))
	}
}

func TestSendUserTurn_WaitingPromptMismatch_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-prompt-mismatch", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	const waitingPromptID = "wp_waiting_prompt_mismatch"
	if err := svc.threadsDB.UpdateThreadRunState(
		ctx,
		meta.EndpointID,
		th.ThreadID,
		"waiting_user",
		"",
		waitingPromptID,
		"msg_waiting_prompt_mismatch",
		"tool_waiting_prompt_mismatch",
		meta.UserPublicID,
		meta.UserEmail,
	); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "reply without waiting prompt id",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingPromptChanged) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrWaitingPromptChanged)
	}

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:               th.ThreadID,
		Model:                  "openai/gpt-5-mini",
		ReplyToWaitingPromptID: "wp_wrong_id",
		Input:                  RunInput{Text: "reply with wrong waiting prompt id"},
		Options:                RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingPromptChanged) {
		t.Fatalf("SendUserTurn wrong-id err=%v, want %v", err, ErrWaitingPromptChanged)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on waiting prompt mismatch, got %d", len(msgs))
	}
}

func TestSendUserTurn_WaitingPromptMatch_ReturnsConsumedPromptID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-prompt-match", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	const waitingPromptID = "wp_waiting_prompt_match"
	if err := svc.threadsDB.UpdateThreadRunState(
		ctx,
		meta.EndpointID,
		th.ThreadID,
		"waiting_user",
		"",
		waitingPromptID,
		"msg_waiting_prompt_match",
		"tool_waiting_prompt_match",
		meta.UserPublicID,
		meta.UserEmail,
	); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:               th.ThreadID,
		Model:                  "openai/gpt-5-mini",
		ReplyToWaitingPromptID: waitingPromptID,
		Input: RunInput{
			Text: "reply with matching waiting prompt id",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if got := strings.TrimSpace(resp.ConsumedWaitingPromptID); got != waitingPromptID {
		t.Fatalf("ConsumedWaitingPromptID=%q, want %q", got, waitingPromptID)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SendUserTurn run_id is empty")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatalf("expected persisted user message after matching waiting prompt reply")
	}
}

func TestExecutePreparedRun_WithPersistedUserMessage_ReusesPersistedMessageID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "prepersist", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	persisted, normalizedInput, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{
		Text: "hello pre persisted",
	})
	if err != nil {
		t.Fatalf("persistUserMessage: %v", err)
	}

	// Intentionally override message_id in run request to ensure executePreparedRun
	// honors pre-persisted metadata instead of appending another user message.
	req := RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID:   "client_override_message_id",
			Text:        normalizedInput.Text,
			Attachments: normalizedInput.Attachments,
		},
		Options: RunOptions{MaxSteps: 1},
	}

	prepared, err := svc.prepareRun(meta, "run_prepersist_reuse_user_msg", req, nil, &persisted)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = svc.executePreparedRun(execCtx, prepared)

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	userMsgIDs := make([]string, 0, 2)
	for _, m := range msgs {
		if m.Role == "user" {
			userMsgIDs = append(userMsgIDs, m.MessageID)
		}
	}
	if len(userMsgIDs) != 1 {
		t.Fatalf("expected exactly one user message after pre-persisted run start, got %d (ids=%v)", len(userMsgIDs), userMsgIDs)
	}
	if userMsgIDs[0] != persisted.MessageID {
		t.Fatalf("user message id=%q, want persisted id=%q", userMsgIDs[0], persisted.MessageID)
	}
}

func TestSendUserTurn_ActiveRun_InterruptsAndStartsNewRun(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "interrupt", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_active_interrupt"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}
	oldRun := &run{
		id:         activeRunID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = activeRunID
	svc.runs[activeRunID] = oldRun
	svc.mu.Unlock()

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "interrupt this run",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "start" {
		t.Fatalf("SendUserTurn kind=%q, want start", resp.Kind)
	}
	if resp.RunID == "" {
		t.Fatalf("SendUserTurn run_id is empty")
	}
	if resp.RunID == activeRunID {
		t.Fatalf("SendUserTurn run_id=%q, want a new run id", resp.RunID)
	}
	if !oldRun.isDetached() {
		t.Fatalf("active run should be detached after interruption")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatalf("expected persisted user message after interruption")
	}
}

func TestSendUserTurn_ModelLockConflict_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "model-lock-conflict", "openai/gpt-5-mini", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadModelLock(ctx, meta.EndpointID, th.ThreadID, true); err != nil {
		t.Fatalf("UpdateThreadModelLock: %v", err)
	}

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-4o-mini",
		Input: RunInput{
			Text: "try switching model while locked",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrModelSwitchRequiresExplicitRestart)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on model lock conflict, got %d", len(msgs))
	}
}

func TestContextRepo_ListRecentDialogueTurns_IncludesPendingUserAfterTurns(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "pending-after-turn", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	first, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{
		Text: "first question",
	})
	if err != nil {
		t.Fatalf("persistUserMessage first: %v", err)
	}
	assistantID, err := newMessageID()
	if err != nil {
		t.Fatalf("newMessageID: %v", err)
	}
	assistantAt := time.Now().UnixMilli()
	if _, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:        th.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       assistantID,
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: assistantAt,
		UpdatedAtUnixMs: assistantAt,
		TextContent:     "first answer",
		MessageJSON:     `{"id":"` + assistantID + `","role":"assistant","blocks":[{"type":"text","content":"first answer"}],"status":"complete"}`,
	}, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("append assistant message: %v", err)
	}
	if err := svc.contextRepo.AppendTurn(ctx, meta.EndpointID, th.ThreadID, "run_first", "turn_first", first.MessageID, assistantID, assistantAt); err != nil {
		t.Fatalf("AppendTurn: %v", err)
	}

	second, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{
		Text: "second pending",
	})
	if err != nil {
		t.Fatalf("persistUserMessage second: %v", err)
	}

	turns, err := svc.contextRepo.ListRecentDialogueTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentDialogueTurns: %v", err)
	}
	if len(turns) < 2 {
		t.Fatalf("ListRecentDialogueTurns len=%d, want >=2", len(turns))
	}

	last := turns[len(turns)-1]
	if last.UserMessageID != second.MessageID {
		t.Fatalf("last user_message_id=%q, want %q", last.UserMessageID, second.MessageID)
	}
	if last.UserText != "second pending" {
		t.Fatalf("last user_text=%q, want %q", last.UserText, "second pending")
	}
	if last.AssistantText != "" {
		t.Fatalf("last assistant_text=%q, want empty", last.AssistantText)
	}
}

func TestContextRepo_ListRecentDialogueTurns_PreservesOrphanUsersAroundReferencedTurn(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "orphan-users-around-turn", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendUser := func(messageID string, text string, at int64) {
		t.Helper()
		userJSON, userText, jsonErr := buildUserMessageJSON(messageID, RunInput{
			MessageID: messageID,
			Text:      text,
		}, svc.uploadsDir, at)
		if jsonErr != nil {
			t.Fatalf("buildUserMessageJSON: %v", jsonErr)
		}
		if _, appendErr := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, th.ThreadID, threadstore.Message{
			ThreadID:           th.ThreadID,
			EndpointID:         meta.EndpointID,
			MessageID:          messageID,
			Role:               "user",
			AuthorUserPublicID: meta.UserPublicID,
			AuthorUserEmail:    meta.UserEmail,
			Status:             "complete",
			CreatedAtUnixMs:    at,
			UpdatedAtUnixMs:    at,
			TextContent:        userText,
			MessageJSON:        userJSON,
		}, meta.UserPublicID, meta.UserEmail); appendErr != nil {
			t.Fatalf("append user message: %v", appendErr)
		}
	}

	at1 := time.Now().UnixMilli()
	at2 := at1 + 1000
	at3 := at2 + 1000
	at4 := at3 + 1000

	userOrphanHeadID := "m_user_orphan_head"
	userPairedID := "m_user_paired"
	userOrphanTailID := "m_user_orphan_tail"
	assistantPairedID := "m_assistant_paired"

	appendUser(userOrphanHeadID, "first orphan question", at1)
	appendUser(userPairedID, "paired question", at2)

	if _, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:        th.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       assistantPairedID,
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: at3,
		UpdatedAtUnixMs: at3,
		TextContent:     "paired answer",
		MessageJSON:     fmt.Sprintf(`{"id":"%s","role":"assistant","blocks":[{"type":"text","content":"paired answer"}],"status":"complete"}`, assistantPairedID),
	}, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("append assistant message: %v", err)
	}
	if err := svc.contextRepo.AppendTurn(ctx, meta.EndpointID, th.ThreadID, "run_paired", "turn_paired", userPairedID, assistantPairedID, at3); err != nil {
		t.Fatalf("AppendTurn: %v", err)
	}

	appendUser(userOrphanTailID, "last orphan question", at4)

	turns, err := svc.contextRepo.ListRecentDialogueTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentDialogueTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("ListRecentDialogueTurns len=%d, want 3", len(turns))
	}

	if turns[0].UserMessageID != userOrphanHeadID || turns[0].AssistantMessageID != "" {
		t.Fatalf("turn[0]=%+v, want head orphan user", turns[0])
	}
	if turns[1].UserMessageID != userPairedID || turns[1].AssistantMessageID != assistantPairedID {
		t.Fatalf("turn[1]=%+v, want referenced pair", turns[1])
	}
	if turns[2].UserMessageID != userOrphanTailID || turns[2].AssistantMessageID != "" {
		t.Fatalf("turn[2]=%+v, want tail orphan user", turns[2])
	}
}

func TestPromptPackToHistory_DeduplicatesPendingTailInput(t *testing.T) {
	t.Parallel()

	pack := contextmodel.PromptPack{
		RecentDialogue: []contextmodel.DialogueTurn{
			{
				UserMessageID:      "m_user_pending",
				AssistantMessageID: "",
				UserText:           "same text",
				AssistantText:      "",
			},
		},
	}

	history := promptPackToHistory(pack, "same text")
	if len(history) != 1 {
		t.Fatalf("history len=%d, want 1", len(history))
	}
	if history[0].Role != "user" || history[0].Text != "same text" {
		t.Fatalf("history[0]=%+v, want single user entry", history[0])
	}
}
