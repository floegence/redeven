package ai

import (
	"context"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v4/config"
	"github.com/floegence/floret/v4/florettest"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/floret/v4/storage"
	fltools "github.com/floegence/floret/v4/tools"
)

func TestPublishedFloretDynamicRegistryDefinitionsReachProviderAndDispatch(t *testing.T) {
	const arguments = `{"command":"printf FLOWER_DYNAMIC_TOOL_OK","yield_ms":10000}`

	var terminalDef ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "terminal.exec" {
			terminalDef = candidate
			break
		}
	}
	if terminalDef.Name == "" {
		t.Fatal("missing Redeven terminal.exec definition")
	}
	presentation, err := floretToolDefinitionForSnapshot(
		terminalDef,
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, []ToolDef{terminalDef}, nil),
	)
	if err != nil {
		t.Fatal(err)
	}
	var dispatched atomic.Bool
	tool := fltools.Define[map[string]any](presentation, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		dispatched.Store(true)
		return fltools.Result{Text: "FLOWER_DYNAMIC_TOOL_OK"}, nil
	})
	registry := fltools.NewRegistry(tool)
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "dynamic-registry", StateCompatibilityKey: "test:dynamic-registry:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "terminal-dynamic", Name: "terminal.exec", Args: arguments}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventDelta, Text: "terminal completed"},
			{Type: flprovider.EventDone, Reason: "stop"},
		}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "dynamic-registry", Name: "Dynamic Registry"},
		SystemPrompt: "Test dynamic registry definition inheritance.",
		Context:      flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway,
		flruntime.WithAgentTools(tool),
		flruntime.WithAgentDynamicToolSurface(func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
			return flruntime.ToolSurface{Tools: registry, ToolDefinitions: nil, Epoch: "approval-required"}, nil
		}),
		flruntime.WithAgentEffectAuthorization(floretAllowTestEffect),
	)
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return agent, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-dynamic-registry"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "run the terminal command"}, RequestKey: "send-dynamic-registry",
	}); err != nil {
		t.Fatal(err)
	}

	requestCtx, cancelRequests := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancelRequests()
	if err := gateway.WaitForRequests(requestCtx, 1); err != nil {
		t.Fatal(err)
	}
	requests := gateway.Requests()
	toolNames := make([]string, 0, len(requests[0].Tools))
	for _, definition := range requests[0].Tools {
		toolNames = append(toolNames, definition.Name)
	}
	slices.Sort(toolNames)
	if want := []string{"ask_user", "terminal.exec"}; !slices.Equal(toolNames, want) {
		t.Fatalf("provider tool definitions=%v, want %v", toolNames, want)
	}

	deadline := time.Now().Add(5 * time.Second)
	var current flruntime.ThreadView
	for time.Now().Before(deadline) {
		current, err = service.View(t.Context(), created.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if len(current.Interactions) == 1 && current.Interactions[0].Kind == flruntime.ThreadInteractionApproval && !current.Interactions[0].Resolved {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(current.Interactions) != 1 || current.Interactions[0].Approval == nil {
		t.Fatalf("dynamic terminal call did not reach approval: %#v", current)
	}
	approved := true
	if _, err := service.Respond(t.Context(), flruntime.RespondInput{
		ThreadID: created.ThreadID, InteractionID: current.Interactions[0].ID,
		Answers: []flruntime.InteractionAnswer{{Approved: &approved}}, RequestKey: "approve-dynamic-registry",
	}); err != nil {
		t.Fatal(err)
	}
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
	if !dispatched.Load() || current.Activity != flruntime.ThreadActivityIdle || current.LastOutcome == nil {
		t.Fatalf("approved dynamic terminal call did not dispatch and complete: dispatched=%v current=%#v", dispatched.Load(), current)
	}
}

var floretAllowTestEffect = flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
	return effect(ctx, flruntime.EffectAuthorizationProof{
		EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint,
		ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID,
		PolicyRevision: "test-policy", AuditReference: "test-audit", AuditHash: "test-audit-hash", AuthorizedAt: time.Now().UTC(),
	})
})

func TestPublishedFloretApprovalCurrentPresentsTerminalCommand(t *testing.T) {
	const (
		command   = "curl -s https://example.test"
		arguments = `{"command":"curl -s https://example.test","yield_ms":10000}`
	)

	var terminalDef ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "terminal.exec" {
			terminalDef = candidate
			break
		}
	}
	if terminalDef.Name == "" {
		t.Fatal("missing Redeven terminal.exec definition")
	}
	presentation, err := floretToolDefinitionForSnapshot(
		terminalDef,
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, []ToolDef{terminalDef}, nil),
	)
	if err != nil {
		t.Fatal(err)
	}
	tool := fltools.Define[map[string]any](presentation, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		return fltools.Result{Text: "unexpected execution"}, nil
	})
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "approval-command", StateCompatibilityKey: "test:approval-command:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "terminal-command", Name: "terminal.exec", Args: arguments}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "approval-command", Name: "Approval Command"},
		SystemPrompt: "Test terminal approval presentation.",
		Context:      flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway,
		flruntime.WithAgentTools(tool),
		flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
			return effect(ctx, flruntime.EffectAuthorizationProof{
				EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint,
				ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID,
				PolicyRevision: "test-policy", AuditReference: "test-audit", AuditHash: "test-audit-hash", AuthorizedAt: time.Now().UTC(),
			})
		})),
	)
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return agent, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-approval-command"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "run curl"}, RequestKey: "send-approval-command",
	}); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(5 * time.Second)
	var current flruntime.ThreadView
	for time.Now().Before(deadline) {
		current, err = service.View(t.Context(), created.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if len(current.Interactions) == 1 && current.Interactions[0].Kind == flruntime.ThreadInteractionApproval && !current.Interactions[0].Resolved {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(current.Interactions) != 1 || current.Interactions[0].Approval == nil {
		t.Fatalf("current did not reach waiting approval: %#v", current)
	}
	summaries, err := service.List(t.Context(), flruntime.ThreadScope{})
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 || summaries[0].Title != "run curl" || summaries[0].TitleStatus != flruntime.ThreadTitleStatusReady {
		t.Fatalf("waiting approval summary title = %#v", summaries)
	}
	approval := current.Interactions[0].Approval
	if approval.Command != command || strings.Contains(approval.Command, `{"command"`) {
		t.Fatalf("canonical approval command=%q, want %q", approval.Command, command)
	}
	projected := publicFloretThreadView(current)
	if got := projected.Interactions[0].Approval.Command; got != command {
		t.Fatalf("public approval command=%q, want %q", got, command)
	}
	if _, err := service.Cancel(t.Context(), flruntime.CancelInput{ThreadID: created.ThreadID, RequestKey: "cancel-approval-command"}); err != nil {
		t.Fatal(err)
	}
}

func TestPublishedFloretSchemaCorrectionDoesNotCreateToolRow(t *testing.T) {
	var terminalRead ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "terminal.read" {
			terminalRead = candidate
			break
		}
	}
	if terminalRead.Name == "" {
		t.Fatal("missing Redeven terminal.read definition")
	}
	presentation, err := floretToolDefinitionForSnapshot(
		terminalRead,
		buildPermissionSnapshot(FlowerPermissionFullAccess, []ToolDef{terminalRead}, nil),
	)
	if err != nil {
		t.Fatal(err)
	}
	var called atomic.Bool
	tool := fltools.Define[map[string]any](presentation, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		called.Store(true)
		return fltools.Result{Text: "unexpected execution"}, nil
	})
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "schema-correction", StateCompatibilityKey: "test:schema-correction:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{
				ID: "terminal-read-invalid", Name: "terminal.read", Args: `{"process_id":"proc-1","after_seq":0}`,
			}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventDelta, Text: "Recovered after validation correction."},
			{Type: flprovider.EventDone, Reason: "stop"},
		}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "schema-correction", Name: "Schema Correction"},
		SystemPrompt: "Test internal schema correction.",
		Context:      flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway,
		flruntime.WithAgentTools(tool),
		flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
			return effect(ctx, flruntime.EffectAuthorizationProof{
				EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint,
				ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID,
				PolicyRevision: "test-policy", AuditReference: "test-audit", AuditHash: "test-audit-hash", AuthorizedAt: time.Now().UTC(),
			})
		})),
	)
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return agent, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-schema-correction"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "read output"}, RequestKey: "send-schema-correction",
	}); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(5 * time.Second)
	var current flruntime.ThreadView
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
	if current.Activity != flruntime.ThreadActivityIdle || current.LastOutcome == nil {
		t.Fatalf("current did not complete: %#v", current)
	}
	if called.Load() {
		t.Fatal("schema-invalid terminal.read handler ran")
	}
	for _, view := range []flruntime.ThreadView{current, publicFloretThreadView(current)} {
		for _, item := range view.Items {
			if item.Kind == flruntime.ThreadItemTool || item.Activity != nil && item.Activity.ToolID == "terminal-read-invalid" {
				t.Fatalf("schema correction leaked as tool row: item=%#v activity=%#v", item, item.Activity)
			}
		}
	}
}
