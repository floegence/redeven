package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type DelegatedApprovalRecord struct {
	ActionID            string
	EndpointID          string
	ParentThreadID      string
	ParentRunID         string
	ParentTurnID        string
	SubagentID          string
	ChildThreadID       string
	ChildRunID          string
	ChildTurnID         string
	ChildToolCallID     string
	ApprovalID          string
	RefHash             string
	RequestFingerprint  string
	State               string
	Status              string
	DeliveryState       string
	ChildExecutionState string
	Version             int64
	SurfaceEpoch        int64
	RequestedAtUnixMs   int64
	ResolvedAtUnixMs    int64
	ExpiresAtUnixMs     int64
	ActionJSON          string
	CreatedAtUnixMs     int64
	UpdatedAtUnixMs     int64
}

type DelegatedApprovalDecisionRequest struct {
	EndpointID       string
	ParentThreadID   string
	ActionID         string
	Version          int64
	SurfaceEpoch     int64
	Approved         bool
	NextActionJSON   string
	NextVersion      int64
	ResolvedAtUnixMs int64
	ActorScope       string
	IdempotencyKey   string
	ResponseJSON     string
}

type DelegatedApprovalDecisionResult struct {
	Accepted bool
	Replayed bool
	Conflict bool
	Record   DelegatedApprovalRecord
}

func (s *Store) UpsertDelegatedApprovalRequest(ctx context.Context, rec DelegatedApprovalRecord) error {
	if s == nil || s.db == nil {
		return errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	rec = normalizeDelegatedApprovalRecord(rec)
	if rec.ActionID == "" || rec.EndpointID == "" || rec.ParentThreadID == "" || rec.RefHash == "" || rec.ActionJSON == "" {
		return errors.New("invalid delegated approval record")
	}
	if rec.RequestFingerprint == "" {
		rec.RequestFingerprint = delegatedApprovalRequestFingerprint(rec)
	}
	now := time.Now().UnixMilli()
	if rec.CreatedAtUnixMs <= 0 {
		rec.CreatedAtUnixMs = now
	}
	if rec.UpdatedAtUnixMs <= 0 {
		rec.UpdatedAtUnixMs = now
	}
	if rec.RequestedAtUnixMs <= 0 {
		rec.RequestedAtUnixMs = now
	}
	if rec.Version <= 0 {
		rec.Version = 1
	}
	if rec.SurfaceEpoch <= 0 {
		rec.SurfaceEpoch = 1
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
INSERT OR IGNORE INTO ai_delegated_approval_requests(
  action_id, endpoint_id, parent_thread_id, parent_run_id, parent_turn_id,
  subagent_id, child_thread_id, child_run_id, child_turn_id,
  child_tool_call_id, approval_id, ref_hash, request_fingerprint, state, status,
  delivery_state, child_execution_state, version, surface_epoch,
  requested_at_unix_ms, resolved_at_unix_ms, expires_at_unix_ms,
  action_json, created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, rec.ActionID, rec.EndpointID, rec.ParentThreadID, rec.ParentRunID, rec.ParentTurnID,
		rec.SubagentID, rec.ChildThreadID, rec.ChildRunID, rec.ChildTurnID,
		rec.ChildToolCallID, rec.ApprovalID, rec.RefHash, rec.RequestFingerprint, rec.State, rec.Status,
		rec.DeliveryState, rec.ChildExecutionState, rec.Version, rec.SurfaceEpoch,
		rec.RequestedAtUnixMs, rec.ResolvedAtUnixMs, rec.ExpiresAtUnixMs,
		rec.ActionJSON, rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs)
	if err != nil {
		return err
	}
	inserted, _ := res.RowsAffected()
	if inserted > 0 {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, 'requested', ?, ?, ?)
`, rec.EndpointID, rec.ParentThreadID, rec.ActionID, rec.Version, rec.ActionJSON, rec.CreatedAtUnixMs); err != nil {
			return err
		}
	} else {
		existing, ok, err := getDelegatedApprovalRequestTx(ctx, tx, rec.EndpointID, rec.ParentThreadID, rec.ActionID)
		if err != nil {
			return err
		}
		if ok && existing.RequestFingerprint != "" && existing.RequestFingerprint != rec.RequestFingerprint {
			nextVersion := existing.Version + 1
			nextActionJSON := delegatedApprovalUnavailableActionJSON(existing, "delegated approval request changed before decision", nextVersion)
			if _, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_requests
SET state = 'unavailable',
    status = 'unavailable',
    delivery_state = 'delivery_unavailable',
    version = ?,
    action_json = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND status = 'pending'
`, nextVersion, nextActionJSON, now, rec.EndpointID, rec.ParentThreadID, rec.ActionID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, 'request_fingerprint_mismatch', ?, ?, ?)
`, rec.EndpointID, rec.ParentThreadID, rec.ActionID, nextVersion, delegatedApprovalReasonPayload("delegated approval request changed before decision"), now); err != nil {
				return err
			}
			if err := tx.Commit(); err != nil {
				return err
			}
			return errors.New("delegated approval request fingerprint mismatch")
		}
	}
	return tx.Commit()
}

func (s *Store) SubmitDelegatedApprovalDecisionCAS(ctx context.Context, req DelegatedApprovalDecisionRequest) (DelegatedApprovalDecisionResult, error) {
	if s == nil || s.db == nil {
		return DelegatedApprovalDecisionResult{}, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.ParentThreadID = strings.TrimSpace(req.ParentThreadID)
	req.ActionID = strings.TrimSpace(req.ActionID)
	req.NextActionJSON = strings.TrimSpace(req.NextActionJSON)
	req.ActorScope = strings.TrimSpace(req.ActorScope)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.ResponseJSON = strings.TrimSpace(req.ResponseJSON)
	if req.ResponseJSON == "" {
		req.ResponseJSON = "{}"
	}
	if req.EndpointID == "" || req.ParentThreadID == "" || req.ActionID == "" || req.Version <= 0 || req.SurfaceEpoch <= 0 || req.NextVersion <= req.Version || req.NextActionJSON == "" {
		return DelegatedApprovalDecisionResult{}, errors.New("invalid delegated approval resolution")
	}
	if req.ResolvedAtUnixMs <= 0 {
		req.ResolvedAtUnixMs = time.Now().UnixMilli()
	}
	decision := "reject"
	if req.Approved {
		decision = "approve"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DelegatedApprovalDecisionResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if req.ActorScope != "" && req.IdempotencyKey != "" {
		var existingActionID string
		var existingApproved int
		if err := tx.QueryRowContext(ctx, `
SELECT action_id, approved
FROM ai_delegated_approval_idempotency
WHERE actor_scope = ? AND idempotency_key = ?
`, req.ActorScope, req.IdempotencyKey).Scan(&existingActionID, &existingApproved); err == nil {
			if strings.TrimSpace(existingActionID) == req.ActionID && (existingApproved != 0) == req.Approved {
				rec, ok, err := getDelegatedApprovalRequestTx(ctx, tx, req.EndpointID, req.ParentThreadID, req.ActionID)
				if err != nil {
					return DelegatedApprovalDecisionResult{}, err
				}
				if !ok {
					return DelegatedApprovalDecisionResult{}, nil
				}
				return DelegatedApprovalDecisionResult{Accepted: true, Replayed: true, Record: rec}, tx.Commit()
			}
			return DelegatedApprovalDecisionResult{Conflict: true}, tx.Commit()
		} else if !errors.Is(err, sql.ErrNoRows) {
			return DelegatedApprovalDecisionResult{}, err
		}
	}
	res, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_requests
SET state = ?,
    status = 'resolved',
    delivery_state = 'delivery_pending',
    version = ?,
    action_json = ?,
    resolved_at_unix_ms = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND status = 'pending'
  AND version = ?
  AND surface_epoch = ?
`, decisionStateForApproval(req.Approved), req.NextVersion, req.NextActionJSON, req.ResolvedAtUnixMs, req.ResolvedAtUnixMs, req.EndpointID, req.ParentThreadID, req.ActionID, req.Version, req.SurfaceEpoch)
	if err != nil {
		return DelegatedApprovalDecisionResult{}, err
	}
	changed, _ := res.RowsAffected()
	if changed == 0 {
		return DelegatedApprovalDecisionResult{}, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, req.EndpointID, req.ParentThreadID, req.ActionID, decision, req.NextVersion, req.NextActionJSON, req.ResolvedAtUnixMs); err != nil {
		return DelegatedApprovalDecisionResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_outbox(endpoint_id, parent_thread_id, action_id, decision, delivery_state, payload_json, created_at_unix_ms, delivered_at_unix_ms)
VALUES(?, ?, ?, ?, 'delivery_pending', ?, ?, 0)
`, req.EndpointID, req.ParentThreadID, req.ActionID, decision, req.NextActionJSON, req.ResolvedAtUnixMs); err != nil {
		return DelegatedApprovalDecisionResult{}, err
	}
	if req.ActorScope != "" && req.IdempotencyKey != "" {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_idempotency(actor_scope, idempotency_key, endpoint_id, parent_thread_id, action_id, approved, response_json, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)
`, req.ActorScope, req.IdempotencyKey, req.EndpointID, req.ParentThreadID, req.ActionID, boolToInt(req.Approved), req.ResponseJSON, req.ResolvedAtUnixMs); err != nil {
			return DelegatedApprovalDecisionResult{}, err
		}
	}
	rec, ok, err := getDelegatedApprovalRequestTx(ctx, tx, req.EndpointID, req.ParentThreadID, req.ActionID)
	if err != nil {
		return DelegatedApprovalDecisionResult{}, err
	}
	if !ok {
		return DelegatedApprovalDecisionResult{}, nil
	}
	return DelegatedApprovalDecisionResult{Accepted: true, Record: rec}, tx.Commit()
}

func (s *Store) ResolveDelegatedApprovalRequestCAS(ctx context.Context, endpointID string, parentThreadID string, actionID string, version int64, surfaceEpoch int64, approved bool, nextActionJSON string, nextVersion int64, resolvedAtUnixMs int64) (bool, error) {
	result, err := s.SubmitDelegatedApprovalDecisionCAS(ctx, DelegatedApprovalDecisionRequest{
		EndpointID:       endpointID,
		ParentThreadID:   parentThreadID,
		ActionID:         actionID,
		Version:          version,
		SurfaceEpoch:     surfaceEpoch,
		Approved:         approved,
		NextActionJSON:   nextActionJSON,
		NextVersion:      nextVersion,
		ResolvedAtUnixMs: resolvedAtUnixMs,
	})
	if err != nil {
		return false, err
	}
	return result.Accepted, nil
}

func (s *Store) MarkDelegatedApprovalDelivered(ctx context.Context, endpointID string, parentThreadID string, actionID string, version int64, nextActionJSON string, deliveredAtUnixMs int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	actionID = strings.TrimSpace(actionID)
	nextActionJSON = strings.TrimSpace(nextActionJSON)
	if endpointID == "" || parentThreadID == "" || actionID == "" || version <= 0 || nextActionJSON == "" {
		return false, errors.New("invalid delegated approval delivery")
	}
	if deliveredAtUnixMs <= 0 {
		deliveredAtUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_requests
SET delivery_state = 'delivery_delivered',
    action_json = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND status = 'resolved'
  AND state IN ('approved', 'rejected')
  AND delivery_state = 'delivery_pending'
  AND version = ?
`, nextActionJSON, deliveredAtUnixMs, endpointID, parentThreadID, actionID, version)
	if err != nil {
		return false, err
	}
	changed, _ := res.RowsAffected()
	if changed == 0 {
		return false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_outbox
SET delivery_state = 'delivery_delivered',
    delivered_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND delivery_state = 'delivery_pending'
`, deliveredAtUnixMs, endpointID, parentThreadID, actionID); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, 'delivered', ?, ?, ?)
`, endpointID, parentThreadID, actionID, version, nextActionJSON, deliveredAtUnixMs); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *Store) MarkDelegatedApprovalUnavailable(ctx context.Context, endpointID string, parentThreadID string, actionID string, reason string, nextActionJSON string, nowUnixMs int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	actionID = strings.TrimSpace(actionID)
	nextActionJSON = strings.TrimSpace(nextActionJSON)
	if endpointID == "" || parentThreadID == "" || actionID == "" {
		return false, errors.New("invalid delegated approval unavailable request")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "delegated approval is no longer available"
	}
	if nextActionJSON == "" {
		nextActionJSON = "{}"
	}
	payloadJSON := delegatedApprovalReasonPayload(reason)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_requests
SET state = 'unavailable',
    status = 'unavailable',
    delivery_state = 'delivery_unavailable',
    version = version + 1,
    action_json = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND status IN ('pending', 'resolved')
  AND delivery_state != 'delivery_delivered'
`, nextActionJSON, nowUnixMs, endpointID, parentThreadID, actionID)
	if err != nil {
		return false, err
	}
	changed, _ := res.RowsAffected()
	if changed == 0 {
		return false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
SELECT endpoint_id, parent_thread_id, action_id, 'unavailable', version, ?, ?
FROM ai_delegated_approval_requests
WHERE endpoint_id = ? AND parent_thread_id = ? AND action_id = ?
`, payloadJSON, nowUnixMs, endpointID, parentThreadID, actionID); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *Store) ListDelegatedApprovalRequestsForThread(ctx context.Context, endpointID string, parentThreadID string, limit int) ([]DelegatedApprovalRecord, error) {
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
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, delegatedApprovalSelectSQL+`
WHERE endpoint_id = ? AND parent_thread_id = ?
ORDER BY status = 'pending' DESC, updated_at_unix_ms DESC, action_id ASC
LIMIT ?
`, endpointID, parentThreadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDelegatedApprovalRows(rows)
}

func (s *Store) GetDelegatedApprovalRequest(ctx context.Context, endpointID string, parentThreadID string, actionID string) (DelegatedApprovalRecord, bool, error) {
	if s == nil || s.db == nil {
		return DelegatedApprovalRecord{}, false, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	actionID = strings.TrimSpace(actionID)
	if endpointID == "" || parentThreadID == "" || actionID == "" {
		return DelegatedApprovalRecord{}, false, errors.New("invalid request")
	}
	rows, err := s.db.QueryContext(ctx, delegatedApprovalSelectSQL+`
WHERE endpoint_id = ? AND parent_thread_id = ? AND action_id = ?
LIMIT 1
`, endpointID, parentThreadID, actionID)
	if err != nil {
		return DelegatedApprovalRecord{}, false, err
	}
	defer rows.Close()
	recs, err := scanDelegatedApprovalRows(rows)
	if err != nil {
		return DelegatedApprovalRecord{}, false, err
	}
	if len(recs) == 0 {
		return DelegatedApprovalRecord{}, false, nil
	}
	return recs[0], true, nil
}

func (s *Store) MarkPendingDelegatedApprovalsUnavailable(ctx context.Context, reason string, nowUnixMs int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "runtime restarted before the delegated approval could be delivered"
	}
	rows, err := s.db.QueryContext(ctx, delegatedApprovalSelectSQL+`
WHERE status = 'pending'
   OR (status = 'resolved' AND delivery_state = 'delivery_pending')
ORDER BY updated_at_unix_ms ASC
`)
	if err != nil {
		return 0, err
	}
	pending, err := scanDelegatedApprovalRows(rows)
	_ = rows.Close()
	if err != nil {
		return 0, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	count := int64(0)
	for _, rec := range pending {
		nextVersion := rec.Version + 1
		nextActionJSON := delegatedApprovalUnavailableActionJSON(rec, reason, nextVersion)
		res, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_requests
SET state = 'unavailable',
    status = 'unavailable',
    delivery_state = 'delivery_unavailable',
    version = ?,
    action_json = ?,
    updated_at_unix_ms = ?
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND (status = 'pending' OR (status = 'resolved' AND delivery_state = 'delivery_pending'))
`, nextVersion, nextActionJSON, nowUnixMs, rec.EndpointID, rec.ParentThreadID, rec.ActionID)
		if err != nil {
			return count, err
		}
		changed, _ := res.RowsAffected()
		if changed == 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE ai_delegated_approval_outbox
SET delivery_state = 'delivery_unavailable'
WHERE endpoint_id = ?
  AND parent_thread_id = ?
  AND action_id = ?
  AND delivery_state = 'delivery_pending'
`, rec.EndpointID, rec.ParentThreadID, rec.ActionID); err != nil {
			return count, err
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_delegated_approval_events(endpoint_id, parent_thread_id, action_id, event_type, version, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, 'unavailable', ?, ?, ?)
`, rec.EndpointID, rec.ParentThreadID, rec.ActionID, nextVersion, delegatedApprovalReasonPayload(reason), nowUnixMs); err != nil {
			return count, err
		}
		count++
	}
	return count, tx.Commit()
}

func delegatedApprovalUnavailableActionJSON(rec DelegatedApprovalRecord, reason string, version int64) string {
	payload := map[string]any{}
	if raw := strings.TrimSpace(rec.ActionJSON); raw != "" {
		_ = json.Unmarshal([]byte(raw), &payload)
	}
	payload["action_id"] = strings.TrimSpace(rec.ActionID)
	payload["state"] = "unavailable"
	payload["status"] = "unavailable"
	payload["delivery_state"] = "delivery_unavailable"
	payload["can_approve"] = false
	payload["read_only_reason"] = strings.TrimSpace(reason)
	payload["version"] = version
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

const delegatedApprovalSelectSQL = `
SELECT action_id, endpoint_id, parent_thread_id, parent_run_id, parent_turn_id,
       subagent_id, child_thread_id, child_run_id, child_turn_id,
       child_tool_call_id, approval_id, ref_hash, request_fingerprint, state, status,
       delivery_state, child_execution_state, version, surface_epoch,
       requested_at_unix_ms, resolved_at_unix_ms, expires_at_unix_ms,
       action_json, created_at_unix_ms, updated_at_unix_ms
FROM ai_delegated_approval_requests
`

func scanDelegatedApprovalRows(rows *sql.Rows) ([]DelegatedApprovalRecord, error) {
	out := []DelegatedApprovalRecord{}
	for rows.Next() {
		var rec DelegatedApprovalRecord
		if err := rows.Scan(
			&rec.ActionID, &rec.EndpointID, &rec.ParentThreadID, &rec.ParentRunID, &rec.ParentTurnID,
			&rec.SubagentID, &rec.ChildThreadID, &rec.ChildRunID, &rec.ChildTurnID,
			&rec.ChildToolCallID, &rec.ApprovalID, &rec.RefHash, &rec.RequestFingerprint, &rec.State, &rec.Status,
			&rec.DeliveryState, &rec.ChildExecutionState, &rec.Version, &rec.SurfaceEpoch,
			&rec.RequestedAtUnixMs, &rec.ResolvedAtUnixMs, &rec.ExpiresAtUnixMs,
			&rec.ActionJSON, &rec.CreatedAtUnixMs, &rec.UpdatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		out = append(out, normalizeDelegatedApprovalRecord(rec))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func normalizeDelegatedApprovalRecord(rec DelegatedApprovalRecord) DelegatedApprovalRecord {
	rec.ActionID = strings.TrimSpace(rec.ActionID)
	rec.EndpointID = strings.TrimSpace(rec.EndpointID)
	rec.ParentThreadID = strings.TrimSpace(rec.ParentThreadID)
	rec.ParentRunID = strings.TrimSpace(rec.ParentRunID)
	rec.ParentTurnID = strings.TrimSpace(rec.ParentTurnID)
	rec.SubagentID = strings.TrimSpace(rec.SubagentID)
	rec.ChildThreadID = strings.TrimSpace(rec.ChildThreadID)
	rec.ChildRunID = strings.TrimSpace(rec.ChildRunID)
	rec.ChildTurnID = strings.TrimSpace(rec.ChildTurnID)
	rec.ChildToolCallID = strings.TrimSpace(rec.ChildToolCallID)
	rec.ApprovalID = strings.TrimSpace(rec.ApprovalID)
	rec.RefHash = strings.TrimSpace(rec.RefHash)
	rec.RequestFingerprint = strings.TrimSpace(rec.RequestFingerprint)
	rec.State = strings.TrimSpace(rec.State)
	if rec.State == "" {
		rec.State = "requested"
	}
	rec.Status = strings.TrimSpace(rec.Status)
	if rec.Status == "" {
		rec.Status = "pending"
	}
	rec.DeliveryState = strings.TrimSpace(rec.DeliveryState)
	rec.ChildExecutionState = strings.TrimSpace(rec.ChildExecutionState)
	rec.ActionJSON = strings.TrimSpace(rec.ActionJSON)
	if rec.ActionJSON == "" {
		rec.ActionJSON = "{}"
	}
	return rec
}

func delegatedApprovalRequestFingerprint(rec DelegatedApprovalRecord) string {
	view := struct {
		RefHash         string `json:"ref_hash"`
		ChildToolCallID string `json:"child_tool_call_id"`
		ApprovalID      string `json:"approval_id"`
		ActionJSON      any    `json:"action_json"`
	}{
		RefHash:         strings.TrimSpace(rec.RefHash),
		ChildToolCallID: strings.TrimSpace(rec.ChildToolCallID),
		ApprovalID:      strings.TrimSpace(rec.ApprovalID),
		ActionJSON:      canonicalDelegatedApprovalRequestAction(strings.TrimSpace(rec.ActionJSON)),
	}
	payload, _ := json.Marshal(view)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func canonicalDelegatedApprovalRequestAction(raw string) any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil || payload == nil {
		return raw
	}
	for _, key := range []string{
		"state",
		"status",
		"revision",
		"version",
		"surface_epoch",
		"scope",
		"requested_at_ms",
		"requested_at_unix_ms",
		"resolved_at_ms",
		"resolved_at_unix_ms",
		"expires_at_ms",
		"expires_at_unix_ms",
		"can_approve",
		"expected_seq",
		"read_only_reason",
		"delivery_state",
		"child_execution_state",
		"primary_wait_anchor",
	} {
		delete(payload, key)
	}
	return payload
}

func decisionStateForApproval(approved bool) string {
	if approved {
		return "approved"
	}
	return "rejected"
}

func getDelegatedApprovalRequestTx(ctx context.Context, tx *sql.Tx, endpointID string, parentThreadID string, actionID string) (DelegatedApprovalRecord, bool, error) {
	rows, err := tx.QueryContext(ctx, delegatedApprovalSelectSQL+`
WHERE endpoint_id = ? AND parent_thread_id = ? AND action_id = ?
LIMIT 1
`, endpointID, parentThreadID, actionID)
	if err != nil {
		return DelegatedApprovalRecord{}, false, err
	}
	defer rows.Close()
	recs, err := scanDelegatedApprovalRows(rows)
	if err != nil {
		return DelegatedApprovalRecord{}, false, err
	}
	if len(recs) == 0 {
		return DelegatedApprovalRecord{}, false, nil
	}
	return recs[0], true, nil
}

func delegatedApprovalReasonPayload(reason string) string {
	payload, err := json.Marshal(map[string]string{"reason": strings.TrimSpace(reason)})
	if err != nil {
		return `{"reason":"delegated approval unavailable"}`
	}
	return string(payload)
}
