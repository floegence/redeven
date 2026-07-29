package appserver

import (
	"context"
	"testing"

	flconfig "github.com/floegence/floret/v2/config"
	flprovider "github.com/floegence/floret/v2/provider"
	flruntime "github.com/floegence/floret/v2/runtime"
	flstorage "github.com/floegence/floret/v2/storage"
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

func openAppserverTestFloretHost(t *testing.T, path string) (*flruntime.Host, error) {
	t.Helper()
	return flruntime.Open(context.Background(), flruntime.Options{Storage: flstorage.SQLite(path)})
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

func runAppserverTestFloretTurn(t *testing.T, path string, threadID flruntime.ThreadID, gateway flprovider.Gateway, request flruntime.TurnRequest) flruntime.TurnResult {
	t.Helper()
	host, err := openAppserverTestFloretHost(t, path)
	if err != nil {
		t.Fatalf("runtime.Open: %v", err)
	}
	defer func() { _ = host.Close() }()
	runner, err := host.TurnRunner(context.Background(), threadID, newAppserverTestFloretAgent(t, gateway))
	if err != nil {
		t.Fatalf("Host.TurnRunner: %v", err)
	}
	result, err := runner.Run(context.Background(), request)
	if err != nil {
		t.Fatalf("TurnRunner.Run: %v", err)
	}
	return result
}
