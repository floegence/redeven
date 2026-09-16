package threadstore

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
)

var ErrPinPositionConflict = errors.New("pinned conversations changed; refresh the list and try again")

// ThreadPinMetadata is a product mutation result, never a canonical thread view.
type ThreadPinMetadata struct {
	ThreadID         string `json:"thread_id"`
	PinnedAtUnixMs   int64  `json:"pinned_at_unix_ms"`
	PinRank          int64  `json:"pin_rank"`
	SettingsRevision int64  `json:"settings_revision"`
}

func pinMetadata(settings ThreadSettings) ThreadPinMetadata {
	return ThreadPinMetadata{ThreadID: settings.ThreadID, PinnedAtUnixMs: settings.PinnedAtUnixMs, PinRank: settings.PinRank, SettingsRevision: settings.SettingsUpdatedAtUnixMs}
}

func (s *Store) SetThreadPinned(ctx context.Context, endpointID, threadID string, pinned bool) (*ThreadPinMetadata, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	ctx = ctxOrBackground(ctx)
	endpointID, threadID = strings.TrimSpace(endpointID), strings.TrimSpace(threadID)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var settings ThreadSettings
	if err := tx.QueryRowContext(ctx, `SELECT thread_id, pinned_at_unix_ms, pin_rank, settings_updated_at_unix_ms FROM ai_thread_settings WHERE endpoint_id = ? AND thread_id = ? AND parent_thread_id = ''`, endpointID, threadID).Scan(&settings.ThreadID, &settings.PinnedAtUnixMs, &settings.PinRank, &settings.SettingsUpdatedAtUnixMs); err != nil {
		return nil, err
	}
	if (settings.PinnedAtUnixMs > 0) != pinned {
		settings.PinnedAtUnixMs, settings.PinRank = 0, 0
		if pinned {
			settings.PinnedAtUnixMs = time.Now().UnixMilli()
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(pin_rank), 0) + 1 FROM ai_thread_settings WHERE endpoint_id = ?`, endpointID).Scan(&settings.PinRank); err != nil {
				return nil, err
			}
		}
		revision, err := nextThreadSettingsRevisionTx(ctx, tx, endpointID, threadID)
		if err != nil {
			return nil, err
		}
		settings.SettingsUpdatedAtUnixMs = revision
		if _, err := tx.ExecContext(ctx, `UPDATE ai_thread_settings SET pinned_at_unix_ms = ?, pin_rank = ?, settings_updated_at_unix_ms = ? WHERE endpoint_id = ? AND thread_id = ?`, settings.PinnedAtUnixMs, settings.PinRank, revision, endpointID, threadID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := pinMetadata(settings)
	return &result, nil
}

// MovePinnedThread applies one relative move to the complete current endpoint
// order. Immediate SQLite transactions serialize it with pin, unpin and deletion.
func (s *Store) MovePinnedThread(ctx context.Context, endpointID, threadID, anchorID, placement string) ([]ThreadPinMetadata, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	ctx = ctxOrBackground(ctx)
	endpointID, threadID, anchorID = strings.TrimSpace(endpointID), strings.TrimSpace(threadID), strings.TrimSpace(anchorID)
	if endpointID == "" || threadID == "" || anchorID == "" || threadID == anchorID || (placement != "before" && placement != "after") {
		return nil, errors.New("invalid pinned conversation position")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	// Resolve both identities inside the same write transaction, without
	// revealing whether a conversation belongs to another endpoint.
	for _, id := range []string{threadID, anchorID} {
		if err := requireThreadWritableTx(ctx, tx, endpointID, id); err != nil {
			return nil, err
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT thread_id, pinned_at_unix_ms, pin_rank, settings_updated_at_unix_ms FROM ai_thread_settings WHERE endpoint_id = ? AND parent_thread_id = '' AND pinned_at_unix_ms > 0 ORDER BY pin_rank DESC, settings_created_at_unix_ms DESC, thread_id ASC`, endpointID)
	if err != nil {
		return nil, err
	}
	var ordered []ThreadSettings
	for rows.Next() {
		var item ThreadSettings
		if err := rows.Scan(&item.ThreadID, &item.PinnedAtUnixMs, &item.PinRank, &item.SettingsUpdatedAtUnixMs); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ordered = append(ordered, item)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	source := slices.IndexFunc(ordered, func(item ThreadSettings) bool { return item.ThreadID == threadID })
	anchor := slices.IndexFunc(ordered, func(item ThreadSettings) bool { return item.ThreadID == anchorID })
	if source < 0 || anchor < 0 {
		return nil, ErrPinPositionConflict
	}
	moved := ordered[source]
	ordered = slices.Delete(ordered, source, source+1)
	anchor = slices.IndexFunc(ordered, func(item ThreadSettings) bool { return item.ThreadID == anchorID })
	if placement == "after" {
		anchor++
	}
	ordered = slices.Insert(ordered, anchor, moved)
	changes := make([]ThreadPinMetadata, 0)
	for index, item := range ordered {
		rank := int64(len(ordered) - index)
		if item.PinRank == rank {
			continue
		}
		revision, err := nextThreadSettingsRevisionTx(ctx, tx, endpointID, item.ThreadID)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_thread_settings SET pin_rank = ?, settings_updated_at_unix_ms = ? WHERE endpoint_id = ? AND thread_id = ?`, rank, revision, endpointID, item.ThreadID); err != nil {
			return nil, err
		}
		item.PinRank, item.SettingsUpdatedAtUnixMs = rank, revision
		changes = append(changes, pinMetadata(item))
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return changes, nil
}
