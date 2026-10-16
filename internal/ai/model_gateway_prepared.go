package ai

import (
	"bytes"
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
	consumed    bool
	payload     []byte
	estimate    flprovider.TokenEstimate
	fingerprint string
	execute     func(context.Context, []byte, func(StreamEvent)) (ModelGatewayResult, error)
}

// Freeze the SDK-rendered body once. Estimation and dispatch use these exact
// bytes, including tool aliases, reasoning controls and restored signatures.
func newPreparedModelWire(providerType, model string, format flprovider.RequestFormat, params any, req ModelGatewayRequest, aliases providerToolAliases, execute func(context.Context, []byte, func(StreamEvent)) (ModelGatewayResult, error)) (*preparedModelWire, error) {
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
	estimate, err := flprovider.EstimateRenderedRequest(flprovider.RenderedRequest{Provider: providerType, Model: model, Format: format, Payload: raw, Attribution: renderedContextAttribution(format, raw, req, aliases)})
	if err != nil {
		return nil, err
	}
	return &preparedModelWire{payload: raw, estimate: estimate, fingerprint: fmt.Sprintf("sha256:%x", sha256.Sum256(raw)), execute: execute}, nil
}
func (p *preparedModelWire) TokenEstimate() flprovider.TokenEstimate {
	return cloneModelTokenEstimate(p.estimate)
}
func (p *preparedModelWire) RenderedPayloadFingerprint() string { return p.fingerprint }
func (p *preparedModelWire) StreamTurn(ctx context.Context, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	p.mu.Lock()
	execute, payload := p.execute, p.payload
	consumed := p.consumed
	p.consumed = true
	p.mu.Unlock()
	if consumed || execute == nil {
		return ModelGatewayResult{}, errors.New("prepared provider request already used or closed")
	}
	return execute(ctx, payload, onEvent)
}
func (p *preparedModelWire) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.consumed = true
	return nil
}

// Replay retains the exact rendered body and immutable dispatch closure. Closing
// a single-use handle releases its execution right, not its frozen model input.
func (p *preparedModelWire) replay(_ context.Context, _ flprovider.Request) (preparedModelGatewayTurn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return &preparedModelWire{payload: bytes.Clone(p.payload), estimate: p.estimate, fingerprint: p.fingerprint, execute: p.execute}, nil
}

func cloneModelTokenEstimate(value flprovider.TokenEstimate) flprovider.TokenEstimate {
	if value.Breakdown.Details != nil {
		details := *value.Breakdown.Details
		details.Items = append(details.Items[:0:0], details.Items...)
		value.Breakdown.Details = &details
	}
	return value
}
