package containerresource

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

type store struct {
	db *sql.DB
}

func openStore(path string) (*store, error) {
	db, err := sqliteutil.Open(path, schemaSpec())
	if err != nil {
		return nil, err
	}
	result := &store{db: db}
	return result, nil
}

func (s *store) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *store) activeOperations(ctx context.Context) ([]Operation, error) {
	rows, err := s.db.QueryContext(ctx, operationSelectSQL+`
WHERE state IN (?, ?, ?)
ORDER BY created_at_unix_ms ASC, operation_id ASC
`, OperationQueued, OperationRunning, OperationCanceling)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var operations []Operation
	for rows.Next() {
		op, err := scanOperation(rows)
		if err != nil {
			return nil, err
		}
		operations = append(operations, op)
	}
	return operations, rows.Err()
}

func (s *store) interruptActive(ctx context.Context, reconciliations map[string]json.RawMessage) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UnixMilli()
	rows, err := tx.QueryContext(ctx, `
SELECT operation_id
FROM container_resource_operations
WHERE state IN (?, ?, ?)
ORDER BY created_at_unix_ms ASC, operation_id ASC
`, OperationQueued, OperationRunning, OperationCanceling)
	if err != nil {
		return err
	}
	var operationIDs []string
	for rows.Next() {
		var operationID string
		if err := rows.Scan(&operationID); err != nil {
			_ = rows.Close()
			return err
		}
		operationIDs = append(operationIDs, operationID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, operationID := range operationIDs {
		reconciliation := reconciliations[operationID]
		if len(reconciliation) == 0 {
			reconciliation = json.RawMessage(`{"status":"unavailable","reason":"runtime_restarted"}`)
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE container_resource_operations
SET state = ?, error_code = 'runtime_restarted',
    error_message = 'The runtime restarted before this operation reached a terminal state.',
    reconciliation_json = ?, finished_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE operation_id = ?
`, OperationInterrupted, string(reconciliation), now, now, operationID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO container_resource_operation_events(operation_id, event_type, state, payload_json, created_at_unix_ms)
VALUES(?, 'interrupted', ?, ?, ?)
`, operationID, OperationInterrupted, string(reconciliation), now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *store) insertOrExisting(ctx context.Context, op Operation) (Operation, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	existing, err := getOperationTx(ctx, tx, "request_id", op.RequestID)
	if err == nil {
		if existing.RequestHash != op.RequestHash || existing.PlanHash != op.PlanHash || existing.Method != op.Method {
			return Operation{}, false, &IdempotencyConflictError{RequestID: op.RequestID}
		}
		return existing, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Operation{}, false, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO container_resource_operations(
  operation_id, request_id, request_hash, plan_hash, method, engine, endpoint_id,
  resource_kind, resource_identity, state, cancel_requested, error_code, error_message,
  reconciliation_json, created_at_unix_ms, started_at_unix_ms, finished_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', ?, 0, 0, ?)
`, op.OperationID, op.RequestID, op.RequestHash, op.PlanHash, op.Method, op.Engine, op.EndpointID,
		op.ResourceKind, op.ResourceIdentity, op.State, op.CreatedAtUnixMs, op.UpdatedAtUnixMs)
	if err != nil {
		return Operation{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO container_resource_operation_events(operation_id, event_type, state, payload_json, created_at_unix_ms)
VALUES(?, 'queued', ?, '', ?)
`, op.OperationID, op.State, op.CreatedAtUnixMs); err != nil {
		return Operation{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, false, err
	}
	return op, true, nil
}

func (s *store) operation(ctx context.Context, operationID string) (Operation, error) {
	op, err := getOperationDB(ctx, s.db, "operation_id", operationID)
	if errors.Is(err, sql.ErrNoRows) {
		return Operation{}, ErrOperationNotFound
	}
	return op, err
}

func (s *store) operations(ctx context.Context, limit int) ([]Operation, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, operationSelectSQL+`
ORDER BY created_at_unix_ms DESC, operation_id DESC
LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Operation
	for rows.Next() {
		op, err := scanOperation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, op)
	}
	return result, rows.Err()
}

func (s *store) transition(ctx context.Context, operationID string, state OperationState, code, message string, reconciliation json.RawMessage) (Operation, Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := getOperationTx(ctx, tx, "operation_id", operationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Operation{}, Event{}, ErrOperationNotFound
		}
		return Operation{}, Event{}, err
	}
	if current.State.Terminal() {
		return current, Event{}, ErrOperationTerminal
	}
	now := time.Now().UnixMilli()
	startedAt := current.StartedAtUnixMs
	if state == OperationRunning && startedAt == 0 {
		startedAt = now
	}
	finishedAt := int64(0)
	if state.Terminal() {
		finishedAt = now
	}
	if reconciliation == nil {
		reconciliation = json.RawMessage{}
	}
	_, err = tx.ExecContext(ctx, `
UPDATE container_resource_operations
SET state = ?, error_code = ?, error_message = ?, reconciliation_json = ?,
    started_at_unix_ms = ?, finished_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE operation_id = ?
`, state, sanitizeCode(code), sanitizeMessage(message), string(reconciliation), startedAt, finishedAt, now, operationID)
	if err != nil {
		return Operation{}, Event{}, err
	}
	eventType := string(state)
	result, err := tx.ExecContext(ctx, `
INSERT INTO container_resource_operation_events(operation_id, event_type, state, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?)
`, operationID, eventType, state, string(reconciliation), now)
	if err != nil {
		return Operation{}, Event{}, err
	}
	sequence, err := result.LastInsertId()
	if err != nil {
		return Operation{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, Event{}, err
	}
	current.State = state
	current.ErrorCode = sanitizeCode(code)
	current.ErrorMessage = sanitizeMessage(message)
	current.Reconciliation = reconciliation
	current.StartedAtUnixMs = startedAt
	current.FinishedAtUnixMs = finishedAt
	current.UpdatedAtUnixMs = now
	return current, Event{Sequence: sequence, OperationID: operationID, Type: eventType, State: state, Payload: reconciliation, CreatedAtUnixMs: now}, nil
}

func (s *store) requestCancel(ctx context.Context, operationID string) (Operation, Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := getOperationTx(ctx, tx, "operation_id", operationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Operation{}, Event{}, ErrOperationNotFound
		}
		return Operation{}, Event{}, err
	}
	if op.State.Terminal() {
		return op, Event{}, ErrOperationTerminal
	}
	now := time.Now().UnixMilli()
	state := OperationCanceling
	if op.State == OperationQueued {
		state = OperationCanceled
	}
	finishedAt := int64(0)
	if state.Terminal() {
		finishedAt = now
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE container_resource_operations
SET state = ?, cancel_requested = 1, finished_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE operation_id = ?
`, state, finishedAt, now, operationID); err != nil {
		return Operation{}, Event{}, err
	}
	result, err := tx.ExecContext(ctx, `
INSERT INTO container_resource_operation_events(operation_id, event_type, state, payload_json, created_at_unix_ms)
VALUES(?, 'cancel_requested', ?, '', ?)
`, operationID, state, now)
	if err != nil {
		return Operation{}, Event{}, err
	}
	sequence, err := result.LastInsertId()
	if err != nil {
		return Operation{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, Event{}, err
	}
	op.State = state
	op.CancelRequested = true
	op.FinishedAtUnixMs = finishedAt
	op.UpdatedAtUnixMs = now
	return op, Event{Sequence: sequence, OperationID: operationID, Type: "cancel_requested", State: state, CreatedAtUnixMs: now}, nil
}

func (s *store) eventsAfter(ctx context.Context, operationID string, after int64) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT sequence, operation_id, event_type, state, payload_json, created_at_unix_ms
FROM container_resource_operation_events
WHERE operation_id = ? AND sequence > ?
ORDER BY sequence ASC
LIMIT 500
`, operationID, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Event
	for rows.Next() {
		var event Event
		var payload string
		if err := rows.Scan(&event.Sequence, &event.OperationID, &event.Type, &event.State, &payload, &event.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		if payload != "" {
			event.Payload = json.RawMessage(payload)
		}
		result = append(result, event)
	}
	return result, rows.Err()
}

const operationSelectSQL = `
SELECT operation_id, request_id, request_hash, plan_hash, method, engine, endpoint_id,
       resource_kind, resource_identity, state, cancel_requested, error_code, error_message,
       reconciliation_json, created_at_unix_ms, started_at_unix_ms, finished_at_unix_ms, updated_at_unix_ms
FROM container_resource_operations`

type rowScanner interface {
	Scan(dest ...any) error
}

func getOperationDB(ctx context.Context, db *sql.DB, key, value string) (Operation, error) {
	if key != "operation_id" && key != "request_id" {
		return Operation{}, errors.New("invalid operation lookup key")
	}
	return scanOperation(db.QueryRowContext(ctx, operationSelectSQL+" WHERE "+key+" = ?", value))
}

func getOperationTx(ctx context.Context, tx *sql.Tx, key, value string) (Operation, error) {
	if key != "operation_id" && key != "request_id" {
		return Operation{}, errors.New("invalid operation lookup key")
	}
	return scanOperation(tx.QueryRowContext(ctx, operationSelectSQL+" WHERE "+key+" = ?", value))
}

func scanOperation(row rowScanner) (Operation, error) {
	var op Operation
	var endpointID string
	var reconciliation string
	var cancelRequested int
	err := row.Scan(&op.OperationID, &op.RequestID, &op.RequestHash, &op.PlanHash, &op.Method, &op.Engine, &endpointID,
		&op.ResourceKind, &op.ResourceIdentity, &op.State, &cancelRequested, &op.ErrorCode, &op.ErrorMessage,
		&reconciliation, &op.CreatedAtUnixMs, &op.StartedAtUnixMs, &op.FinishedAtUnixMs, &op.UpdatedAtUnixMs)
	if err != nil {
		return Operation{}, err
	}
	op.EndpointID = containerengine.EndpointID(endpointID)
	op.CancelRequested = cancelRequested != 0
	if reconciliation != "" {
		op.Reconciliation = json.RawMessage(reconciliation)
	}
	return op, nil
}

func sanitizeCode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 64 {
		value = value[:64]
	}
	var result strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			result.WriteRune(r)
		}
	}
	if result.Len() == 0 && value != "" {
		return "operation_failed"
	}
	return result.String()
}

func sanitizeMessage(value string) string {
	value = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' {
			return ' '
		}
		return r
	}, strings.TrimSpace(value))
	if len(value) > 512 {
		value = value[:512]
	}
	return value
}

func wrapStoreError(action string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s container resource operation: %w", action, err)
}
