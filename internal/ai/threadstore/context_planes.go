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

const openGoalMemoryPrefix = "open_goal::"

var ErrThreadTodosVersionConflict = errors.New("thread todos version conflict")

// ConversationTurn links transcript messages to one semantic turn.
type ConversationTurn struct {
	ID                 int64  `json:"id"`
	TurnID             string `json:"turn_id"`
	EndpointID         string `json:"endpoint_id"`
	ThreadID           string `json:"thread_id"`
	RunID              string `json:"run_id"`
	UserMessageID      string `json:"user_message_id"`
	AssistantMessageID string `json:"assistant_message_id"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
}

// ExecutionSpanRecord captures structured execution evidence.
type ExecutionSpanRecord struct {
	SpanID          string `json:"span_id"`
	EndpointID      string `json:"endpoint_id"`
	ThreadID        string `json:"thread_id"`
	RunID           string `json:"run_id"`
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Status          string `json:"status"`
	PayloadJSON     string `json:"payload_json"`
	StartedAtUnixMs int64  `json:"started_at_unix_ms"`
	EndedAtUnixMs   int64  `json:"ended_at_unix_ms"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
}

// MemoryItemRecord is the normalized semantic memory entry.
type MemoryItemRecord struct {
	MemoryID        string  `json:"memory_id"`
	EndpointID      string  `json:"endpoint_id"`
	ThreadID        string  `json:"thread_id"`
	Scope           string  `json:"scope"`
	Kind            string  `json:"kind"`
	Content         string  `json:"content"`
	SourceRefsJSON  string  `json:"source_refs_json"`
	Importance      float64 `json:"importance"`
	Freshness       float64 `json:"freshness"`
	Confidence      float64 `json:"confidence"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64   `json:"updated_at_unix_ms"`
}

// ContextSnapshotRecord stores compression artifacts with quality scores.
type ContextSnapshotRecord struct {
	SnapshotID       string  `json:"snapshot_id"`
	EndpointID       string  `json:"endpoint_id"`
	ThreadID         string  `json:"thread_id"`
	Level            string  `json:"level"`
	SummaryText      string  `json:"summary_text"`
	CoversTurnFromID int64   `json:"covers_turn_from_id"`
	CoversTurnToID   int64   `json:"covers_turn_to_id"`
	QualityScore     float64 `json:"quality_score"`
	CreatedAtUnixMs  int64   `json:"created_at_unix_ms"`
}

// ProviderCapabilityRecord caches capability json by provider/model.
type ProviderCapabilityRecord struct {
	ProviderID      string `json:"provider_id"`
	ModelName       string `json:"model_name"`
	CapabilityJSON  string `json:"capability_json"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
}

// ThreadTodosSnapshot stores the thread-level todo list snapshot.
type ThreadTodosSnapshot struct {
	EndpointID      string `json:"endpoint_id"`
	ThreadID        string `json:"thread_id"`
	Version         int64  `json:"version"`
	TodosJSON       string `json:"todos_json"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
	UpdatedByRunID  string `json:"updated_by_run_id"`
	UpdatedByToolID string `json:"updated_by_tool_id"`
}

func normalizeScope(scope string) string {
	scope = strings.ToLower(strings.TrimSpace(scope))
	switch scope {
	case "working", "episodic", "long_term":
		return scope
	default:
		return "episodic"
	}
}

func normalizeMemoryKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	switch kind {
	case "fact", "constraint", "decision", "todo", "artifact":
		return kind
	default:
		return "fact"
	}
}

func normalizeSpanKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	switch kind {
	case "tool", "reasoning", "system":
		return kind
	default:
		return "system"
	}
}

func normalizeSpanStatus(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "started", "running", "success", "failed", "canceled", "timed_out", "pending":
		return status
	default:
		return "running"
	}
}

func normalizeSnapshotLevel(level string) string {
	level = strings.ToLower(strings.TrimSpace(level))
	switch level {
	case "turn", "episode", "thread":
		return level
	default:
		return "turn"
	}
}

func clamp01(v float64, fallback float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	if v == 0 {
		return fallback
	}
	return v
}

func (s *Store) AppendConversationTurn(ctx context.Context, rec ConversationTurn) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.UserMessageID = strings.TrimSpace(rec.UserMessageID)
	rec.AssistantMessageID = strings.TrimSpace(rec.AssistantMessageID)
	if rec.TurnID == "" || rec.EndpointID == "" || rec.ThreadID == "" {
		return errors.New("invalid conversation turn")
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}

	_, err := s.db.ExecContext(ctx, `
INSERT INTO conversation_turns(turn_id, endpoint_id, thread_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(turn_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  run_id=excluded.run_id,
  user_message_id=excluded.user_message_id,
  assistant_message_id=excluded.assistant_message_id,
  created_at_unix_ms=excluded.created_at_unix_ms
`, rec.TurnID, rec.EndpointID, rec.ThreadID, rec.RunID, rec.UserMessageID, rec.AssistantMessageID, rec.CreatedAtUnixMs)
	return err
}

func (s *Store) ListConversationTurns(ctx context.Context, endpointID string, threadID string, limit int) ([]ConversationTurn, error) {
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
	if limit <= 0 {
		limit = 80
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT id, turn_id, endpoint_id, thread_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms
FROM conversation_turns
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tmp := make([]ConversationTurn, 0, limit)
	for rows.Next() {
		var rec ConversationTurn
		if err := rows.Scan(
			&rec.ID,
			&rec.TurnID,
			&rec.EndpointID,
			&rec.ThreadID,
			&rec.RunID,
			&rec.UserMessageID,
			&rec.AssistantMessageID,
			&rec.CreatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]ConversationTurn, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) ListRecentTranscriptMessages(ctx context.Context, endpointID string, threadID string, limit int) ([]Message, error) {
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
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, thread_id, endpoint_id, message_id, role,
       author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tmp := make([]Message, 0, limit)
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID,
			&m.ThreadID,
			&m.EndpointID,
			&m.MessageID,
			&m.Role,
			&m.AuthorUserPublicID,
			&m.AuthorUserEmail,
			&m.Status,
			&m.CreatedAtUnixMs,
			&m.UpdatedAtUnixMs,
			&m.TextContent,
			&m.MessageJSON,
		); err != nil {
			return nil, err
		}
		tmp = append(tmp, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Message, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) GetTranscriptMessage(ctx context.Context, endpointID string, threadID string, messageID string) (*Message, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	messageID = strings.TrimSpace(messageID)
	if endpointID == "" || threadID == "" || messageID == "" {
		return nil, errors.New("invalid request")
	}
	var m Message
	err := s.db.QueryRowContext(ctx, `
SELECT id, thread_id, endpoint_id, message_id, role,
       author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`, endpointID, threadID, messageID).Scan(
		&m.ID,
		&m.ThreadID,
		&m.EndpointID,
		&m.MessageID,
		&m.Role,
		&m.AuthorUserPublicID,
		&m.AuthorUserEmail,
		&m.Status,
		&m.CreatedAtUnixMs,
		&m.UpdatedAtUnixMs,
		&m.TextContent,
		&m.MessageJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *Store) UpsertExecutionSpan(ctx context.Context, rec ExecutionSpanRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.SpanID = strings.TrimSpace(rec.SpanID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.Kind = normalizeSpanKind(rec.Kind)
	rec.Name = strings.TrimSpace(rec.Name)
	rec.Status = normalizeSpanStatus(rec.Status)
	rec.PayloadJSON = strings.TrimSpace(rec.PayloadJSON)
	if rec.SpanID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.RunID == "" {
		return errors.New("invalid execution span")
	}
	if rec.Name == "" {
		rec.Name = "unknown"
	}
	if rec.PayloadJSON == "" {
		rec.PayloadJSON = "{}"
	}
	if rec.StartedAtUnixMs <= 0 {
		rec.StartedAtUnixMs = time.Now().UnixMilli()
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO execution_spans(
  span_id, endpoint_id, thread_id, run_id,
  kind, name, status, payload_json,
  started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(span_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  run_id=excluded.run_id,
  kind=excluded.kind,
  name=excluded.name,
  status=excluded.status,
  payload_json=excluded.payload_json,
  started_at_unix_ms=excluded.started_at_unix_ms,
  ended_at_unix_ms=excluded.ended_at_unix_ms,
  updated_at_unix_ms=excluded.updated_at_unix_ms
`, rec.SpanID, rec.EndpointID, rec.ThreadID, rec.RunID, rec.Kind, rec.Name, rec.Status, rec.PayloadJSON, rec.StartedAtUnixMs, rec.EndedAtUnixMs, rec.UpdatedAtUnixMs)
	return err
}

func (s *Store) ListExecutionSpansByRun(ctx context.Context, endpointID string, runID string, limit int) ([]ExecutionSpanRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || runID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT span_id, endpoint_id, thread_id, run_id,
       kind, name, status, payload_json,
       started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
FROM execution_spans
WHERE endpoint_id = ? AND run_id = ?
ORDER BY started_at_unix_ms ASC, span_id ASC
LIMIT ?
`, endpointID, runID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ExecutionSpanRecord, 0, limit)
	for rows.Next() {
		var rec ExecutionSpanRecord
		if err := rows.Scan(
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
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListRecentExecutionSpansByThread(ctx context.Context, endpointID string, threadID string, limit int) ([]ExecutionSpanRecord, error) {
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
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT span_id, endpoint_id, thread_id, run_id,
       kind, name, status, payload_json,
       started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
FROM execution_spans
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY started_at_unix_ms DESC, span_id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tmp := make([]ExecutionSpanRecord, 0, limit)
	for rows.Next() {
		var rec ExecutionSpanRecord
		if err := rows.Scan(
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
			return nil, err
		}
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ExecutionSpanRecord, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) UpsertMemoryItem(ctx context.Context, rec MemoryItemRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.MemoryID = strings.TrimSpace(rec.MemoryID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.Scope = normalizeScope(rec.Scope)
	rec.Kind = normalizeMemoryKind(rec.Kind)
	rec.Content = strings.TrimSpace(rec.Content)
	rec.SourceRefsJSON = strings.TrimSpace(rec.SourceRefsJSON)
	if rec.MemoryID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.Content == "" {
		return errors.New("invalid memory item")
	}
	if rec.SourceRefsJSON == "" {
		rec.SourceRefsJSON = "[]"
	}
	rec.Importance = clamp01(rec.Importance, 0.5)
	rec.Freshness = clamp01(rec.Freshness, 0.5)
	rec.Confidence = clamp01(rec.Confidence, 0.6)
	now := time.Now().UnixMilli()
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = now
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO memory_items(
  memory_id, endpoint_id, thread_id,
  scope, kind, content, source_refs_json,
  importance, freshness, confidence,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(memory_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  scope=excluded.scope,
  kind=excluded.kind,
  content=excluded.content,
  source_refs_json=excluded.source_refs_json,
  importance=excluded.importance,
  freshness=excluded.freshness,
  confidence=excluded.confidence,
  created_at_unix_ms=excluded.created_at_unix_ms,
  updated_at_unix_ms=excluded.updated_at_unix_ms
`, rec.MemoryID, rec.EndpointID, rec.ThreadID, rec.Scope, rec.Kind, rec.Content, rec.SourceRefsJSON, rec.Importance, rec.Freshness, rec.Confidence, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	return err
}

func (s *Store) ListRecentMemoryItems(ctx context.Context, endpointID string, threadID string, limit int) ([]MemoryItemRecord, error) {
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
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT memory_id, endpoint_id, thread_id,
       scope, kind, content, source_refs_json,
       importance, freshness, confidence,
       created_at_unix_ms, updated_at_unix_ms
FROM memory_items
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY updated_at_unix_ms DESC, memory_id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tmp := make([]MemoryItemRecord, 0, limit)
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
			return nil, err
		}
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]MemoryItemRecord, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) SetThreadOpenGoal(ctx context.Context, endpointID string, threadID string, goal string) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	goal = strings.TrimSpace(goal)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	memoryID := openGoalMemoryPrefix + endpointID + "::" + threadID
	if goal == "" {
		if s == nil || s.db == nil {
			return errors.New("store not initialized")
		}
		if ctx == nil {
			ctx = context.Background()
		}
		_, err := s.db.ExecContext(ctx, `DELETE FROM memory_items WHERE memory_id = ?`, memoryID)
		return err
	}
	sourceRefs, _ := json.Marshal([]map[string]any{{"type": "thread_open_goal"}})
	return s.UpsertMemoryItem(ctx, MemoryItemRecord{
		MemoryID:       memoryID,
		EndpointID:     endpointID,
		ThreadID:       threadID,
		Scope:          "working",
		Kind:           "constraint",
		Content:        goal,
		SourceRefsJSON: string(sourceRefs),
		Importance:     0.95,
		Freshness:      1,
		Confidence:     0.95,
	})
}

func (s *Store) GetThreadOpenGoal(ctx context.Context, endpointID string, threadID string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return "", errors.New("invalid request")
	}
	memoryID := openGoalMemoryPrefix + endpointID + "::" + threadID
	var content string
	err := s.db.QueryRowContext(ctx, `
SELECT content
FROM memory_items
WHERE memory_id = ?
`, memoryID).Scan(&content)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(content), nil
}

func (s *Store) GetThreadTodosSnapshot(ctx context.Context, endpointID string, threadID string) (ThreadTodosSnapshot, error) {
	out := ThreadTodosSnapshot{
		EndpointID: strings.TrimSpace(endpointID),
		ThreadID:   strings.TrimSpace(threadID),
		Version:    0,
		TodosJSON:  "[]",
	}
	if s == nil || s.db == nil {
		return out, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if out.EndpointID == "" || out.ThreadID == "" {
		return out, errors.New("invalid request")
	}
	err := s.db.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, version, todos_json, updated_at_unix_ms, updated_by_run_id, updated_by_tool_id
FROM ai_thread_todos
WHERE endpoint_id = ? AND thread_id = ?
`, out.EndpointID, out.ThreadID).Scan(
		&out.EndpointID,
		&out.ThreadID,
		&out.Version,
		&out.TodosJSON,
		&out.UpdatedAtUnixMs,
		&out.UpdatedByRunID,
		&out.UpdatedByToolID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	out.EndpointID = strings.TrimSpace(out.EndpointID)
	out.ThreadID = strings.TrimSpace(out.ThreadID)
	out.TodosJSON = strings.TrimSpace(out.TodosJSON)
	out.UpdatedByRunID = strings.TrimSpace(out.UpdatedByRunID)
	out.UpdatedByToolID = strings.TrimSpace(out.UpdatedByToolID)
	if out.TodosJSON == "" {
		out.TodosJSON = "[]"
	}
	if out.Version < 0 {
		out.Version = 0
	}
	return out, nil
}

func (s *Store) ReplaceThreadTodosSnapshot(ctx context.Context, rec ThreadTodosSnapshot, expectedVersion *int64) (ThreadTodosSnapshot, error) {
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.TodosJSON = strings.TrimSpace(rec.TodosJSON)
	rec.UpdatedByRunID = strings.TrimSpace(rec.UpdatedByRunID)
	rec.UpdatedByToolID = strings.TrimSpace(rec.UpdatedByToolID)
	if rec.TodosJSON == "" {
		rec.TodosJSON = "[]"
	}
	if rec.EndpointID == "" || rec.ThreadID == "" {
		return ThreadTodosSnapshot{}, errors.New("invalid request")
	}
	if expectedVersion != nil && *expectedVersion < 0 {
		return ThreadTodosSnapshot{}, errors.New("invalid expected_version")
	}
	if s == nil || s.db == nil {
		return ThreadTodosSnapshot{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ThreadTodosSnapshot{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var currentVersion int64
	rowErr := tx.QueryRowContext(ctx, `
SELECT version
FROM ai_thread_todos
WHERE endpoint_id = ? AND thread_id = ?
`, rec.EndpointID, rec.ThreadID).Scan(&currentVersion)

	switch {
	case errors.Is(rowErr, sql.ErrNoRows):
		if expectedVersion != nil && *expectedVersion != 0 {
			return ThreadTodosSnapshot{}, ErrThreadTodosVersionConflict
		}
		rec.Version = 1
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_todos(
  endpoint_id, thread_id, version, todos_json,
  updated_at_unix_ms, updated_by_run_id, updated_by_tool_id
) VALUES(?, ?, ?, ?, ?, ?, ?)
`, rec.EndpointID, rec.ThreadID, rec.Version, rec.TodosJSON, rec.UpdatedAtUnixMs, rec.UpdatedByRunID, rec.UpdatedByToolID); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return ThreadTodosSnapshot{}, ErrThreadTodosVersionConflict
			}
			return ThreadTodosSnapshot{}, err
		}
	case rowErr != nil:
		return ThreadTodosSnapshot{}, rowErr
	default:
		if expectedVersion != nil && *expectedVersion != currentVersion {
			return ThreadTodosSnapshot{}, ErrThreadTodosVersionConflict
		}
		nextVersion := currentVersion + 1
		res, err := tx.ExecContext(ctx, `
UPDATE ai_thread_todos
SET version = ?,
    todos_json = ?,
    updated_at_unix_ms = ?,
    updated_by_run_id = ?,
    updated_by_tool_id = ?
WHERE endpoint_id = ? AND thread_id = ? AND version = ?
`, nextVersion, rec.TodosJSON, rec.UpdatedAtUnixMs, rec.UpdatedByRunID, rec.UpdatedByToolID, rec.EndpointID, rec.ThreadID, currentVersion)
		if err != nil {
			return ThreadTodosSnapshot{}, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return ThreadTodosSnapshot{}, ErrThreadTodosVersionConflict
		}
		rec.Version = nextVersion
	}

	if err := tx.Commit(); err != nil {
		return ThreadTodosSnapshot{}, err
	}
	return rec, nil
}

func (s *Store) InsertContextSnapshot(ctx context.Context, rec ContextSnapshotRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.SnapshotID = strings.TrimSpace(rec.SnapshotID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.Level = normalizeSnapshotLevel(rec.Level)
	rec.SummaryText = strings.TrimSpace(rec.SummaryText)
	if rec.SnapshotID == "" || rec.EndpointID == "" || rec.ThreadID == "" || rec.SummaryText == "" {
		return errors.New("invalid context snapshot")
	}
	rec.QualityScore = clamp01(rec.QualityScore, 0.5)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO context_snapshots(
  snapshot_id, endpoint_id, thread_id,
  level, summary_text,
  covers_turn_from_id, covers_turn_to_id,
  quality_score, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(snapshot_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  level=excluded.level,
  summary_text=excluded.summary_text,
  covers_turn_from_id=excluded.covers_turn_from_id,
  covers_turn_to_id=excluded.covers_turn_to_id,
  quality_score=excluded.quality_score,
  created_at_unix_ms=excluded.created_at_unix_ms
`, rec.SnapshotID, rec.EndpointID, rec.ThreadID, rec.Level, rec.SummaryText, rec.CoversTurnFromID, rec.CoversTurnToID, rec.QualityScore, rec.CreatedAtUnixMs)
	return err
}

func (s *Store) ListContextSnapshots(ctx context.Context, endpointID string, threadID string, level string, limit int) ([]ContextSnapshotRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	level = normalizeSnapshotLevel(level)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT snapshot_id, endpoint_id, thread_id,
       level, summary_text,
       covers_turn_from_id, covers_turn_to_id,
       quality_score, created_at_unix_ms
FROM context_snapshots
WHERE endpoint_id = ? AND thread_id = ? AND level = ?
ORDER BY created_at_unix_ms DESC, snapshot_id DESC
LIMIT ?
`, endpointID, threadID, level, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tmp := make([]ContextSnapshotRecord, 0, limit)
	for rows.Next() {
		var rec ContextSnapshotRecord
		if err := rows.Scan(
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
			return nil, err
		}
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ContextSnapshotRecord, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) UpsertProviderCapability(ctx context.Context, rec ProviderCapabilityRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.ProviderID = strings.TrimSpace(rec.ProviderID)
	rec.ModelName = strings.TrimSpace(rec.ModelName)
	rec.CapabilityJSON = strings.TrimSpace(rec.CapabilityJSON)
	if rec.ProviderID == "" || rec.ModelName == "" || rec.CapabilityJSON == "" {
		return errors.New("invalid provider capability")
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO provider_capabilities(provider_id, model_name, capability_json, updated_at_unix_ms)
VALUES(?, ?, ?, ?)
ON CONFLICT(provider_id, model_name) DO UPDATE SET
  capability_json=excluded.capability_json,
  updated_at_unix_ms=excluded.updated_at_unix_ms
`, rec.ProviderID, rec.ModelName, rec.CapabilityJSON, rec.UpdatedAtUnixMs)
	return err
}

func (s *Store) GetProviderCapability(ctx context.Context, providerID string, modelName string) (*ProviderCapabilityRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if providerID == "" || modelName == "" {
		return nil, errors.New("invalid request")
	}
	var rec ProviderCapabilityRecord
	err := s.db.QueryRowContext(ctx, `
SELECT provider_id, model_name, capability_json, updated_at_unix_ms
FROM provider_capabilities
WHERE provider_id = ? AND model_name = ?
`, providerID, modelName).Scan(&rec.ProviderID, &rec.ModelName, &rec.CapabilityJSON, &rec.UpdatedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) DeleteThreadContextData(ctx context.Context, endpointID string, threadID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	queries := []string{
		`DELETE FROM conversation_turns WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM context_snapshots WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`,
	}
	for _, q := range queries {
		if _, err := s.db.ExecContext(ctx, q, endpointID, threadID); err != nil {
			return fmt.Errorf("delete thread context data failed: %w", err)
		}
	}
	return nil
}
