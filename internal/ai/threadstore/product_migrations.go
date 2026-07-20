package threadstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

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
	FlowerMetadata *FlowerThreadMetadata   `json:"flower_metadata,omitempty"`
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
		if item.snapshotSchemaVersion != ForkSnapshotSchemaVersion {
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
		snapshot := forkSnapshotV2{
			SchemaVersion: legacy.SchemaVersion,
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
			FlowerMetadata: legacy.FlowerMetadata,
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
			SnapshotSchemaVersion: item.snapshotSchemaVersion,
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
			if _, err := tx.Exec(`UPDATE ai_thread_fork_operations SET snapshot_json = ?, snapshot_fingerprint = ? WHERE operation_id = ?`, string(payload), fingerprint, item.operationID); err != nil {
				return err
			}
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
