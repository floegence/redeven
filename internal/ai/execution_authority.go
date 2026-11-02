package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func executionAuthorityFromMeta(meta *session.Meta, threadID, requestKey, turnID, permissionType string) (threadstore.ExecutionAuthority, error) {
	if meta == nil {
		return threadstore.ExecutionAuthority{}, errors.New("missing execution authority metadata")
	}
	authority := threadstore.ExecutionAuthority{
		RequestKey: requestKey, ThreadID: threadID, TurnID: turnID, PermissionType: permissionType,
		EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ChannelID: meta.ChannelID, UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
	}
	if strings.TrimSpace(authority.UserPublicID) == "" {
		return threadstore.ExecutionAuthority{}, errors.New("execution authority user is missing")
	}
	return authority, nil
}

func (s *Service) persistExecutionAuthority(ctx context.Context, meta *session.Meta, threadID, requestKey, turnID, permissionType string, requests ...SendUserTurnRequest) error {
	authority, err := executionAuthorityFromMeta(meta, threadID, requestKey, turnID, permissionType)
	if err != nil {
		return err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if len(requests) > 0 {
		raw, err := json.Marshal(struct {
			Model   string
			Options RunOptions
		}{requests[0].Model, requests[0].Options})
		if err != nil {
			return err
		}
		authority.ExecutionConfigJSON = string(raw)
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

func sessionMetaFromExecutionAuthority(authority *threadstore.ExecutionAuthority) session.Meta {
	return session.Meta{
		ChannelID: strings.TrimSpace(authority.ChannelID), EndpointID: strings.TrimSpace(authority.EndpointID),
		NamespacePublicID: strings.TrimSpace(authority.NamespacePublicID), UserPublicID: strings.TrimSpace(authority.UserPublicID),
		UserEmail: strings.TrimSpace(authority.UserEmail), CanRead: true, CanWrite: true, CanExecute: true,
	}
}
