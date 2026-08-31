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

func (s *store) containerServiceConfigurationState(ctx context.Context, serviceID string) (ContainerServiceConfigurationState, error) {
	var state ContainerServiceConfigurationState
	var restartRequired int
	err := s.db.QueryRowContext(ctx, `
SELECT service_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
FROM container_service_configuration_state
WHERE service_id = ?
`, strings.TrimSpace(serviceID)).Scan(&state.ServiceID, &state.ConfigurationRevision, &restartRequired, &state.ServiceGeneration, &state.UpdatedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return ContainerServiceConfigurationState{ServiceID: strings.TrimSpace(serviceID)}, nil
	}
	if err != nil {
		return ContainerServiceConfigurationState{}, err
	}
	state.RestartRequired = restartRequired == 1
	return state, nil
}

func (s *store) upsertContainerServiceConfigurationState(ctx context.Context, state ContainerServiceConfigurationState) error {
	if strings.TrimSpace(state.ServiceID) == "" {
		return ErrInvalidRequest
	}
	if state.UpdatedAtUnixMs == 0 {
		state.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	restartRequired := 0
	if state.RestartRequired {
		restartRequired = 1
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO container_service_configuration_state(
  service_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?)
ON CONFLICT(service_id) DO UPDATE SET
  configuration_revision = excluded.configuration_revision,
  restart_required = excluded.restart_required,
  service_generation = excluded.service_generation,
  updated_at_unix_ms = excluded.updated_at_unix_ms
`, strings.TrimSpace(state.ServiceID), strings.TrimSpace(state.ConfigurationRevision), restartRequired, strings.TrimSpace(state.ServiceGeneration), state.UpdatedAtUnixMs)
	return err
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

func (s *store) appendEvent(ctx context.Context, operationID, eventType string, payload json.RawMessage) (Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	op, err := getOperationTx(ctx, tx, "operation_id", operationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Event{}, ErrOperationNotFound
		}
		return Event{}, err
	}
	if op.State.Terminal() {
		return Event{}, ErrOperationTerminal
	}
	now := time.Now().UnixMilli()
	if payload == nil {
		payload = json.RawMessage{}
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE container_resource_operations SET updated_at_unix_ms = ? WHERE operation_id = ?
`, now, operationID); err != nil {
		return Event{}, err
	}
	result, err := tx.ExecContext(ctx, `
INSERT INTO container_resource_operation_events(operation_id, event_type, state, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?)
`, operationID, sanitizeCode(eventType), op.State, string(payload), now)
	if err != nil {
		return Event{}, err
	}
	sequence, err := result.LastInsertId()
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Event{}, err
	}
	return Event{Sequence: sequence, OperationID: operationID, Type: sanitizeCode(eventType), State: op.State, Payload: payload, CreatedAtUnixMs: now}, nil
}

func (s *store) composeProjectDefinitions(ctx context.Context, engine containerengine.Engine, endpointID containerengine.EndpointID) ([]ComposeProjectDefinition, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT project_id, engine, endpoint_id, name, config_paths_json, env_file_path, profiles_json, created_at_unix_ms, updated_at_unix_ms
FROM container_compose_projects
WHERE engine = ? AND endpoint_id = ?
ORDER BY name COLLATE NOCASE ASC, project_id ASC
`, engine, endpointID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var definitions []ComposeProjectDefinition
	for rows.Next() {
		definition, err := scanComposeProjectDefinition(rows)
		if err != nil {
			return nil, err
		}
		definitions = append(definitions, definition)
	}
	return definitions, rows.Err()
}

func (s *store) composeProjectDefinition(ctx context.Context, projectID string) (ComposeProjectDefinition, error) {
	definition, err := scanComposeProjectDefinition(s.db.QueryRowContext(ctx, `
SELECT project_id, engine, endpoint_id, name, config_paths_json, env_file_path, profiles_json, created_at_unix_ms, updated_at_unix_ms
FROM container_compose_projects WHERE project_id = ?
`, projectID))
	if errors.Is(err, sql.ErrNoRows) {
		return ComposeProjectDefinition{}, ErrComposeProjectDefinitionNotFound
	}
	return definition, err
}

func (s *store) createComposeProjectDefinition(ctx context.Context, definition ComposeProjectDefinition) (ComposeProjectDefinition, error) {
	configPaths, err := json.Marshal(definition.ConfigPaths)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	profiles, err := json.Marshal(definition.Profiles)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO container_compose_projects(
  project_id, engine, endpoint_id, name, config_paths_json, env_file_path, profiles_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`, definition.ProjectID, definition.Engine, definition.EndpointID, definition.Name, string(configPaths), definition.EnvFilePath, string(profiles), definition.CreatedAtUnixMs, definition.UpdatedAtUnixMs)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ComposeProjectDefinition{}, fmt.Errorf("%w: a saved Compose project already uses this name", ErrInvalidRequest)
		}
		return ComposeProjectDefinition{}, err
	}
	return definition, nil
}

func (s *store) updateComposeProjectDefinition(ctx context.Context, definition ComposeProjectDefinition) (ComposeProjectDefinition, error) {
	configPaths, err := json.Marshal(definition.ConfigPaths)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	profiles, err := json.Marshal(definition.Profiles)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE container_compose_projects
SET engine = ?, endpoint_id = ?, name = ?, config_paths_json = ?, env_file_path = ?, profiles_json = ?, updated_at_unix_ms = ?
WHERE project_id = ?
`, definition.Engine, definition.EndpointID, definition.Name, string(configPaths), definition.EnvFilePath, string(profiles), definition.UpdatedAtUnixMs, definition.ProjectID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ComposeProjectDefinition{}, fmt.Errorf("%w: a saved Compose project already uses this name", ErrInvalidRequest)
		}
		return ComposeProjectDefinition{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	if count != 1 {
		return ComposeProjectDefinition{}, ErrComposeProjectDefinitionNotFound
	}
	return definition, nil
}

func (s *store) deleteComposeProjectDefinition(ctx context.Context, projectID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM container_compose_projects WHERE project_id = ?`, projectID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrComposeProjectDefinitionNotFound
	}
	return nil
}

func scanComposeProjectDefinition(row rowScanner) (ComposeProjectDefinition, error) {
	var definition ComposeProjectDefinition
	var engine, endpointID, configPaths, profiles string
	if err := row.Scan(&definition.ProjectID, &engine, &endpointID, &definition.Name, &configPaths, &definition.EnvFilePath, &profiles, &definition.CreatedAtUnixMs, &definition.UpdatedAtUnixMs); err != nil {
		return ComposeProjectDefinition{}, err
	}
	definition.Engine = containerengine.Engine(engine)
	definition.EndpointID = containerengine.EndpointID(endpointID)
	if err := json.Unmarshal([]byte(configPaths), &definition.ConfigPaths); err != nil {
		return ComposeProjectDefinition{}, errors.New("saved Compose project paths are invalid")
	}
	if err := json.Unmarshal([]byte(profiles), &definition.Profiles); err != nil {
		return ComposeProjectDefinition{}, errors.New("saved Compose project profiles are invalid")
	}
	return definition, nil
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
