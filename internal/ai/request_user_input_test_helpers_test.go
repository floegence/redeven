package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/v3/identity"
	flprovider "github.com/floegence/floret/v3/provider"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/session"
)

func executeAdmittedFloretTurnForTest(ctx context.Context, host floretTurnHost, command flruntime.StartTurnCommand) (flruntime.StartTurnResult, error) {
	admission, err := host.AdmitTurn(ctx, command)
	if err != nil {
		return flruntime.StartTurnResult{}, err
	}
	return host.ExecuteAdmission(ctx, admission.Receipt, flruntime.ExecutionContext{
		SupplementalContext: command.SupplementalContext,
		SignalProjector:     command.Signals.Project,
	})
}

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

func (testAskUserGateway) Identity() flprovider.Identity {
	return testFloretGatewayIdentity()
}

func (testAskUserGateway) Capabilities() flprovider.Capabilities {
	return testFloretGatewayCapabilities()
}

func (g testAskUserGateway) Stream(_ context.Context, _ flprovider.Request) (<-chan flprovider.Event, error) {
	events := make(chan flprovider.Event, 2)
	events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: g.toolID, Name: "ask_user", Args: g.args}}}
	events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
	close(events)
	return events, nil
}

func seedWaitingUserPrompt(t *testing.T, svc *Service, ctx context.Context, _ *session.Meta, threadID string, prompt *RequestUserInputPrompt) {
	t.Helper()
	if svc == nil || svc.floretRuntime == nil || prompt == nil {
		t.Fatalf("prompt must not be nil")
	}
	args, err := json.Marshal(map[string]any{
		"reason_code": prompt.ReasonCode, "required_from_user": prompt.RequiredFromUser,
		"evidence_refs": prompt.EvidenceRefs, "questions": prompt.Questions,
	})
	if err != nil {
		t.Fatal(err)
	}
	r := &run{id: "run_" + prompt.MessageID, threadID: threadID, messageID: prompt.MessageID}
	signalSpec, err := newFloretControlSpec(r, &floretToolRuntimeState{}, builtInControlSignalDefinitions(), "")
	if err != nil {
		t.Fatal(err)
	}
	threadRuntime, err := svc.bindFloretThreadRuntime(threadID)
	if err != nil {
		t.Fatal(err)
	}
	host, err := threadRuntime.Turn(ctx, newTestFloretAgent(t, testAskUserGateway{toolID: prompt.ToolID, args: string(args)}))
	if err != nil {
		t.Fatal(err)
	}
	result, err := executeAdmittedFloretTurnForTest(ctx, host, flruntime.StartTurnCommand{
		LogicalRequestID: identity.LogicalRequestID(identity.TurnID(prompt.MessageID)), UserMessage: flruntime.TurnInput{Text: "wait for user input"}, Signals: signalSpec,
	})
	if err != nil {
		t.Fatalf("seed Floret waiting turn: %v", err)
	}
	snapshot, err := host.ReadTurn(ctx, result.TurnID)
	if err != nil {
		t.Fatalf("read seeded waiting turn: %v", err)
	}
	if snapshot.Status != flruntime.TurnStatusWaiting {
		t.Fatalf("seeded turn status = %q, want waiting", snapshot.Status)
	}
	readHost, err := svc.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		t.Fatalf("open seeded Floret waiting turn reader: %v", err)
	}
	page, err := readHost.ListThreadTurns(ctx, flruntime.ThreadTurnsRequest{Tail: 1})
	if err != nil {
		t.Fatalf("read seeded Floret waiting turn: %v", err)
	}
	if len(page.Turns) != 1 || page.Turns[0].Status != flruntime.TurnStatusWaiting {
		t.Fatalf("seeded Floret waiting turn = %#v, want one waiting turn", page.Turns)
	}
	if _, err := readHost.ReadThreadOverview(ctx); err != nil {
		t.Fatalf("read seeded Floret waiting overview: %v", err)
	}
}
