package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

type ThreadRunStateWrite struct {
	Status                string
	ErrorCode             string
	ErrorMessage          string
	WaitingUserInputJSON  string
	UpdatedByUserPublicID string
	UpdatedByUserEmail    string
	UpdatedAtUnixMs       int64
}

type StartUserTurn struct {
	EndpointID              string
	ThreadID                string
	UserMessage             Message
	UploadIDs               []string
	Run                     RunRecord
	Turn                    ConversationTurn
	RunState                ThreadRunStateWrite
	SourceQueueID           string
	RequireSourceQueue      bool
	StructuredUserInputs    []StructuredUserInputRecord
	RequestUserInputSecrets []RequestUserInputSecretAnswerRecord
	UploadClaimedAtUnixMs   int64
}

type StartUserTurnResult struct {
	UserMessageID              string
	UserMessageRowID           int64
	UserMessageJSON            string
	UserMessageCreatedAtUnixMs int64
	ConversationTurnRowID      int64
	FollowupsRevision          int64
	UploadsToDelete            []UploadRecord
}

var ErrDuplicateUserTurnMessage = errors.New("duplicate user turn message")

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

type StructuredUserInputRecord struct {
	ID                  int64  `json:"id"`
	EndpointID          string `json:"endpoint_id"`
	ThreadID            string `json:"thread_id"`
	ResponseMessageID   string `json:"response_message_id"`
	PromptID            string `json:"prompt_id"`
	ToolID              string `json:"tool_id"`
	ReasonCode          string `json:"reason_code"`
	QuestionID          string `json:"question_id"`
	Header              string `json:"header"`
	QuestionText        string `json:"question_text"`
	SelectedChoiceID    string `json:"selected_choice_id"`
	SelectedChoiceLabel string `json:"selected_choice_label"`
	Text                string `json:"text,omitempty"`
	PublicSummary       string `json:"public_summary"`
	ContainsSecret      bool   `json:"contains_secret"`
	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
}

type RequestUserInputSecretAnswerRecord struct {
	ID                int64  `json:"id"`
	EndpointID        string `json:"endpoint_id"`
	ThreadID          string `json:"thread_id"`
	ResponseMessageID string `json:"response_message_id"`
	QuestionID        string `json:"question_id"`
	Text              string `json:"text,omitempty"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
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
	case "fact", "constraint", "decision", "todo", "blocker", "artifact":
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

func (s *Store) AppendConversationTurn(ctx context.Context, rec ConversationTurn) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
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
		return 0, errors.New("invalid conversation turn")
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	rowID, err := appendConversationTurnTx(ctx, tx, rec)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowID, nil
}

func appendConversationTurnTx(ctx context.Context, tx *sql.Tx, rec ConversationTurn) (int64, error) {
	rec.TurnID = strings.TrimSpace(rec.TurnID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.RunID = strings.TrimSpace(rec.RunID)
	rec.UserMessageID = strings.TrimSpace(rec.UserMessageID)
	rec.AssistantMessageID = strings.TrimSpace(rec.AssistantMessageID)
	if rec.TurnID == "" || rec.EndpointID == "" || rec.ThreadID == "" {
		return 0, errors.New("invalid conversation turn")
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO conversation_turns(turn_id, endpoint_id, thread_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(turn_id) DO UPDATE SET
  endpoint_id=excluded.endpoint_id,
  thread_id=excluded.thread_id,
  run_id=excluded.run_id,
  user_message_id=excluded.user_message_id,
  assistant_message_id=excluded.assistant_message_id,
  created_at_unix_ms=excluded.created_at_unix_ms
`, rec.TurnID, rec.EndpointID, rec.ThreadID, rec.RunID, rec.UserMessageID, rec.AssistantMessageID, rec.CreatedAtUnixMs); err != nil {
		return 0, err
	}
	var rowID int64
	if err := tx.QueryRowContext(ctx, `
SELECT id
FROM conversation_turns
WHERE turn_id = ?
`, rec.TurnID).Scan(&rowID); err != nil {
		return 0, err
	}
	return rowID, nil
}

func (s *Store) StartUserTurn(ctx context.Context, rec StartUserTurn) (StartUserTurnResult, error) {
	if s == nil || s.db == nil {
		return StartUserTurnResult{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	if rec.EndpointID == "" || rec.ThreadID == "" {
		return StartUserTurnResult{}, errors.New("invalid request")
	}
	rec.UserMessage.ThreadID = strings.TrimSpace(rec.UserMessage.ThreadID)
	if rec.UserMessage.ThreadID == "" {
		rec.UserMessage.ThreadID = rec.ThreadID
	}
	rec.UserMessage.EndpointID = strings.TrimSpace(rec.UserMessage.EndpointID)
	if rec.UserMessage.EndpointID == "" {
		rec.UserMessage.EndpointID = rec.EndpointID
	}
	rec.UserMessage.MessageID = strings.TrimSpace(rec.UserMessage.MessageID)
	rec.UserMessage.Role = strings.TrimSpace(rec.UserMessage.Role)
	rec.UserMessage.Status = strings.TrimSpace(rec.UserMessage.Status)
	rec.UserMessage.AuthorUserPublicID = strings.TrimSpace(rec.UserMessage.AuthorUserPublicID)
	rec.UserMessage.AuthorUserEmail = strings.TrimSpace(rec.UserMessage.AuthorUserEmail)
	rec.UserMessage.TextContent = strings.TrimSpace(rec.UserMessage.TextContent)
	rec.UserMessage.MessageJSON = strings.TrimSpace(rec.UserMessage.MessageJSON)
	if rec.UserMessage.MessageID == "" || rec.UserMessage.Role != "user" || rec.UserMessage.Status == "" || rec.UserMessage.MessageJSON == "" {
		return StartUserTurnResult{}, errors.New("invalid user message")
	}
	now := time.Now().UnixMilli()
	if rec.UserMessage.CreatedAtUnixMs <= 0 {
		rec.UserMessage.CreatedAtUnixMs = now
	}
	if rec.UserMessage.UpdatedAtUnixMs <= 0 {
		rec.UserMessage.UpdatedAtUnixMs = rec.UserMessage.CreatedAtUnixMs
	}
	if rec.UploadClaimedAtUnixMs <= 0 {
		rec.UploadClaimedAtUnixMs = rec.UserMessage.CreatedAtUnixMs
	}
	rec.Run.EndpointID = strings.TrimSpace(rec.Run.EndpointID)
	if rec.Run.EndpointID == "" {
		rec.Run.EndpointID = rec.EndpointID
	}
	rec.Run.ThreadID = strings.TrimSpace(rec.Run.ThreadID)
	if rec.Run.ThreadID == "" {
		rec.Run.ThreadID = rec.ThreadID
	}
	rec.Run.RunID = strings.TrimSpace(rec.Run.RunID)
	rec.Run.MessageID = strings.TrimSpace(rec.Run.MessageID)
	if rec.Run.RunID == "" || rec.Run.MessageID == "" {
		return StartUserTurnResult{}, errors.New("invalid run record")
	}
	if strings.TrimSpace(rec.Run.State) == "" {
		rec.Run.State = "running"
	}
	if rec.Run.StartedAtUnixMs <= 0 {
		rec.Run.StartedAtUnixMs = now
	}
	if rec.Run.UpdatedAtUnixMs <= 0 {
		rec.Run.UpdatedAtUnixMs = rec.Run.StartedAtUnixMs
	}
	rec.Turn.EndpointID = strings.TrimSpace(rec.Turn.EndpointID)
	if rec.Turn.EndpointID == "" {
		rec.Turn.EndpointID = rec.EndpointID
	}
	rec.Turn.ThreadID = strings.TrimSpace(rec.Turn.ThreadID)
	if rec.Turn.ThreadID == "" {
		rec.Turn.ThreadID = rec.ThreadID
	}
	rec.Turn.RunID = strings.TrimSpace(rec.Turn.RunID)
	if rec.Turn.RunID == "" {
		rec.Turn.RunID = rec.Run.RunID
	}
	rec.Turn.UserMessageID = strings.TrimSpace(rec.Turn.UserMessageID)
	if rec.Turn.UserMessageID == "" {
		rec.Turn.UserMessageID = rec.UserMessage.MessageID
	}
	rec.Turn.AssistantMessageID = strings.TrimSpace(rec.Turn.AssistantMessageID)
	if rec.Turn.AssistantMessageID == "" {
		rec.Turn.AssistantMessageID = rec.Run.MessageID
	}
	rec.Turn.TurnID = strings.TrimSpace(rec.Turn.TurnID)
	if rec.Turn.TurnID == "" {
		rec.Turn.TurnID = rec.Turn.AssistantMessageID
	}
	if rec.Turn.CreatedAtUnixMs <= 0 {
		rec.Turn.CreatedAtUnixMs = rec.UserMessage.CreatedAtUnixMs
	}
	if strings.TrimSpace(rec.RunState.Status) == "" {
		rec.RunState.Status = "running"
	}
	if rec.RunState.UpdatedAtUnixMs <= 0 {
		rec.RunState.UpdatedAtUnixMs = rec.Run.UpdatedAtUnixMs
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return StartUserTurnResult{}, err
	}
	defer func() { _ = tx.Rollback() }()

	preview := buildPreview(rec.UserMessage.Role, rec.UserMessage.TextContent, rec.UserMessage.MessageJSON)
	rowID, err := appendMessageTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.UserMessage, rec.RunState.UpdatedByUserPublicID, rec.RunState.UpdatedByUserEmail, preview)
	if err != nil {
		if !isUniqueConstraintError(err) {
			return StartUserTurnResult{}, err
		}
		result, replayErr := existingStartedUserTurnTx(ctx, tx, rec)
		if replayErr != nil {
			return StartUserTurnResult{}, replayErr
		}
		if err := tx.Commit(); err != nil {
			return StartUserTurnResult{}, err
		}
		return result, nil
	}
	if err := bindUploadsToRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindMessage, rec.UserMessage.MessageID, rec.UploadIDs, rec.UploadClaimedAtUnixMs); err != nil {
		return StartUserTurnResult{}, err
	}
	if err := replaceStructuredUserInputsTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.UserMessage.MessageID, rec.StructuredUserInputs); err != nil {
		return StartUserTurnResult{}, err
	}
	if err := replaceRequestUserInputSecretAnswersTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.UserMessage.MessageID, rec.RequestUserInputSecrets); err != nil {
		return StartUserTurnResult{}, err
	}
	if err := upsertRunTx(ctx, tx, rec.Run); err != nil {
		return StartUserTurnResult{}, err
	}
	turnRowID, err := appendConversationTurnTx(ctx, tx, rec.Turn)
	if err != nil {
		return StartUserTurnResult{}, err
	}
	if err := updateThreadRunStateTx(ctx, tx, rec.EndpointID, rec.ThreadID, rec.RunState); err != nil {
		return StartUserTurnResult{}, err
	}

	var revision int64
	var uploadsToDelete []UploadRecord
	sourceQueueID := strings.TrimSpace(rec.SourceQueueID)
	if sourceQueueID != "" {
		res, err := tx.ExecContext(ctx, `
DELETE FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, rec.EndpointID, rec.ThreadID, sourceQueueID)
		if err != nil {
			return StartUserTurnResult{}, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			if rec.RequireSourceQueue {
				return StartUserTurnResult{}, sql.ErrNoRows
			}
		} else {
			uploadsToDelete, err = prepareUploadCleanupForRefTx(ctx, tx, rec.EndpointID, rec.ThreadID, UploadRefKindQueuedTurn, sourceQueueID, now)
			if err != nil {
				return StartUserTurnResult{}, err
			}
			revision, err = bumpThreadFollowupsRevisionTx(ctx, tx, rec.EndpointID, rec.ThreadID)
			if err != nil {
				return StartUserTurnResult{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return StartUserTurnResult{}, err
	}
	return StartUserTurnResult{
		UserMessageID:              rec.UserMessage.MessageID,
		UserMessageRowID:           rowID,
		UserMessageJSON:            rec.UserMessage.MessageJSON,
		UserMessageCreatedAtUnixMs: rec.UserMessage.CreatedAtUnixMs,
		ConversationTurnRowID:      turnRowID,
		FollowupsRevision:          revision,
		UploadsToDelete:            uploadsToDelete,
	}, nil
}

func existingStartedUserTurnTx(ctx context.Context, tx *sql.Tx, rec StartUserTurn) (StartUserTurnResult, error) {
	messageID := strings.TrimSpace(rec.UserMessage.MessageID)
	runID := strings.TrimSpace(rec.Run.RunID)
	turnID := strings.TrimSpace(rec.Turn.TurnID)
	if messageID == "" || runID == "" || turnID == "" {
		return StartUserTurnResult{}, ErrDuplicateUserTurnMessage
	}
	var rowID int64
	var messageJSON string
	var createdAt int64
	err := tx.QueryRowContext(ctx, `
SELECT id, message_json, created_at_unix_ms
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ? AND message_id = ?
`, rec.EndpointID, rec.ThreadID, messageID).Scan(&rowID, &messageJSON, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return StartUserTurnResult{}, ErrDuplicateUserTurnMessage
		}
		return StartUserTurnResult{}, err
	}
	var turnRowID int64
	var existingRunID string
	var existingUserMessageID string
	var existingAssistantMessageID string
	err = tx.QueryRowContext(ctx, `
SELECT id, run_id, user_message_id, assistant_message_id
FROM conversation_turns
WHERE turn_id = ? AND endpoint_id = ? AND thread_id = ?
`, turnID, rec.EndpointID, rec.ThreadID).Scan(&turnRowID, &existingRunID, &existingUserMessageID, &existingAssistantMessageID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return StartUserTurnResult{}, ErrDuplicateUserTurnMessage
		}
		return StartUserTurnResult{}, err
	}
	var runRowCount int
	err = tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_runs
WHERE endpoint_id = ? AND thread_id = ? AND run_id = ? AND message_id = ?
`, rec.EndpointID, rec.ThreadID, runID, strings.TrimSpace(rec.Run.MessageID)).Scan(&runRowCount)
	if err != nil {
		return StartUserTurnResult{}, err
	}
	if strings.TrimSpace(existingRunID) != runID ||
		strings.TrimSpace(existingUserMessageID) != messageID ||
		strings.TrimSpace(existingAssistantMessageID) != strings.TrimSpace(rec.Turn.AssistantMessageID) ||
		runRowCount != 1 {
		return StartUserTurnResult{}, ErrDuplicateUserTurnMessage
	}
	return StartUserTurnResult{
		UserMessageID:              messageID,
		UserMessageRowID:           rowID,
		UserMessageJSON:            messageJSON,
		UserMessageCreatedAtUnixMs: createdAt,
		ConversationTurnRowID:      turnRowID,
	}, nil
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

func (s *Store) ListMemoryItemsByScopeKind(ctx context.Context, endpointID string, threadID string, scope string, kind string, limit int) ([]MemoryItemRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	scope = normalizeScope(scope)
	kind = normalizeMemoryKind(kind)
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
WHERE endpoint_id = ? AND thread_id = ? AND scope = ? AND kind = ?
ORDER BY updated_at_unix_ms DESC, memory_id DESC
LIMIT ?
`, endpointID, threadID, scope, kind, limit)
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

func (s *Store) DeleteThreadMemoryItem(ctx context.Context, endpointID string, threadID string, memoryID string) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	memoryID = strings.TrimSpace(memoryID)
	if endpointID == "" || threadID == "" || memoryID == "" {
		return errors.New("invalid request")
	}
	_, err := s.db.ExecContext(ctx, `
DELETE FROM memory_items
WHERE endpoint_id = ? AND thread_id = ? AND memory_id = ?
`, endpointID, threadID, memoryID)
	return err
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

func (s *Store) ReplaceStructuredUserInputs(ctx context.Context, endpointID string, threadID string, responseMessageID string, records []StructuredUserInputRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	responseMessageID = strings.TrimSpace(responseMessageID)
	if endpointID == "" || threadID == "" || responseMessageID == "" {
		return errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := replaceStructuredUserInputsTx(ctx, tx, endpointID, threadID, responseMessageID, records); err != nil {
		return err
	}
	return tx.Commit()
}

func replaceStructuredUserInputsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, responseMessageID string, records []StructuredUserInputRecord) error {
	if _, err := tx.ExecContext(ctx, `
DELETE FROM structured_user_inputs
WHERE endpoint_id = ? AND thread_id = ? AND response_message_id = ?
`, endpointID, threadID, responseMessageID); err != nil {
		return err
	}
	for _, rec := range records {
		if strings.TrimSpace(rec.QuestionID) == "" {
			continue
		}
		createdAt := rec.CreatedAtUnixMs
		if createdAt <= 0 {
			createdAt = time.Now().UnixMilli()
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO structured_user_inputs(
  endpoint_id, thread_id, response_message_id,
  prompt_id, tool_id, reason_code, question_id,
  header, question_text,
 selected_choice_id, selected_choice_label,
  response_text, public_summary, contains_secret, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, endpointID, threadID, responseMessageID, strings.TrimSpace(rec.PromptID), strings.TrimSpace(rec.ToolID), strings.TrimSpace(rec.ReasonCode), strings.TrimSpace(rec.QuestionID), strings.TrimSpace(rec.Header), strings.TrimSpace(rec.QuestionText), strings.TrimSpace(rec.SelectedChoiceID), strings.TrimSpace(rec.SelectedChoiceLabel), strings.TrimSpace(rec.Text), strings.TrimSpace(rec.PublicSummary), boolToInt(rec.ContainsSecret), createdAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListRecentStructuredUserInputs(ctx context.Context, endpointID string, threadID string, limit int) ([]StructuredUserInputRecord, error) {
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
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, endpoint_id, thread_id, response_message_id,
       prompt_id, tool_id, reason_code, question_id,
       header, question_text,
       selected_choice_id, selected_choice_label,
       response_text, public_summary, contains_secret, created_at_unix_ms
FROM structured_user_inputs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id DESC
LIMIT ?
`, endpointID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tmp := make([]StructuredUserInputRecord, 0, limit)
	for rows.Next() {
		var (
			rec       StructuredUserInputRecord
			secretInt int
		)
		if err := rows.Scan(&rec.ID, &rec.EndpointID, &rec.ThreadID, &rec.ResponseMessageID, &rec.PromptID, &rec.ToolID, &rec.ReasonCode, &rec.QuestionID, &rec.Header, &rec.QuestionText, &rec.SelectedChoiceID, &rec.SelectedChoiceLabel, &rec.Text, &rec.PublicSummary, &secretInt, &rec.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		rec.ContainsSecret = secretInt != 0
		tmp = append(tmp, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]StructuredUserInputRecord, 0, len(tmp))
	for i := len(tmp) - 1; i >= 0; i-- {
		out = append(out, tmp[i])
	}
	return out, nil
}

func (s *Store) ReplaceRequestUserInputSecretAnswers(ctx context.Context, endpointID string, threadID string, responseMessageID string, records []RequestUserInputSecretAnswerRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	responseMessageID = strings.TrimSpace(responseMessageID)
	if endpointID == "" || threadID == "" || responseMessageID == "" {
		return errors.New("invalid request")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := replaceRequestUserInputSecretAnswersTx(ctx, tx, endpointID, threadID, responseMessageID, records); err != nil {
		return err
	}
	return tx.Commit()
}

func replaceRequestUserInputSecretAnswersTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string, responseMessageID string, records []RequestUserInputSecretAnswerRecord) error {
	if _, err := tx.ExecContext(ctx, `
DELETE FROM request_user_input_secret_answers
WHERE endpoint_id = ? AND thread_id = ? AND response_message_id = ?
`, endpointID, threadID, responseMessageID); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, rec := range records {
		questionID := strings.TrimSpace(rec.QuestionID)
		answerText := strings.TrimSpace(rec.Text)
		if questionID == "" {
			continue
		}
		createdAt := rec.CreatedAtUnixMs
		if createdAt <= 0 {
			createdAt = now
		}
		if answerText == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO request_user_input_secret_answers(
  endpoint_id, thread_id, response_message_id,
  question_id, answer_index, answer_text, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?)
`, endpointID, threadID, responseMessageID, questionID, 0, answerText, createdAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListRequestUserInputSecretAnswers(ctx context.Context, endpointID string, threadID string, responseMessageID string) ([]RequestUserInputSecretAnswerRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	responseMessageID = strings.TrimSpace(responseMessageID)
	if endpointID == "" || threadID == "" || responseMessageID == "" {
		return nil, errors.New("invalid request")
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT question_id, answer_text, created_at_unix_ms
FROM request_user_input_secret_answers
WHERE endpoint_id = ? AND thread_id = ? AND response_message_id = ?
ORDER BY question_id ASC, answer_index ASC
`, endpointID, threadID, responseMessageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grouped := map[string]*RequestUserInputSecretAnswerRecord{}
	order := make([]string, 0, 8)
	for rows.Next() {
		var (
			questionID string
			answerText string
			createdAt  int64
		)
		if err := rows.Scan(&questionID, &answerText, &createdAt); err != nil {
			return nil, err
		}
		questionID = strings.TrimSpace(questionID)
		answerText = strings.TrimSpace(answerText)
		if questionID == "" || answerText == "" {
			continue
		}
		rec := grouped[questionID]
		if rec == nil {
			rec = &RequestUserInputSecretAnswerRecord{
				EndpointID:        endpointID,
				ThreadID:          threadID,
				ResponseMessageID: responseMessageID,
				QuestionID:        questionID,
				CreatedAtUnixMs:   createdAt,
			}
			grouped[questionID] = rec
			order = append(order, questionID)
		}
		if rec.Text == "" {
			rec.Text = answerText
			continue
		}
		rec.Text = strings.TrimSpace(rec.Text + "\n" + answerText)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]RequestUserInputSecretAnswerRecord, 0, len(order))
	for _, questionID := range order {
		if rec := grouped[questionID]; rec != nil {
			out = append(out, *rec)
		}
	}
	return out, nil
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if err := deleteThreadContextPlanesTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	return tx.Commit()
}
