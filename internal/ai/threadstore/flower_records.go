package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	HomeHostID          string `json:"home_host_id"`
	HomeHostKind        string `json:"home_host_kind"`
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

func normalizeFlowerJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "{}"
	}
	return raw
}

func normalizeFlowerStringArrayJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "[]"
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return "[]"
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	body, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(body)
}

func normalizeFlowerState(raw string, fallback string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return fallback
	}
	return raw
}

func (s *Store) UpsertFlowerThreadMetadata(ctx context.Context, rec FlowerThreadMetadata) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	rec.OwnerKind = strings.TrimSpace(strings.ToLower(rec.OwnerKind))
	rec.OwnerID = strings.TrimSpace(rec.OwnerID)
	rec.ParentThreadID = strings.TrimSpace(rec.ParentThreadID)
	rec.ParentRunID = strings.TrimSpace(rec.ParentRunID)
	rec.ContextJSON = normalizeFlowerJSON(rec.ContextJSON)
	rec.ActionJSON = normalizeFlowerJSON(rec.ActionJSON)
	rec.HomeHostID = strings.TrimSpace(rec.HomeHostID)
	rec.HomeHostKind = strings.TrimSpace(strings.ToLower(rec.HomeHostKind))
	rec.OriginEnvPublicID = strings.TrimSpace(rec.OriginEnvPublicID)
	rec.PrimaryTargetID = strings.TrimSpace(rec.PrimaryTargetID)
	rec.ActiveTargetIDsJSON = normalizeFlowerStringArrayJSON(rec.ActiveTargetIDsJSON)
	if rec.EndpointID == "" || rec.ThreadID == "" {
		return errors.New("invalid flower thread metadata")
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}

	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_flower_thread_metadata(
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_host_id, home_host_kind,
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
  home_host_id = excluded.home_host_id,
  home_host_kind = excluded.home_host_kind,
  origin_env_public_id = excluded.origin_env_public_id,
  primary_target_id = excluded.primary_target_id,
  active_target_ids_json = excluded.active_target_ids_json
`, rec.EndpointID, rec.ThreadID, rec.OwnerKind, rec.OwnerID, rec.ParentThreadID, rec.ParentRunID, rec.ContextJSON, rec.ActionJSON, rec.UpdatedAtUnixMs, rec.HomeHostID, rec.HomeHostKind, rec.OriginEnvPublicID, rec.PrimaryTargetID, rec.ActiveTargetIDsJSON)
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
       context_json, action_json, updated_at_unix_ms, home_host_id, home_host_kind,
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
		&rec.HomeHostID,
		&rec.HomeHostKind,
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

func (s *Store) InsertFlowerTransfer(ctx context.Context, rec FlowerTransferRecord) (FlowerTransferRecord, error) {
	if s == nil || s.db == nil {
		return FlowerTransferRecord{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeFlowerTransferRecord(rec)
	if rec.TransferID == "" || rec.EndpointID == "" || rec.IdempotencyKey == "" || rec.PlanJSON == "{}" || rec.ApprovalHash == "" {
		return FlowerTransferRecord{}, errors.New("invalid flower transfer")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_flower_transfers(
  transfer_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
  manifest_hash, approval_hash, state, plan_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.TransferID, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID, rec.IdempotencyKey, rec.ManifestHash, rec.ApprovalHash, rec.State, rec.PlanJSON, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err == nil {
		return rec, nil
	}
	if !isUniqueConstraintError(err) {
		return FlowerTransferRecord{}, err
	}
	existing, getErr := s.GetFlowerTransferByIdempotencyKey(ctx, rec.EndpointID, rec.IdempotencyKey)
	if getErr != nil {
		return FlowerTransferRecord{}, getErr
	}
	if existing != nil && existing.ApprovalHash == rec.ApprovalHash && strings.TrimSpace(existing.PlanJSON) == strings.TrimSpace(rec.PlanJSON) {
		return *existing, nil
	}
	return FlowerTransferRecord{}, ErrFlowerIdempotencyCollision
}

func normalizeFlowerTransferRecord(rec FlowerTransferRecord) FlowerTransferRecord {
	now := time.Now().UnixMilli()
	rec.TransferID = strings.TrimSpace(rec.TransferID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.SourceThreadID = strings.TrimSpace(rec.SourceThreadID)
	rec.DestinationThreadID = strings.TrimSpace(rec.DestinationThreadID)
	rec.IdempotencyKey = strings.TrimSpace(rec.IdempotencyKey)
	rec.ManifestHash = strings.TrimSpace(rec.ManifestHash)
	rec.ApprovalHash = strings.TrimSpace(rec.ApprovalHash)
	rec.State = normalizeFlowerState(rec.State, "planned")
	rec.PlanJSON = normalizeFlowerJSON(rec.PlanJSON)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec
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
	var rec FlowerTransferRecord
	err := s.db.QueryRowContext(ctx, q, args...).Scan(
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
	rec = normalizeFlowerHandoffRecord(rec)
	if rec.HandoffID == "" || rec.EndpointID == "" || rec.IdempotencyKey == "" || rec.EnvelopeHash == "" || rec.EnvelopeJSON == "{}" {
		return FlowerHandoffRecord{}, errors.New("invalid flower handoff")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ai_flower_handoffs(
  handoff_id, endpoint_id, source_thread_id, destination_thread_id, idempotency_key,
  envelope_hash, state, envelope_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.HandoffID, rec.EndpointID, rec.SourceThreadID, rec.DestinationThreadID, rec.IdempotencyKey, rec.EnvelopeHash, rec.State, rec.EnvelopeJSON, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err == nil {
		return rec, nil
	}
	if !isUniqueConstraintError(err) {
		return FlowerHandoffRecord{}, err
	}
	existing, getErr := s.GetFlowerHandoffByIdempotencyKey(ctx, rec.EndpointID, rec.IdempotencyKey)
	if getErr != nil {
		return FlowerHandoffRecord{}, getErr
	}
	if existing != nil && existing.EnvelopeHash == rec.EnvelopeHash && strings.TrimSpace(existing.EnvelopeJSON) == strings.TrimSpace(rec.EnvelopeJSON) {
		return *existing, nil
	}
	return FlowerHandoffRecord{}, ErrFlowerIdempotencyCollision
}

func normalizeFlowerHandoffRecord(rec FlowerHandoffRecord) FlowerHandoffRecord {
	now := time.Now().UnixMilli()
	rec.HandoffID = strings.TrimSpace(rec.HandoffID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.SourceThreadID = strings.TrimSpace(rec.SourceThreadID)
	rec.DestinationThreadID = strings.TrimSpace(rec.DestinationThreadID)
	rec.IdempotencyKey = strings.TrimSpace(rec.IdempotencyKey)
	rec.EnvelopeHash = strings.TrimSpace(rec.EnvelopeHash)
	rec.State = normalizeFlowerState(rec.State, "created")
	rec.EnvelopeJSON = normalizeFlowerJSON(rec.EnvelopeJSON)
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = rec.CreatedAtUnixMs
	}
	return rec
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
	var rec FlowerHandoffRecord
	err := s.db.QueryRowContext(ctx, q, args...).Scan(
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
