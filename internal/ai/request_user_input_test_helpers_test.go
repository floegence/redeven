package ai

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/session"
)

func testRequestUserInputPrompt(messageID string, toolID string, reasonCode string, questions []RequestUserInputQuestion) *RequestUserInputPrompt {
	return normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:        strings.TrimSpace(messageID),
		ToolID:           strings.TrimSpace(toolID),
		ReasonCode:       strings.TrimSpace(reasonCode),
		RequiredFromUser: []string{"Provide the missing input."},
		EvidenceRefs:     []string{"tool_evidence_1"},
		Questions:        questions,
	})
}

func testSingleQuestionPrompt(messageID string, toolID string, questionID string, question string, options []RequestUserInputOption) *RequestUserInputPrompt {
	return testRequestUserInputPrompt(messageID, toolID, AskUserReasonUserDecisionRequired, []RequestUserInputQuestion{
		{
			ID:       strings.TrimSpace(questionID),
			Header:   strings.TrimSpace(question),
			Question: strings.TrimSpace(question),
			IsOther:  true,
			Options:  options,
		},
	})
}

func mustTestWaitingUserInputJSON(t *testing.T, prompt *RequestUserInputPrompt) string {
	t.Helper()
	raw := marshalRequestUserInputPrompt(prompt)
	if strings.TrimSpace(raw) == "" {
		t.Fatalf("waiting user input json should not be empty")
	}
	return raw
}

func seedWaitingUserPrompt(t *testing.T, svc *Service, ctx context.Context, meta *session.Meta, threadID string, prompt *RequestUserInputPrompt) {
	t.Helper()
	if prompt == nil {
		t.Fatalf("prompt must not be nil")
	}
	if err := svc.threadsDB.UpdateThreadRunState(
		ctx,
		meta.EndpointID,
		threadID,
		"waiting_user",
		"",
		mustTestWaitingUserInputJSON(t, prompt),
		meta.UserPublicID,
		meta.UserEmail,
	); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}
}

func testResponseForPrompt(prompt *RequestUserInputPrompt, answers map[string]RequestUserInputAnswer) RequestUserInputResponse {
	if prompt == nil {
		return RequestUserInputResponse{}
	}
	return RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers:  answers,
	}
}
