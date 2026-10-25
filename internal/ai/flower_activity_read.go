package ai

import (
	"context"
	"errors"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// Field locators identify data; they never grant authorization or execution.
func (s *Service) GetFlowerActivityStructure(ctx context.Context, meta *session.Meta, threadID string, input flruntime.ThreadActivityStructureInput) (flruntime.ThreadActivityStructurePage, error) {
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return flruntime.ThreadActivityStructurePage{}, err
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadActivityStructureReader)
	if !ok {
		return flruntime.ThreadActivityStructurePage{}, errors.New("published Floret activity structure contract is unavailable")
	}
	input.ThreadID = identity.ThreadID(threadID)
	return reader.ActivityStructure(ctx, scope, input)
}

func (s *Service) GetFlowerActivityField(ctx context.Context, meta *session.Meta, threadID string, input flruntime.ThreadActivityFieldInput) (flruntime.ThreadActivityFieldChunk, error) {
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return flruntime.ThreadActivityFieldChunk{}, err
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadActivityFieldReader)
	if !ok {
		return flruntime.ThreadActivityFieldChunk{}, errors.New("published Floret activity field contract is unavailable")
	}
	input.ThreadID = identity.ThreadID(threadID)
	return reader.ReadActivityField(ctx, scope, input)
}

// GetFlowerActivityValue reads one complete bounded subtree from one snapshot.
func (s *Service) GetFlowerActivityValue(ctx context.Context, meta *session.Meta, threadID string, input flruntime.ThreadActivityValueInput) (flruntime.ThreadActivityValue, error) {
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return flruntime.ThreadActivityValue{}, err
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadActivityValueReader)
	if !ok {
		return flruntime.ThreadActivityValue{}, errors.New("published Floret activity value contract is unavailable")
	}
	input.ThreadID = identity.ThreadID(threadID)
	return reader.ReadActivityValue(ctx, scope, input)
}
