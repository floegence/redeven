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

var ErrFlowerIdempotencyCollision = errors.New("flower idempotency collision")

type FlowerThreadMetadata struct {
	EndpointID          string `json:"endpoint_id"`
	ThreadID            string `json:"thread_id"`
	OwnerKind           string `json:"owner_kind"`
	OwnerID             string `json:"owner_id"`
	ParentThreadID      string `json:"parent_thread_id"`
	ParentRunID         string `json:"parent_run_id"`
	ContextJSON         string `json:"context_json"`
	ActionJSON          string `json:"action_json"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
	HomeRuntimeID       string `json:"home_runtime_id"`
	HomeRuntimeKind     string `json:"home_runtime_kind"`
	OriginEnvPublicID   string `json:"origin_env_public_id"`
	PrimaryTargetID     string `json:"primary_target_id"`
	ActiveTargetIDsJSON string `json:"active_target_ids_json"`
}

type FlowerTransferRecord struct {
	TransferID          string `json:"transfer_id"`
	EndpointID          string `json:"endpoint_id"`
	SourceThreadID      string `json:"source_thread_id"`
	DestinationThreadID string `json:"destination_thread_id"`
	IdempotencyKey      string `json:"idempotency_key"`
	ManifestHash        string `json:"manifest_hash"`
	ApprovalHash        string `json:"approval_hash"`
	State               string `json:"state"`
	PlanJSON            string `json:"plan_json"`
	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
}

type FlowerHandoffRecord struct {
	HandoffID           string `json:"handoff_id"`
	EndpointID          string `json:"endpoint_id"`
	SourceThreadID      string `json:"source_thread_id"`
	DestinationThreadID string `json:"destination_thread_id"`
	IdempotencyKey      string `json:"idempotency_key"`
	EnvelopeHash        string `json:"envelope_hash"`
	State               string `json:"state"`
	EnvelopeJSON        string `json:"envelope_json"`
	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
}

type sqlContextExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func normalizeFlowerJSON(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "{}", nil
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", err
	}
	if value == nil {
		return "", errors.New("flower JSON value must be an object")
	}
	return raw, nil
}

func normalizeFlowerStringArrayJSON(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "[]", nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return "", err
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return "", errors.New("flower string array contains an empty value")
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	body, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func normalizeFlowerState(raw string, fallback string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return fallback
	}
	return raw
}

func normalizeFlowerThreadMetadata(rec FlowerThreadMetadata) (FlowerThreadMetadata, error) {
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.OwnerKind = strings.TrimSpace(strings.ToLower(rec.OwnerKind))
	rec.OwnerID = strings.TrimSpace(rec.OwnerID)
	rec.ParentThreadID = strings.TrimSpace(rec.ParentThreadID)
	rec.ParentRunID = strings.TrimSpace(rec.ParentRunID)
	var err error
	rec.ContextJSON, err = normalizeFlowerJSON(rec.ContextJSON)
	if err != nil {
		return FlowerThreadMetadata{}, fmt.Errorf("invalid flower context JSON: %w", err)
	}
	rec.ActionJSON, err = normalizeFlowerJSON(rec.ActionJSON)
	if err != nil {
		return FlowerThreadMetadata{}, fmt.Errorf("invalid flower action JSON: %w", err)
	}
	rec.HomeRuntimeID = strings.TrimSpace(rec.HomeRuntimeID)
	rec.HomeRuntimeKind = strings.TrimSpace(strings.ToLower(rec.HomeRuntimeKind))
	rec.OriginEnvPublicID = strings.TrimSpace(rec.OriginEnvPublicID)
	rec.PrimaryTargetID = strings.TrimSpace(rec.PrimaryTargetID)
	rec.ActiveTargetIDsJSON, err = normalizeFlowerStringArrayJSON(rec.ActiveTargetIDsJSON)
	if err != nil {
		return FlowerThreadMetadata{}, fmt.Errorf("invalid flower active target ids JSON: %w", err)
	}
	if rec.EndpointID == "" || rec.ThreadID == "" {
		return FlowerThreadMetadata{}, errors.New("invalid flower thread metadata")
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	return rec, nil
}

func (s *Store) UpsertFlowerThreadMetadata(ctx context.Context, rec FlowerThreadMetadata) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec, err := normalizeFlowerThreadMetadata(rec)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctx, tx, rec.EndpointID, rec.ThreadID); err != nil {
		return err
	}
	if err := upsertFlowerThreadMetadataExec(ctx, tx, rec); err != nil {
		return err
	}
	return tx.Commit()
}

func upsertFlowerThreadMetadataExec(ctx context.Context, exec sqlContextExecutor, rec FlowerThreadMetadata) error {
	if exec == nil {
		return errors.New("store not initialized")
	}
	_, err := exec.ExecContext(ctx, `
INSERT INTO ai_flower_thread_metadata(
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
  owner_kind = excluded.owner_kind,
  owner_id = excluded.owner_id,
  parent_thread_id = excluded.parent_thread_id,
  parent_run_id = excluded.parent_run_id,
  context_json = excluded.context_json,
  action_json = excluded.action_json,
  updated_at_unix_ms = excluded.updated_at_unix_ms,
  home_runtime_id = excluded.home_runtime_id,
  home_runtime_kind = excluded.home_runtime_kind,
  origin_env_public_id = excluded.origin_env_public_id,
  primary_target_id = excluded.primary_target_id,
  active_target_ids_json = excluded.active_target_ids_json
`, rec.EndpointID, rec.ThreadID, rec.OwnerKind, rec.OwnerID, rec.ParentThreadID, rec.ParentRunID, rec.ContextJSON, rec.ActionJSON, rec.UpdatedAtUnixMs, rec.HomeRuntimeID, rec.HomeRuntimeKind, rec.OriginEnvPublicID, rec.PrimaryTargetID, rec.ActiveTargetIDsJSON)
	return err
}

func (s *Store) GetFlowerThreadMetadata(ctx context.Context, endpointID string, threadID string) (*FlowerThreadMetadata, error) {
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

	var rec FlowerThreadMetadata
	err := s.db.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
       context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&rec.EndpointID,
		&rec.ThreadID,
		&rec.OwnerKind,
		&rec.OwnerID,
		&rec.ParentThreadID,
		&rec.ParentRunID,
		&rec.ContextJSON,
		&rec.ActionJSON,
		&rec.UpdatedAtUnixMs,
		&rec.HomeRuntimeID,
		&rec.HomeRuntimeKind,
		&rec.OriginEnvPublicID,
		&rec.PrimaryTargetID,
		&rec.ActiveTargetIDsJSON,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

func (s *Store) ListFlowerThreadMetadataByParent(ctx context.Context, endpointID string, parentThreadID string) ([]FlowerThreadMetadata, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if endpointID == "" || parentThreadID == "" {
		return nil, errors.New("invalid request")
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
       context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
WHERE endpoint_id = ? AND parent_thread_id = ?
ORDER BY updated_at_unix_ms DESC, thread_id ASC
`, endpointID, parentThreadID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make([]FlowerThreadMetadata, 0)
	for rows.Next() {
		var rec FlowerThreadMetadata
		if err := rows.Scan(
			&rec.EndpointID,
			&rec.ThreadID,
			&rec.OwnerKind,
			&rec.OwnerID,
			&rec.ParentThreadID,
			&rec.ParentRunID,
			&rec.ContextJSON,
			&rec.ActionJSON,
			&rec.UpdatedAtUnixMs,
			&rec.HomeRuntimeID,
			&rec.HomeRuntimeKind,
			&rec.OriginEnvPublicID,
			&rec.PrimaryTargetID,
			&rec.ActiveTargetIDsJSON,
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

func (s *Store) InsertFlowerTransfer(ctx context.Context, rec FlowerTransferRecord) (FlowerTransferRecord, error) {
	if s == nil || s.db == nil {
		return FlowerTransferRecord{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var err error
	rec, err = normalizeFlowerTransferRecord(rec)
	if err != nil {
		return FlowerTransferRecord{}, err
	}
	if rec.TransferID == "" || rec.EndpointID == "" || rec.IdempotencyKey == "" || rec.PlanJSON == "{}" || rec.ApprovalHash == "" {
		return FlowerTransferRecord{}, errors.New("invalid flower transfer")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FlowerTransferRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireFlowerThreadRefsWritableTx(ctx, tx, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID); err != nil {
		return FlowerTransferRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_flower_transfers(
  transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
  manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, rec.TransferID, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID, rec.IdempotencyKey, rec.ManifestHash, rec.ApprovalHash, rec.State, rec.PlanJSON, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return FlowerTransferRecord{}, err
		}
		return rec, nil
	}
	if !isUniqueConstraintError(err) {
		return FlowerTransferRecord{}, err
	}
	existing, getErr := scanFlowerTransfer(tx.QueryRowContext(ctx, `
SELECT transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
       manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms
FROM ai_flower_transfers
WHERE endpoint_id = ? AND idempotency_key = ?
`, rec.EndpointID, rec.IdempotencyKey))
	if getErr != nil {
		return FlowerTransferRecord{}, getErr
	}
	if existing != nil && existing.ApprovalHash == rec.ApprovalHash && strings.TrimSpace(existing.PlanJSON) == strings.TrimSpace(rec.PlanJSON) {
		if err := tx.Commit(); err != nil {
			return FlowerTransferRecord{}, err
		}
		return *existing, nil
	}
	return FlowerTransferRecord{}, ErrFlowerIdempotencyCollision
}

func normalizeFlowerTransferRecord(rec FlowerTransferRecord) (FlowerTransferRecord, error) {
	now := time.Now().UnixMilli()
	rec.TransferID = strings.TrimSpace(rec.TransferID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.SourceThreadID = strings.TrimSpace(rec.SourceThreadID)
	rec.DestinationThreadID = strings.TrimSpace(rec.DestinationThreadID)
	rec.IdempotencyKey = strings.TrimSpace(rec.IdempotencyKey)
	rec.ManifestHash = strings.TrimSpace(rec.ManifestHash)
	rec.ApprovalHash = strings.TrimSpace(rec.ApprovalHash)
	rec.State = normalizeFlowerState(rec.State, "planned")
	var err error
	rec.PlanJSON, err = normalizeFlowerJSON(rec.PlanJSON)
	if err != nil {
		return FlowerTransferRecord{}, fmt.Errorf("invalid flower transfer plan JSON: %w", err)
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec, nil
}

func (s *Store) GetFlowerTransferByIdempotencyKey(ctx context.Context, endpointID string, idempotencyKey string) (*FlowerTransferRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if endpointID == "" || idempotencyKey == "" {
		return nil, errors.New("invalid request")
	}
	return s.getFlowerTransfer(ctx, `
SELECT transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
       manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms
FROM ai_flower_transfers
WHERE endpoint_id = ? AND idempotency_key = ?
`, endpointID, idempotencyKey)
}

func (s *Store) getFlowerTransfer(ctx context.Context, q string, args ...any) (*FlowerTransferRecord, error) {
	return scanFlowerTransfer(s.db.QueryRowContext(ctx, q, args...))
}

func scanFlowerTransfer(scanner rowScanner) (*FlowerTransferRecord, error) {
	var rec FlowerTransferRecord
	err := scanner.Scan(
		&rec.TransferID,
		&rec.EndpointID,
		&rec.SourceThreadID,
		&rec.DestinationThreadID,
		&rec.IdempotencyKey,
		&rec.ManifestHash,
		&rec.ApprovalHash,
		&rec.State,
		&rec.PlanJSON,
		&rec.CreatedAtUnixMs,
		&rec.UpdatedAtUnixMs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

func (s *Store) InsertFlowerHandoff(ctx context.Context, rec FlowerHandoffRecord) (FlowerHandoffRecord, error) {
	if s == nil || s.db == nil {
		return FlowerHandoffRecord{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var err error
	rec, err = normalizeFlowerHandoffRecord(rec)
	if err != nil {
		return FlowerHandoffRecord{}, err
	}
	if rec.HandoffID == "" || rec.EndpointID == "" || rec.IdempotencyKey == "" || rec.EnvelopeHash == "" || rec.EnvelopeJSON == "{}" {
		return FlowerHandoffRecord{}, errors.New("invalid flower handoff")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FlowerHandoffRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireFlowerThreadRefsWritableTx(ctx, tx, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID); err != nil {
		return FlowerHandoffRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ai_flower_handoffs(
  handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
  envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, rec.HandoffID, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID, rec.IdempotencyKey, rec.EnvelopeHash, rec.State, rec.EnvelopeJSON, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return FlowerHandoffRecord{}, err
		}
		return rec, nil
	}
	if !isUniqueConstraintError(err) {
		return FlowerHandoffRecord{}, err
	}
	existing, getErr := scanFlowerHandoff(tx.QueryRowContext(ctx, `
SELECT handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
       envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms
FROM ai_flower_handoffs
WHERE endpoint_id = ? AND idempotency_key = ?
`, rec.EndpointID, rec.IdempotencyKey))
	if getErr != nil {
		return FlowerHandoffRecord{}, getErr
	}
	if existing != nil && existing.EnvelopeHash == rec.EnvelopeHash && strings.TrimSpace(existing.EnvelopeJSON) == strings.TrimSpace(rec.EnvelopeJSON) {
		if err := tx.Commit(); err != nil {
			return FlowerHandoffRecord{}, err
		}
		return *existing, nil
	}
	return FlowerHandoffRecord{}, ErrFlowerIdempotencyCollision
}

func normalizeFlowerHandoffRecord(rec FlowerHandoffRecord) (FlowerHandoffRecord, error) {
	now := time.Now().UnixMilli()
	rec.HandoffID = strings.TrimSpace(rec.HandoffID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.SourceThreadID = strings.TrimSpace(rec.SourceThreadID)
	rec.DestinationThreadID = strings.TrimSpace(rec.DestinationThreadID)
	rec.IdempotencyKey = strings.TrimSpace(rec.IdempotencyKey)
	rec.EnvelopeHash = strings.TrimSpace(rec.EnvelopeHash)
	rec.State = normalizeFlowerState(rec.State, "created")
	var err error
	rec.EnvelopeJSON, err = normalizeFlowerJSON(rec.EnvelopeJSON)
	if err != nil {
		return FlowerHandoffRecord{}, fmt.Errorf("invalid flower handoff envelope JSON: %w", err)
	}
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec, nil
}

func (s *Store) GetFlowerHandoffByIdempotencyKey(ctx context.Context, endpointID string, idempotencyKey string) (*FlowerHandoffRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if endpointID == "" || idempotencyKey == "" {
		return nil, errors.New("invalid request")
	}
	return s.getFlowerHandoff(ctx, `
SELECT handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
       envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms
FROM ai_flower_handoffs
WHERE endpoint_id = ? AND idempotency_key = ?
`, endpointID, idempotencyKey)
}

func (s *Store) getFlowerHandoff(ctx context.Context, q string, args ...any) (*FlowerHandoffRecord, error) {
	return scanFlowerHandoff(s.db.QueryRowContext(ctx, q, args...))
}

func scanFlowerHandoff(scanner rowScanner) (*FlowerHandoffRecord, error) {
	var rec FlowerHandoffRecord
	err := scanner.Scan(
		&rec.HandoffID,
		&rec.EndpointID,
		&rec.SourceThreadID,
		&rec.DestinationThreadID,
		&rec.IdempotencyKey,
		&rec.EnvelopeHash,
		&rec.State,
		&rec.EnvelopeJSON,
		&rec.CreatedAtUnixMs,
		&rec.UpdatedAtUnixMs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

func requireFlowerThreadRefsWritableTx(ctx context.Context, tx *sql.Tx, endpointID string, threadIDs ...string) error {
	seen := make(map[string]struct{}, len(threadIDs))
	for _, threadID := range threadIDs {
		threadID = strings.TrimSpace(threadID)
		if threadID == "" {
			continue
		}
		if _, ok := seen[threadID]; ok {
			continue
		}
		seen[threadID] = struct{}{}
		if err := requireThreadWritableTx(ctx, tx, endpointID, threadID); err != nil {
			return err
		}
	}
	return nil
}
