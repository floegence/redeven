package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestE2E_DBConfiguredModel_GuidedStructuredInteractionPreservesContractAcrossTurns(t *testing.T) {
	t.Parallel()

	svc, meta, modelID := newDBConfiguredModelE2EService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "e2e-guided-structured-interaction-multiturn", modelID, "plan", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	firstRunID := fmt.Sprintf("run_e2e_guided_multiturn_%d", time.Now().UnixNano())
	if err := svc.StartRun(ctx, &meta, firstRunID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    modelID,
		Input:    RunInput{Text: "请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 2, Mode: "plan"},
	}, nil); err != nil {
		t.Fatalf("StartRun first turn: %v", err)
	}

	firstView, err := svc.GetThread(ctx, &meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread first turn: %v", err)
	}
	firstQuestion := requireGuidedInteractionWaitingPrompt(t, firstView)
	assertWaitingAssistantMessageHasNoDuplicateMarkdown(t, svc, ctx, meta.EndpointID, thread.ThreadID)

	firstEvents, err := svc.ListRunEvents(ctx, &meta, firstRunID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents first turn: %v", err)
	}
	firstInteraction := findRunEventPayload(t, firstEvents.Events, "interaction.contract.classified")
	if got := anyToBool(firstInteraction["enabled"]); !got {
		t.Fatalf("interaction contract should be enabled on first turn: %+v", firstInteraction)
	}
	if got := anyToBool(firstInteraction["single_question_per_turn"]); !got {
		t.Fatalf("single_question_per_turn should be true: %+v", firstInteraction)
	}
	if got := anyToBool(firstInteraction["fixed_choices_required"]); !got {
		t.Fatalf("fixed_choices_required should be true: %+v", firstInteraction)
	}
	if got := anyToBool(firstInteraction["open_text_fallback_required"]); !got {
		t.Fatalf("open_text_fallback_required should be true: %+v", firstInteraction)
	}
	if got := anyToBool(firstInteraction["indirect_questions_only"]); !got {
		t.Fatalf("indirect_questions_only should be true: %+v", firstInteraction)
	}

	firstChoice := firstSelectChoice(firstQuestion)
	if firstChoice == nil {
		t.Fatalf("first waiting prompt is missing a select choice: %+v", firstQuestion.Choices)
	}

	secondResp, err := svc.SubmitStructuredPromptResponse(ctx, &meta, SubmitStructuredPromptResponseRequest{
		ThreadID: thread.ThreadID,
		Model:    modelID,
		Response: RequestUserInputResponse{
			PromptID: firstView.WaitingPrompt.PromptID,
			Answers: map[string]RequestUserInputAnswer{
				firstQuestion.ID: {ChoiceID: firstChoice.ChoiceID},
			},
		},
		Input: RunInput{
			Text: firstChoice.Label,
		},
		Options: RunOptions{MaxSteps: 4, MaxNoToolRounds: 2, Mode: "plan"},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}

	secondView := waitForThreadStatus(t, ctx, svc, &meta, thread.ThreadID, secondResp.RunID, RunStateWaitingUser)
	requireGuidedInteractionWaitingPrompt(t, secondView)
	assertWaitingAssistantMessageHasNoDuplicateMarkdown(t, svc, ctx, meta.EndpointID, thread.ThreadID)

	secondEvents, err := svc.ListRunEvents(ctx, &meta, secondResp.RunID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents second turn: %v", err)
	}
	secondIntent := findRunEventPayload(t, secondEvents.Events, "intent.classified")
	if got := strings.TrimSpace(fmt.Sprint(secondIntent["objective_mode"])); got != RunObjectiveModeContinue {
		t.Fatalf("second turn objective_mode=%q, want %q", got, RunObjectiveModeContinue)
	}
	if got := strings.TrimSpace(fmt.Sprint(secondIntent["intent_source"])); got != RunIntentSourceDeterministic {
		t.Fatalf("second turn intent_source=%q, want %q", got, RunIntentSourceDeterministic)
	}
	secondInteraction := findRunEventPayload(t, secondEvents.Events, "interaction.contract.classified")
	if got := anyToBool(secondInteraction["enabled"]); !got {
		t.Fatalf("interaction contract should stay enabled on second turn: %+v", secondInteraction)
	}
	if got := anyToBool(secondInteraction["open_text_fallback_required"]); !got {
		t.Fatalf("second turn should keep open_text_fallback_required=true: %+v", secondInteraction)
	}
	if got := strings.TrimSpace(fmt.Sprint(secondInteraction["classification_mode"])); got != interactionContractClassificationModeSeedReuse {
		t.Fatalf("second turn classification_mode=%q, want %q", got, interactionContractClassificationModeSeedReuse)
	}
	if got := anyToBool(secondInteraction["seed_reused"]); !got {
		t.Fatalf("second turn seed_reused should be true: %+v", secondInteraction)
	}
	secondAskUser := findRunEventPayload(t, secondEvents.Events, "ask_user.attempt")
	if got := strings.TrimSpace(fmt.Sprint(secondAskUser["policy_source"])); got != askUserPolicySourceStructuredContinuation {
		t.Fatalf("second turn ask_user policy_source=%q, want %q", got, askUserPolicySourceStructuredContinuation)
	}
}

func TestE2E_DBConfiguredModel_InteractionContractClassifier(t *testing.T) {
	t.Parallel()

	svc, _, modelID := newDBConfiguredModelE2EService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	resolved, err := svc.resolveRunModel(ctx, svc.cfg, modelID, "", false, nil)
	if err != nil {
		t.Fatalf("resolveRunModel: %v", err)
	}
	contract, err := svc.classifyInteractionContractByModel(
		ctx,
		resolved,
		RunObjectiveModeReplace,
		"请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。",
		"请你和我一问一答猜我的岁数，不要有直接的问题，每个问题应该提供几个选项。",
	)
	if err != nil {
		t.Fatalf("classifyInteractionContractByModel: %v", err)
	}
	if !contract.Enabled {
		t.Fatalf("interaction contract should be enabled: %+v", contract)
	}
}

func waitForThreadStatus(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string, runID string, want RunState) *ThreadView {
	t.Helper()

	deadline := time.Now().Add(90 * time.Second)
	var lastView *ThreadView
	for {
		view, err := svc.GetThread(ctx, meta, threadID)
		if err != nil {
			t.Fatalf("GetThread %s: %v", threadID, err)
		}
		lastView = view
		if view != nil && NormalizeRunState(view.RunStatus) == want {
			return view
		}
		if view != nil {
			state := NormalizeRunState(view.RunStatus)
			switch state {
			case RunStateFailed, RunStateTimedOut, RunStateCanceled:
				events, eventsErr := svc.ListRunEvents(ctx, meta, runID, 2000)
				if eventsErr != nil {
					t.Fatalf("run_status=%q, want %q; failed to load run events: %v", view.RunStatus, want, eventsErr)
				}
				t.Fatalf("run_status=%q, want %q; run_error=%q; events=%+v", view.RunStatus, want, view.RunError, events.Events)
			}
		}
		if time.Now().After(deadline) {
			if lastView == nil {
				t.Fatalf("thread %s did not reach %q before timeout", threadID, want)
			}
			events, eventsErr := svc.ListRunEvents(ctx, meta, runID, 2000)
			if eventsErr != nil {
				t.Fatalf("run_status=%q, want %q; failed to load run events: %v", lastView.RunStatus, want, eventsErr)
			}
			t.Fatalf("run_status=%q, want %q; run_error=%q; events=%+v", lastView.RunStatus, want, lastView.RunError, events.Events)
		}
		select {
		case <-ctx.Done():
			t.Fatalf("waitForThreadStatus context done: %v", ctx.Err())
		case <-time.After(1 * time.Second):
		}
	}
}

func requireGuidedInteractionWaitingPrompt(t *testing.T, view *ThreadView) RequestUserInputQuestion {
	t.Helper()

	if view == nil {
		t.Fatalf("thread view is nil")
	}
	if got := strings.TrimSpace(view.RunStatus); got != string(RunStateWaitingUser) {
		t.Fatalf("run_status=%q, want %q", got, RunStateWaitingUser)
	}
	if view.WaitingPrompt == nil || len(view.WaitingPrompt.Questions) == 0 {
		t.Fatalf("waiting prompt missing: %+v", view)
	}
	question := view.WaitingPrompt.Questions[0]
	if containsDirectAgeCue(question.Question) {
		t.Fatalf("question leaked direct age cue: %+v", question)
	}
	if strings.TrimSpace(question.ResponseMode) != requestUserInputResponseModeSelectText {
		t.Fatalf("response_mode=%q, want %q", question.ResponseMode, requestUserInputResponseModeSelectText)
	}
	if question.ChoicesExhaustive == nil || *question.ChoicesExhaustive {
		t.Fatalf("choices_exhaustive=%v, want false", question.ChoicesExhaustive)
	}
	if len(question.Choices) < 2 {
		t.Fatalf("choices=%d, want at least 2: %+v", len(question.Choices), question)
	}
	if strings.TrimSpace(question.WriteLabel) == "" {
		t.Fatalf("write_label missing for typed fallback: %+v", question)
	}
	for _, choice := range question.Choices {
		if containsDirectAgeCue(choice.Label) {
			t.Fatalf("choice leaked direct age cue: %+v", choice)
		}
	}
	return question
}

func firstSelectChoice(question RequestUserInputQuestion) *RequestUserInputChoice {
	for i := range question.Choices {
		if strings.TrimSpace(question.Choices[i].Kind) == requestUserInputChoiceKindSelect {
			return &question.Choices[i]
		}
	}
	return nil
}

func assertWaitingAssistantMessageHasNoDuplicateMarkdown(t *testing.T, svc *Service, ctx context.Context, endpointID string, threadID string) {
	t.Helper()

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, endpointID, threadID, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if strings.TrimSpace(msgs[i].Role) != "assistant" {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(msgs[i].MessageJSON), &message); err != nil {
			t.Fatalf("unmarshal assistant message: %v", err)
		}
		blocks, _ := message["blocks"].([]any)
		if len(blocks) == 0 {
			t.Fatalf("assistant message has no blocks: %s", msgs[i].MessageJSON)
		}
		hasAskUser := false
		for _, raw := range blocks {
			block, _ := raw.(map[string]any)
			if block == nil {
				continue
			}
			if strings.TrimSpace(fmt.Sprint(block["type"])) == "tool-call" && strings.TrimSpace(fmt.Sprint(block["toolName"])) == "ask_user" {
				hasAskUser = true
				continue
			}
			if strings.TrimSpace(fmt.Sprint(block["type"])) == "markdown" && strings.TrimSpace(fmt.Sprint(block["content"])) != "" {
				t.Fatalf("waiting_user assistant message should not keep duplicate markdown: %s", msgs[i].MessageJSON)
			}
		}
		if !hasAskUser {
			t.Fatalf("latest assistant waiting message should contain ask_user block: %s", msgs[i].MessageJSON)
		}
		return
	}
	t.Fatalf("missing assistant message in thread %s", threadID)
}
