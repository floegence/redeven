package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	flprovider "github.com/floegence/floret/v7/provider"
)

type preparedModelWire struct {
	mu          sync.Mutex
	payload     []byte
	estimate    flprovider.TokenEstimate
	fingerprint string
	execute     func(context.Context, []byte, func(StreamEvent)) (ModelGatewayResult, error)
}

// Freeze the SDK-rendered body once. Estimation and dispatch use these exact
// bytes, including tool aliases, reasoning controls and restored signatures.
func newPreparedModelWire(providerType, model string, format flprovider.RequestFormat, params any, execute func(context.Context, []byte, func(StreamEvent)) (ModelGatewayResult, error)) (*preparedModelWire, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	var body map[string]json.RawMessage
	if err = json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	body["stream"] = json.RawMessage("true")
	raw, err = json.Marshal(body)
	if err != nil {
		return nil, err
	}
	estimate, err := flprovider.EstimateRenderedRequest(flprovider.RenderedRequest{Provider: providerType, Model: model, Format: format, Payload: raw})
	if err != nil {
		return nil, err
	}
	return &preparedModelWire{payload: raw, estimate: estimate, fingerprint: fmt.Sprintf("sha256:%x", sha256.Sum256(raw)), execute: execute}, nil
}
func (p *preparedModelWire) TokenEstimate() flprovider.TokenEstimate { return p.estimate }
func (p *preparedModelWire) RenderedPayloadFingerprint() string      { return p.fingerprint }
func (p *preparedModelWire) StreamTurn(ctx context.Context, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	execute, payload := p.execute, p.payload
	p.execute = nil
	p.payload = nil
	p.mu.Unlock()
	if execute == nil {
		return ModelGatewayResult{}, errors.New("prepared provider request already used or closed")
	}
	return execute(ctx, payload, onEvent)
}
func (p *preparedModelWire) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.execute = nil
	p.payload = nil
	return nil
}
