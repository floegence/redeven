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

// FlowerThreadRouting stores Redeven-owned product placement and target policy.
// Agent state, ownership, ancestry, context, and actions belong to Floret.
type FlowerThreadRouting struct {
	EndpointID          string `json:"endpoint_id"`
	ThreadID            string `json:"thread_id"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
	HomeRuntimeID       string `json:"home_runtime_id"`
	HomeRuntimeKind     string `json:"home_runtime_kind"`
	OriginEnvPublicID   string `json:"origin_env_public_id"`
	PrimaryTargetID     string `json:"primary_target_id"`
	ActiveTargetIDsJSON string `json:"active_target_ids_json"`
}

type sqlContextExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
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

func normalizeFlowerThreadRouting(rec FlowerThreadRouting) (FlowerThreadRouting, error) {
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ThreadID = strings.TrimSpace(rec.ThreadID)
	var err error
	rec.HomeRuntimeID = strings.TrimSpace(rec.HomeRuntimeID)
	rec.HomeRuntimeKind = strings.TrimSpace(strings.ToLower(rec.HomeRuntimeKind))
	rec.OriginEnvPublicID = strings.TrimSpace(rec.OriginEnvPublicID)
	rec.PrimaryTargetID = strings.TrimSpace(rec.PrimaryTargetID)
	rec.ActiveTargetIDsJSON, err = normalizeFlowerStringArrayJSON(rec.ActiveTargetIDsJSON)
	if err != nil {
		return FlowerThreadRouting{}, fmt.Errorf("invalid flower active target ids JSON: %w", err)
	}
	if rec.EndpointID == "" || rec.ThreadID == "" {
		return FlowerThreadRouting{}, errors.New("invalid flower thread routing")
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	return rec, nil
}

func hasFlowerThreadRouting(rec FlowerThreadRouting) bool {
	return rec.HomeRuntimeID != "" || rec.HomeRuntimeKind != "" || rec.OriginEnvPublicID != "" ||
		rec.PrimaryTargetID != "" || rec.ActiveTargetIDsJSON != "[]"
}

func (s *Store) UpsertFlowerThreadRouting(ctx context.Context, rec FlowerThreadRouting) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec, err := normalizeFlowerThreadRouting(rec)
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
	if err := upsertFlowerThreadRoutingExec(ctx, tx, rec); err != nil {
		return err
	}
	return tx.Commit()
}

func upsertFlowerThreadRoutingExec(ctx context.Context, exec sqlContextExecutor, rec FlowerThreadRouting) error {
	if exec == nil {
		return errors.New("store not initialized")
	}
	_, err := exec.ExecContext(ctx, `
INSERT INTO ai_flower_thread_routing(
  endpoint_id, thread_id, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, thread_id) DO UPDATE SET
  updated_at_unix_ms = excluded.updated_at_unix_ms,
  home_runtime_id = excluded.home_runtime_id,
  home_runtime_kind = excluded.home_runtime_kind,
  origin_env_public_id = excluded.origin_env_public_id,
  primary_target_id = excluded.primary_target_id,
  active_target_ids_json = excluded.active_target_ids_json
`, rec.EndpointID, rec.ThreadID, rec.UpdatedAtUnixMs, rec.HomeRuntimeID, rec.HomeRuntimeKind, rec.OriginEnvPublicID, rec.PrimaryTargetID, rec.ActiveTargetIDsJSON)
	return err
}

func (s *Store) GetFlowerThreadRouting(ctx context.Context, endpointID string, threadID string) (*FlowerThreadRouting, error) {
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

	var rec FlowerThreadRouting
	err := s.db.QueryRowContext(ctx, `
SELECT endpoint_id, thread_id, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_routing
WHERE endpoint_id = ? AND thread_id = ?
`, endpointID, threadID).Scan(
		&rec.EndpointID,
		&rec.ThreadID,
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
