package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	FollowupLaneQueued = "queued"
	FollowupLaneDraft  = "draft"
)

var ErrFollowupsRevisionChanged = errors.New("followups revision changed")
var ErrInvalidFollowupOrder = errors.New("invalid followup order")

func normalizeFollowupLane(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case FollowupLaneDraft:
		return FollowupLaneDraft
	default:
		return FollowupLaneQueued
	}
}

func scanFollowup(scanner interface{ Scan(...any) error }) (QueuedTurn, error) {
	var rec QueuedTurn
	err := scanner.Scan(
		&rec.QueueID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.ChannelID,
		&rec.Lane,
		&rec.MessageID,
		&rec.ModelID,
		&rec.TextContent,
		&rec.AttachmentsJSON,
		&rec.OptionsJSON,
		&rec.SessionMetaJSON,
		&rec.CreatedByUserPublicID,
		&rec.CreatedByUserEmail,
		&rec.SortIndex,
		&rec.CreatedAtUnixMs,
		&rec.UpdatedAtUnixMs,
	)
	if err != nil {
		return QueuedTurn{}, err
	}
	rec.Lane = normalizeFollowupLane(rec.Lane)
	return rec, nil
}

func getThreadFollowupsRevisionTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (int64, error) {
	var revision int64
	err := tx.QueryRowContext(ctx, `
SELECT followups_revision
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&revision)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, sql.ErrNoRows
		}
		return 0, err
	}
	return revision, nil
}

func bumpThreadFollowupsRevisionTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (int64, error) {
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET followups_revision = followups_revision + 1
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID); err != nil {
		return 0, err
	}
	return getThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
}

func getNextFollowupSortIndexTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, lane string) (int64, error) {
	lane = normalizeFollowupLane(lane)
	var next int64
	err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(sort_index), 0) + 1
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
`, endpointID, threadID, lane).Scan(&next)
	if err != nil {
		return 0, err
	}
	if next <= 0 {
		next = 1
	}
	return next, nil
}

func followupPositionTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, lane string, queueID string, sortIndex int64) (int, error) {
	lane = normalizeFollowupLane(lane)
	var count int
	err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
  AND (sort_index < ? OR (sort_index = ? AND queue_id <= ?))
`, endpointID, threadID, lane, sortIndex, sortIndex, queueID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func listFollowupsByLaneTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, lane string, limit int) ([]QueuedTurn, error) {
	lane = normalizeFollowupLane(lane)
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := tx.QueryContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, message_id, model_id, text_content, attachments_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
ORDER BY sort_index ASC, queue_id ASC
LIMIT ?
`, endpointID, threadID, lane, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]QueuedTurn, 0)
	for rows.Next() {
		rec, err := scanFollowup(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func getFollowupByLaneAndMessageIDTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, lane string, messageID string) (QueuedTurn, error) {
	lane = normalizeFollowupLane(lane)
	row := tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, message_id, model_id, text_content, attachments_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ? AND message_id = ?
`, endpointID, threadID, lane, messageID)
	return scanFollowup(row)
}

func (s *Store) GetThreadFollowupsRevision(ctx context.Context, endpointID string, threadID string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return 0, errors.New("invalid request")
	}
	var revision int64
	err := s.db.QueryRowContext(ctx, `
SELECT followups_revision
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&revision)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, sql.ErrNoRows
		}
		return 0, err
	}
	return revision, nil
}

func (s *Store) CreateFollowup(ctx context.Context, rec QueuedTurn) (QueuedTurn, int, int64, error) {
	if s == nil || s.db == nil {
		return QueuedTurn{}, 0, 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.QueueID = strings.TrimSpace(rec.QueueID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.ChannelID = strings.TrimSpace(rec.ChannelID)
	rec.Lane = normalizeFollowupLane(rec.Lane)
	rec.MessageID = strings.TrimSpace(rec.MessageID)
	rec.ModelID = strings.TrimSpace(rec.ModelID)
	rec.TextContent = strings.TrimSpace(rec.TextContent)
	rec.AttachmentsJSON = strings.TrimSpace(rec.AttachmentsJSON)
	rec.OptionsJSON = strings.TrimSpace(rec.OptionsJSON)
	rec.SessionMetaJSON = strings.TrimSpace(rec.SessionMetaJSON)
	rec.CreatedByUserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	rec.CreatedByUserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	if rec.QueueID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.ChannelID == "" || rec.MessageID == "" {
		return QueuedTurn{}, 0, 0, errors.New("invalid request")
	}
	if rec.AttachmentsJSON == "" {
		rec.AttachmentsJSON = "[]"
	}
	if rec.OptionsJSON == "" {
		rec.OptionsJSON = "{}"
	}
	if rec.SessionMetaJSON == "" {
		rec.SessionMetaJSON = "{}"
	}
	now := time.Now().UnixMilli()
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	queued, position, revision, err := createFollowupTx(ctx, tx, rec)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	return queued, position, revision, nil
}

func createFollowupTx(ctx context.Context, tx *sql.Tx, rec QueuedTurn) (QueuedTurn, int, int64, error) {
	if _, err := getThreadFollowupsRevisionTx(ctx, tx, rec.EndpointID, rec.ThreadID); err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	if rec.SortIndex <= 0 {
		nextSort, err := getNextFollowupSortIndexTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.Lane)
		if err != nil {
			return QueuedTurn{}, 0, 0, err
		}
		rec.SortIndex = nextSort
	}

	_, err := tx.ExecContext(ctx, `
INSERT INTO ai_queued_turns(
  queue_id, endpoint_id, thread_id, channel_id, lane, sort_index, message_id, model_id, text_content, attachments_json, options_json, session_meta_json,
  created_by_user_public_id, created_by_user_email, created_at_unix_ms, updated_at_unix_ms
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.QueueID, rec.EndpointID, rec.ThreadID, rec.ChannelID, rec.Lane, rec.SortIndex, rec.MessageID, rec.ModelID, rec.TextContent, rec.AttachmentsJSON, rec.OptionsJSON, rec.SessionMetaJSON,
		rec.CreatedByUserPublicID, rec.CreatedByUserEmail, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err != nil {
		if !isUniqueConstraintError(err) {
			return QueuedTurn{}, 0, 0, err
		}
		existing, getErr := getFollowupByLaneAndMessageIDTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.Lane, rec.MessageID)
		if getErr != nil {
			return QueuedTurn{}, 0, 0, err
		}
		position, posErr := followupPositionTx(ctx, tx, rec.EndpointID, rec.ThreadID, existing.Lane, existing.QueueID, existing.SortIndex)
		if posErr != nil {
			return QueuedTurn{}, 0, 0, posErr
		}
		revision, revErr := getThreadFollowupsRevisionTx(ctx, tx, rec.EndpointID, rec.ThreadID)
		if revErr != nil {
			return QueuedTurn{}, 0, 0, revErr
		}
		return existing, position, revision, nil
	}

	position, err := followupPositionTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.Lane, rec.QueueID, rec.SortIndex)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, rec.EndpointID, rec.ThreadID)
	if err != nil {
		return QueuedTurn{}, 0, 0, err
	}
	return rec, position, revision, nil
}

func (s *Store) CountFollowupsByLane(ctx context.Context, endpointID string, threadID string, lane string) (int, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	lane = normalizeFollowupLane(lane)
	if endpointID == "" || threadID == "" {
		return 0, errors.New("invalid request")
	}
	var count int
	err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
`, endpointID, threadID, lane).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) CountFollowupsByThreadAndLane(ctx context.Context, endpointID string, threadIDs []string, lane string) (map[string]int, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	lane = normalizeFollowupLane(lane)
	if endpointID == "" {
		return nil, errors.New("invalid request")
	}
	out := make(map[string]int, len(threadIDs))
	cleanIDs := make([]string, 0, len(threadIDs))
	seen := make(map[string]struct{}, len(threadIDs))
	for _, raw := range threadIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		cleanIDs = append(cleanIDs, id)
		out[id] = 0
	}
	if len(cleanIDs) == 0 {
		return out, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(cleanIDs)), ",")
	args := make([]any, 0, len(cleanIDs)+2)
	args = append(args, endpointID, lane)
	for _, id := range cleanIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT thread_id, COUNT(1)
FROM ai_queued_turns
WHERE endpoint_id = ? AND lane = ? AND thread_id IN (`+placeholders+`)
GROUP BY thread_id
`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var threadID string
		var count int
		if err := rows.Scan(&threadID, &count); err != nil {
			return nil, err
		}
		out[strings.TrimSpace(threadID)] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListFollowupsByLane(ctx context.Context, endpointID string, threadID string, lane string, limit int) ([]QueuedTurn, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	lane = normalizeFollowupLane(lane)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, message_id, model_id, text_content, attachments_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND lane = ?
ORDER BY sort_index ASC, queue_id ASC
LIMIT ?
`, endpointID, threadID, lane, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]QueuedTurn, 0)
	for rows.Next() {
		rec, err := scanFollowup(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) UpdateFollowupText(ctx context.Context, endpointID string, threadID string, followupID string, textContent string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	followupID = strings.TrimSpace(followupID)
	textContent = strings.TrimSpace(textContent)
	if endpointID == "" || threadID == "" || followupID == "" || textContent == "" {
		return 0, errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UnixMilli()
	res, err := tx.ExecContext(ctx, `
UPDATE ai_queued_turns
SET text_content = ?, updated_at_unix_ms = ?
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, textContent, now, endpointID, threadID, followupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, sql.ErrNoRows
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return revision, nil
}

func (s *Store) DeleteFollowup(ctx context.Context, endpointID string, threadID string, followupID string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	followupID = strings.TrimSpace(followupID)
	if endpointID == "" || threadID == "" || followupID == "" {
		return 0, errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, endpointID, threadID, followupID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, sql.ErrNoRows
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return revision, nil
}

func (s *Store) ReorderFollowups(ctx context.Context, endpointID string, threadID string, lane string, orderedIDs []string, expectedRevision int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	lane = normalizeFollowupLane(lane)
	if endpointID == "" || threadID == "" {
		return 0, errors.New("invalid request")
	}
	normalizedIDs := make([]string, 0, len(orderedIDs))
	seen := map[string]struct{}{}
	for _, raw := range orderedIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			return 0, ErrInvalidFollowupOrder
		}
		if _, ok := seen[id]; ok {
			return 0, ErrInvalidFollowupOrder
		}
		seen[id] = struct{}{}
		normalizedIDs = append(normalizedIDs, id)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	currentRevision, err := getThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return 0, err
	}
	if expectedRevision > 0 && currentRevision != expectedRevision {
		return 0, ErrFollowupsRevisionChanged
	}
	current, err := listFollowupsByLaneTx(ctx, tx, endpointID, threadID, lane, 500)
	if err != nil {
		return 0, err
	}
	if len(current) != len(normalizedIDs) {
		return 0, ErrInvalidFollowupOrder
	}
	currentSet := make(map[string]struct{}, len(current))
	for _, rec := range current {
		currentSet[strings.TrimSpace(rec.QueueID)] = struct{}{}
	}
	for _, id := range normalizedIDs {
		if _, ok := currentSet[id]; !ok {
			return 0, ErrInvalidFollowupOrder
		}
	}
	now := time.Now().UnixMilli()
	for i, id := range normalizedIDs {
		if _, err := tx.ExecContext(ctx, `
UPDATE ai_queued_turns
SET sort_index = ?, updated_at_unix_ms = ?
WHERE endpoint_id = ? AND thread_id = ? AND lane = ? AND queue_id = ?
`, i+1, now, endpointID, threadID, lane, id); err != nil {
			return 0, err
		}
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return revision, nil
}

func (s *Store) RecoverQueuedTurnsToDrafts(ctx context.Context, endpointID string, threadID string) ([]QueuedTurn, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, 0, errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := getThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID); err != nil {
		return nil, 0, err
	}
	queued, err := listFollowupsByLaneTx(ctx, tx, endpointID, threadID, FollowupLaneQueued, 500)
	if err != nil {
		return nil, 0, err
	}
	if len(queued) == 0 {
		revision, err := getThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
		if err != nil {
			return nil, 0, err
		}
		if err := tx.Commit(); err != nil {
			return nil, 0, err
		}
		return nil, revision, nil
	}
	nextDraftSort, err := getNextFollowupSortIndexTx(ctx, tx, endpointID, threadID, FollowupLaneDraft)
	if err != nil {
		return nil, 0, err
	}
	now := time.Now().UnixMilli()
	recovered := make([]QueuedTurn, 0, len(queued))
	for i, rec := range queued {
		nextSort := nextDraftSort + int64(i)
		if _, err := tx.ExecContext(ctx, `
UPDATE ai_queued_turns
SET lane = ?, sort_index = ?, updated_at_unix_ms = ?
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, FollowupLaneDraft, nextSort, now, endpointID, threadID, rec.QueueID); err != nil {
			return nil, 0, err
		}
		rec.Lane = FollowupLaneDraft
		rec.SortIndex = nextSort
		rec.UpdatedAtUnixMs = now
		recovered = append(recovered, rec)
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return recovered, revision, nil
}
