package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// ProviderCapabilityRecord caches product provider/model capability metadata.
type ProviderCapabilityRecord struct {
	ProviderID      string `json:"provider_id"`
	ModelName       string `json:"model_name"`
	CapabilityJSON  string `json:"capability_json"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
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
