package ai

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

// Simulate the previous adapter policy through the published public writer.
// The current adapter must not reinterpret or answer its persisted requests.
func TestHistoricalCompletedToolInputsRetainCanonicalResponseAfterRestart(t *testing.T) {
	for _, question := range []string{"tool_result_checked", "subagent_attention"} {
		for _, action := range []string{"respond", "cancel"} {
			t.Run(question+"/"+action, func(t *testing.T) {
				var executions atomic.Int32
				gateway := delegationContextGateway(florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "completed", Name: "historical", Args: "{}"}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}, delegationContextDone())
				tool := fltools.Define[struct{}](fltools.Definition{Name: "historical", InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
					executions.Add(1)
					return fltools.Result{Text: "Confirmed result retained", InputRequired: &fltools.InputRequest{Summary: "Previously requested confirmation", Questions: []fltools.InputQuestion{{ID: question, Prompt: "Continue?", Kind: "select", Options: []string{"Continue"}}}}}, nil
				})
				agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "history", Name: "History"}, SystemPrompt: "Preserve historical input.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
				if err != nil {
					t.Fatal(err)
				}
				database := filepath.Join(t.TempDir(), "history.sqlite")
				open := func() (*flruntime.Host, flruntime.ThreadService) {
					host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(database)})
					if err != nil {
						t.Fatal(err)
					}
					service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
					if err != nil {
						t.Fatal(err)
					}
					return host, service
				}
				host, service := open()
				defer func() { _ = host.Shutdown(context.Background()) }()
				created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Perform one action"}}); err != nil {
					t.Fatal(err)
				}
				waiting := waitToolDesignAttention(t, service, created.ThreadID)
				if executions.Load() != 1 || len(gateway.Requests()) != 1 {
					t.Fatal("input did not pause after completion")
				}
				if err := host.Shutdown(t.Context()); err != nil {
					t.Fatal(err)
				}
				host, service = open()
				restored, err := service.View(t.Context(), created.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				if restored.Attention.InputCount != 1 || len(restored.Interactions) != 1 || restored.Interactions[0].ID != waiting.Interactions[0].ID || executions.Load() != 1 || len(gateway.Requests()) != 1 {
					t.Fatalf("restart changed pending input: %+v", restored)
				}
				if action == "cancel" {
					if _, err := service.Cancel(t.Context(), flruntime.CancelInput{ThreadID: created.ThreadID, RequestKey: "cancel"}); err != nil {
						t.Fatal(err)
					}
					waitDesktopContinuation(t, service, created.ThreadID)
					if len(gateway.Requests()) != 1 {
						t.Fatal("cancel continued provider")
					}
				} else {
					response := flruntime.RespondInput{ThreadID: created.ThreadID, InteractionID: restored.Interactions[0].ID, RequestKey: "answer", Answers: []flruntime.InteractionAnswer{{Input: map[string]string{question: "Continue"}}}}
					if _, err := service.Respond(t.Context(), response); err != nil {
						t.Fatal(err)
					}
					final := waitDesktopContinuation(t, service, created.ThreadID)
					if final.LastOutcome == nil || *final.LastOutcome != flruntime.TurnOutcomeCompleted || final.Attention.InputCount != 0 {
						t.Fatalf("response failed: %+v", final)
					}
					if _, err := service.Respond(t.Context(), response); err != nil {
						t.Fatal(err)
					}
					if len(gateway.Requests()) != 2 {
						t.Fatal("duplicate continuation")
					}
				}
				if executions.Load() != 1 {
					t.Fatal("completed action replayed")
				}
			})
		}
	}
}

func waitToolDesignAttention(t *testing.T, service flruntime.ThreadService, id identity.ThreadID) flruntime.ThreadView {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	updates, err := service.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer updates.Close()
	for {
		view, err := service.View(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if view.Attention.InputCount > 0 {
			return view
		}
		if _, err := updates.Next(ctx); err != nil {
			t.Fatal(err)
		}
	}
}
