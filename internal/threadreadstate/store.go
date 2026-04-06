package threadreadstate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

type Surface string

const (
	SurfaceFlower Surface = "flower"
	SurfaceCodex  Surface = "codex"
)

type Store struct {
	db *sql.DB
}

type Record struct {
	EndpointID                string  `json:"endpoint_id"`
	UserPublicID              string  `json:"user_public_id"`
	Surface                   Surface `json:"surface"`
	ThreadID                  string  `json:"thread_id"`
	LastReadMessageAtUnixMs   int64   `json:"last_read_message_at_unix_ms"`
	LastSeenWaitingPromptID   string  `json:"last_seen_waiting_prompt_id"`
	LastReadUpdatedAtUnixS    int64   `json:"last_read_updated_at_unix_s"`
	LastSeenActivitySignature string  `json:"last_seen_activity_signature"`
	UpdatedAtUnixMs           int64   `json:"updated_at_unix_ms"`
}

type FlowerSnapshot struct {
	LastMessageAtUnixMs int64
	WaitingPromptID     string
}

type CodexSnapshot struct {
	UpdatedAtUnixS    int64
	ActivitySignature string
}

func Open(path string) (*Store, error) {
	db, err := sqliteutil.Open(path, schemaSpec())
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) EnsureFlower(
	ctx context.Context,
	endpointID string,
	userPublicID string,
	snapshots map[string]FlowerSnapshot,
) (map[string]Record, error) {
	return s.ensure(ctx, endpointID, userPublicID, SurfaceFlower, snapshots, nil)
}

func (s *Store) EnsureCodex(
	ctx context.Context,
	endpointID string,
	userPublicID string,
	snapshots map[string]CodexSnapshot,
) (map[string]Record, error) {
	return s.ensure(ctx, endpointID, userPublicID, SurfaceCodex, nil, snapshots)
}

func (s *Store) AdvanceFlower(
	ctx context.Context,
	endpointID string,
	userPublicID string,
	threadID string,
	snapshot FlowerSnapshot,
) (Record, error) {
	record, err := s.advance(ctx, recordKey{
		EndpointID:   endpointID,
		UserPublicID: userPublicID,
		Surface:      SurfaceFlower,
		ThreadID:     threadID,
	}, snapshot, CodexSnapshot{})
	if err != nil {
		return Record{}, err
	}
	return record, nil
}

func (s *Store) AdvanceCodex(
	ctx context.Context,
	endpointID string,
	userPublicID string,
	threadID string,
	snapshot CodexSnapshot,
) (Record, error) {
	record, err := s.advance(ctx, recordKey{
		EndpointID:   endpointID,
		UserPublicID: userPublicID,
		Surface:      SurfaceCodex,
		ThreadID:     threadID,
	}, FlowerSnapshot{}, snapshot)
	if err != nil {
		return Record{}, err
	}
	return record, nil
}

func (s *Store) DeleteThread(
	ctx context.Context,
	endpointID string,
	surface Surface,
	threadID string,
) ([]Record, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("thread read state store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	scope, err := normalizeThreadScope(threadScopeKey{
		EndpointID: endpointID,
		Surface:    surface,
		ThreadID:   threadID,
	})
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	records, err := loadThreadScopeRecordsTx(ctx, tx, scope)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM thread_read_state
WHERE endpoint_id = ? AND surface = ? AND thread_id = ?
`, scope.EndpointID, string(scope.Surface), scope.ThreadID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return records, nil
}

func (s *Store) RestoreRecords(ctx context.Context, records []Record) error {
	if s == nil || s.db == nil {
		return errors.New("thread read state store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if len(records) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, record := range records {
		record, err = normalizeRecord(record)
		if err != nil {
			return err
		}
		if err := upsertRecordTx(ctx, tx, record); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type recordKey struct {
	EndpointID   string
	UserPublicID string
	Surface      Surface
	ThreadID     string
}

type threadScopeKey struct {
	EndpointID string
	Surface    Surface
	ThreadID   string
}

func (s *Store) ensure(
	ctx context.Context,
	endpointID string,
	userPublicID string,
	surface Surface,
	flowerSnapshots map[string]FlowerSnapshot,
	codexSnapshots map[string]CodexSnapshot,
) (map[string]Record, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("thread read state store not initialized")
	}
	key, err := normalizeScope(endpointID, userPublicID, surface)
	if err != nil {
		return nil, err
	}

	threadIDs := make([]string, 0, max(len(flowerSnapshots), len(codexSnapshots)))
	if surface == SurfaceFlower {
		for threadID := range flowerSnapshots {
			threadID = normalizeThreadID(threadID)
			if threadID == "" {
				continue
			}
			threadIDs = append(threadIDs, threadID)
		}
	} else {
		for threadID := range codexSnapshots {
			threadID = normalizeThreadID(threadID)
			if threadID == "" {
				continue
			}
			threadIDs = append(threadIDs, threadID)
		}
	}
	if len(threadIDs) == 0 {
		return map[string]Record{}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	out, err := loadRecordsByThreadTx(ctx, tx, key, threadIDs)
	if err != nil {
		return nil, err
	}

	nowUnixMs := time.Now().UnixMilli()
	for _, threadID := range threadIDs {
		if _, ok := out[threadID]; ok {
			continue
		}
		record := Record{
			EndpointID:      key.EndpointID,
			UserPublicID:    key.UserPublicID,
			Surface:         key.Surface,
			ThreadID:        threadID,
			UpdatedAtUnixMs: nowUnixMs,
		}
		if surface == SurfaceFlower {
			record = applyFlowerSeed(record, flowerSnapshots[threadID])
		} else {
			record = applyCodexSeed(record, codexSnapshots[threadID])
		}
		if err := upsertRecordTx(ctx, tx, record); err != nil {
			return nil, err
		}
		out[threadID] = record
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) advance(
	ctx context.Context,
	key recordKey,
	flowerSnapshot FlowerSnapshot,
	codexSnapshot CodexSnapshot,
) (Record, error) {
	if s == nil || s.db == nil {
		return Record{}, errors.New("thread read state store not initialized")
	}
	key, err := normalizeKey(key)
	if err != nil {
		return Record{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer func() { _ = tx.Rollback() }()

	current, err := loadRecordTx(ctx, tx, key)
	if err != nil {
		return Record{}, err
	}
	if current == nil {
		current = &Record{
			EndpointID:   key.EndpointID,
			UserPublicID: key.UserPublicID,
			Surface:      key.Surface,
			ThreadID:     key.ThreadID,
		}
	}

	next := *current
	next.UpdatedAtUnixMs = time.Now().UnixMilli()
	switch key.Surface {
	case SurfaceFlower:
		next = applyFlowerAdvance(next, flowerSnapshot)
	case SurfaceCodex:
		next = applyCodexAdvance(next, codexSnapshot)
	default:
		return Record{}, fmt.Errorf("unsupported surface %q", key.Surface)
	}
	if err := upsertRecordTx(ctx, tx, next); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return next, nil
}

func loadRecordTx(ctx context.Context, tx *sql.Tx, key recordKey) (*Record, error) {
	row := tx.QueryRowContext(ctx, `
SELECT endpoint_id, user_public_id, surface, thread_id,
       last_read_message_at_unix_ms, last_seen_waiting_prompt_id,
       last_read_updated_at_unix_s, last_seen_activity_signature,
       updated_at_unix_ms
FROM thread_read_state
WHERE endpoint_id = ? AND user_public_id = ? AND surface = ? AND thread_id = ?
`,
		key.EndpointID,
		key.UserPublicID,
		string(key.Surface),
		key.ThreadID,
	)
	record, err := scanRecord(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &record, nil
}

func loadRecordsByThreadTx(ctx context.Context, tx *sql.Tx, key recordKey, threadIDs []string) (map[string]Record, error) {
	placeholders := make([]string, 0, len(threadIDs))
	args := make([]any, 0, 3+len(threadIDs))
	args = append(args, key.EndpointID, key.UserPublicID, string(key.Surface))
	for _, threadID := range threadIDs {
		placeholders = append(placeholders, "?")
		args = append(args, threadID)
	}

	query := `
SELECT endpoint_id, user_public_id, surface, thread_id,
       last_read_message_at_unix_ms, last_seen_waiting_prompt_id,
       last_read_updated_at_unix_s, last_seen_activity_signature,
       updated_at_unix_ms
FROM thread_read_state
WHERE endpoint_id = ? AND user_public_id = ? AND surface = ? AND thread_id IN (` + strings.Join(placeholders, ",") + `)
`

	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]Record, len(threadIDs))
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out[record.ThreadID] = record
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func loadThreadScopeRecordsTx(ctx context.Context, tx *sql.Tx, scope threadScopeKey) ([]Record, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, user_public_id, surface, thread_id,
       last_read_message_at_unix_ms, last_seen_waiting_prompt_id,
       last_read_updated_at_unix_s, last_seen_activity_signature,
       updated_at_unix_ms
FROM thread_read_state
WHERE endpoint_id = ? AND surface = ? AND thread_id = ?
ORDER BY user_public_id ASC
`, scope.EndpointID, string(scope.Surface), scope.ThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Record, 0)
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func upsertRecordTx(ctx context.Context, tx *sql.Tx, record Record) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO thread_read_state (
  endpoint_id,
  user_public_id,
  surface,
  thread_id,
  last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id,
  last_read_updated_at_unix_s,
  last_seen_activity_signature,
  updated_at_unix_ms
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, user_public_id, surface, thread_id) DO UPDATE SET
  last_read_message_at_unix_ms = excluded.last_read_message_at_unix_ms,
  last_seen_waiting_prompt_id = excluded.last_seen_waiting_prompt_id,
  last_read_updated_at_unix_s = excluded.last_read_updated_at_unix_s,
  last_seen_activity_signature = excluded.last_seen_activity_signature,
  updated_at_unix_ms = excluded.updated_at_unix_ms
`,
		record.EndpointID,
		record.UserPublicID,
		string(record.Surface),
		record.ThreadID,
		record.LastReadMessageAtUnixMs,
		record.LastSeenWaitingPromptID,
		record.LastReadUpdatedAtUnixS,
		record.LastSeenActivitySignature,
		record.UpdatedAtUnixMs,
	)
	return err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecord(scan rowScanner) (Record, error) {
	var surface string
	var record Record
	if err := scan.Scan(
		&record.EndpointID,
		&record.UserPublicID,
		&surface,
		&record.ThreadID,
		&record.LastReadMessageAtUnixMs,
		&record.LastSeenWaitingPromptID,
		&record.LastReadUpdatedAtUnixS,
		&record.LastSeenActivitySignature,
		&record.UpdatedAtUnixMs,
	); err != nil {
		return Record{}, err
	}
	record.Surface = Surface(strings.TrimSpace(surface))
	record.EndpointID = strings.TrimSpace(record.EndpointID)
	record.UserPublicID = strings.TrimSpace(record.UserPublicID)
	record.ThreadID = strings.TrimSpace(record.ThreadID)
	record.LastSeenWaitingPromptID = strings.TrimSpace(record.LastSeenWaitingPromptID)
	record.LastSeenActivitySignature = strings.TrimSpace(record.LastSeenActivitySignature)
	return record, nil
}

func normalizeScope(endpointID string, userPublicID string, surface Surface) (recordKey, error) {
	key := recordKey{
		EndpointID:   endpointID,
		UserPublicID: userPublicID,
		Surface:      surface,
	}
	key.EndpointID = strings.TrimSpace(key.EndpointID)
	key.UserPublicID = strings.TrimSpace(key.UserPublicID)
	key.Surface = normalizeSurface(key.Surface)
	if key.EndpointID == "" {
		return recordKey{}, errors.New("missing endpoint_id")
	}
	if key.UserPublicID == "" {
		return recordKey{}, errors.New("missing user_public_id")
	}
	if key.Surface == "" {
		return recordKey{}, errors.New("missing surface")
	}
	return key, nil
}

func normalizeKey(key recordKey) (recordKey, error) {
	key.EndpointID = strings.TrimSpace(key.EndpointID)
	key.UserPublicID = strings.TrimSpace(key.UserPublicID)
	key.ThreadID = normalizeThreadID(key.ThreadID)
	key.Surface = normalizeSurface(key.Surface)
	if key.EndpointID == "" {
		return recordKey{}, errors.New("missing endpoint_id")
	}
	if key.UserPublicID == "" {
		return recordKey{}, errors.New("missing user_public_id")
	}
	if key.Surface == "" {
		return recordKey{}, errors.New("missing surface")
	}
	if key.ThreadID == "" {
		return recordKey{}, errors.New("missing thread_id")
	}
	return key, nil
}

func normalizeThreadScope(scope threadScopeKey) (threadScopeKey, error) {
	scope.EndpointID = strings.TrimSpace(scope.EndpointID)
	scope.Surface = normalizeSurface(scope.Surface)
	scope.ThreadID = normalizeThreadID(scope.ThreadID)
	if scope.EndpointID == "" {
		return threadScopeKey{}, errors.New("missing endpoint_id")
	}
	if scope.Surface == "" {
		return threadScopeKey{}, errors.New("missing surface")
	}
	if scope.ThreadID == "" {
		return threadScopeKey{}, errors.New("missing thread_id")
	}
	return scope, nil
}

func normalizeRecord(record Record) (Record, error) {
	key, err := normalizeKey(recordKey{
		EndpointID:   record.EndpointID,
		UserPublicID: record.UserPublicID,
		Surface:      record.Surface,
		ThreadID:     record.ThreadID,
	})
	if err != nil {
		return Record{}, err
	}
	record.EndpointID = key.EndpointID
	record.UserPublicID = key.UserPublicID
	record.Surface = key.Surface
	record.ThreadID = key.ThreadID
	record.LastSeenWaitingPromptID = strings.TrimSpace(record.LastSeenWaitingPromptID)
	record.LastSeenActivitySignature = strings.TrimSpace(record.LastSeenActivitySignature)
	return record, nil
}

func normalizeSurface(surface Surface) Surface {
	switch Surface(strings.ToLower(strings.TrimSpace(string(surface)))) {
	case SurfaceFlower:
		return SurfaceFlower
	case SurfaceCodex:
		return SurfaceCodex
	default:
		return ""
	}
}

func normalizeThreadID(threadID string) string {
	return strings.TrimSpace(threadID)
}

func normalizeFlowerSnapshot(snapshot FlowerSnapshot) FlowerSnapshot {
	return FlowerSnapshot{
		LastMessageAtUnixMs: maxInt64(0, snapshot.LastMessageAtUnixMs),
		WaitingPromptID:     strings.TrimSpace(snapshot.WaitingPromptID),
	}
}

func normalizeCodexSnapshot(snapshot CodexSnapshot) CodexSnapshot {
	return CodexSnapshot{
		UpdatedAtUnixS:    maxInt64(0, snapshot.UpdatedAtUnixS),
		ActivitySignature: strings.TrimSpace(snapshot.ActivitySignature),
	}
}

func applyFlowerSeed(record Record, snapshot FlowerSnapshot) Record {
	snapshot = normalizeFlowerSnapshot(snapshot)
	record.LastReadMessageAtUnixMs = snapshot.LastMessageAtUnixMs
	record.LastSeenWaitingPromptID = snapshot.WaitingPromptID
	return record
}

func applyCodexSeed(record Record, snapshot CodexSnapshot) Record {
	snapshot = normalizeCodexSnapshot(snapshot)
	record.LastReadUpdatedAtUnixS = snapshot.UpdatedAtUnixS
	record.LastSeenActivitySignature = snapshot.ActivitySignature
	return record
}

func applyFlowerAdvance(record Record, snapshot FlowerSnapshot) Record {
	snapshot = normalizeFlowerSnapshot(snapshot)
	record.LastReadMessageAtUnixMs = maxInt64(record.LastReadMessageAtUnixMs, snapshot.LastMessageAtUnixMs)
	if snapshot.WaitingPromptID != "" {
		record.LastSeenWaitingPromptID = snapshot.WaitingPromptID
	}
	return record
}

func applyCodexAdvance(record Record, snapshot CodexSnapshot) Record {
	snapshot = normalizeCodexSnapshot(snapshot)
	record.LastReadUpdatedAtUnixS = maxInt64(record.LastReadUpdatedAtUnixS, snapshot.UpdatedAtUnixS)
	if snapshot.ActivitySignature != "" {
		record.LastSeenActivitySignature = snapshot.ActivitySignature
	}
	return record
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
