package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	// CheckpointKindPreRun captures the stable thread state before a run starts.
	CheckpointKindPreRun = "pre_run"
)

// ThreadCheckpointRecord is a persistence record for a single thread checkpoint.
//
// A checkpoint is created before a run starts (and before the user message is persisted) so the
// caller can rewind the thread to a consistent prior state (transcript + derived context planes).
type ThreadCheckpointRecord struct {
	CheckpointID string `json:"checkpoint_id"`
	EndpointID   string `json:"endpoint_id"`
	ThreadID     string `json:"thread_id"`
	RunID        string `json:"run_id"`
	Kind         string `json:"kind"`

	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`

	ThreadJSON    string `json:"thread_json"`
	DerivedJSON   string `json:"derived_json"`
	WorkspaceJSON string `json:"workspace_json"`

	TranscriptMaxID int64 `json:"transcript_max_id"`
	TurnsMaxID      int64 `json:"turns_max_id"`
	ToolCallsMaxID  int64 `json:"tool_calls_max_id"`
	RunEventsMaxID  int64 `json:"run_events_max_id"`
}

type threadCheckpointDerivedSnapshot struct {
	MemoryItems      []MemoryItemRecord      `json:"memory_items"`
	ThreadTodos      *ThreadTodosSnapshot    `json:"thread_todos,omitempty"`
	ThreadState      *ThreadState            `json:"thread_state,omitempty"`
	ContextSnapshots []ContextSnapshotRecord `json:"context_snapshots"`
	ExecutionSpans   []ExecutionSpanRecord   `json:"execution_spans"`
	RunIDs           []string                `json:"run_ids"`
}

func normalizeCheckpointKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" {
		return CheckpointKindPreRun
	}
	switch kind {
	case CheckpointKindPreRun:
		return kind
	default:
		return CheckpointKindPreRun
	}
}

func (s *Store) CreateThreadCheckpoint(ctx context.Context, endpointID string, threadID string, checkpointID string, runID string, kind string) (ThreadCheckpointRecord, error) {
	out := ThreadCheckpointRecord{}
	if s == nil || s.db == nil {
		return out, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	runID = strings.TrimSpace(runID)
	kind = normalizeCheckpointKind(kind)
	if endpointID == "" || threadID == "" || checkpointID == "" {
		return out, errors.New("invalid request")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer func() { _ = tx.Rollback() }()

	// Snapshot thread row.
	th, err := s.getThreadTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return out, err
	}
	if th == nil {
		return out, errors.New("thread not found")
	}
	threadJSONBytes, err := json.Marshal(th)
	if err != nil {
		return out, err
	}
	threadJSON := strings.TrimSpace(string(threadJSONBytes))
	if threadJSON == "" {
		threadJSON = "{}"
	}

	// Snapshot context planes (derived state).
	derived, err := s.snapshotThreadDerivedTx(ctx, tx, endpointID, threadID)
	if err != nil {
		return out, err
	}
	derivedJSONBytes, err := json.Marshal(derived)
	if err != nil {
		return out, err
	}
	derivedJSON := strings.TrimSpace(string(derivedJSONBytes))
	if derivedJSON == "" {
		derivedJSON = "{}"
	}

	transcriptMaxID, err := maxInt64Tx(ctx, tx, `SELECT COALESCE(MAX(id), 0) FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	turnsMaxID, err := maxInt64Tx(ctx, tx, `SELECT COALESCE(MAX(id), 0) FROM conversation_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	runEventsMaxID, err := maxInt64Tx(ctx, tx, `SELECT COALESCE(MAX(id), 0) FROM ai_run_events WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	toolCallsMaxID, err := maxInt64Tx(ctx, tx, `
SELECT COALESCE(MAX(tc.id), 0)
FROM ai_tool_calls tc
JOIN ai_runs r ON r.run_id = tc.run_id
WHERE r.endpoint_id = ? AND r.thread_id = ?
`, endpointID, threadID)
	if err != nil {
		return out, err
	}

	now := time.Now().UnixMilli()
	if now <= 0 {
		now = 1
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_checkpoints(
  checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
  thread_json, derived_json, workspace_json,
  transcript_max_id, turns_max_id, tool_calls_max_id, run_events_max_id
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, checkpointID, endpointID, threadID, runID, kind, now, threadJSON, derivedJSON, "", transcriptMaxID, turnsMaxID, toolCallsMaxID, runEventsMaxID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			// Idempotency: treat a duplicate checkpoint_id insert as success.
		} else {
			return out, err
		}
	}

	// Best-effort retention to avoid unbounded growth.
	_ = pruneThreadCheckpointsTx(ctx, tx, endpointID, threadID, 40)

	if err := tx.Commit(); err != nil {
		return out, err
	}

	out = ThreadCheckpointRecord{
		CheckpointID:    checkpointID,
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           runID,
		Kind:            kind,
		CreatedAtUnixMs: now,
		ThreadJSON:      threadJSON,
		DerivedJSON:     derivedJSON,
		WorkspaceJSON:   "",
		TranscriptMaxID: transcriptMaxID,
		TurnsMaxID:      turnsMaxID,
		ToolCallsMaxID:  toolCallsMaxID,
		RunEventsMaxID:  runEventsMaxID,
	}
	return out, nil
}

func (s *Store) GetLatestThreadCheckpoint(ctx context.Context, endpointID string, threadID string) (*ThreadCheckpointRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	var rec ThreadCheckpointRecord
	err := s.db.QueryRowContext(ctx, `
SELECT checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
       thread_json, derived_json, workspace_json,
       transcript_max_id, turns_max_id, tool_calls_max_id, run_events_max_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms DESC, checkpoint_id DESC
LIMIT 1
`, endpointID, threadID).Scan(
		&rec.CheckpointID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.RunID,
		&rec.Kind,
		&rec.CreatedAtUnixMs,
		&rec.ThreadJSON,
		&rec.DerivedJSON,
		&rec.WorkspaceJSON,
		&rec.TranscriptMaxID,
		&rec.TurnsMaxID,
		&rec.ToolCallsMaxID,
		&rec.RunEventsMaxID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rec.CheckpointID = strings.TrimSpace(rec.CheckpointID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.Kind = normalizeCheckpointKind(rec.Kind)
	rec.ThreadJSON = strings.TrimSpace(rec.ThreadJSON)
	rec.DerivedJSON = strings.TrimSpace(rec.DerivedJSON)
	rec.WorkspaceJSON = strings.TrimSpace(rec.WorkspaceJSON)
	if rec.ThreadJSON == "" {
		rec.ThreadJSON = "{}"
	}
	if rec.DerivedJSON == "" {
		rec.DerivedJSON = "{}"
	}
	return &rec, nil
}

func (s *Store) GetThreadCheckpoint(ctx context.Context, endpointID string, threadID string, checkpointID string) (*ThreadCheckpointRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	if endpointID == "" || threadID == "" || checkpointID == "" {
		return nil, errors.New("invalid request")
	}

	var rec ThreadCheckpointRecord
	err := s.db.QueryRowContext(ctx, `
SELECT checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
       thread_json, derived_json, workspace_json,
       transcript_max_id, turns_max_id, tool_calls_max_id, run_events_max_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ? AND checkpoint_id = ?
`, endpointID, threadID, checkpointID).Scan(
		&rec.CheckpointID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.RunID,
		&rec.Kind,
		&rec.CreatedAtUnixMs,
		&rec.ThreadJSON,
		&rec.DerivedJSON,
		&rec.WorkspaceJSON,
		&rec.TranscriptMaxID,
		&rec.TurnsMaxID,
		&rec.ToolCallsMaxID,
		&rec.RunEventsMaxID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rec.CheckpointID = strings.TrimSpace(rec.CheckpointID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.Kind = normalizeCheckpointKind(rec.Kind)
	rec.ThreadJSON = strings.TrimSpace(rec.ThreadJSON)
	rec.DerivedJSON = strings.TrimSpace(rec.DerivedJSON)
	rec.WorkspaceJSON = strings.TrimSpace(rec.WorkspaceJSON)
	if rec.ThreadJSON == "" {
		rec.ThreadJSON = "{}"
	}
	if rec.DerivedJSON == "" {
		rec.DerivedJSON = "{}"
	}
	return &rec, nil
}

func (s *Store) SetThreadCheckpointWorkspaceJSON(ctx context.Context, endpointID string, threadID string, checkpointID string, workspaceJSON string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	workspaceJSON = strings.TrimSpace(workspaceJSON)
	if endpointID == "" || threadID == "" || checkpointID == "" {
		return errors.New("invalid request")
	}

	res, err := s.db.ExecContext(ctx, `
UPDATE ai_thread_checkpoints
SET workspace_json = ?
WHERE endpoint_id = ? AND thread_id = ? AND checkpoint_id = ?
`, workspaceJSON, endpointID, threadID, checkpointID)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) RestoreThreadCheckpoint(ctx context.Context, endpointID string, threadID string, checkpointID string) (*ThreadCheckpointRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	if endpointID == "" || threadID == "" || checkpointID == "" {
		return nil, errors.New("invalid request")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rec, err := s.getThreadCheckpointTx(ctx, tx, endpointID, threadID, checkpointID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, sql.ErrNoRows
	}

	// Parse snapshots.
	var th Thread
	if err := json.Unmarshal([]byte(rec.ThreadJSON), &th); err != nil {
		return nil, fmt.Errorf("invalid thread_json: %w", err)
	}
	var derived threadCheckpointDerivedSnapshot
	if err := json.Unmarshal([]byte(rec.DerivedJSON), &derived); err != nil {
		return nil, fmt.Errorf("invalid derived_json: %w", err)
	}

	// Truncate append-only planes.
	if _, err := tx.ExecContext(ctx, `
DELETE FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND id > ?
`, endpointID, threadID, rec.TranscriptMaxID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM conversation_turns
WHERE endpoint_id = ? AND thread_id = ? AND id > ?
`, endpointID, threadID, rec.TurnsMaxID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_run_events
WHERE endpoint_id = ? AND thread_id = ? AND id > ?
`, endpointID, threadID, rec.RunEventsMaxID); err != nil {
		return nil, err
	}
	if rec.ToolCallsMaxID > 0 {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_tool_calls
WHERE id IN (
  SELECT tc.id
  FROM ai_tool_calls tc
  JOIN ai_runs r ON r.run_id = tc.run_id
  WHERE r.endpoint_id = ? AND r.thread_id = ? AND tc.id > ?
)
`, endpointID, threadID, rec.ToolCallsMaxID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_tool_calls
WHERE id IN (
  SELECT tc.id
  FROM ai_tool_calls tc
  JOIN ai_runs r ON r.run_id = tc.run_id
  WHERE r.endpoint_id = ? AND r.thread_id = ?
)
`, endpointID, threadID); err != nil {
			return nil, err
		}
	}

	// Restore derived state by replacement.
	if err := replaceThreadDerivedTx(ctx, tx, endpointID, threadID, derived); err != nil {
		return nil, err
	}

	// Restore thread row snapshot.
	if err := s.restoreThreadRowTx(ctx, tx, endpointID, threadID, th); err != nil {
		return nil, err
	}

	// Pop the checkpoint.
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ? AND checkpoint_id = ?
`, endpointID, threadID, checkpointID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Store) getThreadCheckpointTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, checkpointID string) (*ThreadCheckpointRecord, error) {
	var rec ThreadCheckpointRecord
	err := tx.QueryRowContext(ctx, `
SELECT checkpoint_id, endpoint_id, thread_id, run_id, kind, created_at_unix_ms,
       thread_json, derived_json, workspace_json,
       transcript_max_id, turns_max_id, tool_calls_max_id, run_events_max_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ? AND checkpoint_id = ?
`, endpointID, threadID, checkpointID).Scan(
		&rec.CheckpointID,
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.RunID,
		&rec.Kind,
		&rec.CreatedAtUnixMs,
		&rec.ThreadJSON,
		&rec.DerivedJSON,
		&rec.WorkspaceJSON,
		&rec.TranscriptMaxID,
		&rec.TurnsMaxID,
		&rec.ToolCallsMaxID,
		&rec.RunEventsMaxID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rec.CheckpointID = strings.TrimSpace(rec.CheckpointID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.Kind = normalizeCheckpointKind(rec.Kind)
	rec.ThreadJSON = strings.TrimSpace(rec.ThreadJSON)
	rec.DerivedJSON = strings.TrimSpace(rec.DerivedJSON)
	rec.WorkspaceJSON = strings.TrimSpace(rec.WorkspaceJSON)
	if rec.ThreadJSON == "" {
		rec.ThreadJSON = "{}"
	}
	if rec.DerivedJSON == "" {
		rec.DerivedJSON = "{}"
	}
	return &rec, nil
}

func (s *Store) getThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*Thread, error) {
	var t Thread
	var modelLockedInt int
	err := tx.QueryRowContext(ctx, `
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, working_dir, title,
  run_status, run_updated_at_unix_ms, run_error,
  waiting_prompt_id, waiting_message_id, waiting_tool_id,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&t.ThreadID,
		&t.EndpointID,
		&t.NamespacePublicID,
		&t.ModelID,
		&modelLockedInt,
		&t.WorkingDir,
		&t.Title,
		&t.RunStatus,
		&t.RunUpdatedAtUnixMs,
		&t.RunError,
		&t.WaitingPromptID,
		&t.WaitingMessageID,
		&t.WaitingToolID,
		&t.CreatedByUserPublicID,
		&t.CreatedByUserEmail,
		&t.UpdatedByUserPublicID,
		&t.UpdatedByUserEmail,
		&t.CreatedAtUnixMs,
		&t.UpdatedAtUnixMs,
		&t.LastMessageAtUnixMs,
		&t.LastMessagePreview,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.ModelLocked = modelLockedInt != 0
	return &t, nil
}

func (s *Store) snapshotThreadDerivedTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (threadCheckpointDerivedSnapshot, error) {
	out := threadCheckpointDerivedSnapshot{
		MemoryItems:      nil,
		ThreadTodos:      nil,
		ThreadState:      nil,
		ContextSnapshots: nil,
		ExecutionSpans:   nil,
		RunIDs:           nil,
	}

	// Memory items.
	rows, err := tx.QueryContext(ctx, `
SELECT memory_id, endpoint_id, thread_id,
       scope, kind, content, source_refs_json,
       importance, freshness, confidence,
       created_at_unix_ms, updated_at_unix_ms
FROM memory_items
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY updated_at_unix_ms ASC, memory_id ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var rec MemoryItemRecord
		if err := rows.Scan(
			&rec.MemoryID,
			&rec.EndpointID,
			&rec.ThreadID,
			&rec.Scope,
			&rec.Kind,
			&rec.Content,
			&rec.SourceRefsJSON,
			&rec.Importance,
			&rec.Freshness,
			&rec.Confidence,
			&rec.CreatedAtUnixMs,
			&rec.UpdatedAtUnixMs,
		); err != nil {
			_ = rows.Close()
			return out, err
		}
		out.MemoryItems = append(out.MemoryItems, rec)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return out, err
	}
	_ = rows.Close()

	// Thread todos.
	var todos ThreadTodosSnapshot
	todosErr := tx.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, version, todos_json, updated_at_unix_ms, updated_by_run_id, updated_by_tool_id
FROM ai_thread_todos
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&todos.EndpointID, &todos.ThreadID, &todos.Version, &todos.TodosJSON, &todos.UpdatedAtUnixMs, &todos.UpdatedByRunID, &todos.UpdatedByToolID)
	if todosErr == nil {
		todos.EndpointID = strings.TrimSpace(todos.EndpointID)
		todos.ThreadID = strings.TrimSpace(todos.ThreadID)
		todos.TodosJSON = strings.TrimSpace(todos.TodosJSON)
		todos.UpdatedByRunID = strings.TrimSpace(todos.UpdatedByRunID)
		todos.UpdatedByToolID = strings.TrimSpace(todos.UpdatedByToolID)
		out.ThreadTodos = &todos
	} else if !errors.Is(todosErr, sql.ErrNoRows) {
		return out, todosErr
	}

	// Thread state.
	var st ThreadState
	stErr := tx.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, open_goal, last_assistant_summary, updated_at_unix_ms
FROM ai_thread_state
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(&st.EndpointID, &st.ThreadID, &st.OpenGoal, &st.LastAssistantSummary, &st.UpdatedAtUnixMs)
	if stErr == nil {
		st.EndpointID = strings.TrimSpace(st.EndpointID)
		st.ThreadID = strings.TrimSpace(st.ThreadID)
		st.OpenGoal = strings.TrimSpace(st.OpenGoal)
		st.LastAssistantSummary = strings.TrimSpace(st.LastAssistantSummary)
		out.ThreadState = &st
	} else if !errors.Is(stErr, sql.ErrNoRows) {
		return out, stErr
	}

	// Context snapshots.
	srows, err := tx.QueryContext(ctx, `
SELECT snapshot_id, endpoint_id, thread_id,
       level, summary_text,
       covers_turn_from_id, covers_turn_to_id,
       quality_score, created_at_unix_ms
FROM context_snapshots
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms ASC, snapshot_id ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	for srows.Next() {
		var rec ContextSnapshotRecord
		if err := srows.Scan(
			&rec.SnapshotID,
			&rec.EndpointID,
			&rec.ThreadID,
			&rec.Level,
			&rec.SummaryText,
			&rec.CoversTurnFromID,
			&rec.CoversTurnToID,
			&rec.QualityScore,
			&rec.CreatedAtUnixMs,
		); err != nil {
			_ = srows.Close()
			return out, err
		}
		out.ContextSnapshots = append(out.ContextSnapshots, rec)
	}
	if err := srows.Err(); err != nil {
		_ = srows.Close()
		return out, err
	}
	_ = srows.Close()

	// Execution spans.
	erows, err := tx.QueryContext(ctx, `
SELECT span_id, endpoint_id, thread_id, run_id,
       kind, name, status, payload_json,
       started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
FROM execution_spans
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY started_at_unix_ms ASC, span_id ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	for erows.Next() {
		var rec ExecutionSpanRecord
		if err := erows.Scan(
			&rec.SpanID,
			&rec.EndpointID,
			&rec.ThreadID,
			&rec.RunID,
			&rec.Kind,
			&rec.Name,
			&rec.Status,
			&rec.PayloadJSON,
			&rec.StartedAtUnixMs,
			&rec.EndedAtUnixMs,
			&rec.UpdatedAtUnixMs,
		); err != nil {
			_ = erows.Close()
			return out, err
		}
		out.ExecutionSpans = append(out.ExecutionSpans, rec)
	}
	if err := erows.Err(); err != nil {
		_ = erows.Close()
		return out, err
	}
	_ = erows.Close()

	// Run IDs.
	rrows, err := tx.QueryContext(ctx, `
SELECT run_id
FROM ai_runs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY started_at_unix_ms ASC, run_id ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	for rrows.Next() {
		var rid string
		if err := rrows.Scan(&rid); err != nil {
			_ = rrows.Close()
			return out, err
		}
		rid = strings.TrimSpace(rid)
		if rid != "" {
			out.RunIDs = append(out.RunIDs, rid)
		}
	}
	if err := rrows.Err(); err != nil {
		_ = rrows.Close()
		return out, err
	}
	_ = rrows.Close()

	return out, nil
}

func replaceThreadDerivedTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, snap threadCheckpointDerivedSnapshot) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	for _, rec := range snap.MemoryItems {
		rec.MemoryID = strings.TrimSpace(rec.MemoryID)
		if rec.MemoryID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO memory_items(
  memory_id, endpoint_id, thread_id,
  scope, kind, content, source_refs_json,
  importance, freshness, confidence,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.MemoryID, endpointID, threadID, strings.TrimSpace(rec.Scope), strings.TrimSpace(rec.Kind), strings.TrimSpace(rec.Content), strings.TrimSpace(rec.SourceRefsJSON), rec.Importance, rec.Freshness, rec.Confidence, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM context_snapshots WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	for _, rec := range snap.ContextSnapshots {
		rec.SnapshotID = strings.TrimSpace(rec.SnapshotID)
		if rec.SnapshotID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO context_snapshots(
  snapshot_id, endpoint_id, thread_id,
  level, summary_text,
  covers_turn_from_id, covers_turn_to_id,
  quality_score, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.SnapshotID, endpointID, threadID, strings.TrimSpace(rec.Level), strings.TrimSpace(rec.SummaryText), rec.CoversTurnFromID, rec.CoversTurnToID, rec.QualityScore, rec.CreatedAtUnixMs); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	for _, rec := range snap.ExecutionSpans {
		rec.SpanID = strings.TrimSpace(rec.SpanID)
		if rec.SpanID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO execution_spans(
  span_id, endpoint_id, thread_id, run_id,
  kind, name, status, payload_json,
  started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.SpanID, endpointID, threadID, strings.TrimSpace(rec.RunID), strings.TrimSpace(rec.Kind), strings.TrimSpace(rec.Name), strings.TrimSpace(rec.Status), strings.TrimSpace(rec.PayloadJSON), rec.StartedAtUnixMs, rec.EndedAtUnixMs, rec.UpdatedAtUnixMs); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if snap.ThreadTodos != nil {
		rec := *snap.ThreadTodos
		if rec.Version > 0 || rec.UpdatedAtUnixMs > 0 {
			if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_todos(
  endpoint_id, thread_id, version, todos_json,
  updated_at_unix_ms, updated_by_run_id, updated_by_tool_id
) VALUES(?, ?, ?, ?, ?, ?, ?)
`, endpointID, threadID, rec.Version, strings.TrimSpace(rec.TodosJSON), rec.UpdatedAtUnixMs, strings.TrimSpace(rec.UpdatedByRunID), strings.TrimSpace(rec.UpdatedByToolID)); err != nil {
				return err
			}
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return err
	}
	if snap.ThreadState != nil {
		st := *snap.ThreadState
		if st.UpdatedAtUnixMs > 0 || st.OpenGoal != "" || st.LastAssistantSummary != "" {
			if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_state(endpoint_id, thread_id, open_goal, last_assistant_summary, updated_at_unix_ms)
VALUES(?, ?, ?, ?, ?)
`, endpointID, threadID, strings.TrimSpace(st.OpenGoal), strings.TrimSpace(st.LastAssistantSummary), st.UpdatedAtUnixMs); err != nil {
				return err
			}
		}
	}

	// Delete run records that did not exist at the checkpoint time (best-effort).
	if len(snap.RunIDs) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
			return err
		}
		return nil
	}
	keep := make([]string, 0, len(snap.RunIDs))
	seen := map[string]struct{}{}
	for _, rid := range snap.RunIDs {
		rid = strings.TrimSpace(rid)
		if rid == "" {
			continue
		}
		if _, ok := seen[rid]; ok {
			continue
		}
		seen[rid] = struct{}{}
		keep = append(keep, rid)
	}
	if len(keep) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
			return err
		}
		return nil
	}
	placeholders := strings.Repeat("?,", len(keep))
	placeholders = strings.TrimSuffix(placeholders, ",")
	args := make([]any, 0, 2+len(keep))
	args = append(args, endpointID, threadID)
	for _, rid := range keep {
		args = append(args, rid)
	}
	q := fmt.Sprintf(`
DELETE FROM ai_runs
WHERE endpoint_id = ? AND thread_id = ? AND run_id NOT IN (%s)
`, placeholders)
	if _, err := tx.ExecContext(ctx, q, args...); err != nil {
		return err
	}
	return nil
}

func (s *Store) restoreThreadRowTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, th Thread) error {
	th.ThreadID = strings.TrimSpace(th.ThreadID)
	th.EndpointID = strings.TrimSpace(th.EndpointID)
	if th.ThreadID == "" || th.EndpointID == "" {
		return errors.New("invalid thread snapshot")
	}
	if th.ThreadID != threadID || th.EndpointID != endpointID {
		return errors.New("thread snapshot mismatch")
	}
	_, err := tx.ExecContext(ctx, `
UPDATE ai_threads
SET namespace_public_id = ?,
    model_id = ?,
    model_locked = ?,
    working_dir = ?,
    title = ?,
    run_status = ?,
    run_updated_at_unix_ms = ?,
    run_error = ?,
    waiting_prompt_id = ?,
    waiting_message_id = ?,
    waiting_tool_id = ?,
    created_by_user_public_id = ?,
    created_by_user_email = ?,
    updated_by_user_public_id = ?,
    updated_by_user_email = ?,
    created_at_unix_ms = ?,
    updated_at_unix_ms = ?,
    last_message_at_unix_ms = ?,
    last_message_preview = ?
WHERE endpoint_id = ? AND thread_id = ?
`,
		strings.TrimSpace(th.NamespacePublicID),
		strings.TrimSpace(th.ModelID),
		boolToInt(th.ModelLocked),
		strings.TrimSpace(th.WorkingDir),
		strings.TrimSpace(th.Title),
		normalizeRunStatus(th.RunStatus),
		th.RunUpdatedAtUnixMs,
		strings.TrimSpace(th.RunError),
		strings.TrimSpace(th.WaitingPromptID),
		strings.TrimSpace(th.WaitingMessageID),
		strings.TrimSpace(th.WaitingToolID),
		strings.TrimSpace(th.CreatedByUserPublicID),
		strings.TrimSpace(th.CreatedByUserEmail),
		strings.TrimSpace(th.UpdatedByUserPublicID),
		strings.TrimSpace(th.UpdatedByUserEmail),
		th.CreatedAtUnixMs,
		th.UpdatedAtUnixMs,
		th.LastMessageAtUnixMs,
		strings.TrimSpace(th.LastMessagePreview),
		endpointID,
		threadID,
	)
	return err
}

func pruneThreadCheckpointsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, keep int) error {
	if keep <= 0 {
		keep = 20
	}
	if keep > 200 {
		keep = 200
	}
	_, err := tx.ExecContext(ctx, `
DELETE FROM ai_thread_checkpoints
WHERE checkpoint_id IN (
  SELECT checkpoint_id
  FROM ai_thread_checkpoints
  WHERE endpoint_id = ? AND thread_id = ?
  ORDER BY created_at_unix_ms DESC, checkpoint_id DESC
  LIMIT -1 OFFSET ?
)
`, endpointID, threadID, keep)
	return err
}

func maxInt64Tx(ctx context.Context, tx *sql.Tx, query string, args ...any) (int64, error) {
	var out int64
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&out); err != nil {
		return 0, err
	}
	if out < 0 {
		out = 0
	}
	return out, nil
}
