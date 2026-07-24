package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	flruntime "github.com/floegence/floret/runtime"
)

type preparedTestFloretRequest struct {
	mu          sync.Mutex
	gateway     flruntime.ModelGateway
	request     flruntime.ModelRequest
	estimate    flruntime.ModelRequestTokenEstimate
	fingerprint string
	streamed    bool
	closed      bool
}

func prepareTestFloretRequest(gateway flruntime.ModelGateway, req flruntime.ModelRequest) (flruntime.PreparedModelRequest, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	var frozen flruntime.ModelRequest
	if err := json.Unmarshal(payload, &frozen); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	return &preparedTestFloretRequest{
		gateway: gateway,
		request: frozen,
		estimate: flruntime.ModelRequestTokenEstimate{
			EstimatedInputTokens: int64(len(payload)),
			Source:               "redeven_test_gateway_rendered_json_utf8_bytes_v1",
			Method:               "provider_rendered_payload",
			Confidence:           "conservative",
			Coverage:             flruntime.ModelRequestTokenEstimateCoverageComplete,
		},
		fingerprint: fmt.Sprintf("sha256:%x", digest[:]),
	}, nil
}

func (p *preparedTestFloretRequest) StreamModel(ctx context.Context) (<-chan flruntime.ModelEvent, error) {
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
	return gateway.StreamModel(ctx, request)
}

func (p *preparedTestFloretRequest) TokenEstimate() flruntime.ModelRequestTokenEstimate {
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
	p.request = flruntime.ModelRequest{}
	return nil
}

func (f floretModelGatewayFunc) PrepareModelRequest(_ context.Context, req flruntime.ModelRequest) (flruntime.PreparedModelRequest, error) {
	return prepareTestFloretRequest(f, req)
}

func (g canonicalChildApprovalGateway) PrepareModelRequest(_ context.Context, req flruntime.ModelRequest) (flruntime.PreparedModelRequest, error) {
	return prepareTestFloretRequest(g, req)
}

func (g testAskUserGateway) PrepareModelRequest(_ context.Context, req flruntime.ModelRequest) (flruntime.PreparedModelRequest, error) {
	return prepareTestFloretRequest(g, req)
}

func (g *blockingFloretModelGateway) PrepareModelRequest(_ context.Context, req flruntime.ModelRequest) (flruntime.PreparedModelRequest, error) {
	return prepareTestFloretRequest(g, req)
}
