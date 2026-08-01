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
	"time"
)

const (
	PendingTurnAdmissionStageInFlight = "in_flight"
	PendingTurnAdmissionStageSettled  = "settled"
)

type PendingTurnAdmissionReceipt struct {
	QueueID                string
	EndpointID             string
	ThreadID               string
	LogicalRequestID       string
	CommandFingerprint     string
	TurnID                 string
	RunID                  string
	EntryID                string
	PermissionSnapshotID   string
	PermissionSnapshotHash string
	Stage                  string
	CreatedAtUnixMs        int64
	UpdatedAtUnixMs        int64
}

type PendingTurnAdmissionBinding struct {
	QueueID            string
	EndpointID         string
	ThreadID           string
	LogicalRequestID   string
	CommandFingerprint string
	TurnID             string
	RunID              string
	EntryID            string
	PermissionSnapshot PermissionSnapshotRecord
	UploadIDs          []string
	AdmittedAtUnixMs   int64
}

func queuedTurnCommandFingerprint(rec QueuedTurn) (string, error) {
	type command struct {
		QueueID               string `json:"queue_id"`
		EndpointID            string `json:"endpoint_id"`
		ThreadID              string `json:"thread_id"`
		ChannelID             string `json:"channel_id"`
		ModelID               string `json:"model_id"`
		TextContent           string `json:"text_content"`
		AttachmentsJSON       string `json:"attachments_json"`
		ContextActionJSON     string `json:"context_action_json"`
		OptionsJSON           string `json:"options_json"`
		SessionMetaJSON       string `json:"session_meta_json"`
		CreatedByUserPublicID string `json:"created_by_user_public_id"`
		CreatedByUserEmail    string `json:"created_by_user_email"`
	}
	payload, err := json.Marshal(command{
		QueueID: strings.TrimSpace(rec.QueueID), EndpointID: strings.TrimSpace(rec.EndpointID), ThreadID: strings.TrimSpace(rec.ThreadID),
		ChannelID: strings.TrimSpace(rec.ChannelID), ModelID: strings.TrimSpace(rec.ModelID), TextContent: rec.TextContent,
		AttachmentsJSON: strings.TrimSpace(rec.AttachmentsJSON), ContextActionJSON: strings.TrimSpace(rec.ContextActionJSON),
		OptionsJSON: strings.TrimSpace(rec.OptionsJSON), SessionMetaJSON: strings.TrimSpace(rec.SessionMetaJSON),
		CreatedByUserPublicID: strings.TrimSpace(rec.CreatedByUserPublicID), CreatedByUserEmail: strings.TrimSpace(rec.CreatedByUserEmail),
	})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func scanPendingTurnAdmissionReceipt(scanner interface{ Scan(...any) error }) (PendingTurnAdmissionReceipt, error) {
	var rec PendingTurnAdmissionReceipt
	err := scanner.Scan(&rec.QueueID, &rec.EndpointID, &rec.ThreadID, &rec.LogicalRequestID, &rec.CommandFingerprint,
		&rec.TurnID, &rec.RunID, &rec.EntryID, &rec.PermissionSnapshotID, &rec.PermissionSnapshotHash, &rec.Stage,
		&rec.CreatedAtUnixMs, &rec.UpdatedAtUnixMs)
	return rec, err
}

func loadPendingTurnAdmissionReceiptTx(ctx context.Context, tx *sql.Tx, queueID string) (PendingTurnAdmissionReceipt, error) {
	return scanPendingTurnAdmissionReceipt(tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, logical_request_id, command_fingerprint,
       turn_id, run_id, entry_id, permission_snapshot_id, permission_snapshot_hash, stage,
       created_at_unix_ms, updated_at_unix_ms
FROM ai_turn_admission_receipts WHERE queue_id = ?
`, strings.TrimSpace(queueID)))
}

func getQueuedTurnTx(ctx context.Context, tx *sql.Tx, endpointID, threadID, queueID string) (QueuedTurn, error) {
	return scanFollowup(tx.QueryRowContext(ctx, `
SELECT queue_id, endpoint_id, thread_id, channel_id, lane, admission_state, turn_id, run_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json,
       created_by_user_public_id, created_by_user_email, sort_index, created_at_unix_ms, updated_at_unix_ms
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND lane = ?
`, strings.TrimSpace(endpointID), strings.TrimSpace(threadID), strings.TrimSpace(queueID), FollowupLaneQueued))
}

func (s *Store) GetPendingTurnAdmissionReceipt(ctx context.Context, queueID string) (PendingTurnAdmissionReceipt, error) {
	if s == nil || s.db == nil {
		return PendingTurnAdmissionReceipt{}, errors.New("store not initialized")
	}
	return scanPendingTurnAdmissionReceipt(s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT queue_id, endpoint_id, thread_id, logical_request_id, command_fingerprint,
       turn_id, run_id, entry_id, permission_snapshot_id, permission_snapshot_hash, stage,
       created_at_unix_ms, updated_at_unix_ms
FROM ai_turn_admission_receipts WHERE queue_id = ?
`, strings.TrimSpace(queueID)))
}

func (s *Store) BindPendingTurnAdmission(ctx context.Context, req PendingTurnAdmissionBinding) (PendingTurnAdmissionReceipt, int64, error) {
	if s == nil || s.db == nil {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("store not initialized")
	}
	req.QueueID = strings.TrimSpace(req.QueueID)
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.LogicalRequestID = strings.TrimSpace(req.LogicalRequestID)
	req.CommandFingerprint = strings.ToLower(strings.TrimSpace(req.CommandFingerprint))
	req.TurnID = strings.TrimSpace(req.TurnID)
	req.RunID = strings.TrimSpace(req.RunID)
	req.EntryID = strings.TrimSpace(req.EntryID)
	req.UploadIDs = dedupeNonEmptyStrings(req.UploadIDs)
	req.PermissionSnapshot = normalizePermissionSnapshotRecord(req.PermissionSnapshot)
	if req.AdmittedAtUnixMs <= 0 {
		req.AdmittedAtUnixMs = time.Now().UnixMilli()
	}
	if req.QueueID == "" || req.EndpointID == "" || req.ThreadID == "" || req.LogicalRequestID == "" ||
		len(req.CommandFingerprint) != sha256.Size*2 || req.TurnID == "" || req.RunID == "" || req.EntryID == "" {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("invalid pending turn admission binding")
	}
	if req.PermissionSnapshot.EndpointID != req.EndpointID || req.PermissionSnapshot.OwnerThreadID != req.ThreadID || req.PermissionSnapshot.OwnerRunID != req.RunID {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("permission snapshot owner differs from canonical admission")
	}
	if err := validatePermissionSnapshotRecord(req.PermissionSnapshot); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireThreadWritableTx(ctxOrBackground(ctx), tx, req.EndpointID, req.ThreadID); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	receipt, err := loadPendingTurnAdmissionReceiptTx(ctxOrBackground(ctx), tx, req.QueueID)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	if receipt.EndpointID != req.EndpointID || receipt.ThreadID != req.ThreadID || receipt.LogicalRequestID != req.LogicalRequestID || receipt.CommandFingerprint != req.CommandFingerprint {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("pending turn admission receipt identity mismatch")
	}
	if receipt.Stage == PendingTurnAdmissionStageSettled {
		if receipt.TurnID != req.TurnID || receipt.RunID != req.RunID || receipt.EntryID != req.EntryID ||
			receipt.PermissionSnapshotID != req.PermissionSnapshot.SnapshotID || receipt.PermissionSnapshotHash != req.PermissionSnapshot.SnapshotHash {
			return PendingTurnAdmissionReceipt{}, 0, errors.New("settled pending turn admission conflicts with canonical evidence")
		}
		revision, revisionErr := getThreadFollowupsRevisionTx(ctxOrBackground(ctx), tx, req.EndpointID, req.ThreadID)
		if revisionErr != nil {
			return PendingTurnAdmissionReceipt{}, 0, revisionErr
		}
		if err := tx.Commit(); err != nil {
			return PendingTurnAdmissionReceipt{}, 0, err
		}
		return receipt, revision, nil
	}
	var queued QueuedTurn
	queued, err = getQueuedTurnTx(ctxOrBackground(ctx), tx, req.EndpointID, req.ThreadID, req.QueueID)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, fmt.Errorf("pending turn command is missing during admission settlement: %w", err)
	}
	fingerprint, err := queuedTurnCommandFingerprint(queued)
	if err != nil || fingerprint != req.CommandFingerprint || queued.AdmissionState != PendingTurnAdmissionInFlight || queued.TurnID != "" || queued.RunID != "" {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("pending turn command changed during admission")
	}
	if err := insertPermissionSnapshotTx(ctxOrBackground(ctx), tx, req.PermissionSnapshot); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	rows, err := tx.QueryContext(ctxOrBackground(ctx), `SELECT upload_id FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?`, req.EndpointID, req.ThreadID, UploadRefKindQueuedTurn, req.QueueID)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			_ = rows.Close()
			return PendingTurnAdmissionReceipt{}, 0, err
		}
		req.UploadIDs = append(req.UploadIDs, strings.TrimSpace(uploadID))
	}
	if err := rows.Close(); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	if err := bindUploadsToRefTx(ctxOrBackground(ctx), tx, req.EndpointID, req.ThreadID, UploadRefKindThread, req.ThreadID, dedupeNonEmptyStrings(req.UploadIDs), req.AdmittedAtUnixMs, "", "", ""); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ? AND ref_kind = ? AND ref_id = ?`, req.EndpointID, req.ThreadID, UploadRefKindQueuedTurn, req.QueueID); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	result, err := tx.ExecContext(ctxOrBackground(ctx), `DELETE FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ? AND admission_state = ? AND turn_id = '' AND run_id = ''`, req.EndpointID, req.ThreadID, req.QueueID, PendingTurnAdmissionInFlight)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return PendingTurnAdmissionReceipt{}, 0, errors.New("pending turn command changed during admission")
	}
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_turn_admission_receipts
SET turn_id = ?, run_id = ?, entry_id = ?, permission_snapshot_id = ?, permission_snapshot_hash = ?, stage = ?, updated_at_unix_ms = ?
WHERE queue_id = ? AND stage = ? AND turn_id = '' AND run_id = '' AND entry_id = ''
`, req.TurnID, req.RunID, req.EntryID, req.PermissionSnapshot.SnapshotID, req.PermissionSnapshot.SnapshotHash,
		PendingTurnAdmissionStageSettled, req.AdmittedAtUnixMs, req.QueueID, PendingTurnAdmissionStageInFlight); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	revision, err := bumpThreadFollowupsRevisionTx(ctxOrBackground(ctx), tx, req.EndpointID, req.ThreadID)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	receipt, err = loadPendingTurnAdmissionReceiptTx(ctxOrBackground(ctx), tx, req.QueueID)
	if err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	if err := tx.Commit(); err != nil {
		return PendingTurnAdmissionReceipt{}, 0, err
	}
	return receipt, revision, nil
}
