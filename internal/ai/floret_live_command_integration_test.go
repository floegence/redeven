package ai

import (
	"context"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestPublishedFloretPublishesCommandBeforeTerminalOutput(t *testing.T) {
	var terminalDef ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "terminal.exec" {
			terminalDef = candidate
			break
		}
	}
	definition, err := floretToolDefinitionForSnapshot(terminalDef, buildPermissionSnapshot(FlowerPermissionFullAccess, []ToolDef{terminalDef}, nil))
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	finish := sync.OnceFunc(func() { close(release) })
	t.Cleanup(finish)
	tool := fltools.Define[map[string]any](definition, nil, nil, func(ctx context.Context, _ fltools.Invocation[map[string]any]) (fltools.Result, error) {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return fltools.Result{}, ctx.Err()
		}
		return fltools.Result{Text: "ready"}, nil
	})
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "live-command", StateCompatibilityKey: "test:live-command:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "live-command", Name: "terminal.exec", Args: `{"description":"Inspect environment status","command":"printf READY","yield_ms":10000}`}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Finished."}, {Type: flprovider.EventDone, Reason: "stop"}}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Test command presentation.",
		Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
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
	subscription, err := service.Subscribe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Close)
	thread, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-live-command"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: "send-live-command", Input: flruntime.UserInput{Text: "Inspect environment"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("tool did not start")
	}
	assertCommand := func(view flruntime.ThreadView) bool {
		t.Helper()
		for _, item := range publicFloretThreadView(view).Items {
			activity := item.Activity
			if activity == nil || activity.ToolID != "live-command" || activity.Status != observation.ActivityStatusRunning {
				continue
			}
			if activity.Presentation == nil || activity.Presentation.Label != "Inspect environment status" {
				t.Fatalf("missing running description: %#v", activity)
			}
			payload := activity.Presentation.Payload.(fltools.TerminalActivityPayload)
			if payload.Command != "printf READY" || payload.Output != "" {
				t.Fatalf("running command facts: %#v", payload)
			}
			return true
		}
		return false
	}
	view, err := service.View(t.Context(), thread.ThreadID)
	if err != nil || !assertCommand(view) {
		t.Fatalf("View did not expose the running command before output: %v", err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for {
		view, err = subscription.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if assertCommand(view) {
			break
		}
	}
	finish()
}
