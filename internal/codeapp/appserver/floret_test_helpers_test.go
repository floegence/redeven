package appserver

import (
	"context"
	"errors"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v4/config"
	"github.com/floegence/floret/v4/identity"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
	flstorage "github.com/floegence/floret/v4/storage"
	"github.com/floegence/redeven/internal/ai"
	redevenconfig "github.com/floegence/redeven/internal/config"
)

func appserverTestAIConfig() *redevenconfig.AIConfig {
	return &redevenconfig.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []redevenconfig.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1",
			Models: []redevenconfig.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
}

type staticAIServiceProvider struct {
	service *ai.Service
}

func newStaticAIServiceProvider(service *ai.Service) AIServiceProvider {
	return staticAIServiceProvider{service: service}
}

func (p staticAIServiceProvider) AcquireAIService(ctx context.Context) (*ai.Service, context.Context, uint64, func(), error) {
	if p.service == nil {
		return nil, nil, 0, nil, ErrAIServiceUnavailable
	}
	return p.service, ctx, 1, func() {}, nil
}

func (p staticAIServiceProvider) AIReadiness() AIReadinessSnapshot {
	if p.service == nil {
		return AIReadinessSnapshot{State: AIReadinessUnavailable}
	}
	return AIReadinessSnapshot{State: AIReadinessReady}
}

func (p staticAIServiceProvider) RetryAIReadiness() error {
	return nil
}

func (p staticAIServiceProvider) UpdateAIServiceStartupOptions(AIServiceStartupOptions) {}

type appserverTestIDSource struct {
	turnID identity.TurnID
	runID  identity.RunID
}

func (source *appserverTestIDSource) NewThreadID() (identity.ThreadID, error) {
	return "", errors.New("appserver fixture must use an existing canonical thread")
}

func (source *appserverTestIDSource) NewTurnID() (identity.TurnID, error) {
	if source == nil || source.turnID == "" {
		return "", errors.New("appserver fixture turn identity is unavailable")
	}
	turnID := source.turnID
	source.turnID = ""
	return turnID, nil
}

func (source *appserverTestIDSource) NewRunID() (identity.RunID, error) {
	if source == nil || source.runID == "" {
		return "", errors.New("appserver fixture run identity is unavailable")
	}
	runID := source.runID
	source.runID = ""
	return runID, nil
}

type appserverTestFloretTurnRequest struct {
	TurnID              identity.TurnID
	RunID               identity.RunID
	Input               flruntime.TurnInput
	SupplementalContext []flruntime.TurnSupplementalContextItem
	Signals             flruntime.TurnSignalSpec
}

type appserverTestGateway struct {
	events []flprovider.Event
}

func (appserverTestGateway) Identity() flprovider.Identity {
	return flprovider.Identity{Provider: "test", Model: "appserver-test", StateCompatibilityKey: "test:appserver:v2"}
}

func (appserverTestGateway) Capabilities() flprovider.Capabilities {
	return flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}
}

func (gateway appserverTestGateway) Stream(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
	events := make(chan flprovider.Event, len(gateway.events))
	for _, event := range gateway.events {
		events <- event
	}
	close(events)
	return events, nil
}

func newAppserverTestFloretAgent(t *testing.T, gateway flprovider.Gateway) *flruntime.Agent {
	t.Helper()
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "appserver-test", Name: "AppServer test agent"},
		SystemPrompt: "You are a deterministic AppServer test agent.",
		Context: flconfig.ContextPolicy{
			ContextWindowTokens: 128000, MaxOutputTokens: 4096, ReservedOutputTokens: 4096, MaxCompactionFailures: 2,
		},
	}, gateway)
	if err != nil {
		t.Fatalf("runtime.NewAgent: %v", err)
	}
	return agent
}

func runAppserverTestFloretTurn(t *testing.T, path string, threadID identity.ThreadID, gateway flprovider.Gateway, request appserverTestFloretTurnRequest) flruntime.ThreadView {
	t.Helper()
	host, err := flruntime.Open(context.Background(), flruntime.Options{
		Storage:  flstorage.SQLite(path),
		IDSource: &appserverTestIDSource{turnID: request.TurnID, runID: request.RunID},
	})
	if err != nil {
		t.Fatalf("runtime.Open: %v", err)
	}
	defer func() { _ = host.Shutdown(context.Background()) }()
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return newAppserverTestFloretAgent(t, gateway), nil
	}))
	if err != nil {
		t.Fatalf("Host.ThreadService: %v", err)
	}
	_, err = service.Send(context.Background(), flruntime.SendInput{
		ThreadID: threadID, Input: request.Input, RequestKey: flruntime.RequestKey("fixture_" + string(request.TurnID)),
	})
	if err != nil {
		t.Fatalf("ThreadService.Send: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		view, viewErr := service.View(context.Background(), threadID)
		if viewErr == nil && (len(view.Interactions) > 0 || view.Activity == flruntime.ThreadActivityIdle) {
			return view
		}
		time.Sleep(5 * time.Millisecond)
	}
	view, err := service.View(context.Background(), threadID)
	t.Fatalf("typed thread fixture did not converge: view=%#v err=%v", view, err)
	return flruntime.ThreadView{}
}
