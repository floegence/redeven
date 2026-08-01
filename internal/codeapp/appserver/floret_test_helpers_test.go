package appserver

import (
	"context"
	"errors"
	"testing"

	flconfig "github.com/floegence/floret/v3/config"
	"github.com/floegence/floret/v3/identity"
	flprovider "github.com/floegence/floret/v3/provider"
	flruntime "github.com/floegence/floret/v3/runtime"
	flstorage "github.com/floegence/floret/v3/storage"
	"github.com/floegence/redeven/internal/ai"
)

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

func runAppserverTestFloretTurn(t *testing.T, path string, threadID identity.ThreadID, gateway flprovider.Gateway, request appserverTestFloretTurnRequest) flruntime.ThreadTurnSnapshot {
	t.Helper()
	host, err := flruntime.Open(context.Background(), flruntime.Options{
		Storage:  flstorage.SQLite(path),
		IDSource: &appserverTestIDSource{turnID: request.TurnID, runID: request.RunID},
	})
	if err != nil {
		t.Fatalf("runtime.Open: %v", err)
	}
	defer func() { _ = host.Shutdown(context.Background()) }()
	thread, err := host.Thread(context.Background(), threadID)
	if err != nil {
		t.Fatalf("Host.Thread: %v", err)
	}
	executor, err := thread.TurnExecutor(newAppserverTestFloretAgent(t, gateway))
	if err != nil {
		t.Fatalf("Thread.TurnExecutor: %v", err)
	}
	started, err := executor.StartTurn(context.Background(), flruntime.StartTurnCommand{
		LogicalRequestID:    identity.LogicalRequestID("fixture_" + string(request.TurnID)),
		UserMessage:         request.Input,
		SupplementalContext: request.SupplementalContext,
		Signals:             request.Signals,
	})
	if err != nil {
		t.Fatalf("TurnExecutor.StartTurn: %v", err)
	}
	reader, err := thread.Reader()
	if err != nil {
		t.Fatalf("Thread.Reader: %v", err)
	}
	result, err := reader.ReadTurn(context.Background(), started.TurnID)
	if err != nil {
		t.Fatalf("ThreadReader.ReadTurn: %v", err)
	}
	return result
}
