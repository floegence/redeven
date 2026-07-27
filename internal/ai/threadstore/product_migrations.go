package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

type productV6ComposerDraft struct {
	endpointID           string
	ownerUserHash        string
	scopeID              string
	revision             int64
	valueJSON            string
	leaseID              string
	leaseHolderID        string
	leaseExpiresAtUnixMs int64
	createdAtUnixMs      int64
	updatedAtUnixMs      int64
	expiresAtUnixMs      int64
}

func migrateProductV7ToV8(tx *sql.Tx, decisions legacyComposerAdmissionDecisionSet) error {
	if err := verifyProductSchemaVersion(tx, 7); err != nil {
		return fmt.Errorf("verify product threadstore v7: %w", err)
	}
	rows, err := tx.Query(`
SELECT endpoint_id, owner_user_hash, scope_id, value_json
FROM ai_composer_drafts
ORDER BY endpoint_id, owner_user_hash, scope_id
`)
	if err != nil {
		return err
	}
	type legacyDraft struct{ endpointID, ownerUserHash, scopeID, valueJSON string }
	var drafts []legacyDraft
	for rows.Next() {
		var draft legacyDraft
		if err := rows.Scan(&draft.endpointID, &draft.ownerUserHash, &draft.scopeID, &draft.valueJSON); err != nil {
			_ = rows.Close()
			return err
		}
		drafts = append(drafts, draft)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	consumedDecisions := map[string]struct{}{}
	for _, draft := range drafts {
		var value composerDraftAdmissionValue
		if _, err := normalizeComposerDraftValue(json.RawMessage(draft.valueJSON)); err != nil {
			return fmt.Errorf("preflight legacy composer draft %q: malformed value: %w", draft.scopeID, err)
		}
		if err := json.Unmarshal([]byte(draft.valueJSON), &value); err != nil {
			return fmt.Errorf("preflight legacy composer draft %q: malformed value: %w", draft.scopeID, err)
		}
		if !value.AdmissionStarted {
			continue
		}
		turnID := strings.TrimSpace(value.ProposedTurnID)
		threadID := strings.TrimSpace(value.TargetThreadID)
		if threadID == "" && strings.TrimSpace(draft.scopeID) != "__new_thread__" {
			threadID = strings.TrimSpace(draft.scopeID)
		}
		if turnID == "" || threadID == "" {
			return fmt.Errorf("preflight legacy composer draft %q: incomplete admission identity", draft.scopeID)
		}
		uploadIDs, err := composerDraftAttachmentIDs(json.RawMessage(draft.valueJSON))
		if err != nil {
			return fmt.Errorf("preflight legacy composer draft %q attachments: %w", draft.scopeID, err)
		}
		queuedID, queued, err := exactLegacyQueuedComposerAdmission(tx, draft, value, threadID, turnID, uploadIDs)
		if err != nil {
			return err
		}
		decisionKey := legacyComposerAdmissionDecisionKey(draft.endpointID, draft.ownerUserHash, draft.scopeID)
		decisionRecord, ok := decisions[decisionKey]
		if !ok {
			return fmt.Errorf("legacy composer admission %s/%s has no frozen preflight decision", threadID, turnID)
		}
		currentAttachments, _, err := readLegacyComposerAttachments(tx, draft.endpointID, draft.ownerUserHash, draft.scopeID, uploadIDs)
		if err != nil {
			return err
		}
		currentAdmission := LegacyComposerAdmission{
			EndpointID: strings.TrimSpace(draft.endpointID), OwnerUserHash: strings.ToLower(strings.TrimSpace(draft.ownerUserHash)),
			ScopeID: strings.TrimSpace(draft.scopeID), ThreadID: threadID, TurnID: turnID, Attachments: currentAttachments,
		}
		if !reflect.DeepEqual(decisionRecord.Admission, currentAdmission) {
			return fmt.Errorf("legacy composer admission %s/%s changed after preflight", threadID, turnID)
		}
		if decisionRecord.Queued != queued {
			return fmt.Errorf("legacy composer admission %s/%s queued state changed after preflight", threadID, turnID)
		}
		consumedDecisions[decisionKey] = struct{}{}
		if queued {
			if err := transferLegacyDraftRefsTx(tx, draft, uploadIDs, threadID, UploadRefKindQueuedTurn, queuedID); err != nil {
				return err
			}
			continue
		}
		if err := validateLegacyComposerAdmissionDecision(currentAdmission, decisionRecord.Decision); err != nil {
			return fmt.Errorf("legacy composer admission %s/%s decision invalid: %w", threadID, turnID, err)
		}
		switch decisionRecord.Decision.State {
		case LegacyComposerAdmissionAdmitted:
			if err := transferLegacyDraftRefsTx(tx, draft, uploadIDs, threadID, UploadRefKindThread, threadID); err != nil {
				return err
			}
		case LegacyComposerAdmissionMissing:
		}
	}
	if len(consumedDecisions) != len(decisions) {
		return errors.New("legacy composer admission preflight decision set does not match migration rows")
	}
	if err := createUploadStagingScopesTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
DELETE FROM ai_upload_refs WHERE ref_kind IN ('draft', 'draft_pending');
UPDATE ai_uploads
SET state = 'deleting', delete_after_unix_ms = 0
WHERE state = 'staged'
  AND NOT EXISTS (
    SELECT 1 FROM ai_upload_refs r
    WHERE r.endpoint_id = ai_uploads.endpoint_id AND r.upload_id = ai_uploads.upload_id
  );
DROP INDEX idx_ai_composer_drafts_expiry;
DROP TABLE ai_composer_drafts;
`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 8)
}

func exactLegacyQueuedComposerAdmission(tx *sql.Tx, draft struct{ endpointID, ownerUserHash, scopeID, valueJSON string }, value composerDraftAdmissionValue, threadID, turnID string, uploadIDs []string) (string, bool, error) {
	var queueID, modelID, textContent, attachmentsJSON, contextActionJSON string
	err := tx.QueryRow(`
SELECT queue_id, model_id, text_content, attachments_json, context_action_json
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND turn_id = ?
`, draft.endpointID, threadID, turnID).Scan(&queueID, &modelID, &textContent, &attachmentsJSON, &contextActionJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var queuedAttachments []struct {
		AttachmentID string `json:"attachment_id"`
	}
	if err := decodeStrictJSON(attachmentsJSON, &queuedAttachments); err != nil {
		return "", false, fmt.Errorf("legacy queued command %q attachments are malformed: %w", queueID, err)
	}
	queuedIDs := make([]string, 0, len(queuedAttachments))
	for _, item := range queuedAttachments {
		queuedIDs = append(queuedIDs, strings.TrimSpace(item.AttachmentID))
	}
	expectedText := value.Text
	if strings.TrimSpace(value.PreparedLongTextAttachmentID) != "" {
		expectedText = ""
	}
	if strings.TrimSpace(modelID) != strings.TrimSpace(value.ModelID) || textContent != expectedText || !reflect.DeepEqual(queuedIDs, uploadIDs) {
		return "", false, fmt.Errorf("legacy queued command %q conflicts with composer admission", queueID)
	}
	if err := validateComposerDraftReferenceAdmission(value.References, contextActionJSON); err != nil {
		return "", false, fmt.Errorf("legacy queued command %q references conflict with composer admission: %w", queueID, err)
	}
	return strings.TrimSpace(queueID), true, nil
}

func transferLegacyDraftRefsTx(tx *sql.Tx, draft struct{ endpointID, ownerUserHash, scopeID, valueJSON string }, uploadIDs []string, threadID, targetRefKind, targetRefID string) error {
	draftRefID := legacyComposerDraftUploadRefID(draft.ownerUserHash, draft.scopeID)
	for _, uploadID := range uploadIDs {
		var count int
		if err := tx.QueryRow(`
SELECT COUNT(1) FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
`, draft.endpointID, uploadID, legacyUploadRefKindDraft, legacyUploadRefKindDraftPending, draftRefID).Scan(&count); err != nil || count != 1 {
			return fmt.Errorf("legacy composer attachment %q does not have one exact draft claim", uploadID)
		}
		if _, err := tx.Exec(`
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, 0)
ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
`, draft.endpointID, uploadID, threadID, targetRefKind, targetRefID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE ai_uploads SET state = ?, delete_after_unix_ms = 0 WHERE endpoint_id = ? AND upload_id = ?`, UploadStateLive, draft.endpointID, uploadID); err != nil {
			return err
		}
	}
	return nil
}

func migrateProductV6ToV7(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 6); err != nil {
		return fmt.Errorf("verify product threadstore v6: %w", err)
	}
	drafts, err := readProductV6ComposerDraftsForMigration(tx)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE ai_composer_drafts RENAME TO product_v6_ai_composer_drafts;
DROP INDEX idx_ai_composer_drafts_expiry;
`); err != nil {
		return err
	}
	if err := createComposerDraftsTableTx(tx); err != nil {
		return err
	}
	for _, draft := range drafts {
		if _, err := tx.Exec(`
INSERT INTO ai_composer_drafts(
  endpoint_id, owner_user_hash, scope_id, revision, value_json,
  lease_id, lease_holder_id, lease_expires_at_unix_ms,
  created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, draft.endpointID, draft.ownerUserHash, draft.scopeID, draft.revision, draft.valueJSON,
			draft.leaseID, draft.leaseHolderID, draft.leaseExpiresAtUnixMs,
			draft.createdAtUnixMs, draft.updatedAtUnixMs, draft.expiresAtUnixMs); err != nil {
			return fmt.Errorf("restore composer draft %q during v7 migration: %w", draft.scopeID, err)
		}
	}
	if _, err := tx.Exec(`DROP TABLE product_v6_ai_composer_drafts`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 7)
}

func readProductV6ComposerDraftsForMigration(tx *sql.Tx) ([]productV6ComposerDraft, error) {
	rows, err := tx.Query(`
SELECT endpoint_id, owner_user_hash, scope_id, revision, value_json,
       lease_id, lease_holder_id, lease_expires_at_unix_ms,
       created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms
FROM ai_composer_drafts
ORDER BY endpoint_id, owner_user_hash, scope_id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	drafts := make([]productV6ComposerDraft, 0)
	for rows.Next() {
		var draft productV6ComposerDraft
		if err := rows.Scan(
			&draft.endpointID,
			&draft.ownerUserHash,
			&draft.scopeID,
			&draft.revision,
			&draft.valueJSON,
			&draft.leaseID,
			&draft.leaseHolderID,
			&draft.leaseExpiresAtUnixMs,
			&draft.createdAtUnixMs,
			&draft.updatedAtUnixMs,
			&draft.expiresAtUnixMs,
		); err != nil {
			return nil, err
		}
		migratedValue, err := migrateComposerDraftValueV6ToV7(draft.valueJSON)
		if err != nil {
			return nil, fmt.Errorf("validate composer draft %q before v7 migration: %w", draft.scopeID, err)
		}
		draft.valueJSON = migratedValue
		drafts = append(drafts, draft)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return drafts, nil
}

func migrateComposerDraftValueV6ToV7(raw string) (string, error) {
	if len(raw) == 0 || len(raw) > 12<<20 || !utf8.ValidString(raw) {
		return "", errors.New("invalid composer draft value")
	}
	var value map[string]any
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil || value == nil {
		return "", errors.New("invalid composer draft value")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return "", errors.New("invalid composer draft value")
	}
	allowed := map[string]struct{}{
		"text": {}, "attachments": {}, "mode": {}, "model_id": {},
		"permission_type": {}, "reasoning_selection": {}, "working_dir": {},
		"proposed_turn_id": {}, "admission_started": {},
		"prepared_long_text_local_id": {}, "prepared_long_text_attachment_id": {},
		"target_thread_id": {}, "capability_revision": {},
	}
	for key := range value {
		if _, ok := allowed[key]; !ok {
			return "", fmt.Errorf("invalid composer draft value field %q", key)
		}
	}
	value["references"] = []any{}
	withReferences, err := json.Marshal(value)
	if err != nil {
		return "", errors.New("invalid composer draft value")
	}
	normalized, err := normalizeComposerDraftValue(withReferences)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

func migrateProductV5ToV6(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 5); err != nil {
		return fmt.Errorf("verify product threadstore v5: %w", err)
	}
	if err := createComposerDraftsTableV6Tx(tx); err != nil {
		return err
	}
	if err := migrateProductV5DraftUploadRefs(tx); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 6)
}

func migrateProductV5DraftUploadRefs(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT r.id, r.ref_id, COALESCE(u.owner_user_hash, ''), u.owner_scope_kind
FROM ai_upload_refs r
JOIN ai_uploads u ON u.endpoint_id = r.endpoint_id AND u.upload_id = r.upload_id
WHERE r.ref_kind IN (?, ?)
ORDER BY r.id ASC
	`, legacyUploadRefKindDraft, legacyUploadRefKindDraftPending)
	if err != nil {
		return err
	}
	type legacyDraftRef struct {
		id            int64
		scopeID       string
		ownerUserHash string
		ownerKind     string
	}
	var refs []legacyDraftRef
	for rows.Next() {
		var ref legacyDraftRef
		if err := rows.Scan(&ref.id, &ref.scopeID, &ref.ownerUserHash, &ref.ownerKind); err != nil {
			_ = rows.Close()
			return err
		}
		refs = append(refs, ref)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, ref := range refs {
		ref.scopeID = strings.TrimSpace(ref.scopeID)
		ref.ownerUserHash = strings.ToLower(strings.TrimSpace(ref.ownerUserHash))
		if ref.scopeID == "" {
			return fmt.Errorf("draft upload reference %d has invalid owner identity", ref.id)
		}
		refID := ref.scopeID
		switch ref.ownerKind {
		case UploadOwnerScopeUser:
			if len(ref.ownerUserHash) != 64 {
				return fmt.Errorf("draft upload reference %d has invalid owner identity", ref.id)
			}
			refID = legacyComposerDraftUploadRefID(ref.ownerUserHash, ref.scopeID)
		case UploadOwnerScopeLegacyThread, UploadOwnerScopeLegacyStagedQuarantine:
			if ref.ownerUserHash != "" {
				return fmt.Errorf("draft upload reference %d has invalid legacy owner identity", ref.id)
			}
		default:
			return fmt.Errorf("draft upload reference %d has invalid owner scope", ref.id)
		}
		if _, err := tx.Exec(`UPDATE ai_upload_refs SET thread_id = ?, ref_id = ? WHERE id = ?`,
			ref.scopeID, refID, ref.id); err != nil {
			return err
		}
	}
	return nil
}

func migrateProductV4ToV5(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 4); err != nil {
		return fmt.Errorf("verify product threadstore v4: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE ai_uploads RENAME TO product_v4_ai_uploads;`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
DROP INDEX idx_ai_uploads_endpoint_created;
DROP INDEX idx_ai_uploads_state_delete_after;
`); err != nil {
		return err
	}
	if err := createUploadResourcesV5Tx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
INSERT INTO ai_uploads(
  upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
  declared_media_type, detected_media_type, size_bytes, content_sha256,
  unicode_code_points, logical_line_count, source, state,
  created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
)
SELECT
  old.upload_id,
  old.endpoint_id,
  CASE WHEN LOWER(COALESCE(old.state, '')) = 'live' AND EXISTS (
    SELECT 1 FROM ai_upload_refs ref
    WHERE ref.endpoint_id = old.endpoint_id AND ref.upload_id = old.upload_id
      AND ref.ref_kind = 'thread'
  ) THEN 'legacy_thread' ELSE 'legacy_staged_quarantine' END,
  NULL,
  old.storage_relpath,
  old.name,
  old.mime_type,
  old.mime_type,
  old.size_bytes,
  '',
  NULL,
  NULL,
  'uploaded_file',
  old.state,
  old.created_at_unix_ms,
  old.claimed_at_unix_ms,
  old.delete_after_unix_ms
FROM product_v4_ai_uploads old;
DROP TABLE product_v4_ai_uploads;
`); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 5)
}

func migrateProductV3ToV4(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 3); err != nil {
		return fmt.Errorf("verify product threadstore v3: %w", err)
	}
	if _, err := tx.Exec(`
CREATE TABLE ai_flower_thread_routing (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  home_runtime_id TEXT NOT NULL DEFAULT '',
  home_runtime_kind TEXT NOT NULL DEFAULT '',
  origin_env_public_id TEXT NOT NULL DEFAULT '',
  primary_target_id TEXT NOT NULL DEFAULT '',
  active_target_ids_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(endpoint_id, thread_id)
);
`); err != nil {
		return err
	}
	rows, err := tx.Query(`
SELECT endpoint_id, thread_id, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
ORDER BY endpoint_id, thread_id
`)
	if err != nil {
		return err
	}
	var routes []FlowerThreadRouting
	for rows.Next() {
		var route FlowerThreadRouting
		if err := rows.Scan(
			&route.EndpointID,
			&route.ThreadID,
			&route.UpdatedAtUnixMs,
			&route.HomeRuntimeID,
			&route.HomeRuntimeKind,
			&route.OriginEnvPublicID,
			&route.PrimaryTargetID,
			&route.ActiveTargetIDsJSON,
		); err != nil {
			_ = rows.Close()
			return err
		}
		originalUpdatedAt := route.UpdatedAtUnixMs
		route, err = normalizeFlowerThreadRouting(route)
		if err != nil {
			_ = rows.Close()
			return fmt.Errorf("migrate product thread routing %q: %w", route.ThreadID, err)
		}
		if originalUpdatedAt <= 0 {
			route.UpdatedAtUnixMs = 0
		}
		if hasFlowerThreadRouting(route) {
			routes = append(routes, route)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, route := range routes {
		if err := upsertFlowerThreadRoutingExec(context.Background(), tx, route); err != nil {
			return err
		}
	}
	if err := migrateProductV3ForkOperationSnapshots(tx); err != nil {
		return err
	}
	_, err = tx.Exec(`
DROP INDEX idx_ai_flower_thread_metadata_owner;
DROP INDEX idx_ai_flower_thread_metadata_parent;
DROP TABLE ai_flower_thread_metadata;
DROP TABLE ai_flower_transfers;
DROP TABLE ai_flower_handoffs;
`)
	return err
}

func migrateProductV2ToV3(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 2); err != nil {
		return fmt.Errorf("verify product threadstore v2: %w", err)
	}
	if err := validateProductV2UploadRefs(tx); err != nil {
		return err
	}
	if err := validateProductV2PermissionSnapshots(tx); err != nil {
		return err
	}
	if err := createThreadCreateOperationsTableTx(tx); err != nil {
		return err
	}
	if err := createSubAgentPublicationOperationsTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE ai_thread_fork_operations ADD COLUMN snapshot_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_thread_delete_operations ADD COLUMN snapshot_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_queued_turns ADD COLUMN admission_state TEXT NOT NULL DEFAULT 'ready';

DROP TRIGGER trg_ai_threads_reject_retired_id;
DROP INDEX idx_ai_threads_endpoint_updated;
DROP INDEX idx_ai_threads_endpoint_pinned_created;
ALTER TABLE ai_threads RENAME TO product_v2_ai_threads;

CREATE TABLE ai_thread_settings (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  working_dir TEXT NOT NULL DEFAULT '',
  pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  queue_revision INTEGER NOT NULL DEFAULT 0,
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  settings_created_at_unix_ms INTEGER NOT NULL,
  settings_updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_settings_endpoint_updated ON ai_thread_settings(endpoint_id, settings_updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_thread_settings_endpoint_pinned_created ON ai_thread_settings(endpoint_id, pinned_at_unix_ms DESC, settings_created_at_unix_ms DESC, thread_id ASC);
INSERT INTO ai_thread_settings(
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, queue_revision,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, settings_created_at_unix_ms, settings_updated_at_unix_ms
)
SELECT
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json,
  permission_type, working_dir, pinned_at_unix_ms, followups_revision,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id,
  updated_by_user_email, created_at_unix_ms, updated_at_unix_ms
FROM product_v2_ai_threads;

DROP INDEX idx_ai_upload_refs_unique_ref;
DROP INDEX idx_ai_upload_refs_thread_upload;
DROP INDEX idx_ai_upload_refs_upload;
ALTER TABLE ai_upload_refs RENAME TO product_v2_ai_upload_refs;
CREATE TABLE ai_upload_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ai_upload_refs_unique_ref ON ai_upload_refs(endpoint_id, upload_id, ref_kind, ref_id);
CREATE INDEX idx_ai_upload_refs_thread_upload ON ai_upload_refs(endpoint_id, thread_id, upload_id);
CREATE INDEX idx_ai_upload_refs_upload ON ai_upload_refs(endpoint_id, upload_id);
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
SELECT endpoint_id, upload_id, thread_id,
       CASE WHEN ref_kind = 'queued_turn' THEN 'queued_turn' ELSE 'thread' END,
       CASE WHEN ref_kind = 'queued_turn' THEN ref_id ELSE thread_id END,
       MIN(created_at_unix_ms)
FROM product_v2_ai_upload_refs
GROUP BY endpoint_id, upload_id, thread_id,
         CASE WHEN ref_kind = 'queued_turn' THEN 'queued_turn' ELSE 'thread' END,
         CASE WHEN ref_kind = 'queued_turn' THEN ref_id ELSE thread_id END;

DELETE FROM ai_permission_snapshots
WHERE CASE
  WHEN json_valid(snapshot_json) THEN COALESCE(CAST(json_extract(snapshot_json, '$.version') AS INTEGER), 0)
  ELSE 0
END <> 2;

DROP INDEX idx_ai_child_permission_snapshots_spawn;
DROP INDEX idx_ai_child_permission_snapshots_parent;
DROP INDEX idx_ai_child_permission_snapshots_child;
ALTER TABLE ai_child_permission_snapshots RENAME TO product_v2_ai_child_permission_snapshots;
CREATE TABLE ai_child_permission_snapshots (
  child_snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_snapshot_id TEXT NOT NULL DEFAULT '',
  spawn_tool_call_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  child_thread_id TEXT NOT NULL DEFAULT '',
  child_run_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'provisional',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  finalized_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_child_permission_snapshots_spawn ON ai_child_permission_snapshots(endpoint_id, spawn_tool_call_id);
CREATE INDEX idx_ai_child_permission_snapshots_parent ON ai_child_permission_snapshots(endpoint_id, parent_thread_id, parent_run_id);
CREATE INDEX idx_ai_child_permission_snapshots_child ON ai_child_permission_snapshots(endpoint_id, child_thread_id);
INSERT INTO ai_child_permission_snapshots(
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, child_thread_id, child_run_id, state,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
)
SELECT
  child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
  parent_thread_id, parent_run_id, child_thread_id, child_run_id, state,
  snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
  created_at_unix_ms, finalized_at_unix_ms
FROM product_v2_ai_child_permission_snapshots
WHERE CASE
  WHEN json_valid(snapshot_json) THEN COALESCE(CAST(json_extract(snapshot_json, '$.version') AS INTEGER), 0)
  ELSE 0
END = 2;
`); err != nil {
		return err
	}
	if err := migrateProductV2ForkOperationSnapshots(tx); err != nil {
		return err
	}
	if err := fingerprintProductV2DeleteOperationSnapshots(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
CREATE TRIGGER trg_ai_thread_settings_reject_retired_id
BEFORE INSERT ON ai_thread_settings
WHEN EXISTS (
  SELECT 1 FROM ai_thread_delete_operations op
  WHERE op.endpoint_id = NEW.endpoint_id AND op.thread_id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'thread id retired');
END;

DROP TABLE product_v2_ai_threads;
DROP TABLE product_v2_ai_upload_refs;
DROP TABLE product_v2_ai_child_permission_snapshots;
`); err != nil {
		return err
	}
	return nil
}

func validateProductV2PermissionSnapshots(tx *sql.Tx) error {
	rows, err := tx.Query(`
	SELECT snapshot_id, endpoint_id, owner_thread_id, owner_run_id, permission_type,
	       snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
	       created_at_unix_ms
	FROM ai_permission_snapshots
	ORDER BY snapshot_id ASC
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var record PermissionSnapshotRecord
		if err := rows.Scan(
			&record.SnapshotID, &record.EndpointID, &record.OwnerThreadID, &record.OwnerRunID, &record.PermissionType,
			&record.SnapshotJSON, &record.SnapshotHash, &record.RegistryHash, &record.SchemaHash, &record.PresentationHash,
			&record.CreatedAtUnixMs,
		); err != nil {
			_ = rows.Close()
			return err
		}
		version, err := permissionsnapshot.Version(record.SnapshotJSON)
		if err != nil {
			_ = rows.Close()
			return fmt.Errorf("permission snapshot %q has invalid version: %w", record.SnapshotID, err)
		}
		switch version {
		case 1:
		case permissionsnapshot.VersionCurrent:
			record = normalizePermissionSnapshotRecord(record)
			if err := validatePermissionSnapshotRecord(record); err != nil {
				_ = rows.Close()
				return fmt.Errorf("permission snapshot %q is invalid: %w", record.SnapshotID, err)
			}
		default:
			_ = rows.Close()
			return fmt.Errorf("permission snapshot %q has unsupported version %d", record.SnapshotID, version)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}

	rows, err = tx.Query(`
	SELECT child_snapshot_id, endpoint_id, parent_snapshot_id, spawn_tool_call_id,
	       parent_thread_id, parent_run_id, child_thread_id, child_run_id, state,
	       snapshot_json, snapshot_hash, registry_hash, schema_hash, presentation_hash,
	       created_at_unix_ms, finalized_at_unix_ms
	FROM ai_child_permission_snapshots
	ORDER BY child_snapshot_id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var record ChildPermissionSnapshotRecord
		if err := rows.Scan(
			&record.ChildSnapshotID, &record.EndpointID, &record.ParentSnapshotID, &record.SpawnToolCallID,
			&record.ParentThreadID, &record.ParentRunID, &record.ChildThreadID, &record.ChildRunID, &record.State,
			&record.SnapshotJSON, &record.SnapshotHash, &record.RegistryHash, &record.SchemaHash, &record.PresentationHash,
			&record.CreatedAtUnixMs, &record.FinalizedAtUnixMs,
		); err != nil {
			return err
		}
		version, err := permissionsnapshot.Version(record.SnapshotJSON)
		if err != nil {
			return fmt.Errorf("child permission snapshot %q has invalid version: %w", record.ChildSnapshotID, err)
		}
		switch version {
		case 1:
		case permissionsnapshot.VersionCurrent:
			record = normalizeChildPermissionSnapshotRecord(record)
			if err := validateChildPermissionSnapshotRecord(record); err != nil {
				return fmt.Errorf("child permission snapshot %q is invalid: %w", record.ChildSnapshotID, err)
			}
		default:
			return fmt.Errorf("child permission snapshot %q has unsupported version %d", record.ChildSnapshotID, version)
		}
	}
	return rows.Err()
}

func validateProductV2UploadRefs(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT endpoint_id, upload_id, thread_id, ref_kind, ref_id
FROM ai_upload_refs
ORDER BY id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var endpointID, uploadID, threadID, refKind, refID string
		if err := rows.Scan(&endpointID, &uploadID, &threadID, &refKind, &refID); err != nil {
			return err
		}
		if strings.TrimSpace(endpointID) == "" || strings.TrimSpace(uploadID) == "" || strings.TrimSpace(threadID) == "" || strings.TrimSpace(refID) == "" {
			return fmt.Errorf("product v2 upload reference has incomplete identity")
		}
		switch refKind {
		case "turn", "run", UploadRefKindThread, UploadRefKindQueuedTurn:
		default:
			return fmt.Errorf("product v2 upload reference has unsupported kind %q", refKind)
		}
	}
	return rows.Err()
}

type productV2ForkSnapshot struct {
	SchemaVersion  int                     `json:"schema_version"`
	Request        forkSnapshotRequest     `json:"request"`
	SourceThread   productV2Thread         `json:"source_thread"`
	UploadRefs     []forkSnapshotUploadRef `json:"upload_refs"`
	FlowerMetadata *legacyFlowerMetadata   `json:"flower_metadata,omitempty"`
}

const legacyForkSnapshotSchemaVersion = 2

type legacyFlowerMetadata struct {
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

func flowerRoutingFromLegacyMetadata(metadata *legacyFlowerMetadata) (*FlowerThreadRouting, error) {
	if metadata == nil {
		return nil, nil
	}
	routing, err := normalizeFlowerThreadRouting(FlowerThreadRouting{
		EndpointID:          metadata.EndpointID,
		ThreadID:            metadata.ThreadID,
		UpdatedAtUnixMs:     metadata.UpdatedAtUnixMs,
		HomeRuntimeID:       metadata.HomeRuntimeID,
		HomeRuntimeKind:     metadata.HomeRuntimeKind,
		OriginEnvPublicID:   metadata.OriginEnvPublicID,
		PrimaryTargetID:     metadata.PrimaryTargetID,
		ActiveTargetIDsJSON: metadata.ActiveTargetIDsJSON,
	})
	if err != nil {
		return nil, err
	}
	if !hasFlowerThreadRouting(routing) {
		return nil, nil
	}
	return &routing, nil
}

type productV2Thread struct {
	ThreadID               string `json:"thread_id"`
	EndpointID             string `json:"endpoint_id"`
	NamespacePublicID      string `json:"namespace_public_id"`
	ModelID                string `json:"model_id"`
	ReasoningSelectionJSON string `json:"reasoning_selection_json"`
	PermissionType         string `json:"permission_type"`
	WorkingDir             string `json:"working_dir"`
	Title                  string `json:"title"`
	TitleSource            string `json:"title_source"`
	TitleGeneratedAtUnixMs int64  `json:"title_generated_at_unix_ms"`
	TitleInputMessageID    string `json:"title_input_message_id"`
	TitleModelID           string `json:"title_model_id"`
	TitlePromptVersion     string `json:"title_prompt_version"`
	PinnedAtUnixMs         int64  `json:"pinned_at_unix_ms"`

	CreatedByUserPublicID string `json:"created_by_user_public_id"`
	CreatedByUserEmail    string `json:"created_by_user_email"`
	UpdatedByUserPublicID string `json:"updated_by_user_public_id"`
	UpdatedByUserEmail    string `json:"updated_by_user_email"`

	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64 `json:"updated_at_unix_ms"`
}

func migrateProductV2ForkOperationSnapshots(tx *sql.Tx) error {
	return processProductV2ForkOperationSnapshots(tx, true)
}

func validateProductV2ForkOperationSnapshots(tx *sql.Tx) error {
	return processProductV2ForkOperationSnapshots(tx, false)
}

func processProductV2ForkOperationSnapshots(tx *sql.Tx, apply bool) error {
	rows, err := tx.Query(`
	SELECT operation_id, endpoint_id, source_thread_id, destination_thread_id,
	       request_fingerprint, status, snapshot_schema_version, snapshot_json
	FROM ai_thread_fork_operations
	ORDER BY operation_id ASC
	`)
	if err != nil {
		return err
	}
	type row struct {
		operationID, endpointID, sourceThreadID, destinationThreadID string
		requestFingerprint, status, snapshotJSON                     string
		snapshotSchemaVersion                                        int
	}
	var pending []row
	for rows.Next() {
		var item row
		if err := rows.Scan(
			&item.operationID, &item.endpointID, &item.sourceThreadID, &item.destinationThreadID,
			&item.requestFingerprint, &item.status, &item.snapshotSchemaVersion, &item.snapshotJSON,
		); err != nil {
			_ = rows.Close()
			return err
		}
		pending = append(pending, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range pending {
		if item.snapshotJSON == "" {
			if item.status == string(ForkOperationCommitted) {
				continue
			}
			return fmt.Errorf("fork operation %q has empty product v2 snapshot in state %q", item.operationID, item.status)
		}
		if item.snapshotSchemaVersion != legacyForkSnapshotSchemaVersion {
			return fmt.Errorf("fork operation %q has unsupported snapshot schema %d", item.operationID, item.snapshotSchemaVersion)
		}
		var legacy productV2ForkSnapshot
		if err := decodeStrictJSON(item.snapshotJSON, &legacy); err != nil {
			return fmt.Errorf("decode product v2 fork operation %q: %w", item.operationID, err)
		}
		request := ForkThreadRequest{
			OperationID: item.operationID, EndpointID: legacy.Request.EndpointID,
			SourceThreadID: legacy.Request.SourceThreadID, DestinationThreadID: legacy.Request.DestinationThreadID,
			Title: legacy.Request.Title, CreatedByUserPublicID: legacy.Request.CreatedByUserPublicID,
			CreatedByUserEmail: legacy.Request.CreatedByUserEmail, CreatedAtUnixMs: legacy.Request.CreatedAtUnixMs,
		}
		fingerprint, err := forkRequestFingerprint(request)
		if err != nil {
			return err
		}
		if fingerprint != strings.TrimSpace(item.requestFingerprint) {
			request.Title = ""
			fingerprint, err = forkRequestFingerprint(request)
			if err != nil {
				return err
			}
			if fingerprint != strings.TrimSpace(item.requestFingerprint) {
				return fmt.Errorf("fork operation %q request fingerprint does not match its product v2 snapshot", item.operationID)
			}
			legacy.Request.Title = ""
		}
		routing, err := flowerRoutingFromLegacyMetadata(legacy.FlowerMetadata)
		if err != nil {
			return fmt.Errorf("migrate fork operation %q routing: %w", item.operationID, err)
		}
		snapshot := forkSnapshot{
			SchemaVersion: ForkSnapshotSchemaVersion,
			Request:       legacy.Request,
			SourceThread: ThreadSettings{
				ThreadID: legacy.SourceThread.ThreadID, EndpointID: legacy.SourceThread.EndpointID,
				NamespacePublicID: legacy.SourceThread.NamespacePublicID, ModelID: legacy.SourceThread.ModelID,
				ReasoningSelectionJSON: legacy.SourceThread.ReasoningSelectionJSON,
				PermissionType:         legacy.SourceThread.PermissionType, WorkingDir: legacy.SourceThread.WorkingDir,
				PinnedAtUnixMs:        legacy.SourceThread.PinnedAtUnixMs,
				CreatedByUserPublicID: legacy.SourceThread.CreatedByUserPublicID, CreatedByUserEmail: legacy.SourceThread.CreatedByUserEmail,
				UpdatedByUserPublicID: legacy.SourceThread.UpdatedByUserPublicID, UpdatedByUserEmail: legacy.SourceThread.UpdatedByUserEmail,
				SettingsCreatedAtUnixMs: legacy.SourceThread.CreatedAtUnixMs,
				SettingsUpdatedAtUnixMs: legacy.SourceThread.UpdatedAtUnixMs,
			},
			FlowerRouting: routing,
		}
		seenUploads := map[string]struct{}{}
		for _, ref := range legacy.UploadRefs {
			uploadID := strings.TrimSpace(ref.UploadID)
			refID := strings.TrimSpace(ref.RefID)
			if uploadID == "" || refID == "" {
				return fmt.Errorf("fork operation %q contains an incomplete upload reference", item.operationID)
			}
			switch ref.RefKind {
			case UploadRefKindQueuedTurn:
				continue
			case "turn", "run", UploadRefKindThread:
			default:
				return fmt.Errorf("fork operation %q contains unsupported upload reference kind %q", item.operationID, ref.RefKind)
			}
			if _, exists := seenUploads[uploadID]; exists {
				continue
			}
			seenUploads[uploadID] = struct{}{}
			snapshot.UploadRefs = append(snapshot.UploadRefs, forkSnapshotUploadRef{
				UploadID: uploadID, RefKind: UploadRefKindThread, RefID: item.sourceThreadID,
				CreatedAtUnixMs: ref.CreatedAtUnixMs,
			})
		}
		operation := &ForkOperation{
			OperationID: item.operationID, EndpointID: item.endpointID, SourceThreadID: item.sourceThreadID,
			DestinationThreadID: item.destinationThreadID, RequestFingerprint: item.requestFingerprint,
			SnapshotSchemaVersion: ForkSnapshotSchemaVersion,
		}
		fingerprint, err = forkSnapshotFingerprint(snapshot)
		if err != nil {
			return err
		}
		operation.SnapshotFingerprint = fingerprint
		if err := validateForkSnapshot(operation, snapshot); err != nil {
			return fmt.Errorf("validate migrated fork operation %q: %w", item.operationID, err)
		}
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		if apply {
			if _, err := tx.Exec(`UPDATE ai_thread_fork_operations SET snapshot_schema_version = ?, snapshot_json = ?, snapshot_fingerprint = ? WHERE operation_id = ?`, ForkSnapshotSchemaVersion, string(payload), fingerprint, item.operationID); err != nil {
				return err
			}
		}
	}
	return nil
}

type productV3ForkSnapshot struct {
	SchemaVersion  int                     `json:"schema_version"`
	Request        forkSnapshotRequest     `json:"request"`
	SourceThread   ThreadSettings          `json:"source_thread"`
	UploadRefs     []forkSnapshotUploadRef `json:"upload_refs"`
	FlowerMetadata *legacyFlowerMetadata   `json:"flower_metadata,omitempty"`
}

func migrateProductV3ForkOperationSnapshots(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT operation_id, endpoint_id, source_thread_id, destination_thread_id,
       request_fingerprint, status, snapshot_schema_version, snapshot_json
FROM ai_thread_fork_operations
ORDER BY operation_id ASC
`)
	if err != nil {
		return err
	}
	type row struct {
		operationID, endpointID, sourceThreadID, destinationThreadID string
		requestFingerprint, status, snapshotJSON                     string
		snapshotSchemaVersion                                        int
	}
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(
			&item.operationID,
			&item.endpointID,
			&item.sourceThreadID,
			&item.destinationThreadID,
			&item.requestFingerprint,
			&item.status,
			&item.snapshotSchemaVersion,
			&item.snapshotJSON,
		); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range items {
		if strings.TrimSpace(item.snapshotJSON) == "" {
			if item.status == string(ForkOperationCommitted) {
				continue
			}
			return fmt.Errorf("fork operation %q has empty product v3 snapshot in state %q", item.operationID, item.status)
		}
		switch item.snapshotSchemaVersion {
		case ForkSnapshotSchemaVersion:
			continue
		case legacyForkSnapshotSchemaVersion:
		default:
			return fmt.Errorf("fork operation %q has unsupported snapshot schema %d", item.operationID, item.snapshotSchemaVersion)
		}
		var legacy productV3ForkSnapshot
		if err := decodeStrictJSON(item.snapshotJSON, &legacy); err != nil {
			return fmt.Errorf("decode product v3 fork operation %q: %w", item.operationID, err)
		}
		if legacy.SchemaVersion != legacyForkSnapshotSchemaVersion {
			return fmt.Errorf("fork operation %q snapshot body has unsupported schema %d", item.operationID, legacy.SchemaVersion)
		}
		routing, err := flowerRoutingFromLegacyMetadata(legacy.FlowerMetadata)
		if err != nil {
			return fmt.Errorf("migrate fork operation %q routing: %w", item.operationID, err)
		}
		snapshot := forkSnapshot{
			SchemaVersion: ForkSnapshotSchemaVersion,
			Request:       legacy.Request,
			SourceThread:  legacy.SourceThread,
			UploadRefs:    legacy.UploadRefs,
			FlowerRouting: routing,
		}
		fingerprint, err := forkSnapshotFingerprint(snapshot)
		if err != nil {
			return err
		}
		operation := &ForkOperation{
			OperationID: item.operationID, EndpointID: item.endpointID, SourceThreadID: item.sourceThreadID,
			DestinationThreadID: item.destinationThreadID, RequestFingerprint: item.requestFingerprint,
			SnapshotSchemaVersion: ForkSnapshotSchemaVersion, SnapshotFingerprint: fingerprint,
		}
		if err := validateForkSnapshot(operation, snapshot); err != nil {
			return fmt.Errorf("validate migrated product v3 fork operation %q: %w", item.operationID, err)
		}
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
UPDATE ai_thread_fork_operations
SET snapshot_schema_version = ?, snapshot_json = ?, snapshot_fingerprint = ?
WHERE operation_id = ?
`, ForkSnapshotSchemaVersion, string(payload), fingerprint, item.operationID); err != nil {
			return err
		}
	}
	return nil
}

func fingerprintProductV2DeleteOperationSnapshots(tx *sql.Tx) error {
	return processProductV2DeleteOperationSnapshots(tx, true)
}

func validateProductV2DeleteOperationSnapshots(tx *sql.Tx) error {
	return processProductV2DeleteOperationSnapshots(tx, false)
}

func processProductV2DeleteOperationSnapshots(tx *sql.Tx, apply bool) error {
	rows, err := tx.Query(`
SELECT operation_id, endpoint_id, thread_id, snapshot_schema_version, snapshot_json, read_state_required
FROM ai_thread_delete_operations
ORDER BY operation_id ASC
`)
	if err != nil {
		return err
	}
	type row struct {
		operationID, endpointID, threadID, snapshotJSON string
		snapshotSchemaVersion, readStateRequired        int
	}
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(
			&item.operationID, &item.endpointID, &item.threadID,
			&item.snapshotSchemaVersion, &item.snapshotJSON, &item.readStateRequired,
		); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range items {
		if strings.TrimSpace(item.operationID) == "" || strings.TrimSpace(item.endpointID) == "" || strings.TrimSpace(item.threadID) == "" {
			return errors.New("product v2 delete operation has incomplete identity")
		}
		if item.snapshotSchemaVersion != ThreadDeleteSnapshotSchemaV1 {
			return fmt.Errorf("delete operation %q has unsupported snapshot schema %d", item.operationID, item.snapshotSchemaVersion)
		}
		var snapshot ThreadDeleteSnapshotV1
		if err := decodeStrictJSON(item.snapshotJSON, &snapshot); err != nil {
			return fmt.Errorf("decode product v2 delete operation %q: %w", item.operationID, err)
		}
		if snapshot.SchemaVersion != ThreadDeleteSnapshotSchemaV1 ||
			snapshot.DeleteFlowerReadState != (item.readStateRequired != 0) ||
			!validThreadDeleteSnapshotIDs(snapshot.UploadCleanupIDs) {
			return fmt.Errorf("delete operation %q has invalid product v2 snapshot contract", item.operationID)
		}
		fingerprint, err := threadDeleteSnapshotFingerprint(item.endpointID, item.threadID, snapshot)
		if err != nil {
			return err
		}
		if apply {
			if _, err := tx.Exec(`UPDATE ai_thread_delete_operations SET snapshot_fingerprint = ? WHERE operation_id = ?`, fingerprint, item.operationID); err != nil {
				return err
			}
		}
	}
	return nil
}
