package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
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
		AgentHomeDir:     t.TempDir(),
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

func prepareAndPersistUserTurnForTest(t *testing.T, svc *Service, meta *session.Meta, runID string, req RunStartRequest) (*preparedRun, persistedUserMessage, RunInput) {
	t.Helper()

	ctx := context.Background()
	preparedUser, normalizedInput, err := svc.prepareUserMessage(ctx, meta, meta.EndpointID, req.ThreadID, req.Input)
	if err != nil {
		t.Fatalf("prepareUserMessage: %v", err)
	}
	req.Input = normalizedInput
	persistedSeed := persistedUserMessage{
		MessageID:       preparedUser.Message.MessageID,
		MessageJSON:     preparedUser.Message.MessageJSON,
		CreatedAtUnixMs: preparedUser.Message.CreatedAtUnixMs,
	}
	prepared, err := svc.prepareRun(meta, runID, req, nil, &persistedSeed)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}
	startedAt := time.Now().UnixMilli()
	prepared.startedAtUnixMs = startedAt
	result, err := prepared.db.StartUserTurn(ctx, threadstore.StartUserTurn{
		EndpointID:  meta.EndpointID,
		ThreadID:    req.ThreadID,
		UserMessage: preparedUser.Message,
		UploadIDs:   preparedUser.UploadIDs,
		Run: threadstore.RunRecord{
			RunID:           runID,
			EndpointID:      meta.EndpointID,
			ThreadID:        req.ThreadID,
			MessageID:       prepared.messageID,
			State:           string(RunStateRunning),
			AttemptCount:    1,
			StartedAtUnixMs: startedAt,
			UpdatedAtUnixMs: startedAt,
		},
		Turn: threadstore.ConversationTurn{
			TurnID:             prepared.messageID,
			EndpointID:         meta.EndpointID,
			ThreadID:           req.ThreadID,
			RunID:              runID,
			UserMessageID:      preparedUser.Message.MessageID,
			AssistantMessageID: prepared.messageID,
			CreatedAtUnixMs:    preparedUser.Message.CreatedAtUnixMs,
		},
		RunState: threadstore.ThreadRunStateWrite{
			Status:                string(RunStateRunning),
			UpdatedByUserPublicID: meta.UserPublicID,
			UpdatedByUserEmail:    meta.UserEmail,
			UpdatedAtUnixMs:       startedAt,
		},
		StructuredUserInputs:    preparedUser.StructuredInputs,
		RequestUserInputSecrets: preparedUser.SecretAnswers,
		UploadClaimedAtUnixMs:   preparedUser.Message.CreatedAtUnixMs,
	})
	if err != nil {
		svc.releasePreparedRun(prepared)
		t.Fatalf("StartUserTurn: %v", err)
	}
	persisted := persistedUserMessage{
		MessageID:       result.UserMessageID,
		RowID:           result.UserMessageRowID,
		MessageJSON:     result.UserMessageJSON,
		CreatedAtUnixMs: result.UserMessageCreatedAtUnixMs,
	}
	prepared.persistedUser = &persisted
	prepared.req.Input = normalizedInput
	return prepared, persisted, normalizedInput
}

func TestSendUserTurn_ExpectedRunChanged_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "conflict", "", "", "")
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
		Options: RunOptions{},
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

func TestSubmitRequestUserInputResponse_WaitingPromptMismatch_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-prompt-mismatch", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_mismatch",
		"tool_waiting_prompt_mismatch",
		"question_1",
		"Choose a direction.",
		nil,
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "reply without waiting prompt id",
		},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrWaitingUserQueueConflict) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrWaitingUserQueueConflict)
	}

	_, err = svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: RequestUserInputResponse{
			PromptID: "wp_wrong_id",
			Answers: map[string]RequestUserInputAnswer{
				"question_1": {Text: "wrong prompt"},
			},
		},
		Input:   RunInput{Text: "reply with wrong waiting prompt id"},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrWaitingPromptChanged) {
		t.Fatalf("SubmitRequestUserInputResponse wrong-id err=%v, want %v", err, ErrWaitingPromptChanged)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on waiting prompt mismatch, got %d", len(msgs))
	}
}

func TestSubmitRequestUserInputResponse_WaitingPromptMatch_ReturnsConsumedPromptID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-prompt-match", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_match",
		"tool_waiting_prompt_match",
		"question_1",
		"Choose a direction.",
		nil,
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	resp, err := svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"question_1": {Text: "reply with matching waiting prompt id"},
		}),
		Input: RunInput{
			Text: "reply with matching waiting prompt id",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SubmitRequestUserInputResponse: %v", err)
	}
	if got := strings.TrimSpace(resp.ConsumedWaitingPromptID); got != waitingPrompt.PromptID {
		t.Fatalf("ConsumedWaitingPromptID=%q, want %q", got, waitingPrompt.PromptID)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitRequestUserInputResponse run_id is empty")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatalf("expected persisted user message after matching waiting prompt reply")
	}
}

func TestSubmitRequestUserInputResponse_PromptOnlyPersistsStructuredResponseContext(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "prompt-only-structured-response", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testRequestUserInputPrompt(
		"msg_prompt_only",
		"tool_prompt_only",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:                "direction",
				Header:            "Direction",
				Question:          "Choose a direction.",
				ResponseMode:      requestUserInputResponseModeSelect,
				ChoicesExhaustive: testBoolPtr(true),
				Choices: []RequestUserInputChoice{
					{ChoiceID: "proceed", Label: "Proceed", Kind: requestUserInputChoiceKindSelect},
				},
			},
		},
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	resp, err := svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"direction": {ChoiceID: "proceed"},
		}),
		Input:   RunInput{},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SubmitRequestUserInputResponse: %v", err)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitRequestUserInputResponse run_id is empty")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	var userMsg *threadstore.Message
	for i := range msgs {
		if msgs[i].Role == "user" {
			userMsg = &msgs[i]
			break
		}
	}
	if userMsg == nil {
		t.Fatalf("expected persisted user message")
	}
	if got := strings.TrimSpace(userMsg.TextContent); got != "Direction: Proceed." {
		t.Fatalf("user text_content=%q, want %q", got, "Direction: Proceed.")
	}
	if !strings.Contains(userMsg.MessageJSON, "\"request_user_input_response\"") {
		t.Fatalf("user message json missing structured response block: %s", userMsg.MessageJSON)
	}

	structured, err := svc.contextRepo.ListRecentStructuredUserInputs(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentStructuredUserInputs: %v", err)
	}
	if len(structured) != 1 {
		t.Fatalf("len(structured)=%d, want 1", len(structured))
	}
	if structured[0].ResponseMessageID != userMsg.MessageID {
		t.Fatalf("structured response_message_id=%q, want %q", structured[0].ResponseMessageID, userMsg.MessageID)
	}
	if structured[0].SelectedChoiceID != "proceed" {
		t.Fatalf("structured selected_choice_id=%q, want %q", structured[0].SelectedChoiceID, "proceed")
	}
	if structured[0].PublicSummary != "Direction: Proceed." {
		t.Fatalf("structured public_summary=%q, want %q", structured[0].PublicSummary, "Direction: Proceed.")
	}
}

func TestSubmitRequestUserInputResponse_SecretAnswerDoesNotLeakToTranscriptOrStructuredProjection(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "secret-structured-response", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testRequestUserInputPrompt(
		"msg_secret_prompt",
		"tool_secret_prompt",
		AskUserReasonMissingExternalInput,
		[]RequestUserInputQuestion{
			{
				ID:               "api_key",
				Header:           "API key",
				Question:         "Provide the API key.",
				IsSecret:         true,
				ResponseMode:     requestUserInputResponseModeWrite,
				WriteLabel:       "API key",
				WritePlaceholder: "Type the API key",
			},
		},
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	const secretValue = "super-secret-token"
	resp, err := svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"api_key": {Text: secretValue},
		}),
		Input:   RunInput{},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SubmitRequestUserInputResponse: %v", err)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitRequestUserInputResponse run_id is empty")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	var userMsg *threadstore.Message
	for i := range msgs {
		if msgs[i].Role == "user" {
			userMsg = &msgs[i]
			break
		}
	}
	if userMsg == nil {
		t.Fatalf("expected persisted user message")
	}
	if strings.Contains(userMsg.TextContent, secretValue) {
		t.Fatalf("user text_content leaked secret: %q", userMsg.TextContent)
	}
	if strings.Contains(userMsg.MessageJSON, secretValue) {
		t.Fatalf("user message json leaked secret: %s", userMsg.MessageJSON)
	}
	if !strings.Contains(userMsg.TextContent, "secret provided") {
		t.Fatalf("user text_content=%q, want redacted summary", userMsg.TextContent)
	}

	secrets, err := svc.threadsDB.ListRequestUserInputSecretAnswers(ctx, meta.EndpointID, th.ThreadID, userMsg.MessageID)
	if err != nil {
		t.Fatalf("ListRequestUserInputSecretAnswers: %v", err)
	}
	if len(secrets) != 1 || secrets[0].Text != secretValue {
		t.Fatalf("secret answers=%+v, want raw secret stored separately", secrets)
	}

	structured, err := svc.contextRepo.ListRecentStructuredUserInputs(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentStructuredUserInputs: %v", err)
	}
	if len(structured) != 1 {
		t.Fatalf("len(structured)=%d, want 1", len(structured))
	}
	if strings.Contains(structured[0].PublicSummary, secretValue) {
		t.Fatalf("structured public_summary leaked secret: %q", structured[0].PublicSummary)
	}
	if structured[0].Text != "" {
		t.Fatalf("structured text should be empty for secret input, got %+v", structured[0].Text)
	}
	if !structured[0].ContainsSecret {
		t.Fatalf("structured contains_secret=false, want true")
	}

}

func TestExecutePreparedRun_WithPersistedUserMessage_ReusesPersistedMessageID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "prepersist", "", "", "")
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
		Options: RunOptions{},
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

func TestExecutePreparedRun_PreEngineFailureTerminalizesRunRecord(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "pre-engine-failure", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadModelLock(ctx, meta.EndpointID, th.ThreadID, true); err != nil {
		t.Fatalf("UpdateThreadModelLock: %v", err)
	}

	runID := "run_pre_engine_failure"
	prepared, _, _ := prepareAndPersistUserTurnForTest(t, svc, meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-4o-mini",
		Input: RunInput{
			MessageID: "m_pre_engine_failure",
			Text:      "trigger model lock failure",
		},
		Options: RunOptions{},
	})

	err = svc.executePreparedRun(ctx, prepared)
	if !errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
		t.Fatalf("executePreparedRun err=%v, want %v", err, ErrModelSwitchRequiresExplicitRestart)
	}
	rec, err := svc.threadsDB.GetRun(ctx, meta.EndpointID, runID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if rec == nil {
		t.Fatalf("run record missing")
	}
	if rec.State == string(RunStateRunning) || rec.State != string(RunStateFailed) {
		t.Fatalf("run state=%q, want failed terminal", rec.State)
	}
	if rec.EndedAtUnixMs <= 0 {
		t.Fatalf("EndedAtUnixMs=%d, want terminal timestamp", rec.EndedAtUnixMs)
	}
	msg, err := svc.threadsDB.GetTranscriptMessage(ctx, meta.EndpointID, th.ThreadID, prepared.messageID)
	if err != nil {
		t.Fatalf("GetTranscriptMessage assistant: %v", err)
	}
	if msg == nil || msg.Role != "assistant" || msg.Status != "error" || !strings.Contains(msg.TextContent, ErrModelSwitchRequiresExplicitRestart.Error()) {
		t.Fatalf("assistant message=%+v, want persisted error assistant", msg)
	}
	turns, err := svc.contextRepo.ListRecentDialogueTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentDialogueTurns: %v", err)
	}
	if len(turns) != 1 || turns[0].RunID != runID || turns[0].AssistantMessageID != prepared.messageID {
		t.Fatalf("recent turns=%+v, want complete pre-engine failure turn", turns)
	}
}

func TestSendUserTurn_ActiveRun_QueuesFollowUpWithoutCanceling(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "interrupt", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	baseline, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{
		Text: "baseline before queue",
	})
	if err != nil {
		t.Fatalf("persistUserMessage baseline: %v", err)
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
			MessageID: "m_client_follow_up_1",
			Text:      "queue this follow-up",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "queued" {
		t.Fatalf("SendUserTurn kind=%q, want queued", resp.Kind)
	}
	if resp.RunID != "" {
		t.Fatalf("SendUserTurn run_id=%q, want empty", resp.RunID)
	}
	if strings.TrimSpace(resp.QueueID) == "" {
		t.Fatalf("SendUserTurn queue_id is empty")
	}
	if resp.QueuePosition != 1 {
		t.Fatalf("SendUserTurn queue_position=%d, want 1", resp.QueuePosition)
	}
	if oldRun.isDetached() {
		t.Fatalf("active run should not be detached when follow-up is queued")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	userMsgCount := 0
	for _, m := range msgs {
		if m.Role == "user" {
			userMsgCount++
		}
	}
	if userMsgCount != 1 {
		t.Fatalf("expected only baseline transcript user message before dequeue, got %d", userMsgCount)
	}
	if msgs[0].MessageID != baseline.MessageID {
		t.Fatalf("baseline message_id=%q, want %q", msgs[0].MessageID, baseline.MessageID)
	}

	queued, err := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("len(queued)=%d, want 1", len(queued))
	}
	if queued[0].MessageID != "m_client_follow_up_1" {
		t.Fatalf("queued message_id=%q, want m_client_follow_up_1", queued[0].MessageID)
	}
	if queued[0].ChannelID != meta.ChannelID {
		t.Fatalf("queued channel_id=%q, want %q", queued[0].ChannelID, meta.ChannelID)
	}
	restoredMeta := queuedTurnRecordToSessionMeta(queued[0], "ns_queue")
	if restoredMeta.CanRead != meta.CanRead || restoredMeta.CanWrite != meta.CanWrite || restoredMeta.CanExecute != meta.CanExecute {
		t.Fatalf("queued permissions=(%v,%v,%v), want (%v,%v,%v)", restoredMeta.CanRead, restoredMeta.CanWrite, restoredMeta.CanExecute, meta.CanRead, meta.CanWrite, meta.CanExecute)
	}

	threadView, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if threadView == nil || threadView.QueuedTurnCount != 1 {
		t.Fatalf("QueuedTurnCount=%v, want 1", threadView)
	}

	threads, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(threads.Threads) != 1 || threads.Threads[0].QueuedTurnCount != 1 {
		t.Fatalf("ListThreads queued_turn_count mismatch: %+v", threads.Threads)
	}
}

func TestSendUserTurn_ExistingQueuedTurnsKeepFIFOWhenThreadIdle(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "queued-fifo-idle", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	first, firstPos, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_fifo_first",
			Text:      "first queued turn",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("enqueueQueuedTurn first: %v", err)
	}
	if firstPos != 1 {
		t.Fatalf("first position=%d, want 1", firstPos)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_fifo_second",
			Text:      "second queued turn",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn second: %v", err)
	}
	if resp.Kind != "queued" || strings.TrimSpace(resp.RunID) != "" || resp.QueuePosition != 2 {
		t.Fatalf("SendUserTurn response=%+v, want queued in second position", resp)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("messages=%+v, want no direct transcript while previous queued turn exists", msgs)
	}
	queued, err := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns: %v", err)
	}
	if len(queued) != 2 || queued[0].QueueID != first.QueueID || queued[0].MessageID != "m_fifo_first" || queued[1].MessageID != "m_fifo_second" {
		t.Fatalf("queued=%+v, want original FIFO order", queued)
	}
}

func TestSendUserTurn_IdleCompactionQueuesUntilCompactionFinishes(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "idle-compaction-queue", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_idle_queue", "run_idle_compaction_queue", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_existing_anchor",
		Edge:       "after",
	}, threadstore.ThreadContextBoundary{}, func() {
		t.Fatalf("idle compaction must not be canceled by a user turn")
	})
	if gateErr != nil || !begin.Started {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.OperationID)

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_idle_compaction_started",
			Text:      "start now and replace compaction",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "queued" || strings.TrimSpace(resp.RunID) != "" || strings.TrimSpace(resp.QueueID) == "" || resp.QueuePosition != 1 {
		t.Fatalf("SendUserTurn response=%+v, want queued follow-up", resp)
	}
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != begin.OperationID {
		t.Fatalf("idleThreadCompactionOperation=%q, want current operation %q", got, begin.OperationID)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("messages=%+v, want no canonical transcript until compaction finishes", msgs)
	}
	queued, err := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns: %v", err)
	}
	if len(queued) != 1 || queued[0].MessageID != "m_idle_compaction_started" {
		t.Fatalf("queued=%+v, want queued follow-up after compaction", queued)
	}
	turns, err := svc.contextRepo.ListRecentDialogueTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentDialogueTurns: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("turns=%+v, want no unfinished turn in recent dialogue", turns)
	}
}

func TestQueuedDrain_WaitsForIdleCompactionThenStartsQueuedTurn(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "idle-compaction-drain", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_queued_idle_compaction_start",
			Text:      "queued turn should start now",
		},
		Options: RunOptions{},
	}); err != nil {
		t.Fatalf("enqueueQueuedTurn: %v", err)
	}

	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_idle_drain", "run_idle_compaction_drain", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_existing_anchor",
		Edge:       "after",
	}, threadstore.ThreadContextBoundary{}, func() {
		t.Fatalf("queued drain must not cancel idle compaction")
	})
	if gateErr != nil || !begin.Started {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}

	actor := svc.threadMgr.Get(meta.EndpointID, th.ThreadID)
	if actor == nil {
		t.Fatalf("thread actor missing")
	}
	if err := actor.handleMaybeStartQueuedTurn(ctx); err != nil {
		t.Fatalf("handleMaybeStartQueuedTurn: %v", err)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("messages=%+v, want no canonical transcript while compaction is running", msgs)
	}
	queued, err := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("queued=%+v, want queued turn retained while compaction is running", queued)
	}

	svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.OperationID)
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != "" {
		t.Fatalf("idleThreadCompactionOperation=%q, want cleared", got)
	}
	if err := actor.handleMaybeStartQueuedTurn(ctx); err != nil {
		t.Fatalf("handleMaybeStartQueuedTurn after compaction: %v", err)
	}
	msgs, _, _, err = svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages after compaction: %v", err)
	}
	if len(msgs) != 1 || msgs[0].MessageID != "m_queued_idle_compaction_start" {
		t.Fatalf("messages=%+v, want queued turn canonical transcript after compaction", msgs)
	}
	queued, err = svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns after compaction: %v", err)
	}
	if len(queued) != 0 {
		t.Fatalf("queued=%+v, want queued turn consumed after compaction", queued)
	}
	threadView, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread after drain: %v", err)
	}
	if threadView == nil || strings.TrimSpace(threadView.RunStatus) != string(RunStateRunning) || threadView.QueuedTurnCount != 0 {
		t.Fatalf("threadView=%+v, want running with no queued turns", threadView)
	}
	threads, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatalf("ListThreads after drain: %v", err)
	}
	if len(threads.Threads) != 1 || strings.TrimSpace(threads.Threads[0].RunStatus) != string(RunStateRunning) || threads.Threads[0].QueuedTurnCount != 0 {
		t.Fatalf("threads=%+v, want running thread with no queued turns", threads.Threads)
	}
}

func TestStartRunDetachedRejectedWhileIdleCompactionRunning(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "idle-compaction-start-run-gate", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_start_run_gate", "run_idle_gate", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_idle_gate_anchor",
		Edge:       "after",
	}, threadstore.ThreadContextBoundary{}, func() {})
	if gateErr != nil || !begin.Started || begin.OperationID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.OperationID)

	err = svc.StartRunDetached(meta, "run_must_not_start_during_idle_compaction", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_should_not_persist",
			Text:      "this path must respect the idle compaction gate",
		},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("StartRunDetached err=%v, want %v", err, ErrThreadBusy)
	}
	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("messages=%+v, want no transcript message from rejected detached run", msgs)
	}
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != begin.OperationID {
		t.Fatalf("idleThreadCompactionOperation=%q, want %q", got, begin.OperationID)
	}
}

func TestSetThreadPermissionTypeAllowsActiveRunAndBroadcastsPatch(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, meta, "live-permission", "", config.AIPermissionApprovalRequired, "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = "run_active_permission_patch"
	svc.mu.Unlock()

	if err := svc.SetThreadPermissionType(ctx, meta, th.ThreadID, config.AIPermissionFullAccess); err != nil {
		t.Fatalf("SetThreadPermissionType active run: %v", err)
	}
	got, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got.PermissionType != config.AIPermissionFullAccess {
		t.Fatalf("permission_type=%q, want full_access", got.PermissionType)
	}
	resp, err := svc.ListFlowerThreadLiveEvents(ctx, meta, th.ThreadID, 0, 20)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var patch *FlowerLiveThreadPatch
	for i := range resp.Events {
		if resp.Events[i].Kind != FlowerLiveThreadPatched {
			continue
		}
		var payload FlowerLiveThreadPatchedPayload
		if decodeFlowerPayload(resp.Events[i].Payload, &payload) {
			patch = &payload.Patch
		}
	}
	if patch == nil {
		t.Fatalf("events=%#v, want thread.patched", resp.Events)
	}
	if patch.PermissionType != config.AIPermissionFullAccess {
		t.Fatalf("patch permission_type=%q, want full_access", patch.PermissionType)
	}
}

func TestBeginIdleCompactionRejectedWhileActiveRunRegistered(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "active-run-idle-compaction-gate", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = "run_active_gate"
	svc.mu.Unlock()

	cancelled := false
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_must_not_register", "run_idle_must_not_register", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_active_gate_anchor",
		Edge:       "after",
	}, threadstore.ThreadContextBoundary{}, func() {
		cancelled = true
	})
	if !errors.Is(gateErr, ErrThreadBusy) {
		t.Fatalf("beginIdleThreadCompaction err=%v, want %v", gateErr, ErrThreadBusy)
	}
	if begin.Started {
		t.Fatalf("beginIdleThreadCompaction result=%+v, want rejected", begin)
	}
	if !cancelled {
		t.Fatalf("beginIdleThreadCompaction did not cancel rejected idle compaction context")
	}
	if existing := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); existing != "" {
		t.Fatalf("idle compaction operation=%q, want none", existing)
	}
}

func TestSendUserTurn_QueuedDraftSourceMayReuseMessageID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "queued-draft-source", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	draft, _, _, err := svc.threadsDB.CreateFollowup(ctx, threadstore.QueuedTurn{
		QueueID:               "draft_reuse_1",
		EndpointID:            meta.EndpointID,
		ThreadID:              th.ThreadID,
		ChannelID:             meta.ChannelID,
		Lane:                  threadstore.FollowupLaneDraft,
		MessageID:             "m_reused_draft_message",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "draft text",
		CreatedByUserPublicID: meta.UserPublicID,
		CreatedByUserEmail:    meta.UserEmail,
	})
	if err != nil {
		t.Fatalf("CreateFollowup draft: %v", err)
	}

	activeRunID := "run_active_queue_reuse"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}
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

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:         th.ThreadID,
		Model:            "openai/gpt-5-mini",
		SourceFollowupID: draft.QueueID,
		Input: RunInput{
			MessageID: draft.MessageID,
			Text:      "queued from draft",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "queued" {
		t.Fatalf("resp.Kind=%q, want queued", resp.Kind)
	}

	queued, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("len(queued)=%d, want 1", len(queued))
	}
	if queued[0].QueueID == draft.QueueID {
		t.Fatalf("queued followup reused draft queue_id %q", queued[0].QueueID)
	}
	if queued[0].MessageID != draft.MessageID {
		t.Fatalf("queued message_id=%q, want %q", queued[0].MessageID, draft.MessageID)
	}

	drafts, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft: %v", err)
	}
	if len(drafts) != 0 {
		t.Fatalf("len(drafts)=%d, want source draft consumed", len(drafts))
	}
}

func TestQueuedTurnRecordToSessionMeta_HistoricalRecordDoesNotEscalatePermissions(t *testing.T) {
	t.Parallel()

	rec := threadstore.QueuedTurn{
		QueueID:               "q_legacy",
		EndpointID:            "env_legacy",
		ThreadID:              "th_legacy",
		ChannelID:             "ch_legacy",
		MessageID:             "m_legacy",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "legacy queued turn",
		CreatedByUserPublicID: "u_legacy",
		CreatedByUserEmail:    "legacy@example.com",
	}

	meta := queuedTurnRecordToSessionMeta(rec, "ns_legacy")
	if meta == nil {
		t.Fatalf("meta is nil")
	}
	if meta.CanRead || meta.CanWrite || meta.CanExecute {
		t.Fatalf("legacy queued turn permissions escalated: read=%v write=%v execute=%v", meta.CanRead, meta.CanWrite, meta.CanExecute)
	}
	if err := requireRWX(meta); !errors.Is(err, errRWXPermissionDenied) {
		t.Fatalf("requireRWX legacy meta err=%v, want %v", err, errRWXPermissionDenied)
	}
}

func TestThreadActor_MaybeStartQueuedTurn_StartsQueuedMessageWithOriginalMessageID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "queued-drain", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_active_queue_drain"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}
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

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_client_follow_up_2",
			Text:      "queued follow-up to auto start",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "queued" {
		t.Fatalf("resp.Kind=%q, want queued", resp.Kind)
	}

	svc.mu.Lock()
	delete(svc.activeRunByTh, thKey)
	delete(svc.runs, activeRunID)
	svc.mu.Unlock()

	actor := svc.threadMgr.Get(meta.EndpointID, th.ThreadID)
	if actor == nil {
		t.Fatalf("thread actor missing")
	}
	if err := actor.handleMaybeStartQueuedTurn(ctx); err != nil {
		t.Fatalf("handleMaybeStartQueuedTurn: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		msgs, _, _, listErr := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
		if listErr != nil {
			t.Fatalf("ListMessages: %v", listErr)
		}
		for _, m := range msgs {
			if m.Role == "user" && m.MessageID == "m_client_follow_up_2" {
				queued, queuedErr := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
				if queuedErr != nil {
					t.Fatalf("ListQueuedTurns after drain: %v", queuedErr)
				}
				if len(queued) != 0 {
					t.Fatalf("expected queued turns to be drained, got %d", len(queued))
				}
				return
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("queued follow-up message was not persisted with original message id")
}

func TestThreadActor_MaybeStartQueuedTurn_DropsInvalidQueuedTurnAndLogsIt(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		Shell:            "/bin/bash",
		Config:           &config.AIConfig{Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   2 * time.Second,
		RunIdleTimeout:   1 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := testSendTurnMeta()
	ctx := context.Background()
	th, err := svc.CreateThread(ctx, meta, "invalid queued turn", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "bad queued turn",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				ExecutionContext: &ContextActionExecutionHint{
					RuntimeHint: "legacy",
				},
				Context:      []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{},
	}); !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("enqueueQueuedTurn err=%v, want %v", err, ErrInvalidContextAction)
	}

	invalidContextActionJSON := `{"schema_version":2,"action_id":"assistant.ask.flower","provider":"flower","target":{"target_id":"current","locality":"auto"},"source":{"surface":"desktop_welcome_environment_card"},"execution_context":{"runtime_hint":"legacy"},"context":[{"kind":"text_snapshot","title":"Local","content":"Environment: Local"}],"presentation":{"label":"Ask Flower","priority":100}}`

	if raw, _, _, err := svc.threadsDB.CreateFollowup(ctx, threadstore.QueuedTurn{
		QueueID:           "q_invalid_queued_turn",
		EndpointID:        meta.EndpointID,
		ThreadID:          th.ThreadID,
		ChannelID:         meta.ChannelID,
		Lane:              threadstore.FollowupLaneQueued,
		MessageID:         "m_invalid_queued_turn",
		ModelID:           "openai/gpt-5-mini",
		TextContent:       "bad queued turn",
		ContextActionJSON: invalidContextActionJSON,
	}); err != nil {
		t.Fatalf("CreateFollowup invalid queued turn: %v", err)
	} else if raw.QueueID == "" {
		t.Fatalf("CreateFollowup returned empty queue id")
	}

	actor := svc.threadMgr.Get(meta.EndpointID, th.ThreadID)
	if actor == nil {
		t.Fatalf("thread actor missing")
	}
	actor.wakeMaybeStartQueuedTurn()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		queued, listErr := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
		if listErr != nil {
			t.Fatalf("ListQueuedTurns: %v", listErr)
		}
		if len(queued) == 0 && strings.Contains(logBuf.String(), "failed to start queued turn") {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	queued, listErr := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if listErr != nil {
		t.Fatalf("ListQueuedTurns: %v", listErr)
	}
	if len(queued) != 0 {
		t.Fatalf("queued turns len=%d, want 0 after dropping invalid record", len(queued))
	}
	t.Fatalf("queued turn failure not logged: %s", logBuf.String())
}

func TestThreadActor_MaybeStartQueuedTurn_ConsumesPermanentDuplicateAndDrainsNext(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "duplicate queued drain", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	prepared, _, _ := prepareAndPersistUserTurnForTest(t, svc, meta, "run_existing_duplicate", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_duplicate_queue",
			Text:      "already canonical",
		},
		Options: RunOptions{},
	})
	t.Cleanup(func() { svc.releasePreparedRun(prepared) })
	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, th.ThreadID, string(RunStateSuccess), "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState success: %v", err)
	}
	svc.releasePreparedRun(prepared)

	if _, _, _, err := svc.threadsDB.CreateFollowup(ctx, threadstore.QueuedTurn{
		QueueID:               "q_duplicate_queue",
		EndpointID:            meta.EndpointID,
		ThreadID:              th.ThreadID,
		ChannelID:             meta.ChannelID,
		Lane:                  threadstore.FollowupLaneQueued,
		MessageID:             "m_duplicate_queue",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "already canonical",
		OptionsJSON:           marshalQueuedTurnOptions(RunOptions{}),
		SessionMetaJSON:       marshalQueuedTurnSessionMeta(meta),
		CreatedByUserPublicID: meta.UserPublicID,
		CreatedByUserEmail:    meta.UserEmail,
		SortIndex:             1,
	}); err != nil {
		t.Fatalf("CreateFollowup duplicate: %v", err)
	}
	if _, _, _, err := svc.threadsDB.CreateFollowup(ctx, threadstore.QueuedTurn{
		QueueID:               "q_next_queue",
		EndpointID:            meta.EndpointID,
		ThreadID:              th.ThreadID,
		ChannelID:             meta.ChannelID,
		Lane:                  threadstore.FollowupLaneQueued,
		MessageID:             "m_next_queue",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "start next queued turn",
		OptionsJSON:           marshalQueuedTurnOptions(RunOptions{}),
		SessionMetaJSON:       marshalQueuedTurnSessionMeta(meta),
		CreatedByUserPublicID: meta.UserPublicID,
		CreatedByUserEmail:    meta.UserEmail,
		SortIndex:             2,
	}); err != nil {
		t.Fatalf("CreateFollowup next: %v", err)
	}

	actor := svc.threadMgr.Get(meta.EndpointID, th.ThreadID)
	if actor == nil {
		t.Fatalf("thread actor missing")
	}
	actor.wakeMaybeStartQueuedTurn()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		queued, listErr := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
		if listErr != nil {
			t.Fatalf("ListQueuedTurns: %v", listErr)
		}
		msg, getErr := svc.threadsDB.GetTranscriptMessage(ctx, meta.EndpointID, th.ThreadID, "m_next_queue")
		if getErr != nil {
			t.Fatalf("GetTranscriptMessage next: %v", getErr)
		}
		if len(queued) == 0 && msg != nil {
			turns, turnErr := svc.threadsDB.ListConversationTurns(ctx, meta.EndpointID, th.ThreadID, 10)
			if turnErr != nil {
				t.Fatalf("ListConversationTurns: %v", turnErr)
			}
			if len(turns) != 2 || turns[1].UserMessageID != "m_next_queue" {
				t.Fatalf("turns=%+v, want duplicate consumed and next queued turn started", turns)
			}
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	queued, listErr := svc.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if listErr != nil {
		t.Fatalf("ListQueuedTurns final: %v", listErr)
	}
	t.Fatalf("queued=%+v, want duplicate consumed and next queued turn started", queued)
}

func TestSendUserTurn_ModelLockConflict_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "model-lock-conflict", "openai/gpt-5-mini", "", "")
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
		Options: RunOptions{},
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

func TestSendUserTurn_IdleStartPersistsCanonicalTurnBeforeExecution(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "idle-start-turn", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_idle_start_user",
			Text:      "start immediately",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "start" || strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SendUserTurn response=%+v, want started run", resp)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	foundUser := false
	for _, msg := range msgs {
		if msg.Role == "user" && msg.MessageID == "m_idle_start_user" {
			foundUser = true
			break
		}
	}
	if !foundUser {
		t.Fatalf("messages=%+v, want canonical user message before execution finishes", msgs)
	}
	turns, err := svc.threadsDB.ListConversationTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListConversationTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns=%+v, want one canonical turn", turns)
	}
	if turns[0].RunID != resp.RunID || turns[0].UserMessageID != "m_idle_start_user" || strings.TrimSpace(turns[0].AssistantMessageID) == "" {
		t.Fatalf("turn=%+v, want turn linked to started run and assistant message", turns[0])
	}
}

func TestContextRepo_ListRecentDialogueTurns_ExcludesPendingTranscriptUser(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "pending-after-turn", "", "", "")
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
	if _, err := svc.contextRepo.AppendTurn(ctx, meta.EndpointID, th.ThreadID, "run_first", "turn_first", first.MessageID, assistantID, assistantAt); err != nil {
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
	if len(turns) != 1 {
		t.Fatalf("ListRecentDialogueTurns len=%d, want 1 canonical turn", len(turns))
	}
	if turns[0].UserMessageID != first.MessageID || turns[0].AssistantMessageID != assistantID {
		t.Fatalf("turn[0]=%+v, want canonical first turn", turns[0])
	}
	if turns[0].UserMessageID == second.MessageID {
		t.Fatalf("pending transcript user %q must not be projected as dialogue", second.MessageID)
	}
}

func TestContextRepo_ListRecentDialogueTurns_ExcludesOrphanTranscriptUsersAroundReferencedTurn(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "orphan-users-around-turn", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendUser := func(messageID string, text string, at int64) {
		t.Helper()
		userJSON, userText, jsonErr := buildUserMessageJSON(messageID, RunInput{
			MessageID: messageID,
			Text:      text,
		}, nil, at)
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
	if _, err := svc.contextRepo.AppendTurn(ctx, meta.EndpointID, th.ThreadID, "run_paired", "turn_paired", userPairedID, assistantPairedID, at3); err != nil {
		t.Fatalf("AppendTurn: %v", err)
	}

	appendUser(userOrphanTailID, "last orphan question", at4)

	turns, err := svc.contextRepo.ListRecentDialogueTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentDialogueTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("ListRecentDialogueTurns len=%d, want 1 canonical turn", len(turns))
	}

	if turns[0].UserMessageID != userPairedID || turns[0].AssistantMessageID != assistantPairedID {
		t.Fatalf("turn[0]=%+v, want referenced pair", turns[0])
	}
	if turns[0].UserMessageID == userOrphanHeadID || turns[0].UserMessageID == userOrphanTailID {
		t.Fatalf("orphan transcript user projected as dialogue: %+v", turns[0])
	}
}

func TestSendUserTurn_StaleSourceFollowupStillStartsTurn(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "stale-source-start", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:         th.ThreadID,
		Model:            "openai/gpt-5-mini",
		SourceFollowupID: "missing_stale_draft",
		Input: RunInput{
			MessageID: "m_stale_source_user",
			Text:      "continue after stale draft id",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.Kind != "start" || strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SendUserTurn response=%+v, want started run", resp)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	foundUser := false
	for _, msg := range msgs {
		if msg.Role == "user" && msg.MessageID == "m_stale_source_user" {
			foundUser = true
			break
		}
	}
	if !foundUser {
		t.Fatalf("messages=%+v, want user message despite stale source followup", msgs)
	}
	turns, err := svc.threadsDB.ListConversationTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListConversationTurns: %v", err)
	}
	if len(turns) != 1 || turns[0].RunID != resp.RunID || turns[0].UserMessageID != "m_stale_source_user" {
		t.Fatalf("turns=%+v, want canonical turn despite stale source followup", turns)
	}
}

func TestSendUserTurnRejectsNonStandardContextActions(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "legacy context action rejection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "inspect env",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.unlisted",
				Provider:      "not_flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrInvalidContextAction)
	}
}

func TestSendUserTurnRejectsNonStandardContextActionsWhileWaitingUser(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "legacy context action waiting-user rejection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, thread.ThreadID, testSingleQuestionPrompt(
		"msg_waiting_legacy_context_action",
		"tool_waiting_legacy_context_action",
		"question_1",
		"Choose a direction.",
		nil,
	))

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:              thread.ThreadID,
		Model:                 "openai/gpt-5-mini",
		QueueAfterWaitingUser: true,
		Input: RunInput{
			Text: "queue with invalid context action",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.unlisted",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("SendUserTurn queue-after-waiting-user err=%v, want %v", err, ErrInvalidContextAction)
	}
}

func TestSendUserTurnRejectsNonStandardContextActionsWhileActiveRunWouldQueue(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "legacy context action active-run queue rejection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_active_invalid_context_queue"
	thKey := runThreadKey(meta.EndpointID, thread.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = activeRunID
	svc.runs[activeRunID] = &run{
		id:         activeRunID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   thread.ThreadID,
		doneCh:     make(chan struct{}),
	}
	svc.mu.Unlock()

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "queue with invalid locality",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "current", Locality: "legacy"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("SendUserTurn active-run queue err=%v, want %v", err, ErrInvalidContextAction)
	}

	queued, listErr := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued, 10)
	if listErr != nil {
		t.Fatalf("ListFollowupsByLane: %v", listErr)
	}
	if len(queued) != 0 {
		t.Fatalf("queued followups len=%d, want none", len(queued))
	}
}
