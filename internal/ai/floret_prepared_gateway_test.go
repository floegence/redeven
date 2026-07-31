package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"

	flconfig "github.com/floegence/floret/v3/config"
	flprovider "github.com/floegence/floret/v3/provider"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/config"
)

func testFloretGatewayIdentity() flprovider.Identity {
	return flprovider.Identity{Provider: "test", Model: "test-model", StateCompatibilityKey: "test:v2"}
}

func testFloretGatewayCapabilities() flprovider.Capabilities {
	return flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported, AttachmentPayload: flprovider.AttachmentDescriptors}
}

func newTestFloretAgent(t *testing.T, gateway flprovider.Gateway, options ...flruntime.AgentOption) *flruntime.Agent {
	t.Helper()
	agent, err := flruntime.NewAgent(
		redevenFloretAgentConfig("You are a deterministic test agent.", floretModelContextPolicy(128000, 4096), config.AIReasoningSelection{}),
		gateway,
		options...,
	)
	if err != nil {
		t.Fatalf("runtime.NewAgent: %v", err)
	}
	return agent
}

func newStaticTestFloretAgent(t *testing.T, response string, options ...flruntime.AgentOption) *flruntime.Agent {
	t.Helper()
	gateway := floretModelGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 2)
		events <- flprovider.Event{Type: flprovider.EventDelta, Text: response}
		events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		close(events)
		return events, nil
	})
	return newTestFloretAgent(t, gateway, options...)
}

type preparedTestFloretRequest struct {
	mu          sync.Mutex
	gateway     flprovider.Gateway
	request     flprovider.Request
	estimate    flprovider.TokenEstimate
	fingerprint string
	streamed    bool
	closed      bool
}

func prepareTestFloretRequest(gateway flprovider.Gateway, req flprovider.Request) (flprovider.PreparedRequest, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	var frozen flprovider.Request
	if err := json.Unmarshal(payload, &frozen); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	return &preparedTestFloretRequest{
		gateway: gateway,
		request: frozen,
		estimate: flprovider.TokenEstimate{
			EstimatedInputTokens: int64(len(payload)),
			Source:               "redeven_test_gateway_rendered_json_utf8_bytes_v1",
			Method:               string(flconfig.EstimateMethodProviderRenderedPayload),
			Confidence:           "conservative",
			Coverage:             "complete_request",
		},
		fingerprint: fmt.Sprintf("sha256:%x", digest[:]),
	}, nil
}

func (p *preparedTestFloretRequest) Stream(ctx context.Context) (<-chan flprovider.Event, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("prepared test model request is closed")
	}
	if p.streamed {
		p.mu.Unlock()
		return nil, errors.New("prepared test model request was already streamed")
	}
	p.streamed = true
	gateway := p.gateway
	request := p.request
	p.mu.Unlock()
	return gateway.Stream(ctx, request)
}

func (p *preparedTestFloretRequest) TokenEstimate() flprovider.TokenEstimate {
	return p.estimate
}

func (p *preparedTestFloretRequest) RenderedPayloadFingerprint() string {
	return p.fingerprint
}

func (p *preparedTestFloretRequest) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.gateway = nil
	p.request = flprovider.Request{}
	return nil
}

func (f floretModelGatewayFunc) Prepare(_ context.Context, req flprovider.Request) (flprovider.PreparedRequest, error) {
	return prepareTestFloretRequest(f, req)
}

func (g canonicalChildApprovalGateway) Prepare(_ context.Context, req flprovider.Request) (flprovider.PreparedRequest, error) {
	return prepareTestFloretRequest(g, req)
}

func (g testAskUserGateway) Prepare(_ context.Context, req flprovider.Request) (flprovider.PreparedRequest, error) {
	return prepareTestFloretRequest(g, req)
}

func (g *blockingFloretModelGateway) Prepare(_ context.Context, req flprovider.Request) (flprovider.PreparedRequest, error) {
	return prepareTestFloretRequest(g, req)
}
