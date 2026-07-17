package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func testBoolPtr(value bool) *bool {
	return &value
}

func testRequestUserInputPrompt(messageID string, toolID string, reasonCode string, questions []RequestUserInputQuestion) *RequestUserInputPrompt {
	return normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:        strings.TrimSpace(messageID),
		ToolID:           strings.TrimSpace(toolID),
		ToolName:         "ask_user",
		ReasonCode:       strings.TrimSpace(reasonCode),
		RequiredFromUser: []string{"Provide the missing input."},
		EvidenceRefs:     []string{"tool_evidence_1"},
		Questions:        questions,
	})
}

func testSingleQuestionPrompt(messageID string, toolID string, questionID string, question string, choices []RequestUserInputChoice) *RequestUserInputPrompt {
	responseMode := requestUserInputResponseModeWrite
	var choicesExhaustive *bool
	if len(choices) > 0 {
		responseMode = requestUserInputResponseModeSelect
		choicesExhaustive = testBoolPtr(true)
	}
	return testRequestUserInputPrompt(messageID, toolID, AskUserReasonUserDecisionRequired, []RequestUserInputQuestion{
		{
			ID:                strings.TrimSpace(questionID),
			Header:            strings.TrimSpace(question),
			Question:          strings.TrimSpace(question),
			ResponseMode:      responseMode,
			ChoicesExhaustive: choicesExhaustive,
			Choices:           choices,
		},
	})
}

type testAskUserGateway struct {
	toolID string
	args   string
}

func (g testAskUserGateway) StreamModel(_ context.Context, _ flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	events := make(chan flruntime.ModelEvent, 2)
	events <- flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: []fltools.ToolCall{{ID: g.toolID, Name: "ask_user", Args: g.args}}}
	events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "tool_calls"}
	close(events)
	return events, nil
}

func seedWaitingUserPrompt(t *testing.T, svc *Service, ctx context.Context, _ *session.Meta, threadID string, prompt *RequestUserInputPrompt) {
	t.Helper()
	if svc == nil || svc.floretStore == nil || prompt == nil {
		t.Fatalf("prompt must not be nil")
	}
	args, err := json.Marshal(map[string]any{
		"reason_code": prompt.ReasonCode, "required_from_user": prompt.RequiredFromUser,
		"evidence_refs": prompt.EvidenceRefs, "questions": prompt.Questions,
	})
	if err != nil {
		t.Fatal(err)
	}
	r := &run{id: "run_" + prompt.MessageID, threadID: threadID, messageID: prompt.MessageID, service: svc}
	signalSpec, err := newFloretControlSpec(r, &floretToolRuntimeState{}, builtInControlSignalDefinitions(), "")
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:               redevenFloretAdapterConfig("", floretModelContextPolicy(128000, 4096), config.AIReasoningSelection{}),
		Store:                svc.floretStore,
		ModelGateway:         testAskUserGateway{toolID: prompt.ToolID, args: string(args)},
		ModelGatewayIdentity: flruntime.ModelGatewayIdentity{Provider: "test", Model: "ask-user-test", StateCompatibilityKey: "test:ask-user-test"},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(threadID), TurnID: flruntime.TurnID(prompt.MessageID),
		RunID: flruntime.RunID(r.id), Input: "wait for user input", Signals: signalSpec,
	})
	if err != nil {
		t.Fatalf("seed Floret waiting turn: %v", err)
	}
	if result.Status != flruntime.TurnStatusWaiting {
		t.Fatalf("seeded turn status = %q, want waiting", result.Status)
	}
}
