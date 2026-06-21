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
	CheckpointKindPreRun = "pre_run"
)

// ThreadCheckpointRecord is a persisted record for a single thread checkpoint.
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
	MemoryItems             []MemoryItemRecord                   `json:"memory_items"`
	ThreadTodos             *ThreadTodosSnapshot                 `json:"thread_todos,omitempty"`
	ThreadState             *ThreadState                         `json:"thread_state,omitempty"`
	ContextSnapshots        []ContextSnapshotRecord              `json:"context_snapshots"`
	ExecutionSpans          []ExecutionSpanRecord                `json:"execution_spans"`
	StructuredUserInputs    []StructuredUserInputRecord          `json:"structured_user_inputs"`
	RequestUserInputSecrets []RequestUserInputSecretAnswerRecord `json:"request_user_input_secret_answers"`
	RunIDs                  []string                             `json:"run_ids"`
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

func (s *Store) ListThreadCheckpointIDs(ctx context.Context, endpointID string, threadID string) ([]string, error) {
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

	rows, err := s.db.QueryContext(ctx, `
SELECT checkpoint_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms DESC, checkpoint_id DESC
`, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 8)
	for rows.Next() {
		var checkpointID string
		if err := rows.Scan(&checkpointID); err != nil {
			return nil, err
		}
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		out = append(out, checkpointID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListCheckpointIDs(ctx context.Context) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT checkpoint_id
FROM ai_thread_checkpoints
ORDER BY created_at_unix_ms DESC, checkpoint_id DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 32)
	for rows.Next() {
		var checkpointID string
		if err := rows.Scan(&checkpointID); err != nil {
			return nil, err
		}
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		out = append(out, checkpointID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) PruneThreadCheckpoints(ctx context.Context, endpointID string, threadID string, keep int) ([]string, error) {
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	deletedIDs, err := pruneThreadCheckpointsTx(ctx, tx, endpointID, threadID, keep)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deletedIDs, nil
}

func (s *Store) getThreadTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (*Thread, error) {
	var t Thread
	err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`
	SELECT
%s
	FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), endpointID, threadID), &t)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) snapshotThreadDerivedTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) (threadCheckpointDerivedSnapshot, error) {
	out := threadCheckpointDerivedSnapshot{
		MemoryItems:             nil,
		ThreadTodos:             nil,
		ThreadState:             nil,
		ContextSnapshots:        nil,
		ExecutionSpans:          nil,
		StructuredUserInputs:    nil,
		RequestUserInputSecrets: nil,
		RunIDs:                  nil,
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
	var providerContinuationStateJSON string
	stErr := tx.QueryRowContext(ctx, `
	SELECT endpoint_id, thread_id, open_goal, last_assistant_summary,
	       provider_continuation_state_json, provider_continuation_provider_id,
	       provider_continuation_model, provider_continuation_base_url, provider_continuation_updated_at_unix_ms,
	       updated_at_unix_ms
	FROM ai_thread_state
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&st.EndpointID,
		&st.ThreadID,
		&st.OpenGoal,
		&st.LastAssistantSummary,
		&providerContinuationStateJSON,
		&st.ProviderContinuation.ProviderID,
		&st.ProviderContinuation.Model,
		&st.ProviderContinuation.BaseURL,
		&st.ProviderContinuation.UpdatedAtUnixMs,
		&st.UpdatedAtUnixMs,
	)
	if stErr == nil {
		st.EndpointID = strings.TrimSpace(st.EndpointID)
		st.ThreadID = strings.TrimSpace(st.ThreadID)
		st.OpenGoal = strings.TrimSpace(st.OpenGoal)
		st.LastAssistantSummary = strings.TrimSpace(st.LastAssistantSummary)
		st.ProviderContinuation.State = parseProviderContinuationStateJSON(providerContinuationStateJSON)
		st.ProviderContinuation = st.ProviderContinuation.normalized()
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

	suiRows, err := tx.QueryContext(ctx, `
SELECT id, endpoint_id, thread_id, response_message_id,
       prompt_id, tool_id, reason_code, question_id,
       header, question_text,
       selected_choice_id, selected_choice_label,
       response_text, public_summary, contains_secret, created_at_unix_ms
FROM structured_user_inputs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	for suiRows.Next() {
		var (
			rec       StructuredUserInputRecord
			secretInt int
		)
		if err := suiRows.Scan(&rec.ID, &rec.EndpointID, &rec.ThreadID, &rec.ResponseMessageID, &rec.PromptID, &rec.ToolID, &rec.ReasonCode, &rec.QuestionID, &rec.Header, &rec.QuestionText, &rec.SelectedChoiceID, &rec.SelectedChoiceLabel, &rec.Text, &rec.PublicSummary, &secretInt, &rec.CreatedAtUnixMs); err != nil {
			_ = suiRows.Close()
			return out, err
		}
		rec.ContainsSecret = secretInt != 0
		out.StructuredUserInputs = append(out.StructuredUserInputs, rec)
	}
	if err := suiRows.Err(); err != nil {
		_ = suiRows.Close()
		return out, err
	}
	_ = suiRows.Close()

	secretRows, err := tx.QueryContext(ctx, `
SELECT question_id, answer_text, created_at_unix_ms, response_message_id
FROM request_user_input_secret_answers
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY response_message_id ASC, question_id ASC, answer_index ASC
`, endpointID, threadID)
	if err != nil {
		return out, err
	}
	secretIndex := map[string]int{}
	for secretRows.Next() {
		var (
			questionID        string
			answerText        string
			createdAtUnixMs   int64
			responseMessageID string
		)
		if err := secretRows.Scan(&questionID, &answerText, &createdAtUnixMs, &responseMessageID); err != nil {
			_ = secretRows.Close()
			return out, err
		}
		key := strings.TrimSpace(responseMessageID) + "\x1f" + strings.TrimSpace(questionID)
		if key == "\x1f" {
			continue
		}
		idx, exists := secretIndex[key]
		if !exists {
			out.RequestUserInputSecrets = append(out.RequestUserInputSecrets, RequestUserInputSecretAnswerRecord{
				EndpointID:        endpointID,
				ThreadID:          threadID,
				ResponseMessageID: strings.TrimSpace(responseMessageID),
				QuestionID:        strings.TrimSpace(questionID),
				CreatedAtUnixMs:   createdAtUnixMs,
			})
			idx = len(out.RequestUserInputSecrets) - 1
			secretIndex[key] = idx
		}
		answerText = strings.TrimSpace(answerText)
		if answerText == "" {
			continue
		}
		if out.RequestUserInputSecrets[idx].Text == "" {
			out.RequestUserInputSecrets[idx].Text = answerText
		} else {
			out.RequestUserInputSecrets[idx].Text = strings.TrimSpace(out.RequestUserInputSecrets[idx].Text + "\n" + answerText)
		}
	}
	if err := secretRows.Err(); err != nil {
		_ = secretRows.Close()
		return out, err
	}
	_ = secretRows.Close()

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

func pruneThreadCheckpointsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, keep int) ([]string, error) {
	if keep <= 0 {
		keep = 20
	}
	if keep > 200 {
		keep = 200
	}

	rows, err := tx.QueryContext(ctx, `
SELECT checkpoint_id
FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms DESC, checkpoint_id DESC
LIMIT -1 OFFSET ?
`, endpointID, threadID, keep)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deletedIDs := make([]string, 0, 8)
	for rows.Next() {
		var checkpointID string
		if err := rows.Scan(&checkpointID); err != nil {
			return nil, err
		}
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		deletedIDs = append(deletedIDs, checkpointID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(deletedIDs) == 0 {
		return nil, nil
	}

	args := make([]any, 0, len(deletedIDs)+2)
	placeholders := make([]string, 0, len(deletedIDs))
	args = append(args, endpointID, threadID)
	for _, checkpointID := range deletedIDs {
		args = append(args, checkpointID)
		placeholders = append(placeholders, "?")
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_thread_checkpoints
WHERE endpoint_id = ? AND thread_id = ? AND checkpoint_id IN (`+strings.Join(placeholders, ",")+`)`, args...); err != nil {
		return nil, err
	}
	return deletedIDs, nil
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
