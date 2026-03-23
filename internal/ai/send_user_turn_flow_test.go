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
	promptpacker "github.com/floegence/redeven-agent/internal/ai/context/packer"
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

func TestSubmitStructuredPromptResponse_WaitingPromptMismatch_DoesNotPersistMessage(t *testing.T) {
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
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingUserQueueConflict) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrWaitingUserQueueConflict)
	}

	_, err = svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: RequestUserInputResponse{
			PromptID: "wp_wrong_id",
			Answers: map[string]RequestUserInputAnswer{
				"question_1": {Text: "wrong prompt"},
			},
		},
		Input:   RunInput{Text: "reply with wrong waiting prompt id"},
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingPromptChanged) {
		t.Fatalf("SubmitStructuredPromptResponse wrong-id err=%v, want %v", err, ErrWaitingPromptChanged)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on waiting prompt mismatch, got %d", len(msgs))
	}
}

func TestSubmitStructuredPromptResponse_WaitingPromptMatch_ReturnsConsumedPromptID(t *testing.T) {
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

	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"question_1": {Text: "reply with matching waiting prompt id"},
		}),
		Input: RunInput{
			Text: "reply with matching waiting prompt id",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if got := strings.TrimSpace(resp.ConsumedWaitingPromptID); got != waitingPrompt.PromptID {
		t.Fatalf("ConsumedWaitingPromptID=%q, want %q", got, waitingPrompt.PromptID)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitStructuredPromptResponse run_id is empty")
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatalf("expected persisted user message after matching waiting prompt reply")
	}
}

func TestSubmitStructuredPromptResponse_WaitingChoiceSetMode_UpdatesThreadExecutionMode(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-choice-set-mode", "", "plan", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testRequestUserInputPrompt(
		"msg_waiting_prompt_set_mode",
		"tool_waiting_prompt_set_mode",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "mode_decision",
				Header:   "Execution mode",
				Question: "Switch to Act mode?",
				Choices: []RequestUserInputChoice{
					{
						ChoiceID: "switch_to_act",
						Label:    "Switch to Act mode",
						Kind:     requestUserInputChoiceKindSelect,
						Actions: []RequestUserInputAction{
							{
								Type: requestUserInputActionSetMode,
								Mode: "act",
							},
						},
					},
				},
			},
		},
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"mode_decision": {ChoiceID: "switch_to_act"},
		}),
		Input: RunInput{
			Text: "confirmed, switch to act and continue",
		},
		Options: RunOptions{MaxSteps: 1, Mode: "plan"},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if got := strings.TrimSpace(resp.ConsumedWaitingPromptID); got != waitingPrompt.PromptID {
		t.Fatalf("ConsumedWaitingPromptID=%q, want %q", got, waitingPrompt.PromptID)
	}
	if got := strings.TrimSpace(resp.AppliedExecutionMode); got != "act" {
		t.Fatalf("AppliedExecutionMode=%q, want %q", got, "act")
	}

	gotThread, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if gotThread == nil {
		t.Fatalf("thread missing")
	}
	if got := strings.TrimSpace(gotThread.ExecutionMode); got != "act" {
		t.Fatalf("thread execution_mode=%q, want %q", got, "act")
	}
}

func TestSubmitStructuredPromptResponse_PromptOnlyPersistsStructuredResponseContext(t *testing.T) {
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
				ID:       "direction",
				Header:   "Direction",
				Question: "Choose a direction.",
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

	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"direction": {ChoiceID: "proceed"},
		}),
		Input:   RunInput{},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitStructuredPromptResponse run_id is empty")
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

func TestSubmitStructuredPromptResponse_SecretAnswerDoesNotLeakToTranscriptOrStructuredProjection(t *testing.T) {
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
				ID:       "api_key",
				Header:   "API key",
				Question: "Provide the API key.",
				IsSecret: true,
				Choices: []RequestUserInputChoice{
					{ChoiceID: "write", Label: "API key", Kind: requestUserInputChoiceKindWrite},
				},
			},
		},
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	const secretValue = "super-secret-token"
	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"api_key": {ChoiceID: "write", Text: secretValue},
		}),
		Input:   RunInput{},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("SubmitStructuredPromptResponse run_id is empty")
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

	pack, err := svc.contextPacker.BuildPromptPack(ctx, promptpacker.BuildInput{
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		RunID:      "run_secret_projection_check",
		Objective:  "use the provided API key safely",
		UserInput:  "",
		Capability: contextmodel.ModelCapability{SupportsAskUserQuestionBatches: true, MaxContextTokens: 2048},
	})
	if err != nil {
		t.Fatalf("BuildPromptPack: %v", err)
	}
	if len(pack.RecentStructuredUserInputs) == 0 {
		t.Fatalf("expected structured projection in prompt pack")
	}
	if got := pack.RecentStructuredUserInputs[0]; strings.Contains(got.PublicSummary, secretValue) || got.Text != "" {
		t.Fatalf("prompt pack leaked secret: %+v", got)
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
		Options: RunOptions{MaxSteps: 1},
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
		Options: RunOptions{MaxSteps: 1},
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

	th, err := svc.CreateThread(ctx, meta, "orphan-users-around-turn", "", "", "")
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
