package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// GetComputerTarget reads selection for an already authorized canonical thread.
// Selection is not an authorization grant and does not imply target readiness.
func (s *Store) GetComputerTarget(ctx context.Context, threadID string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("store not initialized")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return "", errors.New("missing canonical thread id")
	}
	var target string
	err := s.db.QueryRowContext(ctx, `SELECT computer_target_id FROM ai_thread_settings WHERE thread_id = ?`, threadID).Scan(&target)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errors.New("computer target thread not found")
	}
	return target, err
}

// SetComputerTarget changes only the selected target. It never creates thread
// settings, changes permissions or copies a parent's control session on fork.
func (s *Store) SetComputerTarget(ctx context.Context, threadID, targetID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	threadID, targetID = strings.TrimSpace(threadID), strings.TrimSpace(targetID)
	if threadID == "" || targetID == "" {
		return errors.New("thread and computer target are required")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ai_thread_settings SET computer_target_id = ? WHERE thread_id = ?`, targetID, threadID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("computer target thread not found")
	}
	return nil
}
