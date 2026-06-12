package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestThreadWaitingPromptRequiresWaitingUserState(t *testing.T) {
	t.Parallel()

	prompt := testSingleQuestionPrompt(
		"msg_waiting_state",
		"tool_waiting_state",
		"question_1",
		"Which direction should I take?",
		nil,
	)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}

	th := &threadstore.Thread{
		ThreadID:             "th_waiting_state",
		EndpointID:           "env_waiting_state",
		WaitingUserInputJSON: mustTestWaitingUserInputJSON(t, prompt),
	}
	svc := &Service{}

	if got := svc.threadWaitingPrompt(context.Background(), th, string(RunStateSuccess)); got != nil {
		t.Fatalf("success state waiting prompt=%#v, want nil", got)
	}
	got := svc.threadWaitingPrompt(context.Background(), th, string(RunStateWaitingUser))
	if got == nil {
		t.Fatalf("waiting_user state should expose stored prompt")
	}
	if got.PromptID != prompt.PromptID {
		t.Fatalf("prompt_id=%q, want %q", got.PromptID, prompt.PromptID)
	}
}
