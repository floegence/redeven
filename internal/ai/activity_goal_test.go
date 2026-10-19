package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestFlowerGoalReviewRemainsReadableWhileWaitingForUser(t *testing.T) {
	for _, outcome := range []string{"continue", "blocked"} {
		t.Run(outcome, func(t *testing.T) {
			const objective = "Deliver a verified result after the user chooses a target"
			const evidence = "The target selection needs a user decision."
			args, err := json.Marshal(map[string]any{"operation": "review", "expected_version": 1, "outcome": outcome, "evidence": evidence})
			if err != nil {
				t.Fatal(err)
			}
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "goal-review", StateCompatibilityKey: "goal-review:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
				goalInteractionCall("review", "goal", string(args)),
				goalInteractionCall("question", "ask_user", `{"reason_code":"user_decision_required","required_from_user":["target"],"evidence_refs":[],"questions":[{"id":"target","header":"Target","question":"Which target should be used?","response_mode":"write","is_secret":false}]}`))
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "goal-review", Name: "Goal review"}, SystemPrompt: "Verify the Goal before completion.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentGoals())
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
			if _, err := service.(flruntime.ThreadGoalController).SetGoal(t.Context(), flruntime.SetGoalInput{ThreadID: created.ThreadID, RequestKey: "set", Text: objective}); err != nil {
				t.Fatal(err)
			}
			if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Complete the requested work"}}); err != nil {
				t.Fatal(err)
			}
			waiting := waitGoalInteraction(t, service, created.ThreadID.String(), func(v flruntime.ThreadView) bool { return len(v.Interactions) == 1 && !v.Interactions[0].Resolved })
			raw, err := json.Marshal(FlowerThreadDetail{Current: waiting})
			if err != nil {
				t.Fatal(err)
			}
			var response struct{ Current flruntime.ThreadView }
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatal(err)
			}
			if response.Current.Goal.Status != "active" || response.Current.Interactions[0].Resolved || len(gateway.Requests()) != 2 {
				t.Fatal("public projection changed waiting or Goal execution state")
			}
			found := false
			for _, item := range response.Current.Items {
				if item.Activity == nil || item.Activity.ToolName != "goal" {
					continue
				}
				goal := item.Activity.Presentation.Payload.(fltools.StructuredActivityPayload).Goal
				if goal == nil || goal.Outcome != outcome || goal.Text != objective || goal.Evidence != evidence {
					t.Fatalf("public waiting view lost the recorded review: %+v", goal)
				}
				found = true
			}
			if !found {
				t.Fatal("public waiting view lost the Goal tool")
			}
		})
	}
}

func TestPublicGoalActivityPreservesCanonicalFactsAcrossProjections(t *testing.T) {
	t.Parallel()
	text := "  " + strings.Repeat("Deliver the verified result. ", 1000) + "\n"
	evidence := "  " + strings.Repeat("The existing execution provides this evidence. ", 1000) + "\n"
	for _, goal := range []fltools.GoalActivity{
		{Operation: "set", Version: 0, Text: text, Applied: true},
		{Operation: "delete", Version: 1, Text: text, Applied: true},
		{Operation: "review", Version: 1, Text: text},
		{Operation: "review", Version: 1, Text: text, Outcome: "continue", Evidence: evidence},
		{Operation: "review", Version: 1, Text: text, Outcome: "blocked", Evidence: evidence},
		{Operation: "review", Version: 1, Text: text, Outcome: "completed", Evidence: evidence},
	} {
		t.Run(goal.Operation+"/"+goal.Outcome, func(t *testing.T) {
			activity := observation.ActivityItem{
				ItemID: "activity:goal", ToolID: "call:goal", ToolName: "goal",
				Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess,
				Presentation: &fltools.ActivityPresentation{Label: "Goal", Renderer: fltools.ActivityRendererStructured,
					Payload: fltools.StructuredActivityPayload{Operation: goal.Operation, Status: "success", Goal: &goal}},
			}
			item := flruntime.ThreadItem{ID: "tool:goal", TurnID: "turn:goal", RunID: "run:goal", Ordinal: 1, Kind: flruntime.ThreadItemTool, Activity: &activity}
			current := flruntime.ThreadView{ThreadID: "thread:goal", Items: []flruntime.ThreadItem{item}}
			assertGoal := func(t *testing.T, got *fltools.ActivityPresentation) {
				t.Helper()
				if got == nil {
					t.Fatal("public Goal presentation was dropped")
				}
				payload, ok := got.Payload.(fltools.StructuredActivityPayload)
				if !ok || payload.Goal == nil || !reflect.DeepEqual(*payload.Goal, goal) {
					t.Fatalf("public Goal lost canonical facts: %T %+v", got.Payload, payload.Goal)
				}
			}
			t.Run("current", func(t *testing.T) {
				raw, err := MarshalFlowerCurrentView(current)
				if err != nil {
					t.Fatal(err)
				}
				var wire flruntime.ThreadView
				if err := json.Unmarshal(raw, &wire); err != nil {
					t.Fatal(err)
				}
				assertGoal(t, wire.Items[0].Activity.Presentation)
			})
			t.Run("timeline", func(t *testing.T) {
				raw, visible, err := typedThreadItemMessage(current.ThreadID.String(), item)
				if err != nil || !visible {
					t.Fatalf("timeline visible=%v err=%v", visible, err)
				}
				raw, err = SanitizeActivityTimelineMessageJSON(string(raw))
				if err != nil {
					t.Fatal(err)
				}
				var message struct{ Blocks []ActivityTimelineBlock }
				if err := json.Unmarshal(raw, &message); err != nil {
					t.Fatal(err)
				}
				assertGoal(t, message.Blocks[0].Items[0].Presentation)
			})
			t.Run("live", func(t *testing.T) {
				event, ok := sanitizePublicStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: item.ID,
					Block: ActivityTimelineBlock{Type: activityTimelineBlockType, ActivityTimeline: observation.ActivityTimeline{SchemaVersion: 1, Items: []observation.ActivityItem{activity}}}})
				if !ok {
					t.Fatal("public live event was dropped")
				}
				raw, err := json.Marshal(event)
				if err != nil {
					t.Fatal(err)
				}
				var wire struct{ Block ActivityTimelineBlock }
				if err := json.Unmarshal(raw, &wire); err != nil {
					t.Fatal(err)
				}
				assertGoal(t, wire.Block.Items[0].Presentation)
			})
			projected := publicFloretThreadView(current)
			assertGoal(t, projected.Items[0].Activity.Presentation)
			projected.Items[0].Activity.Presentation.Payload.(fltools.StructuredActivityPayload).Goal.Text = "Changed public copy"
			if activity.Presentation.Payload.(fltools.StructuredActivityPayload).Goal.Text != text {
				t.Fatal("public projection mutated the canonical Goal")
			}
		})
	}
}

func TestPublicGoalActivityFiltersUnknownFieldsAndRejectsInvalidFacts(t *testing.T) {
	t.Parallel()
	valid := `{"operation":"review","version":1,"text":"Original objective","outcome":"blocked","evidence":"Needs a decision","applied":true}`
	var record map[string]any
	if err := json.Unmarshal([]byte(valid), &record); err != nil {
		t.Fatal(err)
	}
	record["private_state"] = map[string]any{"secret": "private"}
	record["path"] = "/private/runtime"
	payload, ok := sanitizeActivityPayloadValue(map[string]any{"operation": "review", "goal": record}, fltools.ActivityRendererStructured, "goal")
	if !ok {
		t.Fatal("public payload dropped")
	}
	raw, err := json.Marshal(payload["goal"])
	if err != nil {
		t.Fatal(err)
	}
	var got, want map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(valid), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public Goal fields=%s, want only typed canonical facts", raw)
	}
	for _, invalid := range []string{
		`null`, `"goal"`, `[]`, `{}`,
		`{"operation":"unknown","version":1}`,
		`{"operation":"review","version":-1}`,
		`{"operation":"review","version":1.5}`,
		`{"operation":"review","version":"1"}`,
		`{"operation":"review","version":1,"text":{}}`,
		`{"operation":"review","version":1,"outcome":"done","evidence":"Verified"}`,
		`{"operation":"review","version":1,"outcome":"completed"}`,
		`{"operation":"set","version":1,"outcome":"completed","evidence":"Verified"}`,
	} {
		t.Run(invalid, func(t *testing.T) {
			var value any
			if err := json.Unmarshal([]byte(invalid), &value); err != nil {
				t.Fatal(err)
			}
			payload, _ := sanitizeActivityPayloadValue(map[string]any{"operation": "review", "goal": value}, fltools.ActivityRendererStructured, "goal")
			if _, found := payload["goal"]; found {
				t.Fatalf("invalid Goal became a public fact: %+v", payload)
			}
		})
	}
	for _, scope := range []struct {
		tool     string
		renderer fltools.ActivityRenderer
	}{
		{"other_tool", fltools.ActivityRendererStructured},
		{"goal", fltools.ActivityRendererTerminal},
	} {
		payload, _ := sanitizeActivityPayloadValue(map[string]any{"operation": "review", "goal": record}, scope.renderer, scope.tool)
		if _, found := payload["goal"]; found {
			t.Fatalf("Goal exposed outside its public tool contract: %+v", scope)
		}
	}
	payload, _ = sanitizeActivityPayloadValue(map[string]any{"operation": "review", "status": "success"}, fltools.ActivityRendererStructured, "goal")
	if _, found := payload["goal"]; found {
		t.Fatal("missing historical Goal facts were fabricated")
	}
}
