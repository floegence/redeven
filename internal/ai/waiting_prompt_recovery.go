package ai

import (
	"context"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

const waitingPromptTranscriptRecoveryLimit = 8

func finalWaitingPromptForRunState(runStatus string, snapshot *RequestUserInputPrompt, assistantMessageJSON string) *RequestUserInputPrompt {
	if NormalizeRunState(runStatus) != RunStateWaitingUser {
		return nil
	}
	if snapshot != nil {
		return snapshot
	}
	return requestUserInputPromptFromMessageJSON(assistantMessageJSON)
}

func (s *Service) recoverWaitingPromptFromTranscript(ctx context.Context, endpointID string, threadID string, effectiveRunStatus string) *RequestUserInputPrompt {
	if s == nil {
		return nil
	}
	if NormalizeRunState(effectiveRunStatus) != RunStateWaitingUser {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil
	}

	messages, _, _, err := db.ListMessages(ctx, endpointID, threadID, waitingPromptTranscriptRecoveryLimit, 0)
	if err != nil {
		return nil
	}
	return requestUserInputPromptFromMessages(messages, effectiveRunStatus)
}

func (s *Service) threadWaitingPrompt(ctx context.Context, th *threadstore.Thread, effectiveRunStatus string) *RequestUserInputPrompt {
	prompt := requestUserInputPromptFromThreadRecord(th, effectiveRunStatus)
	if prompt != nil || th == nil {
		return prompt
	}
	return s.recoverWaitingPromptFromTranscript(ctx, strings.TrimSpace(th.EndpointID), strings.TrimSpace(th.ThreadID), effectiveRunStatus)
}
