package flowertransfer

import (
	"encoding/json"
	"errors"
	"strings"
)

const HandoffEnvelopeSchemaVersion = 1

const (
	HandoffCompareDistinct   = "distinct"
	HandoffCompareIdempotent = "idempotent"
	HandoffCompareCollision  = "collision"
)

type FlowerHandoffEndpoint struct {
	EndpointID        string `json:"endpoint_id"`
	ThreadID          string `json:"thread_id"`
	RunID             string `json:"run_id,omitempty"`
	UserPublicID      string `json:"user_public_id,omitempty"`
	NamespacePublicID string `json:"namespace_public_id,omitempty"`
}

type FlowerHandoffAction struct {
	ActionID            string          `json:"action_id"`
	Provider            string          `json:"provider,omitempty"`
	SourceSurface       string          `json:"source_surface,omitempty"`
	SourceSurfaceID     string          `json:"source_surface_id,omitempty"`
	SuggestedWorkingDir string          `json:"suggested_working_dir_abs,omitempty"`
	ContextJSON         json.RawMessage `json:"context_json,omitempty"`
}

type FlowerHandoffEnvelopeRequest struct {
	Source           FlowerHandoffEndpoint `json:"source"`
	Destination      FlowerHandoffEndpoint `json:"destination"`
	Action           FlowerHandoffAction   `json:"action"`
	TransferPlanHash string                `json:"transfer_plan_hash,omitempty"`
	CreatedAtUnixMs  int64                 `json:"created_at_unix_ms,omitempty"`
	ExpiresAtUnixMs  int64                 `json:"expires_at_unix_ms,omitempty"`
}

type FlowerHandoffEnvelope struct {
	SchemaVersion    int                   `json:"schema_version"`
	EnvelopeID       string                `json:"envelope_id"`
	IdempotencyKey   string                `json:"idempotency_key"`
	SemanticHash     string                `json:"semantic_hash"`
	EnvelopeHash     string                `json:"envelope_hash"`
	Source           FlowerHandoffEndpoint `json:"source"`
	Destination      FlowerHandoffEndpoint `json:"destination"`
	Action           FlowerHandoffAction   `json:"action"`
	TransferPlanHash string                `json:"transfer_plan_hash,omitempty"`
	CreatedAtUnixMs  int64                 `json:"created_at_unix_ms,omitempty"`
	ExpiresAtUnixMs  int64                 `json:"expires_at_unix_ms,omitempty"`
}

type HandoffCompareResult struct {
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

func BuildFlowerHandoffEnvelope(req FlowerHandoffEnvelopeRequest) (FlowerHandoffEnvelope, error) {
	req = normalizeHandoffRequest(req)
	if err := validateHandoffRequest(req); err != nil {
		return FlowerHandoffEnvelope{}, err
	}
	semantic := handoffSemanticPayload(req)
	semanticHash := mustStableHash(semantic)
	env := FlowerHandoffEnvelope{
		SchemaVersion:    HandoffEnvelopeSchemaVersion,
		EnvelopeID:       shortHashID("fh_", semanticHash),
		IdempotencyKey:   semanticHash,
		SemanticHash:     semanticHash,
		Source:           req.Source,
		Destination:      req.Destination,
		Action:           req.Action,
		TransferPlanHash: req.TransferPlanHash,
		CreatedAtUnixMs:  req.CreatedAtUnixMs,
		ExpiresAtUnixMs:  req.ExpiresAtUnixMs,
	}
	env.EnvelopeHash = mustStableHash(handoffEnvelopeHashPayload(env))
	return env, nil
}

func ValidateFlowerHandoffEnvelope(env FlowerHandoffEnvelope) error {
	normalized, err := BuildFlowerHandoffEnvelope(FlowerHandoffEnvelopeRequest{
		Source:           env.Source,
		Destination:      env.Destination,
		Action:           env.Action,
		TransferPlanHash: env.TransferPlanHash,
		CreatedAtUnixMs:  env.CreatedAtUnixMs,
		ExpiresAtUnixMs:  env.ExpiresAtUnixMs,
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(env.EnvelopeID) != normalized.EnvelopeID {
		return errors.New("handoff envelope_id mismatch")
	}
	if strings.TrimSpace(env.IdempotencyKey) != normalized.IdempotencyKey {
		return errors.New("handoff idempotency_key mismatch")
	}
	if strings.TrimSpace(env.SemanticHash) != normalized.SemanticHash {
		return errors.New("handoff semantic_hash mismatch")
	}
	if strings.TrimSpace(env.EnvelopeHash) != normalized.EnvelopeHash {
		return errors.New("handoff envelope_hash mismatch")
	}
	return nil
}

func CompareFlowerHandoffEnvelope(existing FlowerHandoffEnvelope, incoming FlowerHandoffEnvelope) HandoffCompareResult {
	existingKey := strings.TrimSpace(existing.IdempotencyKey)
	incomingKey := strings.TrimSpace(incoming.IdempotencyKey)
	existingID := strings.TrimSpace(existing.EnvelopeID)
	incomingID := strings.TrimSpace(incoming.EnvelopeID)
	if existingKey == "" || incomingKey == "" || existingID == "" || incomingID == "" {
		return HandoffCompareResult{Status: HandoffCompareCollision, Reason: "missing_identity"}
	}
	if existingID != incomingID && existingKey != incomingKey {
		return HandoffCompareResult{Status: HandoffCompareDistinct}
	}
	if existingID == incomingID &&
		existingKey == incomingKey &&
		strings.TrimSpace(existing.SemanticHash) == strings.TrimSpace(incoming.SemanticHash) &&
		strings.TrimSpace(existing.EnvelopeHash) == strings.TrimSpace(incoming.EnvelopeHash) {
		return HandoffCompareResult{Status: HandoffCompareIdempotent}
	}
	return HandoffCompareResult{Status: HandoffCompareCollision, Reason: "identity_reused_for_different_payload"}
}

func normalizeHandoffRequest(in FlowerHandoffEnvelopeRequest) FlowerHandoffEnvelopeRequest {
	return FlowerHandoffEnvelopeRequest{
		Source:           normalizeHandoffEndpoint(in.Source),
		Destination:      normalizeHandoffEndpoint(in.Destination),
		Action:           normalizeHandoffAction(in.Action),
		TransferPlanHash: strings.TrimSpace(in.TransferPlanHash),
		CreatedAtUnixMs:  in.CreatedAtUnixMs,
		ExpiresAtUnixMs:  in.ExpiresAtUnixMs,
	}
}

func normalizeHandoffEndpoint(in FlowerHandoffEndpoint) FlowerHandoffEndpoint {
	return FlowerHandoffEndpoint{
		EndpointID:        strings.TrimSpace(in.EndpointID),
		ThreadID:          strings.TrimSpace(in.ThreadID),
		RunID:             strings.TrimSpace(in.RunID),
		UserPublicID:      strings.TrimSpace(in.UserPublicID),
		NamespacePublicID: strings.TrimSpace(in.NamespacePublicID),
	}
}

func normalizeHandoffAction(in FlowerHandoffAction) FlowerHandoffAction {
	return FlowerHandoffAction{
		ActionID:            strings.TrimSpace(in.ActionID),
		Provider:            strings.TrimSpace(in.Provider),
		SourceSurface:       strings.TrimSpace(in.SourceSurface),
		SourceSurfaceID:     strings.TrimSpace(in.SourceSurfaceID),
		SuggestedWorkingDir: cleanSlashPath(in.SuggestedWorkingDir),
		ContextJSON:         normalizeRawJSON(in.ContextJSON),
	}
}

func normalizeRawJSON(in json.RawMessage) json.RawMessage {
	raw := strings.TrimSpace(string(in))
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return json.RawMessage(raw)
	}
	canonical, err := stableJSON(value)
	if err != nil {
		return json.RawMessage(raw)
	}
	return json.RawMessage(canonical)
}

func validateHandoffRequest(req FlowerHandoffEnvelopeRequest) error {
	if req.Source.EndpointID == "" || req.Source.ThreadID == "" {
		return errors.New("missing handoff source")
	}
	if req.Destination.EndpointID == "" || req.Destination.ThreadID == "" {
		return errors.New("missing handoff destination")
	}
	if req.Action.ActionID == "" {
		return errors.New("missing handoff action")
	}
	if req.ExpiresAtUnixMs > 0 && req.CreatedAtUnixMs > 0 && req.ExpiresAtUnixMs <= req.CreatedAtUnixMs {
		return errors.New("invalid handoff expiry")
	}
	return nil
}

func handoffSemanticPayload(req FlowerHandoffEnvelopeRequest) map[string]any {
	return map[string]any{
		"schema_version":     HandoffEnvelopeSchemaVersion,
		"source":             req.Source,
		"destination":        req.Destination,
		"action":             req.Action,
		"transfer_plan_hash": req.TransferPlanHash,
	}
}

func handoffEnvelopeHashPayload(env FlowerHandoffEnvelope) map[string]any {
	return map[string]any{
		"schema_version":     HandoffEnvelopeSchemaVersion,
		"envelope_id":        env.EnvelopeID,
		"idempotency_key":    env.IdempotencyKey,
		"semantic_hash":      env.SemanticHash,
		"source":             env.Source,
		"destination":        env.Destination,
		"action":             env.Action,
		"transfer_plan_hash": env.TransferPlanHash,
		"created_at_unix_ms": env.CreatedAtUnixMs,
		"expires_at_unix_ms": env.ExpiresAtUnixMs,
	}
}
