package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrCanonicalThreadSettingsConflict = errors.New("canonical thread settings conflict")

func (s *Store) ListPendingCanonicalRootOwnershipClaims(ctx context.Context) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	rows, err := s.db.QueryContext(operationContext(ctx), `
SELECT canonical_thread_id
FROM ai_thread_create_operations
WHERE canonical_thread_id <> '' AND stage NOT IN (?, ?)
UNION
SELECT destination_thread_id
FROM ai_thread_fork_operations
WHERE destination_thread_id <> '' AND stage NOT IN (?, ?)
ORDER BY 1
`, ThreadCreateStageCompleted, ThreadCreateStageFailed, string(ForkStageCompleted), string(ForkStageFailed))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var claims []string
	for rows.Next() {
		var threadID string
		if err := rows.Scan(&threadID); err != nil {
			return nil, err
		}
		threadID = strings.TrimSpace(threadID)
		if threadID == "" {
			return nil, errors.New("pending canonical root ownership claim has an empty thread id")
		}
		claims = append(claims, threadID)
	}
	return claims, rows.Err()
}

func (s *Store) GetThreadSettingsByCanonicalThreadID(ctx context.Context, threadID string) (*ThreadSettings, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing canonical thread id")
	}
	var settings ThreadSettings
	err := scanThreadRow(s.db.QueryRowContext(operationContext(ctx), fmt.Sprintf(`SELECT %s FROM ai_thread_settings WHERE thread_id = ? ORDER BY endpoint_id LIMIT 1`, threadSelectColumnsSQL), threadID), &settings)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &settings, err
}

func (s *Store) AdoptCanonicalRootSettings(ctx context.Context, settings ThreadSettings) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	ctx = operationContext(ctx)
	settings.ThreadID = strings.TrimSpace(settings.ThreadID)
	settings.EndpointID = strings.TrimSpace(settings.EndpointID)
	settings.NamespacePublicID = strings.TrimSpace(settings.NamespacePublicID)
	settings.ModelID = strings.TrimSpace(settings.ModelID)
	settings.PermissionType = strings.TrimSpace(settings.PermissionType)
	settings.WorkingDir = strings.TrimSpace(settings.WorkingDir)
	settings.CreatedByUserPublicID = strings.TrimSpace(settings.CreatedByUserPublicID)
	settings.CreatedByUserEmail = strings.TrimSpace(settings.CreatedByUserEmail)
	settings.UpdatedByUserPublicID = strings.TrimSpace(settings.UpdatedByUserPublicID)
	settings.UpdatedByUserEmail = strings.TrimSpace(settings.UpdatedByUserEmail)
	permissionType, err := canonicalPermissionType(settings.PermissionType)
	if err != nil {
		return err
	}
	settings.PermissionType = permissionType
	if settings.ThreadID == "" || settings.EndpointID == "" || settings.NamespacePublicID == "" || settings.ModelID == "" || settings.WorkingDir == "" || settings.CreatedByUserPublicID == "" {
		return errors.New("canonical root adoption settings are incomplete")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var existing ThreadSettings
	err = scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_thread_settings WHERE thread_id = ? ORDER BY endpoint_id LIMIT 1`, threadSelectColumnsSQL), settings.ThreadID), &existing)
	switch {
	case err == nil:
		if existing.ThreadID == settings.ThreadID && existing.EndpointID == settings.EndpointID && existing.NamespacePublicID == settings.NamespacePublicID &&
			existing.ModelID == settings.ModelID && existing.PermissionType == settings.PermissionType && existing.WorkingDir == settings.WorkingDir {
			return tx.Commit()
		}
		return ErrCanonicalThreadSettingsConflict
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	now := time.Now().UnixMilli()
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_thread_settings(
		thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir,
		pinned_at_unix_ms, queue_revision, created_by_user_public_id, created_by_user_email,
		updated_by_user_public_id, updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms
	) VALUES(?, ?, ?, ?, '', ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`, settings.ThreadID, settings.EndpointID,
		settings.NamespacePublicID, settings.ModelID, settings.PermissionType, settings.WorkingDir,
		settings.CreatedByUserPublicID, settings.CreatedByUserEmail, settings.UpdatedByUserPublicID,
		settings.UpdatedByUserEmail, now, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}
