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
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestThreadQueryUnsupportedFilterCorrectsBeforeDispatch(t *testing.T) {
	def := builtInThreadQueryToolDefinitions()[0]
	presentation, err := floretToolDefinitionForSnapshot(def, buildPermissionSnapshot(FlowerPermissionFullAccess, []ToolDef{def}, nil))
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	tool := fltools.Define[map[string]any](presentation, nil, nil, func(_ context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
		calls.Add(1)
		if inv.Args["thread_id"] != "thread" || inv.Args["filter"] != nil {
			t.Errorf("schema-invalid sort reached dispatch: %v", inv.Args)
		}
		return fltools.Result{Text: "Found canonical messages."}, nil
	})
	call := func(id, key string) florettest.Step {
		input := map[string]any{"object": "messages", "thread_id": "thread"}
		if key != "time" {
			input["filter"] = map[string]any{"text": map[string]any{"contains": "release"}}
		}
		args, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: id, Name: def.Name, Args: string(args)}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}}
	}
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "thread-query", StateCompatibilityKey: "thread-query:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		call("invalid-sort", "created_at"), call("corrected-sort", "time"),
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Query completed."}, {Type: flprovider.EventDone, Reason: "stop"}}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "thread-query", Name: "Thread Query"},
		SystemPrompt: "Query canonical messages.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-query-correction"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "Find the latest messages."}, RequestKey: "query-correction"}); err != nil {
		t.Fatal(err)
	}
	var current flruntime.ThreadView
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		current, err = service.View(t.Context(), created.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Activity == flruntime.ThreadActivityIdle && current.LastOutcome != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if current.LastOutcome == nil || *current.LastOutcome != flruntime.TurnOutcomeCompleted || calls.Load() != 1 {
		t.Fatalf("query correction did not complete with one dispatch: calls=%d view=%+v", calls.Load(), current)
	}
	requests := gateway.Requests()
	if len(requests) != 3 {
		t.Fatalf("provider requests=%d, want 3", len(requests))
	}
	var pairedFeedback bool
	var feedbackText string
	for _, message := range requests[1].Messages {
		if message.ToolResult != nil && message.ToolResult.CallID == "invalid-sort" && message.ToolResult.ToolName == def.Name {
			feedbackText = message.ToolResult.Text
			pairedFeedback = strings.Contains(feedbackText, "filter")
		}
	}
	if !pairedFeedback {
		t.Fatalf("paired enum validation feedback missing: %q", feedbackText)
	}
	var visibleTools int
	for _, item := range publicFloretThreadView(current).Items {
		if item.Activity != nil && item.Activity.ToolID == "invalid-sort" {
			t.Fatal("schema-invalid sort leaked into visible Activity")
		}
		if item.Kind == flruntime.ThreadItemTool {
			visibleTools++
		}
	}
	if visibleTools != 1 {
		t.Fatalf("visible query tools=%d, want only the corrected call", visibleTools)
	}
}
