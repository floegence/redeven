package ai

import (
	"context"
	"encoding/json"
	"strings"
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

func goalInteractionCall(id, name, args string) florettest.Step {
	return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: id, Name: name, Args: args}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}
}
func goalInteractionDone() florettest.Step {
	return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Verified result"}, {Type: flprovider.EventDone, Reason: "stop"}}}
}
func waitGoalInteraction(t *testing.T, service flruntime.ThreadService, id string, predicate func(flruntime.ThreadView) bool) flruntime.ThreadView {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		view, err := service.View(t.Context(), identity.ThreadID(id))
		if err != nil {
			t.Fatal(err)
		}
		if predicate(view) {
			return view
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("canonical Goal interaction did not converge")
	return flruntime.ThreadView{}
}

func TestPublishedGoalUpdatesDuringQuestionAndApprovalUseNextModelRequest(t *testing.T) {
	for _, interaction := range []string{"question", "approval"} {
		t.Run(interaction, func(t *testing.T) {
			first := goalInteractionCall("question", "ask_user", `{"reason_code":"missing_external_input","required_from_user":["target"],"evidence_refs":[],"questions":[{"id":"q","header":"Target","question":"Which target?","response_mode":"write","is_secret":false}]}`)
			var dispatched atomic.Int32
			options := []flruntime.AgentOption{flruntime.WithAgentGoals()}
			if interaction == "approval" {
				first = goalInteractionCall("write", "verified_write", `{}`)
				tool := fltools.Define[map[string]any](fltools.Definition{Name: "verified_write", Description: "Write the verified result", InputSchema: map[string]any{"type": "object", "additionalProperties": false}, Effects: []fltools.Effect{fltools.EffectShell}, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
					dispatched.Add(1)
					return fltools.Result{Text: "Result written"}, nil
				})
				options = append(options, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
			}
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "goal-interaction", StateCompatibilityKey: "goal-interaction:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, first, goalInteractionCall("review", "goal", `{"operation":"review","expected_version":2,"outcome":"completed","evidence":"The updated result and resolved interaction are verified."}`), goalInteractionDone())
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "goal-interaction", Name: "Goal interaction"}, SystemPrompt: "Verify Goal interaction recovery.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, options...)
			if err != nil {
				t.Fatal(err)
			}
			host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
			if err != nil {
				t.Fatal(err)
			}
			defer host.Shutdown(context.Background())
			service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
			if err != nil {
				t.Fatal(err)
			}
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			controller := service.(flruntime.ThreadGoalController)
			if _, err := controller.SetGoal(t.Context(), flruntime.SetGoalInput{ThreadID: created.ThreadID, RequestKey: "set", Text: "Original result"}); err != nil {
				t.Fatal(err)
			}
			if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Finish"}}); err != nil {
				t.Fatal(err)
			}
			waiting := waitGoalInteraction(t, service, created.ThreadID.String(), func(v flruntime.ThreadView) bool { return len(v.Interactions) == 1 && !v.Interactions[0].Resolved })
			if waiting.Goal.Status != "active" || len(gateway.Requests()) != 1 {
				t.Fatalf("waiting=%+v", waiting)
			}
			if _, err := controller.SetGoal(t.Context(), flruntime.SetGoalInput{ThreadID: created.ThreadID, RequestKey: "update", ExpectedVersion: 1, Text: "Updated verified result"}); err != nil {
				t.Fatal(err)
			}
			answer := flruntime.InteractionAnswer{Input: map[string]string{"q": "production"}}
			if interaction == "approval" {
				approved := true
				answer = flruntime.InteractionAnswer{Approved: &approved}
			}
			if _, err := service.Respond(t.Context(), flruntime.RespondInput{ThreadID: created.ThreadID, InteractionID: waiting.Interactions[0].ID, RequestKey: "respond", Answers: []flruntime.InteractionAnswer{answer}}); err != nil {
				t.Fatal(err)
			}
			completed := waitGoalInteraction(t, service, created.ThreadID.String(), func(v flruntime.ThreadView) bool {
				return v.Activity == flruntime.ThreadActivityIdle && v.LastOutcome != nil
			})
			if completed.Failure != nil || completed.Goal.Status != "completed" || completed.Goal.Version != 2 {
				t.Fatalf("goal=%+v failure=%+v", completed.Goal, completed.Failure)
			}
			requests := gateway.Requests()
			if len(requests) != 3 {
				t.Fatalf("requests=%d", len(requests))
			}
			for i, request := range requests {
				wire, _ := json.Marshal(request.Messages)
				if strings.Contains(string(wire), "Updated verified result") != (i > 0) {
					t.Fatalf("Goal snapshot wrong at request %d", i)
				}
			}
			if interaction == "approval" && dispatched.Load() != 1 {
				t.Fatalf("effect dispatched %d times", dispatched.Load())
			}
		})
	}
}

func TestPublishedGoalIgnoresHistoricalTodoState(t *testing.T) {
	historic := true
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "historical-todo", StateCompatibilityKey: "historical-todo:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		goalInteractionCall("old-todo", "write_todos", `{}`), goalInteractionDone(),
		goalInteractionCall("review", "goal", `{"operation":"review","expected_version":1,"outcome":"completed","evidence":"The requested result is verified; the old task list is historical."}`), goalInteractionDone())
	todo := fltools.Define[map[string]any](fltools.Definition{Name: "write_todos", Description: "Historical task list", InputSchema: map[string]any{"type": "object", "additionalProperties": false}, ReadOnly: true}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		return fltools.Result{Text: `{"todos":[{"content":"Old unfinished work","status":"pending"}]}`}, nil
	})
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	defer host.Shutdown(context.Background())
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		options := []flruntime.AgentOption{flruntime.WithAgentGoals()}
		if historic {
			options = []flruntime.AgentOption{flruntime.WithAgentTools(todo), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect)}
		}
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "historical-todo", Name: "Historical Todo"}, SystemPrompt: "Verify the requested result.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, options...)
	}))
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "old-send", Input: flruntime.UserInput{Text: "Historical task"}}); err != nil {
		t.Fatal(err)
	}
	first := waitGoalInteraction(t, service, created.ThreadID.String(), func(v flruntime.ThreadView) bool {
		return v.Activity == flruntime.ThreadActivityIdle && v.LastOutcome != nil
	})
	if first.Failure != nil {
		t.Fatal(first.Failure)
	}
	historic = false
	if _, err := service.(flruntime.ThreadGoalController).SetGoal(t.Context(), flruntime.SetGoalInput{ThreadID: created.ThreadID, RequestKey: "set", Text: "Deliver the verified result"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "new-send", Input: flruntime.UserInput{Text: "Verify the new result"}}); err != nil {
		t.Fatal(err)
	}
	completed := waitGoalInteraction(t, service, created.ThreadID.String(), func(v flruntime.ThreadView) bool {
		return v.Activity == flruntime.ThreadActivityIdle && v.LastOutcome != nil && v.TurnID != first.TurnID
	})
	if completed.Failure != nil || completed.Goal.Status != "completed" {
		t.Fatalf("goal=%+v failure=%+v", completed.Goal, completed.Failure)
	}
	requests := gateway.Requests()
	if len(requests) != 4 {
		t.Fatalf("requests=%d", len(requests))
	}
	for _, request := range requests[2:] {
		for _, tool := range request.Tools {
			if tool.Name == "write_todos" {
				t.Fatal("historical Todo re-enabled its tool")
			}
		}
		raw, _ := json.Marshal(request.Messages)
		if !strings.Contains(string(raw), "Old unfinished work") {
			t.Fatal("historical Todo record was removed")
		}
	}
}
