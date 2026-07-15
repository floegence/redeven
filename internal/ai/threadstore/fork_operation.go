package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const ForkSnapshotSchemaVersion = 1

type ForkOperationStatus string

const (
	ForkOperationPending   ForkOperationStatus = "pending"
	ForkOperationCommitted ForkOperationStatus = "committed"
	ForkOperationFailed    ForkOperationStatus = "failed"
)

var (
	ErrForkOperationConflict   = errors.New("thread fork operation conflicts with existing request")
	ErrForkDestinationConflict = errors.New("thread fork destination conflicts with existing operation")
	ErrForkOperationFailed     = errors.New("thread fork operation is failed")
	ErrForkResultConflict      = errors.New("thread fork result conflicts with source snapshot")
)

type ForkOperation struct {
	OperationID                    string
	EndpointID                     string
	SourceThreadID                 string
	DestinationThreadID            string
	RequestFingerprint             string
	Status                         ForkOperationStatus
	SnapshotSchemaVersion          int
	SnapshotJSON                   string
	FloretResultJSON               string
	RetryCount                     int
	ErrorCode                      string
	ErrorMessage                   string
	SourceBroadcastedAtUnixMs      int64
	DestinationBroadcastedAtUnixMs int64
	CreatedAtUnixMs                int64
	UpdatedAtUnixMs                int64
}

type CommitForkOperationRequest struct {
	OperationID      string
	FloretTurnRefs   []ForkTurnRef
	FloretResultJSON string
	UpdatedAtUnixMs  int64
}

type forkSnapshotV1 struct {
	SchemaVersion    int                           `json:"schema_version"`
	Request          forkSnapshotRequest           `json:"request"`
	SourceThread     Thread                        `json:"source_thread"`
	Messages         []forkSnapshotMessage         `json:"messages"`
	Turns            []forkSnapshotTurn            `json:"turns"`
	StructuredInputs []forkSnapshotStructuredInput `json:"structured_inputs"`
	Todos            *forkSnapshotTodos            `json:"todos,omitempty"`
	MemoryItems      []forkSnapshotMemoryItem      `json:"memory_items"`
	UploadRefs       []forkSnapshotUploadRef       `json:"upload_refs"`
	FlowerMetadata   *forkSnapshotFlowerMetadata   `json:"flower_metadata,omitempty"`
}

type forkSnapshotRequest struct {
	EndpointID            string `json:"endpoint_id"`
	SourceThreadID        string `json:"source_thread_id"`
	DestinationThreadID   string `json:"destination_thread_id"`
	Title                 string `json:"title"`
	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	CreatedAtUnixMs       int64  `json:"created_at_unix_ms"`
}

type forkSnapshotMessage struct {
	MessageID          string `json:"message_id"`
	Role               string `json:"role"`
	AuthorUserPublicID string `json:"author_user_public_id"`
	AuthorUserEmail    string `json:"author_user_email"`
	Status             string `json:"status"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	TextContent        string `json:"text_content"`
	MessageJSON        string `json:"message_json"`
}

type forkSnapshotTurn struct {
	TurnID             string `json:"turn_id"`
	RunID              string `json:"run_id"`
	UserMessageID      string `json:"user_message_id"`
	AssistantMessageID string `json:"assistant_message_id"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
}

type forkSnapshotStructuredInput struct {
	ResponseMessageID   string `json:"response_message_id"`
	PromptID            string `json:"prompt_id"`
	ToolID              string `json:"tool_id"`
	ReasonCode          string `json:"reason_code"`
	QuestionID          string `json:"question_id"`
	Header              string `json:"header"`
	QuestionText        string `json:"question_text"`
	SelectedChoiceID    string `json:"selected_choice_id"`
	SelectedChoiceLabel string `json:"selected_choice_label"`
	ResponseText        string `json:"response_text"`
	PublicSummary       string `json:"public_summary"`
	ContainsSecret      bool   `json:"contains_secret"`
	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
}

type forkSnapshotTodos struct {
	Version         int64  `json:"version"`
	TodosJSON       string `json:"todos_json"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
}

type forkSnapshotMemoryItem struct {
	MemoryID        string  `json:"memory_id"`
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

type forkSnapshotUploadRef struct {
	UploadID        string `json:"upload_id"`
	RefKind         string `json:"ref_kind"`
	RefID           string `json:"ref_id"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

type forkSnapshotFlowerMetadata struct {
	OwnerKind           string `json:"owner_kind"`
	OwnerID             string `json:"owner_id"`
	ContextJSON         string `json:"context_json"`
	ActionJSON          string `json:"action_json"`
	HomeRuntimeID       string `json:"home_runtime_id"`
	HomeRuntimeKind     string `json:"home_runtime_kind"`
	OriginEnvPublicID   string `json:"origin_env_public_id"`
	PrimaryTargetID     string `json:"primary_target_id"`
	ActiveTargetIDsJSON string `json:"active_target_ids_json"`
}

func (s *Store) PrepareForkOperation(ctx context.Context, req ForkThreadRequest) (*ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := normalizeForkThreadRequest(&req); err != nil {
		return nil, err
	}
	fingerprint, err := forkRequestFingerprint(req)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := loadForkOperationTx(ctx, tx, req.OperationID)
	if err == nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, ErrForkOperationConflict
		}
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var destinationCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, req.EndpointID, req.DestinationThreadID).Scan(&destinationCount); err != nil {
		return nil, err
	}
	if destinationCount != 0 {
		return nil, ErrForkDestinationConflict
	}

	snapshot, err := captureForkSnapshotV1(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.OperationID, req.EndpointID, req.SourceThreadID, req.DestinationThreadID,
		fingerprint, string(ForkOperationPending), ForkSnapshotSchemaVersion, string(snapshotJSON),
		req.CreatedAtUnixMs, req.CreatedAtUnixMs)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, ErrForkDestinationConflict
		}
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ForkOperation{
		OperationID:           req.OperationID,
		EndpointID:            req.EndpointID,
		SourceThreadID:        req.SourceThreadID,
		DestinationThreadID:   req.DestinationThreadID,
		RequestFingerprint:    fingerprint,
		Status:                ForkOperationPending,
		SnapshotSchemaVersion: ForkSnapshotSchemaVersion,
		SnapshotJSON:          string(snapshotJSON),
		CreatedAtUnixMs:       req.CreatedAtUnixMs,
		UpdatedAtUnixMs:       req.CreatedAtUnixMs,
	}, nil
}

func (s *Store) CommitForkOperation(ctx context.Context, req CommitForkOperationRequest) (*Thread, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	req.FloretResultJSON = strings.TrimSpace(req.FloretResultJSON)
	if req.OperationID == "" || req.UpdatedAtUnixMs <= 0 {
		return nil, errors.New("invalid fork commit request")
	}
	if req.FloretResultJSON == "" || !json.Valid([]byte(req.FloretResultJSON)) {
		return nil, errors.New("invalid Floret fork result JSON")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	operation, err := loadForkOperationTx(ctx, tx, req.OperationID)
	if err != nil {
		return nil, err
	}
	switch operation.Status {
	case ForkOperationCommitted:
		return loadForkDestinationThreadTx(ctx, tx, operation)
	case ForkOperationFailed:
		return nil, fmt.Errorf("%w: %s", ErrForkOperationFailed, strings.TrimSpace(operation.ErrorMessage))
	case ForkOperationPending:
	default:
		return nil, fmt.Errorf("unsupported fork operation status %q", operation.Status)
	}
	var destinationCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, operation.EndpointID, operation.DestinationThreadID).Scan(&destinationCount); err != nil {
		return nil, err
	}
	if destinationCount != 0 {
		return nil, ErrForkDestinationConflict
	}
	var snapshot forkSnapshotV1
	if operation.SnapshotSchemaVersion != ForkSnapshotSchemaVersion || strings.TrimSpace(operation.SnapshotJSON) == "" {
		return nil, fmt.Errorf("unsupported fork snapshot schema %d", operation.SnapshotSchemaVersion)
	}
	if err := json.Unmarshal([]byte(operation.SnapshotJSON), &snapshot); err != nil {
		return nil, fmt.Errorf("decode fork snapshot: %w", err)
	}
	if err := validateForkSnapshot(operation, snapshot); err != nil {
		return nil, err
	}
	if err := materializeForkSnapshotV1(ctx, tx, snapshot, req.FloretTurnRefs); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
UPDATE ai_thread_fork_operations
SET status = ?, snapshot_json = '', floret_result_json = ?, error_code = '', error_message = '', updated_at_unix_ms = ?
WHERE operation_id = ? AND status = ?
`, string(ForkOperationCommitted), req.FloretResultJSON, req.UpdatedAtUnixMs, req.OperationID, string(ForkOperationPending))
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, ErrForkOperationConflict
	}
	out, err := loadForkDestinationThreadTx(ctx, tx, operation)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListPendingForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, forkOperationSelectSQL+`
WHERE status = ?
ORDER BY updated_at_unix_ms ASC, operation_id ASC
LIMIT ?
`, string(ForkOperationPending), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ForkOperation, 0)
	for rows.Next() {
		var operation ForkOperation
		if err := scanForkOperation(rows, &operation); err != nil {
			return nil, err
		}
		out = append(out, operation)
	}
	return out, rows.Err()
}

func (s *Store) ListUnbroadcastCommittedForkOperations(ctx context.Context, limit int) ([]ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, forkOperationSelectSQL+`
WHERE status = ?
  AND (source_broadcasted_at_unix_ms = 0 OR destination_broadcasted_at_unix_ms = 0)
ORDER BY updated_at_unix_ms ASC, operation_id ASC
LIMIT ?
`, string(ForkOperationCommitted), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ForkOperation, 0)
	for rows.Next() {
		var operation ForkOperation
		if err := scanForkOperation(rows, &operation); err != nil {
			return nil, err
		}
		out = append(out, operation)
	}
	return out, rows.Err()
}

func (s *Store) GetForkOperation(ctx context.Context, operationID string) (*ForkOperation, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return loadForkOperationRow(s.db.QueryRowContext(ctx, forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func (s *Store) RecordForkOperationFailure(ctx context.Context, operationID string, code string, message string, terminal bool, updatedAtUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	status := ForkOperationPending
	if terminal {
		status = ForkOperationFailed
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE ai_thread_fork_operations
SET status = ?, retry_count = retry_count + 1, error_code = ?, error_message = ?, updated_at_unix_ms = ?
WHERE operation_id = ? AND status = ?
`, string(status), strings.TrimSpace(code), strings.TrimSpace(message), updatedAtUnixMs, strings.TrimSpace(operationID), string(ForkOperationPending))
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrForkOperationConflict
	}
	return nil
}

func (s *Store) MarkForkOperationBroadcasted(ctx context.Context, operationID string, source bool, atUnixMs int64) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	column := "destination_broadcasted_at_unix_ms"
	if source {
		column = "source_broadcasted_at_unix_ms"
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ai_thread_fork_operations SET `+column+` = ?, updated_at_unix_ms = ? WHERE operation_id = ? AND status = ? AND `+column+` = 0`, atUnixMs, atUnixMs, strings.TrimSpace(operationID), string(ForkOperationCommitted))
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrForkOperationConflict
	}
	return nil
}

const forkOperationSelectSQL = `
SELECT operation_id, endpoint_id, source_thread_id, destination_thread_id,
       request_fingerprint, status, snapshot_schema_version, snapshot_json,
       floret_result_json, retry_count, error_code, error_message,
       source_broadcasted_at_unix_ms, destination_broadcasted_at_unix_ms,
       created_at_unix_ms, updated_at_unix_ms
FROM ai_thread_fork_operations
`

type forkOperationScanner interface {
	Scan(dest ...any) error
}

func scanForkOperation(scanner forkOperationScanner, operation *ForkOperation) error {
	if operation == nil {
		return errors.New("nil fork operation")
	}
	return scanner.Scan(
		&operation.OperationID,
		&operation.EndpointID,
		&operation.SourceThreadID,
		&operation.DestinationThreadID,
		&operation.RequestFingerprint,
		&operation.Status,
		&operation.SnapshotSchemaVersion,
		&operation.SnapshotJSON,
		&operation.FloretResultJSON,
		&operation.RetryCount,
		&operation.ErrorCode,
		&operation.ErrorMessage,
		&operation.SourceBroadcastedAtUnixMs,
		&operation.DestinationBroadcastedAtUnixMs,
		&operation.CreatedAtUnixMs,
		&operation.UpdatedAtUnixMs,
	)
}

func loadForkOperationTx(ctx context.Context, tx *sql.Tx, operationID string) (*ForkOperation, error) {
	return loadForkOperationRow(tx.QueryRowContext(ctx, forkOperationSelectSQL+` WHERE operation_id = ?`, strings.TrimSpace(operationID)))
}

func loadForkOperationRow(row *sql.Row) (*ForkOperation, error) {
	var operation ForkOperation
	if err := scanForkOperation(row, &operation); err != nil {
		return nil, err
	}
	return &operation, nil
}

func loadForkDestinationThreadTx(ctx context.Context, tx *sql.Tx, operation *ForkOperation) (*Thread, error) {
	if operation == nil {
		return nil, errors.New("nil fork operation")
	}
	var out Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), operation.EndpointID, operation.DestinationThreadID), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func normalizeForkThreadRequest(req *ForkThreadRequest) error {
	if req == nil {
		return errors.New("nil fork request")
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.SourceThreadID = strings.TrimSpace(req.SourceThreadID)
	req.DestinationThreadID = strings.TrimSpace(req.DestinationThreadID)
	req.Title = strings.TrimSpace(req.Title)
	req.CreatedByUserPublicID = strings.TrimSpace(req.CreatedByUserPublicID)
	req.CreatedByUserEmail = strings.TrimSpace(req.CreatedByUserEmail)
	if req.OperationID == "" || req.EndpointID == "" || req.SourceThreadID == "" || req.DestinationThreadID == "" || req.CreatedAtUnixMs <= 0 {
		return errors.New("invalid fork request")
	}
	if req.SourceThreadID == req.DestinationThreadID {
		return errors.New("fork destination must differ from source")
	}
	if len(req.Title) > 200 {
		return errors.New("title too long")
	}
	return nil
}

func forkRequestFingerprint(req ForkThreadRequest) (string, error) {
	payload := forkSnapshotRequest{
		EndpointID:            req.EndpointID,
		SourceThreadID:        req.SourceThreadID,
		DestinationThreadID:   req.DestinationThreadID,
		Title:                 req.Title,
		CreatedByUserPublicID: req.CreatedByUserPublicID,
		CreatedByUserEmail:    req.CreatedByUserEmail,
		CreatedAtUnixMs:       req.CreatedAtUnixMs,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func validateForkSnapshot(operation *ForkOperation, snapshot forkSnapshotV1) error {
	if operation == nil {
		return errors.New("nil fork operation")
	}
	if snapshot.SchemaVersion != ForkSnapshotSchemaVersion {
		return fmt.Errorf("unsupported fork snapshot schema %d", snapshot.SchemaVersion)
	}
	if snapshot.Request.EndpointID != operation.EndpointID ||
		snapshot.Request.SourceThreadID != operation.SourceThreadID ||
		snapshot.Request.DestinationThreadID != operation.DestinationThreadID ||
		snapshot.SourceThread.EndpointID != operation.EndpointID ||
		snapshot.SourceThread.ThreadID != operation.SourceThreadID {
		return errors.New("fork snapshot identity mismatch")
	}
	return nil
}

func captureForkSnapshotV1(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (forkSnapshotV1, error) {
	var source Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT %s FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, threadSelectColumnsSQL), req.EndpointID, req.SourceThreadID), &source); err != nil {
		return forkSnapshotV1{}, err
	}
	title := req.Title
	if title == "" {
		title = strings.TrimSpace(source.Title)
	}
	snapshot := forkSnapshotV1{
		SchemaVersion: ForkSnapshotSchemaVersion,
		Request: forkSnapshotRequest{
			EndpointID:            req.EndpointID,
			SourceThreadID:        req.SourceThreadID,
			DestinationThreadID:   req.DestinationThreadID,
			Title:                 title,
			CreatedByUserPublicID: req.CreatedByUserPublicID,
			CreatedByUserEmail:    req.CreatedByUserEmail,
			CreatedAtUnixMs:       req.CreatedAtUnixMs,
		},
		SourceThread: source,
	}
	var err error
	if snapshot.Messages, err = captureForkMessages(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.Turns, err = captureForkTurns(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.StructuredInputs, err = captureForkStructuredInputs(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.Todos, err = captureForkTodos(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.MemoryItems, err = captureForkMemoryItems(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.UploadRefs, err = captureForkUploadRefs(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	if snapshot.FlowerMetadata, err = captureForkFlowerMetadata(ctx, tx, req); err != nil {
		return forkSnapshotV1{}, err
	}
	return snapshot, nil
}

func captureForkMessages(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) ([]forkSnapshotMessage, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT message_id, role, author_user_public_id, author_user_email, status,
       created_at_unix_ms, updated_at_unix_ms, text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]forkSnapshotMessage, 0)
	for rows.Next() {
		var rec forkSnapshotMessage
		if err := rows.Scan(&rec.MessageID, &rec.Role, &rec.AuthorUserPublicID, &rec.AuthorUserEmail, &rec.Status, &rec.CreatedAtUnixMs, &rec.UpdatedAtUnixMs, &rec.TextContent, &rec.MessageJSON); err != nil {
			return nil, err
		}
		if strings.TrimSpace(rec.MessageID) == "" {
			return nil, errors.New("fork source contains message without identity")
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func captureForkTurns(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) ([]forkSnapshotTurn, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT turn_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms
FROM conversation_turns
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]forkSnapshotTurn, 0)
	for rows.Next() {
		var rec forkSnapshotTurn
		if err := rows.Scan(&rec.TurnID, &rec.RunID, &rec.UserMessageID, &rec.AssistantMessageID, &rec.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		if strings.TrimSpace(rec.TurnID) == "" {
			return nil, errors.New("fork source contains turn without identity")
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func captureForkStructuredInputs(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) ([]forkSnapshotStructuredInput, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT response_message_id, prompt_id, tool_id, reason_code, question_id, header, question_text,
       selected_choice_id, selected_choice_label, response_text, public_summary, contains_secret, created_at_unix_ms
FROM structured_user_inputs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]forkSnapshotStructuredInput, 0)
	for rows.Next() {
		var rec forkSnapshotStructuredInput
		var containsSecret int
		if err := rows.Scan(&rec.ResponseMessageID, &rec.PromptID, &rec.ToolID, &rec.ReasonCode, &rec.QuestionID, &rec.Header, &rec.QuestionText, &rec.SelectedChoiceID, &rec.SelectedChoiceLabel, &rec.ResponseText, &rec.PublicSummary, &containsSecret, &rec.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		rec.ContainsSecret = containsSecret != 0
		out = append(out, rec)
	}
	return out, rows.Err()
}

func captureForkTodos(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (*forkSnapshotTodos, error) {
	var rec forkSnapshotTodos
	err := tx.QueryRowContext(ctx, `SELECT version, todos_json, updated_at_unix_ms FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`, req.EndpointID, req.SourceThreadID).Scan(&rec.Version, &rec.TodosJSON, &rec.UpdatedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func captureForkMemoryItems(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) ([]forkSnapshotMemoryItem, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT memory_id, scope, kind, content, source_refs_json, importance, freshness, confidence, created_at_unix_ms, updated_at_unix_ms
FROM memory_items
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY updated_at_unix_ms ASC, memory_id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]forkSnapshotMemoryItem, 0)
	for rows.Next() {
		var rec forkSnapshotMemoryItem
		if err := rows.Scan(&rec.MemoryID, &rec.Scope, &rec.Kind, &rec.Content, &rec.SourceRefsJSON, &rec.Importance, &rec.Freshness, &rec.Confidence, &rec.CreatedAtUnixMs, &rec.UpdatedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func captureForkUploadRefs(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) ([]forkSnapshotUploadRef, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT upload_id, ref_kind, ref_id, created_at_unix_ms
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]forkSnapshotUploadRef, 0)
	for rows.Next() {
		var rec forkSnapshotUploadRef
		if err := rows.Scan(&rec.UploadID, &rec.RefKind, &rec.RefID, &rec.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func captureForkFlowerMetadata(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (*forkSnapshotFlowerMetadata, error) {
	var rec forkSnapshotFlowerMetadata
	err := tx.QueryRowContext(ctx, `
SELECT owner_kind, owner_id, context_json, action_json, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
WHERE endpoint_id = ? AND thread_id = ?
`, req.EndpointID, req.SourceThreadID).Scan(&rec.OwnerKind, &rec.OwnerID, &rec.ContextJSON, &rec.ActionJSON, &rec.HomeRuntimeID, &rec.HomeRuntimeKind, &rec.OriginEnvPublicID, &rec.PrimaryTargetID, &rec.ActiveTargetIDsJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func materializeForkSnapshotV1(ctx context.Context, tx *sql.Tx, snapshot forkSnapshotV1, refs []ForkTurnRef) error {
	req := ForkThreadRequest{
		EndpointID:            snapshot.Request.EndpointID,
		SourceThreadID:        snapshot.Request.SourceThreadID,
		DestinationThreadID:   snapshot.Request.DestinationThreadID,
		Title:                 snapshot.Request.Title,
		CreatedByUserPublicID: snapshot.Request.CreatedByUserPublicID,
		CreatedByUserEmail:    snapshot.Request.CreatedByUserEmail,
		CreatedAtUnixMs:       snapshot.Request.CreatedAtUnixMs,
	}
	if err := insertForkedThreadTx(ctx, tx, req, snapshot.SourceThread, snapshot.Request.Title); err != nil {
		return err
	}
	floretRefs, err := forkTurnRefsBySource(refs)
	if err != nil {
		return err
	}
	messageIDMap := make(map[string]string, len(snapshot.Messages))
	for index, rec := range snapshot.Messages {
		messageIDMap[strings.TrimSpace(rec.MessageID)] = forkScopedID("msg", req.DestinationThreadID, index+1)
	}
	for _, rec := range snapshot.Turns {
		ref, err := forkTurnRefFor(floretRefs, rec.TurnID, rec.RunID)
		if err != nil {
			return err
		}
		userMessageID := strings.TrimSpace(rec.UserMessageID)
		if userMessageID != "" {
			if _, exists := messageIDMap[userMessageID]; !exists {
				return fmt.Errorf("%w: user message %q is absent from the source snapshot", ErrForkResultConflict, userMessageID)
			}
		}
		assistantMessageID := strings.TrimSpace(rec.AssistantMessageID)
		if assistantMessageID == "" {
			continue
		}
		messageIDMap[assistantMessageID] = ref.DestinationTurnID
	}
	replacements := make(map[string]string, len(messageIDMap)+1)
	for source, destination := range messageIDMap {
		replacements[source] = destination
	}
	replacements[req.SourceThreadID] = req.DestinationThreadID
	for _, rec := range snapshot.Turns {
		ref, err := forkTurnRefFor(floretRefs, rec.TurnID, rec.RunID)
		if err != nil {
			return err
		}
		replacements[strings.TrimSpace(rec.TurnID)] = ref.DestinationTurnID
		if strings.TrimSpace(rec.RunID) != "" {
			replacements[strings.TrimSpace(rec.RunID)] = ref.DestinationRunID
		}
	}
	for _, rec := range snapshot.Messages {
		body, err := rewriteMessageJSONForFork(rec.MessageJSON, replacements)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
INSERT INTO transcript_messages(
  thread_id, endpoint_id, message_id, role, author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms, text_content, message_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.DestinationThreadID, req.EndpointID, messageIDMap[strings.TrimSpace(rec.MessageID)], strings.TrimSpace(rec.Role), strings.TrimSpace(rec.AuthorUserPublicID), strings.TrimSpace(rec.AuthorUserEmail), strings.TrimSpace(rec.Status), rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs, strings.TrimSpace(rec.TextContent), body)
		if err != nil {
			return err
		}
	}
	for _, rec := range snapshot.Turns {
		ref, err := forkTurnRefFor(floretRefs, rec.TurnID, rec.RunID)
		if err != nil {
			return err
		}
		createdAt := rec.CreatedAtUnixMs
		if createdAt <= 0 && ref.CreatedAtUnixMs > 0 {
			createdAt = ref.CreatedAtUnixMs
		}
		_, err = tx.ExecContext(ctx, `
INSERT INTO conversation_turns(turn_id, endpoint_id, thread_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, ref.DestinationTurnID, req.EndpointID, req.DestinationThreadID, ref.DestinationRunID, mappedForkID(rec.UserMessageID, messageIDMap), mappedForkID(rec.AssistantMessageID, messageIDMap), createdAt)
		if err != nil {
			return err
		}
	}
	for _, rec := range snapshot.StructuredInputs {
		nextResponseID := mappedForkID(rec.ResponseMessageID, messageIDMap)
		if strings.TrimSpace(nextResponseID) == "" || nextResponseID == strings.TrimSpace(rec.ResponseMessageID) {
			return fmt.Errorf("%w: structured input response %q is not mapped", ErrForkResultConflict, strings.TrimSpace(rec.ResponseMessageID))
		}
		containsSecret := 0
		if rec.ContainsSecret {
			containsSecret = 1
		}
		_, err := tx.ExecContext(ctx, `
INSERT INTO structured_user_inputs(
  endpoint_id, thread_id, response_message_id, prompt_id, tool_id, reason_code,
  question_id, header, question_text, selected_choice_id, selected_choice_label,
  response_text, public_summary, contains_secret, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.EndpointID, req.DestinationThreadID, nextResponseID, strings.TrimSpace(rec.PromptID), strings.TrimSpace(rec.ToolID), strings.TrimSpace(rec.ReasonCode), strings.TrimSpace(rec.QuestionID), strings.TrimSpace(rec.Header), strings.TrimSpace(rec.QuestionText), strings.TrimSpace(rec.SelectedChoiceID), strings.TrimSpace(rec.SelectedChoiceLabel), strings.TrimSpace(rec.ResponseText), strings.TrimSpace(rec.PublicSummary), containsSecret, rec.CreatedAtUnixMs)
		if err != nil {
			return err
		}
	}
	if snapshot.Todos != nil {
		_, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_todos(endpoint_id, thread_id, version, todos_json, updated_at_unix_ms, updated_by_run_id, updated_by_tool_id)
VALUES(?, ?, ?, ?, ?, '', '')
`, req.EndpointID, req.DestinationThreadID, snapshot.Todos.Version, snapshot.Todos.TodosJSON, snapshot.Todos.UpdatedAtUnixMs)
		if err != nil {
			return err
		}
	}
	for index, rec := range snapshot.MemoryItems {
		memoryID := forkMemoryID(req, rec.MemoryID, index+1)
		sourceRefsJSON, err := rewriteForkOptionalJSON(rec.SourceRefsJSON, messageIDMap)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
INSERT INTO memory_items(
  memory_id, endpoint_id, thread_id, scope, kind, content, source_refs_json,
  importance, freshness, confidence, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, memoryID, req.EndpointID, req.DestinationThreadID, normalizeScope(rec.Scope), normalizeMemoryKind(rec.Kind), strings.TrimSpace(rec.Content), sourceRefsJSON, rec.Importance, rec.Freshness, rec.Confidence, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
		if err != nil {
			return err
		}
	}
	for _, rec := range snapshot.UploadRefs {
		nextRefID := mappedForkID(rec.RefID, messageIDMap)
		if strings.TrimSpace(nextRefID) == "" || nextRefID == strings.TrimSpace(rec.RefID) {
			continue
		}
		_, err := tx.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
`, req.EndpointID, strings.TrimSpace(rec.UploadID), req.DestinationThreadID, normalizeUploadRefKind(rec.RefKind), nextRefID, rec.CreatedAtUnixMs)
		if err != nil {
			return err
		}
	}
	if snapshot.FlowerMetadata != nil {
		rec := snapshot.FlowerMetadata
		_, err := tx.ExecContext(ctx, `
INSERT INTO ai_flower_thread_metadata(
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
) VALUES(?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
`, req.EndpointID, req.DestinationThreadID, strings.TrimSpace(rec.OwnerKind), strings.TrimSpace(rec.OwnerID), req.SourceThreadID, rec.ContextJSON, rec.ActionJSON, req.CreatedAtUnixMs, strings.TrimSpace(rec.HomeRuntimeID), strings.TrimSpace(rec.HomeRuntimeKind), strings.TrimSpace(rec.OriginEnvPublicID), strings.TrimSpace(rec.PrimaryTargetID), rec.ActiveTargetIDsJSON)
		if err != nil {
			return err
		}
	}
	return nil
}

func rewriteForkOptionalJSON(raw string, replacements map[string]string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "[]", nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", fmt.Errorf("decode fork JSON references: %w", err)
	}
	value = rewriteJSONIDReferences(value, replacements)
	body, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
