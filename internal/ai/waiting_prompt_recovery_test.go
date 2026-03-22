package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

func testWaitingPromptAssistantMessageJSON(t *testing.T, prompt *RequestUserInputPrompt, waitingUser bool) string {
	t.Helper()
	if prompt == nil {
		t.Fatalf("prompt must not be nil")
	}

	questionPayloads := make([]any, 0, len(prompt.Questions))
	for _, question := range prompt.Questions {
		optionPayloads := make([]any, 0, len(question.Options))
		for _, option := range question.Options {
			actionPayloads := make([]any, 0, len(option.Actions))
			for _, action := range option.Actions {
				actionPayloads = append(actionPayloads, map[string]any{
					"type": action.Type,
					"mode": action.Mode,
				})
			}
			optionPayloads = append(optionPayloads, map[string]any{
				"option_id":   option.OptionID,
				"label":       option.Label,
				"description": option.Description,
				"actions":     actionPayloads,
			})
		}
		questionPayloads = append(questionPayloads, map[string]any{
			"id":        question.ID,
			"header":    question.Header,
			"question":  question.Question,
			"is_other":  question.IsOther,
			"is_secret": question.IsSecret,
			"options":   optionPayloads,
		})
	}

	r := &run{
		messageID:                prompt.MessageID,
		assistantCreatedAtUnixMs: time.Now().UnixMilli(),
		assistantBlocks: []any{
			ToolCallBlock{
				Type:     "tool-call",
				ToolName: "ask_user",
				ToolID:   prompt.ToolID,
				Status:   ToolCallStatusSuccess,
				Args: map[string]any{
					"reason_code":        prompt.ReasonCode,
					"required_from_user": prompt.RequiredFromUser,
					"evidence_refs":      prompt.EvidenceRefs,
					"questions":          questionPayloads,
				},
				Result: map[string]any{
					"questions":    questionPayloads,
					"waiting_user": waitingUser,
				},
			},
		},
	}

	raw, _, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if strings.TrimSpace(raw) == "" {
		t.Fatalf("assistant message json should not be empty")
	}
	return raw
}

func seedWaitingPromptTranscriptOnly(t *testing.T, svc *Service, meta *session.Meta, threadID string, prompt *RequestUserInputPrompt) {
	t.Helper()
	if svc == nil {
		t.Fatalf("service must not be nil")
	}
	if meta == nil {
		t.Fatalf("meta must not be nil")
	}
	raw := testWaitingPromptAssistantMessageJSON(t, prompt, true)
	now := time.Now().UnixMilli()
	if _, err := svc.threadsDB.AppendMessage(context.Background(), meta.EndpointID, threadID, threadstore.Message{
		ThreadID:        threadID,
		EndpointID:      meta.EndpointID,
		MessageID:       prompt.MessageID,
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: now,
		UpdatedAtUnixMs: now,
		TextContent:     prompt.PublicSummary,
		MessageJSON:     raw,
	}, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("AppendMessage assistant waiting prompt: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadRunState(
		context.Background(),
		meta.EndpointID,
		threadID,
		string(RunStateWaitingUser),
		"",
		"",
		meta.UserPublicID,
		meta.UserEmail,
	); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user without prompt snapshot: %v", err)
	}
}

func TestRequestUserInputPromptFromMessageJSON_ExtractsWaitingPrompt(t *testing.T) {
	t.Parallel()

	prompt := testRequestUserInputPrompt(
		"msg_waiting_prompt_recovery",
		"tool_waiting_prompt_recovery",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "mode_decision",
				Header:   "Execution mode",
				Question: "Switch to Act mode?",
				Options: []RequestUserInputOption{
					{
						OptionID: "switch_to_act",
						Label:    "Switch to Act mode",
						Actions: []RequestUserInputAction{
							{Type: requestUserInputActionSetMode, Mode: "act"},
						},
					},
				},
			},
		},
	)
	raw := testWaitingPromptAssistantMessageJSON(t, prompt, true)

	got := requestUserInputPromptFromMessageJSON(raw)
	if got == nil {
		t.Fatalf("requestUserInputPromptFromMessageJSON returned nil")
	}
	if got.PromptID != prompt.PromptID {
		t.Fatalf("PromptID=%q, want %q", got.PromptID, prompt.PromptID)
	}
	if got.ReasonCode != prompt.ReasonCode {
		t.Fatalf("ReasonCode=%q, want %q", got.ReasonCode, prompt.ReasonCode)
	}
	if len(got.Questions) != 1 || got.Questions[0].ID != "mode_decision" {
		t.Fatalf("Questions=%+v", got.Questions)
	}
	if len(got.Questions[0].Options) != 1 || got.Questions[0].Options[0].OptionID != "switch_to_act" {
		t.Fatalf("Options=%+v", got.Questions[0].Options)
	}
}

func TestFinalWaitingPromptForRunState_FallsBackToAssistantTranscript(t *testing.T) {
	t.Parallel()

	prompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_write_fallback",
		"tool_waiting_prompt_write_fallback",
		"question_1",
		"Need your approval.",
		nil,
	)
	raw := testWaitingPromptAssistantMessageJSON(t, prompt, true)

	got := finalWaitingPromptForRunState(string(RunStateWaitingUser), nil, raw)
	if got == nil {
		t.Fatalf("finalWaitingPromptForRunState returned nil")
	}
	if got.PromptID != prompt.PromptID {
		t.Fatalf("PromptID=%q, want %q", got.PromptID, prompt.PromptID)
	}
}

func TestGetThread_RecoversWaitingPromptFromTranscriptWhenSnapshotMissing(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "recover-waiting-prompt-view", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_recover_get_thread",
		"tool_waiting_prompt_recover_get_thread",
		"question_1",
		"Choose a direction.",
		nil,
	)
	seedWaitingPromptTranscriptOnly(t, svc, meta, th.ThreadID, prompt)

	view, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil || view.WaitingPrompt == nil {
		t.Fatalf("GetThread waiting_prompt missing: %+v", view)
	}
	if got := strings.TrimSpace(view.WaitingPrompt.PromptID); got != prompt.PromptID {
		t.Fatalf("GetThread waiting_prompt.prompt_id=%q, want %q", got, prompt.PromptID)
	}
}

func TestListThreads_RecoversWaitingPromptFromTranscriptWhenSnapshotMissing(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "recover-waiting-prompt-list", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_recover_list_threads",
		"tool_waiting_prompt_recover_list_threads",
		"question_1",
		"Choose a direction.",
		nil,
	)
	seedWaitingPromptTranscriptOnly(t, svc, meta, th.ThreadID, prompt)

	list, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(list.Threads) != 1 {
		t.Fatalf("len(ListThreads.Threads)=%d, want 1", len(list.Threads))
	}
	if list.Threads[0].WaitingPrompt == nil {
		t.Fatalf("ListThreads waiting_prompt missing: %+v", list.Threads[0])
	}
	if got := strings.TrimSpace(list.Threads[0].WaitingPrompt.PromptID); got != prompt.PromptID {
		t.Fatalf("ListThreads waiting_prompt.prompt_id=%q, want %q", got, prompt.PromptID)
	}
}

func TestSendUserTurn_TranscriptRecoveredWaitingPromptStillBlocksPlainReply(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "recover-send-turn-conflict", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_recover_send_turn",
		"tool_waiting_prompt_recover_send_turn",
		"question_1",
		"Choose a direction.",
		nil,
	)
	seedWaitingPromptTranscriptOnly(t, svc, meta, th.ThreadID, prompt)

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "reply without structured prompt submission",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingUserQueueConflict) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrWaitingUserQueueConflict)
	}
}

func TestSubmitStructuredPromptResponse_RecoversWaitingPromptFromTranscriptWhenSnapshotMissing(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "recover-submit-structured-response", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	prompt := testSingleQuestionPrompt(
		"msg_waiting_prompt_recover_submit",
		"tool_waiting_prompt_recover_submit",
		"question_1",
		"Choose a direction.",
		nil,
	)
	seedWaitingPromptTranscriptOnly(t, svc, meta, th.ThreadID, prompt)

	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(prompt, map[string]RequestUserInputAnswer{
			"question_1": {Answers: []string{"continue with the fix"}},
		}),
		Input: RunInput{
			Text: "continue with the fix",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if got := strings.TrimSpace(resp.ConsumedWaitingPromptID); got != prompt.PromptID {
		t.Fatalf("ConsumedWaitingPromptID=%q, want %q", got, prompt.PromptID)
	}
}
