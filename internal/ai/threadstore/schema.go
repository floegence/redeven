package threadstore

import (
	"database/sql"
	"fmt"
	"reflect"
	"sync"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v2"
	threadstoreCurrentSchemaVersion = 4
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           threadstoreSchemaKind,
		CurrentVersion: threadstoreCurrentSchemaVersion,
		MinimumVersion: 2,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Initialize:     createThreadstoreSchema,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 2, ToVersion: 3, Apply: migrateProductV2ToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateProductV3ToV4},
		},
		Verify: verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
	return createThreadstoreSchemaWithFlowerTables(tx, createFlowerThreadRoutingTableTx)
}

func createThreadstoreSchemaV3(tx *sql.Tx) error {
	return createThreadstoreSchemaWithFlowerTables(tx, createLegacyFlowerTablesV3Tx)
}

func createThreadstoreSchemaWithFlowerTables(tx *sql.Tx, createFlowerTables func(*sql.Tx) error) error {
	if _, err := tx.Exec(`
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
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		createPendingTurnCommandsTableTx,
		createProviderCapabilitiesTableTx,
		createUploadTablesTx,
		createFlowerTables,
		createPermissionSnapshotTablesV3Tx,
		createSubAgentPublicationOperationsTableTx,
		createThreadCreateOperationsTableTx,
		createThreadForkOperationsTableV3Tx,
		createThreadDeleteOperationsTableV3Tx,
		addPendingTurnAdmissionStateTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

func createThreadstoreSchemaV2(tx *sql.Tx) error {
	return createThreadstoreSchemaWithFork(tx, createThreadForkOperationsTableV2Tx)
}

func createThreadstoreSchemaWithFork(tx *sql.Tx, createFork func(*sql.Tx) error) error {
	if _, err := tx.Exec(`
CREATE TABLE ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  working_dir TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  title_source TEXT NOT NULL DEFAULT '',
  title_generated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  title_input_message_id TEXT NOT NULL DEFAULT '',
  title_model_id TEXT NOT NULL DEFAULT '',
  title_prompt_version TEXT NOT NULL DEFAULT '',
  followups_revision INTEGER NOT NULL DEFAULT 0,
  pinned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_threads_endpoint_updated ON ai_threads(endpoint_id, updated_at_unix_ms DESC, thread_id DESC);
CREATE INDEX idx_ai_threads_endpoint_pinned_created ON ai_threads(endpoint_id, pinned_at_unix_ms DESC, created_at_unix_ms DESC, thread_id ASC);
`); err != nil {
		return err
	}
	builders := []func(*sql.Tx) error{
		createPendingTurnCommandsTableTx,
		createProviderCapabilitiesTableTx,
		createUploadTablesTx,
		createLegacyFlowerTablesV3Tx,
		createPermissionSnapshotTablesV2Tx,
		createFork,
		createThreadDeleteOperationsTableTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

func createPendingTurnCommandsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_queued_turns (
  queue_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT 'queued',
  sort_index INTEGER NOT NULL DEFAULT 0,
  turn_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  context_action_json TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  session_meta_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id, turn_id),
  UNIQUE(run_id)
);
CREATE INDEX idx_ai_queued_turns_thread_created ON ai_queued_turns(endpoint_id, thread_id, created_at_unix_ms ASC, queue_id ASC);
CREATE INDEX idx_ai_queued_turns_thread_lane_sort ON ai_queued_turns(endpoint_id, thread_id, lane, sort_index ASC, queue_id ASC);
`)
	return err
}

func addPendingTurnAdmissionStateTx(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE ai_queued_turns ADD COLUMN admission_state TEXT NOT NULL DEFAULT 'ready'`)
	return err
}

func createProviderCapabilitiesTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE provider_capabilities (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(provider_id, model_name)
);
`)
	return err
}

func createUploadTablesTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_uploads (
  upload_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  storage_relpath TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'staged',
  created_at_unix_ms INTEGER NOT NULL,
  claimed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  delete_after_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_uploads_endpoint_created ON ai_uploads(endpoint_id, created_at_unix_ms DESC, upload_id DESC);
CREATE INDEX idx_ai_uploads_state_delete_after ON ai_uploads(endpoint_id, state, delete_after_unix_ms, created_at_unix_ms);
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
`)
	return err
}

func createFlowerThreadRoutingTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
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
`)
	return err
}

// createLegacyFlowerTablesV3Tx defines the historical v2/v3 schema used only
// to verify and migrate existing product databases.
func createLegacyFlowerTablesV3Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_flower_thread_metadata (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  context_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  home_runtime_id TEXT NOT NULL DEFAULT '',
  home_runtime_kind TEXT NOT NULL DEFAULT '',
  origin_env_public_id TEXT NOT NULL DEFAULT '',
  primary_target_id TEXT NOT NULL DEFAULT '',
  active_target_ids_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_flower_thread_metadata_owner ON ai_flower_thread_metadata(endpoint_id, owner_kind, owner_id);
CREATE INDEX idx_ai_flower_thread_metadata_parent ON ai_flower_thread_metadata(endpoint_id, parent_thread_id, parent_run_id);
CREATE TABLE ai_flower_transfers (
  transfer_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL DEFAULT '',
  destination_thread_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  manifest_hash TEXT NOT NULL DEFAULT '',
  approval_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',
  plan_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_flower_transfers_idempotency ON ai_flower_transfers(endpoint_id, idempotency_key);
CREATE INDEX idx_ai_flower_transfers_source ON ai_flower_transfers(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX idx_ai_flower_transfers_destination ON ai_flower_transfers(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);
CREATE TABLE ai_flower_handoffs (
  handoff_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL DEFAULT '',
  destination_thread_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  envelope_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'created',
  envelope_json TEXT NOT NULL DEFAULT '{}',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_flower_handoffs_idempotency ON ai_flower_handoffs(endpoint_id, idempotency_key);
CREATE INDEX idx_ai_flower_handoffs_source ON ai_flower_handoffs(endpoint_id, source_thread_id, updated_at_unix_ms DESC);
CREATE INDEX idx_ai_flower_handoffs_destination ON ai_flower_handoffs(endpoint_id, destination_thread_id, updated_at_unix_ms DESC);
`)
	return err
}

func createPermissionSnapshotTablesV2Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_permission_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_thread_id TEXT NOT NULL DEFAULT '',
  owner_run_id TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_permission_snapshots_owner ON ai_permission_snapshots(endpoint_id, owner_thread_id, owner_run_id);
CREATE TABLE ai_child_permission_snapshots (
  child_snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_snapshot_id TEXT NOT NULL DEFAULT '',
  spawn_tool_call_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  subagent_id TEXT NOT NULL DEFAULT '',
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
`)
	return err
}

func createPermissionSnapshotTablesV3Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_permission_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  owner_thread_id TEXT NOT NULL DEFAULT '',
  owner_run_id TEXT NOT NULL DEFAULT '',
  permission_type TEXT NOT NULL DEFAULT 'approval_required',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  snapshot_hash TEXT NOT NULL DEFAULT '',
  registry_hash TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL DEFAULT '',
  presentation_hash TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_permission_snapshots_owner ON ai_permission_snapshots(endpoint_id, owner_thread_id, owner_run_id);
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
`)
	return err
}

func createSubAgentPublicationOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_subagent_publication_operations (
  publication_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  parent_thread_id TEXT NOT NULL,
  parent_turn_id TEXT NOT NULL,
  parent_run_id TEXT NOT NULL,
  spawn_tool_call_id TEXT NOT NULL,
  child_thread_id TEXT NOT NULL UNIQUE,
  child_run_id TEXT NOT NULL UNIQUE,
  child_snapshot_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  session_meta_json TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_selection_json TEXT NOT NULL DEFAULT '',
	  state TEXT NOT NULL CHECK(state IN ('pending', 'committed', 'failed')),
	  created_at_unix_ms INTEGER NOT NULL,
	  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	  failed_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_subagent_publication_spawn ON ai_subagent_publication_operations(endpoint_id, spawn_tool_call_id);
CREATE INDEX idx_ai_subagent_publication_pending ON ai_subagent_publication_operations(state, created_at_unix_ms ASC, publication_id ASC);
`)
	return err
}

func createThreadForkOperationsTableV2Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_fork_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL,
  destination_thread_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  source_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  destination_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_fork_operations_status_updated ON ai_thread_fork_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX idx_ai_thread_fork_operations_source ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
`)
	return err
}

func createThreadForkOperationsTableV3Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_fork_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL,
  destination_thread_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  source_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  destination_broadcasted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
, snapshot_fingerprint TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_ai_thread_fork_operations_status_updated ON ai_thread_fork_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE INDEX idx_ai_thread_fork_operations_source ON ai_thread_fork_operations(endpoint_id, source_thread_id, created_at_unix_ms DESC);
`)
	return err
}

func createThreadCreateOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_create_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  floret_created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  title_set_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  settings_committed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE INDEX idx_ai_thread_create_operations_status_updated ON ai_thread_create_operations(status, updated_at_unix_ms ASC, operation_id ASC);
`)
	return err
}

func createThreadDeleteOperationsTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_delete_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  read_state_required INTEGER NOT NULL DEFAULT 0 CHECK(read_state_required IN (0, 1)),
  product_data_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  files_cleaned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  floret_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  read_state_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_thread_delete_operations_status_updated ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE TRIGGER trg_ai_threads_reject_retired_id
BEFORE INSERT ON ai_threads
WHEN EXISTS (
  SELECT 1 FROM ai_thread_delete_operations op
  WHERE op.endpoint_id = NEW.endpoint_id AND op.thread_id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'thread id retired');
END;
`)
	return err
}

func createThreadDeleteOperationsTableV3Tx(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE ai_thread_delete_operations (
  operation_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'failed')),
  snapshot_schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  read_state_required INTEGER NOT NULL DEFAULT 0 CHECK(read_state_required IN (0, 1)),
  product_data_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  files_cleaned_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  floret_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  read_state_deleted_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  committed_at_unix_ms INTEGER NOT NULL DEFAULT 0, snapshot_fingerprint TEXT NOT NULL DEFAULT '',
  UNIQUE(endpoint_id, thread_id)
);
CREATE INDEX idx_ai_thread_delete_operations_status_updated ON ai_thread_delete_operations(status, updated_at_unix_ms ASC, operation_id ASC);
CREATE TRIGGER trg_ai_thread_settings_reject_retired_id
BEFORE INSERT ON ai_thread_settings
WHEN EXISTS (
  SELECT 1 FROM ai_thread_delete_operations op
  WHERE op.endpoint_id = NEW.endpoint_id AND op.thread_id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'thread id retired');
END;
`)
	return err
}

func verifyThreadstoreSchema(tx *sql.Tx) error {
	return verifyProductSchemaVersion(tx, threadstoreCurrentSchemaVersion)
}

var (
	productSchemaContractsMu sync.Mutex
	productSchemaContracts   = make(map[int][]canonicalSchemaObject, threadstoreCurrentSchemaVersion-1)
)

func verifyProductSchemaVersion(tx *sql.Tx, version int) error {
	expected, err := expectedProductSchemaContract(version)
	if err != nil {
		return err
	}
	actual, err := readCanonicalSchemaObjects(tx)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(actual, expected) {
		for index := 0; index < len(actual) && index < len(expected); index++ {
			if actual[index] != expected[index] {
				return fmt.Errorf(
					"product threadstore schema v%d contract mismatch at object %d: actual=%#v expected=%#v",
					version,
					index,
					actual[index],
					expected[index],
				)
			}
		}
		return fmt.Errorf(
			"product threadstore schema v%d contract mismatch: actual object count=%d expected=%d",
			version,
			len(actual),
			len(expected),
		)
	}
	return nil
}

func expectedProductSchemaContract(version int) ([]canonicalSchemaObject, error) {
	var build func(*sql.Tx) error
	switch version {
	case 2:
		build = createThreadstoreSchemaV2
	case 3:
		build = createThreadstoreSchemaV3
	case threadstoreCurrentSchemaVersion:
		build = createThreadstoreSchema
	default:
		return nil, fmt.Errorf("unsupported product threadstore schema version %d", version)
	}
	productSchemaContractsMu.Lock()
	defer productSchemaContractsMu.Unlock()
	if cached, ok := productSchemaContracts[version]; ok {
		return append([]canonicalSchemaObject(nil), cached...), nil
	}
	db, err := sql.Open("sqlite", fmt.Sprintf("file:redeven-product-contract-v%d?mode=memory&cache=shared&_txlock=immediate", version))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	tx, err := db.Begin()
	if err == nil {
		err = build(tx)
	}
	var objects []canonicalSchemaObject
	if err == nil {
		objects, err = readCanonicalSchemaObjects(tx)
	}
	if err == nil {
		err = tx.Commit()
	} else if tx != nil {
		_ = tx.Rollback()
	}
	_ = db.Close()
	if err != nil {
		return nil, fmt.Errorf("build product threadstore v%d contract: %w", version, err)
	}
	productSchemaContracts[version] = append([]canonicalSchemaObject(nil), objects...)
	return objects, nil
}
