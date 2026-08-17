package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func executionAuthorityFromMeta(meta *session.Meta, threadID, requestKey, turnID string) (threadstore.ExecutionAuthority, error) {
	if meta == nil {
		return threadstore.ExecutionAuthority{}, errors.New("missing execution authority metadata")
	}
	authority := threadstore.ExecutionAuthority{
		RequestKey: requestKey, ThreadID: threadID, TurnID: turnID,
		EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ChannelID: meta.ChannelID, UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
	}
	if strings.TrimSpace(authority.UserPublicID) == "" {
		return threadstore.ExecutionAuthority{}, errors.New("execution authority user is missing")
	}
	return authority, nil
}

func (s *Service) persistExecutionAuthority(ctx context.Context, meta *session.Meta, threadID, requestKey, turnID string) error {
	authority, err := executionAuthorityFromMeta(meta, threadID, requestKey, turnID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	return db.PutExecutionAuthority(ctxOrBackground(ctx), authority)
}

func (s *Service) persistExecutionAuthorityRecord(ctx context.Context, authority *threadstore.ExecutionAuthority, requestKey, turnID string) error {
	if authority == nil {
		return errors.New("execution authority is unavailable")
	}
	copy := *authority
	copy.RequestKey = strings.TrimSpace(requestKey)
	copy.TurnID = strings.TrimSpace(turnID)
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	return db.PutExecutionAuthority(ctxOrBackground(ctx), copy)
}
