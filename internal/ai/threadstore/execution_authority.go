package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var ErrExecutionAuthorityConflict = errors.New("execution authority conflicts with an existing request")

// ExecutionAuthority is the minimum durable host fact needed to rebuild one
// provider execution after restart. It is not a second Agent lifecycle or
// transcript store; Floret remains authoritative for all execution state.
type ExecutionAuthority struct {
	RequestKey        string
	ThreadID          string
	TurnID            string
	EndpointID        string
	NamespacePublicID string
	ChannelID         string
	UserPublicID      string
	UserEmail         string
	CreatedAtUnixMs   int64
}

func (s *Store) PutExecutionAuthority(ctx context.Context, authority ExecutionAuthority) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	authority.RequestKey = strings.TrimSpace(authority.RequestKey)
	authority.ThreadID = strings.TrimSpace(authority.ThreadID)
	authority.TurnID = strings.TrimSpace(authority.TurnID)
	authority.EndpointID = strings.TrimSpace(authority.EndpointID)
	authority.NamespacePublicID = strings.TrimSpace(authority.NamespacePublicID)
	authority.ChannelID = strings.TrimSpace(authority.ChannelID)
	authority.UserPublicID = strings.TrimSpace(authority.UserPublicID)
	authority.UserEmail = strings.TrimSpace(authority.UserEmail)
	if authority.RequestKey == "" || authority.ThreadID == "" || authority.EndpointID == "" || authority.UserPublicID == "" {
		return errors.New("execution authority identity is incomplete")
	}
	if authority.CreatedAtUnixMs <= 0 {
		authority.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var existing ExecutionAuthority
	err = tx.QueryRowContext(ctx, `SELECT request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms FROM ai_flower_execution_authority WHERE request_key = ?`, authority.RequestKey).Scan(
		&existing.RequestKey, &existing.ThreadID, &existing.TurnID, &existing.EndpointID, &existing.NamespacePublicID, &existing.ChannelID, &existing.UserPublicID, &existing.UserEmail, &existing.CreatedAtUnixMs,
	)
	switch {
	case err == nil:
		if existing.ThreadID != authority.ThreadID ||
			existing.EndpointID != authority.EndpointID ||
			existing.NamespacePublicID != authority.NamespacePublicID ||
			existing.ChannelID != authority.ChannelID ||
			existing.UserPublicID != authority.UserPublicID ||
			existing.UserEmail != authority.UserEmail {
			return ErrExecutionAuthorityConflict
		}
		if authority.TurnID != "" && existing.TurnID != authority.TurnID {
			_, err = tx.ExecContext(ctx, `UPDATE ai_flower_execution_authority SET turn_id = ? WHERE request_key = ?`, authority.TurnID, authority.RequestKey)
			if err != nil {
				return err
			}
		}
		return tx.Commit()
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_flower_execution_authority(request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, authority.RequestKey, authority.ThreadID, authority.TurnID, authority.EndpointID, authority.NamespacePublicID, authority.ChannelID, authority.UserPublicID, authority.UserEmail, authority.CreatedAtUnixMs)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func scanExecutionAuthority(row rowScanner, authority *ExecutionAuthority) error {
	return row.Scan(&authority.RequestKey, &authority.ThreadID, &authority.TurnID, &authority.EndpointID, &authority.NamespacePublicID, &authority.ChannelID, &authority.UserPublicID, &authority.UserEmail, &authority.CreatedAtUnixMs)
}

func (s *Store) GetExecutionAuthority(ctx context.Context, requestKey string) (*ExecutionAuthority, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	requestKey = strings.TrimSpace(requestKey)
	if requestKey == "" {
		return nil, errors.New("missing execution authority request key")
	}
	var authority ExecutionAuthority
	err := scanExecutionAuthority(s.db.QueryRowContext(ctxOrBackground(ctx), `SELECT request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms FROM ai_flower_execution_authority WHERE request_key = ?`, requestKey), &authority)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &authority, err
}

func (s *Store) GetExecutionAuthorityByTurn(ctx context.Context, threadID, turnID string) (*ExecutionAuthority, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	threadID, turnID = strings.TrimSpace(threadID), strings.TrimSpace(turnID)
	if threadID == "" || turnID == "" {
		return nil, errors.New("execution authority turn identity is incomplete")
	}
	var authority ExecutionAuthority
	err := scanExecutionAuthority(s.db.QueryRowContext(ctxOrBackground(ctx), `SELECT request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms FROM ai_flower_execution_authority WHERE thread_id = ? AND turn_id = ? ORDER BY created_at_unix_ms DESC, request_key DESC LIMIT 1`, threadID, turnID), &authority)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &authority, err
}
