package ai

import (
	"context"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func waitingPromptForRunState(runStatus string, prompt *RequestUserInputPrompt) *RequestUserInputPrompt {
	if NormalizeRunState(runStatus) != RunStateWaitingUser {
		return nil
	}
	return normalizeRequestUserInputPrompt(prompt)
}

func (s *Service) threadWaitingPrompt(ctx context.Context, th *threadstore.Thread, effectiveRunStatus string) *RequestUserInputPrompt {
	_ = ctx
	if th == nil {
		return nil
	}
	prompt := requestUserInputPromptFromThreadRecord(th, effectiveRunStatus)
	if prompt == nil {
		return nil
	}
	if strings.TrimSpace(prompt.PromptID) == "" {
		return nil
	}
	return prompt
}
