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

type ExecutionAuthorityCursor struct {
	ThreadID   string
	RequestKey string
}

func (s *Store) PutExecutionAuthority(ctx context.Context, authority ExecutionAuthority) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := putExecutionAuthorityTx(ctx, tx, authority); err != nil {
		return err
	}
	return tx.Commit()
}

func putExecutionAuthorityTx(ctx context.Context, tx *sql.Tx, authority ExecutionAuthority) error {
	if tx == nil {
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
	var existing ExecutionAuthority
	err := tx.QueryRowContext(ctx, `SELECT request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms FROM ai_flower_execution_authority WHERE request_key = ?`, authority.RequestKey).Scan(
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
		return nil
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_flower_execution_authority(request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id, user_public_id, user_email, created_at_unix_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, authority.RequestKey, authority.ThreadID, authority.TurnID, authority.EndpointID, authority.NamespacePublicID, authority.ChannelID, authority.UserPublicID, authority.UserEmail, authority.CreatedAtUnixMs)
	if err != nil {
		return err
	}
	return nil
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

func (s *Store) ListExecutionAuthoritiesPage(ctx context.Context, cursor ExecutionAuthorityCursor, limit int) ([]ExecutionAuthority, ExecutionAuthorityCursor, bool, error) {
	if s == nil || s.db == nil {
		return nil, cursor, false, errors.New("store not initialized")
	}
	if limit <= 0 || limit > 500 {
		return nil, cursor, false, errors.New("invalid execution authority page size")
	}
	rows, err := s.db.QueryContext(ctxOrBackground(ctx), `
SELECT request_key, thread_id, turn_id, endpoint_id, namespace_public_id, channel_id,
       user_public_id, user_email, created_at_unix_ms
FROM ai_flower_execution_authority
WHERE thread_id > ? OR (thread_id = ? AND request_key > ?)
ORDER BY thread_id, request_key
LIMIT ?
`, cursor.ThreadID, cursor.ThreadID, cursor.RequestKey, limit)
	if err != nil {
		return nil, cursor, false, err
	}
	defer rows.Close()
	authorities := make([]ExecutionAuthority, 0, limit)
	for rows.Next() {
		var authority ExecutionAuthority
		if err := scanExecutionAuthority(rows, &authority); err != nil {
			return nil, cursor, false, err
		}
		authorities = append(authorities, authority)
	}
	if err := rows.Err(); err != nil {
		return nil, cursor, false, err
	}
	complete := len(authorities) < limit
	if len(authorities) == 0 || complete {
		return authorities, ExecutionAuthorityCursor{}, true, nil
	}
	last := authorities[len(authorities)-1]
	return authorities, ExecutionAuthorityCursor{ThreadID: last.ThreadID, RequestKey: last.RequestKey}, false, nil
}

func (s *Store) DeleteExecutionAuthorities(ctx context.Context, requestKeys []string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	requestKeys = dedupeNonEmptyStrings(requestKeys)
	if len(requestKeys) == 0 {
		return 0, nil
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	var removed int64
	for _, requestKey := range requestKeys {
		result, err := tx.ExecContext(ctx, `DELETE FROM ai_flower_execution_authority WHERE request_key = ?`, requestKey)
		if err != nil {
			return removed, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return removed, err
		}
		removed += count
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return removed, nil
}
