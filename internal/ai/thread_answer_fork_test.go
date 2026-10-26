package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
)

func TestFlowerAnswerForkPinsHistoricalCompletedAnswer(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	answer := func(text string) florettest.Step {
		return florettest.Step{Events: []provider.Event{{Type: provider.EventDelta, Text: text}, {Type: provider.EventDone, Reason: "stop"}}}
	}
	gateway := florettest.NewScriptedGateway(provider.Identity{Provider: "test", Model: "answers", StateCompatibilityKey: "answers:v1"}, provider.Capabilities{Reasoning: provider.ReasoningUnsupported}, answer("First final answer."), answer("Middle final answer."), answer("Later final answer."))
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(filepath.Join(t.TempDir(), "answers.sqlite"))})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	canonical, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "answers", Name: "Answers"}, SystemPrompt: "Answer the user.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway)
	}))
	if err != nil {
		t.Fatal(err)
	}
	svc.threadRuntime = canonical
	source, err := svc.CreateThread(t.Context(), meta, "Answers", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var anchor string
	var userAnchor string
	for _, key := range []string{"first", "middle", "later"} {
		sent, err := canonical.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(source.ThreadID), RequestKey: flruntime.RequestKey(key), Input: flruntime.UserInput{Text: key}})
		if err != nil {
			t.Fatal(err)
		}
		var view flruntime.ThreadView
		deadline := time.Now().Add(3 * time.Second)
		for {
			view, err = canonical.View(t.Context(), identity.ThreadID(source.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			if view.TurnID == sent.TurnID && view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("answer did not settle")
			}
			time.Sleep(10 * time.Millisecond)
		}
		if key == "middle" {
			if len(view.Turns) != 2 || len(view.Turns[1].FinalItemIDs) != 1 {
				t.Fatalf("missing middle final answer: %+v", view)
			}
			anchor = view.Turns[1].FinalItemIDs[0]
			for _, item := range view.Items {
				if item.Kind == flruntime.ThreadItemUser && item.Text == key {
					userAnchor = item.ID
					break
				}
			}
		}
	}
	if userAnchor == "" {
		t.Fatal("missing middle user item for invalid-anchor check")
	}
	space, err := prepareTaskFiles(svc.stateDir, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(space.Scratch, "current.csv"), []byte("current files, not historical"), 0600); err != nil {
		t.Fatal(err)
	}
	request := ForkThreadRequest{ClientRequestID: "answer-fork", Title: "Answers · Fork", SourceItemID: anchor}
	fork, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, request)
	if err != nil {
		t.Fatal(err)
	}
	childSpace, _ := taskFiles(svc.stateDir, fork.ThreadID)
	if bytes, e := os.ReadFile(filepath.Join(childSpace.Scratch, "current.csv")); e != nil || string(bytes) != "current files, not historical" {
		t.Fatalf("historical fork lost current work: %q %v", bytes, e)
	}
	view, err := canonical.View(t.Context(), identity.ThreadID(fork.ThreadID))
	if err != nil || view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted || len(view.Turns) != 2 || !view.Turns[1].FinalBoundaryComplete {
		t.Fatalf("fork lost completed answer: %+v, %v", view, err)
	}
	var text strings.Builder
	for _, item := range view.Items {
		text.WriteString(item.Text)
	}
	if !strings.Contains(text.String(), "First final answer.") || !strings.Contains(text.String(), "Middle final answer.") || strings.Contains(text.String(), "Later") {
		t.Fatalf("wrong answer boundary: %q", text.String())
	}
	replay, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, request)
	if err != nil || replay.ThreadID != fork.ThreadID {
		t.Fatalf("replay: %+v, %v", replay, err)
	}
	request.ClientRequestID, request.SourceItemID = "invalid-answer", "missing"
	if _, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, request); err == nil {
		t.Fatal("accepted an unknown answer")
	}
	request.ClientRequestID, request.SourceItemID = "invalid-user-anchor", userAnchor
	if _, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, request); err == nil {
		t.Fatal("accepted a user item as an answer anchor")
	}
	list, err := svc.ListThreads(t.Context(), meta, 100, "")
	if err != nil || len(list.Threads) != 2 {
		t.Fatalf("fork created duplicate or invalid destination: %+v, %v", list, err)
	}
}
