package ai

import (
	"context"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type providerContinuationProjector struct {
	run          *run
	providerID   string
	providerType string
	modelName    string
	baseURL      string
}

func newProviderContinuationProjector(r *run, providerID string, providerType string, modelName string, baseURL string) providerContinuationProjector {
	return providerContinuationProjector{
		run:          r,
		providerID:   strings.TrimSpace(providerID),
		providerType: strings.TrimSpace(providerType),
		modelName:    strings.TrimSpace(modelName),
		baseURL:      strings.TrimSpace(baseURL),
	}
}

func (p providerContinuationProjector) PreviousState(ctx context.Context) (*flruntime.ModelState, error) {
	r := p.run
	if r == nil || r.threadsDB == nil {
		return nil, nil
	}
	if strings.TrimSpace(r.endpointID) == "" || strings.TrimSpace(r.threadID) == "" {
		return nil, nil
	}
	if !isOpenAIResponsesProviderContinuationEnabled(p.providerType) {
		return nil, nil
	}
	continuation, err := r.threadsDB.GetThreadProviderContinuation(ctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID))
	if err != nil {
		return nil, err
	}
	if continuation == nil || continuation.IsZero() {
		return nil, nil
	}
	normalized := continuation.Normalized()
	if normalized.Kind != providerContinuationKindOpenAIResponses {
		return nil, nil
	}
	if normalized.ProviderID != p.providerID {
		return nil, nil
	}
	if normalized.Model != p.modelName {
		return nil, nil
	}
	if normalized.BaseURL != canonicalProviderContinuationBaseURL(p.providerType, p.baseURL) {
		return nil, nil
	}
	return &flruntime.ModelState{Kind: normalized.Kind, ID: normalized.ContinuationID}, nil
}

func (p providerContinuationProjector) Candidate(state *TurnProviderState) threadstore.ThreadProviderContinuation {
	if state == nil {
		return threadstore.ThreadProviderContinuation{}
	}
	kind := strings.TrimSpace(state.ContinuationKind)
	continuationID := strings.TrimSpace(state.ContinuationID)
	if kind == "" || continuationID == "" {
		return threadstore.ThreadProviderContinuation{}
	}
	return threadstore.ThreadProviderContinuation{
		Kind:            kind,
		ContinuationID:  continuationID,
		ProviderID:      p.providerID,
		Model:           p.modelName,
		BaseURL:         canonicalProviderContinuationBaseURL(p.providerType, p.baseURL),
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	}.Normalized()
}

func persistProviderContinuationCandidate(ctx context.Context, db *threadstore.Store, endpointID string, threadID string, continuation threadstore.ThreadProviderContinuation) error {
	if db == nil {
		return nil
	}
	if continuation.IsZero() {
		return db.ClearThreadProviderContinuation(ctx, endpointID, threadID)
	}
	return db.SetThreadProviderContinuation(ctx, endpointID, threadID, continuation)
}

func canonicalProviderContinuationBaseURL(providerType string, baseURL string) string {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL != "" {
		return baseURL
	}
	if providerType == "openai" {
		return "https://api.openai.com/v1"
	}
	return ""
}
