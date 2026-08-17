package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

func requireThreadWritableTx(ctx context.Context, tx *sql.Tx, endpointID, threadID string) error {
	if tx == nil {
		return errors.New("store not initialized")
	}
	var found int
	err := tx.QueryRowContext(ctxOrBackground(ctx), `SELECT 1 FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, strings.TrimSpace(endpointID), strings.TrimSpace(threadID)).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	return err
}

// RequireThreadSettingsWritable verifies product catalog ownership only.
// Floret owns thread lifecycle and deletion tombstones.
func (s *Store) RequireThreadSettingsWritable(ctx context.Context, endpointID, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid thread identity")
	}
	var found int
	err := s.db.QueryRowContext(ctxOrBackground(ctx), `SELECT 1 FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	return err
}

// RequireThreadDeleteAuthority accepts an active product thread or its
// endpoint-scoped deletion tombstone. A missing row is an ownership miss and
// must fail closed before the process-wide Floret runtime is touched.
func (s *Store) RequireThreadDeleteAuthority(ctx context.Context, endpointID, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid thread identity")
	}
	var found int
	err := s.db.QueryRowContext(ctxOrBackground(ctx), `SELECT 1 FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ? UNION ALL SELECT 1 FROM ai_thread_delete_authority WHERE endpoint_id = ? AND thread_id = ? LIMIT 1`, endpointID, threadID, endpointID, threadID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	return err
}

// DeleteThreadProductData removes only Redeven-owned catalog and attachment
// rows. The caller deletes the canonical Floret thread first.
func (s *Store) DeleteThreadProductData(ctx context.Context, endpointID, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid thread identity")
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := prepareUploadCleanupForThreadTx(ctxOrBackground(ctx), tx, endpointID, threadID, time.Now().UnixMilli()); err != nil {
		return err
	}
	if err := deleteThreadScopedRowsTx(ctxOrBackground(ctx), tx, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `INSERT INTO ai_thread_delete_authority(endpoint_id, thread_id, deleted_at_unix_ms) VALUES(?, ?, ?) ON CONFLICT(endpoint_id, thread_id) DO NOTHING`, endpointID, threadID, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}
