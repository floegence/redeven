package threadstore

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	threadstoreSchemaKind           = "ai_threadstore_product_v2"
	threadstoreLegacySchemaKind     = "ai_threadstore_canonical"
	threadstoreCurrentSchemaVersion = 2
)

// CurrentSchemaVersion returns the product-only threadstore schema version.
func CurrentSchemaVersion() int {
	return threadstoreCurrentSchemaVersion
}

func initSchema(db *sql.DB) error {
	return sqliteutil.EnsureSchema(db, threadstoreSchemaSpec())
}

func threadstoreSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           threadstoreSchemaKind,
		CurrentVersion: threadstoreCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA auto_vacuum=INCREMENTAL;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: createThreadstoreSchema},
			{FromVersion: 1, ToVersion: 2, Apply: migrateProductV1ToV2},
		},
		LegacyKindMigrations: []sqliteutil.LegacyKindMigration{{
			FromKind:      threadstoreLegacySchemaKind,
			FromVersion:   -1,
			LegacyMarkers: []string{"ai_messages", "ai_runs", "ai_thread_state", "ai_thread_todos", "ai_thread_checkpoints", "transcript_messages", "conversation_turns"},
			Apply:         migrateCanonicalToProductV2,
		}},
		RepairCurrent: rebuildProductThreadstore,
		Verify:        verifyThreadstoreSchema,
	}
}

func createThreadstoreSchema(tx *sql.Tx) error {
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
		ensurePendingTurnCommandsTableTx,
		ensureProviderCapabilitiesTableTx,
		ensureUploadTablesTx,
		ensureFlowerTransferHandoffTablesTx,
		ensurePermissionSnapshotTablesTx,
		createThreadForkOperationsTableTx,
		createThreadDeleteOperationsTableTx,
	}
	for _, build := range builders {
		if err := build(tx); err != nil {
			return err
		}
	}
	return nil
}

type schemaCopyColumn struct {
	Name     string
	Default  string
	Required bool
}

var productThreadstoreTables = []string{
	"ai_threads",
	"ai_queued_turns",
	"provider_capabilities",
	"ai_uploads",
	"ai_upload_refs",
	"ai_flower_thread_metadata",
	"ai_flower_transfers",
	"ai_flower_handoffs",
	"ai_permission_snapshots",
	"ai_child_permission_snapshots",
	"ai_thread_fork_operations",
	"ai_thread_delete_operations",
}

func migrateCanonicalToProductV2(tx *sql.Tx) error {
	return rebuildProductThreadstore(tx)
}

func migrateProductV1ToV2(tx *sql.Tx) error {
	if err := verifyThreadstoreSchema(tx); err == nil {
		return nil
	}
	return rebuildProductThreadstore(tx)
}

// rebuildProductThreadstore creates the current product-only schema from the
// known product tables. Every other table, index, trigger, and source column
// is intentionally discarded in the same transaction.
func rebuildProductThreadstore(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if err := dropLegacySchemaObjects(tx); err != nil {
		return err
	}

	productSet := make(map[string]struct{}, len(productThreadstoreTables))
	for _, tableName := range productThreadstoreTables {
		productSet[tableName] = struct{}{}
	}
	legacyTables := make(map[string]string, len(productThreadstoreTables))
	for _, tableName := range tables {
		if _, keep := productSet[tableName]; !keep {
			if _, err := tx.Exec(`DROP TABLE ` + quoteSchemaIdentifier(tableName)); err != nil {
				return fmt.Errorf("drop obsolete table %q: %w", tableName, err)
			}
			continue
		}
		legacyName := "__redeven_legacy_" + tableName
		if _, err := tx.Exec(`ALTER TABLE ` + quoteSchemaIdentifier(tableName) + ` RENAME TO ` + quoteSchemaIdentifier(legacyName)); err != nil {
			return fmt.Errorf("stage legacy table %q: %w", tableName, err)
		}
		legacyTables[tableName] = legacyName
	}

	if err := createThreadstoreSchema(tx); err != nil {
		return err
	}
	for _, tableName := range productThreadstoreTables {
		legacyName, ok := legacyTables[tableName]
		if !ok {
			continue
		}
		if tableName == "ai_queued_turns" {
			if err := copyLegacyQueuedTurns(tx, legacyName); err != nil {
				return err
			}
		} else if err := copyLegacyProductTable(tx, legacyName, tableName, productTableColumns(tableName)); err != nil {
			return err
		}
		if _, err := tx.Exec(`DROP TABLE ` + quoteSchemaIdentifier(legacyName)); err != nil {
			return fmt.Errorf("drop staged table %q: %w", legacyName, err)
		}
	}
	return nil
}

func dropLegacySchemaObjects(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT type, name
FROM sqlite_master
WHERE (type = 'index' AND name NOT LIKE 'sqlite_autoindex_%') OR type = 'trigger'
ORDER BY type, name
`)
	if err != nil {
		return err
	}
	type schemaObject struct{ kind, name string }
	var objects []schemaObject
	for rows.Next() {
		var object schemaObject
		if err := rows.Scan(&object.kind, &object.name); err != nil {
			_ = rows.Close()
			return err
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, object := range objects {
		if _, err := tx.Exec(`DROP ` + strings.ToUpper(object.kind) + ` ` + quoteSchemaIdentifier(object.name)); err != nil {
			return fmt.Errorf("drop legacy %s %q: %w", object.kind, object.name, err)
		}
	}
	return nil
}

func productTableColumns(tableName string) []schemaCopyColumn {
	columns := map[string][]schemaCopyColumn{
		"ai_threads": {
			{Name: "thread_id", Required: true}, {Name: "endpoint_id", Required: true},
			{Name: "namespace_public_id", Default: "''"}, {Name: "model_id", Default: "''"},
			{Name: "reasoning_selection_json", Default: "''"}, {Name: "permission_type", Default: "'approval_required'"},
			{Name: "working_dir", Default: "''"}, {Name: "title", Default: "''"}, {Name: "title_source", Default: "''"},
			{Name: "title_generated_at_unix_ms", Default: "0"}, {Name: "title_input_message_id", Default: "''"},
			{Name: "title_model_id", Default: "''"}, {Name: "title_prompt_version", Default: "''"},
			{Name: "followups_revision", Default: "0"}, {Name: "pinned_at_unix_ms", Default: "0"},
			{Name: "created_by_user_public_id", Default: "''"}, {Name: "created_by_user_email", Default: "''"},
			{Name: "updated_by_user_public_id", Default: "''"}, {Name: "updated_by_user_email", Default: "''"},
			{Name: "created_at_unix_ms", Required: true}, {Name: "updated_at_unix_ms", Required: true},
		},
		"ai_queued_turns": {
			{Name: "queue_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "thread_id", Required: true},
			{Name: "channel_id", Default: "''"}, {Name: "lane", Default: "'queued'"}, {Name: "sort_index", Default: "0"},
			{Name: "turn_id", Required: true}, {Name: "run_id", Required: true}, {Name: "model_id", Default: "''"},
			{Name: "text_content", Default: "''"}, {Name: "attachments_json", Default: "'[]'"}, {Name: "context_action_json", Default: "''"},
			{Name: "options_json", Default: "'{}'"}, {Name: "session_meta_json", Default: "'{}'"},
			{Name: "created_by_user_public_id", Default: "''"}, {Name: "created_by_user_email", Default: "''"},
			{Name: "created_at_unix_ms", Required: true}, {Name: "updated_at_unix_ms", Default: "0"},
		},
		"provider_capabilities": {
			{Name: "provider_id", Required: true}, {Name: "model_name", Required: true},
			{Name: "capability_json", Default: "'{}'"}, {Name: "updated_at_unix_ms", Default: "0"},
		},
		"ai_uploads": {
			{Name: "upload_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "storage_relpath", Required: true},
			{Name: "name", Default: "''"}, {Name: "mime_type", Default: "'application/octet-stream'"}, {Name: "size_bytes", Default: "0"},
			{Name: "state", Default: "'staged'"}, {Name: "created_at_unix_ms", Required: true}, {Name: "claimed_at_unix_ms", Default: "0"},
			{Name: "delete_after_unix_ms", Default: "0"},
		},
		"ai_upload_refs": {
			{Name: "id", Default: "NULL"}, {Name: "endpoint_id", Required: true}, {Name: "upload_id", Required: true},
			{Name: "thread_id", Required: true}, {Name: "ref_kind", Required: true}, {Name: "ref_id", Required: true},
			{Name: "created_at_unix_ms", Required: true},
		},
		"ai_flower_thread_metadata": {
			{Name: "endpoint_id", Required: true}, {Name: "thread_id", Required: true}, {Name: "owner_kind", Default: "''"},
			{Name: "owner_id", Default: "''"}, {Name: "parent_thread_id", Default: "''"}, {Name: "parent_run_id", Default: "''"},
			{Name: "context_json", Default: "'{}'"}, {Name: "action_json", Default: "'{}'"}, {Name: "updated_at_unix_ms", Default: "0"},
			{Name: "home_runtime_id", Default: "''"}, {Name: "home_runtime_kind", Default: "''"}, {Name: "origin_env_public_id", Default: "''"},
			{Name: "primary_target_id", Default: "''"}, {Name: "active_target_ids_json", Default: "'[]'"},
		},
		"ai_flower_transfers": {
			{Name: "transfer_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "source_thread_id", Default: "''"},
			{Name: "destination_thread_id", Default: "''"}, {Name: "idempotency_key", Default: "''"}, {Name: "manifest_hash", Default: "''"},
			{Name: "approval_hash", Default: "''"}, {Name: "state", Default: "'planned'"}, {Name: "plan_json", Default: "'{}'"},
			{Name: "created_at_unix_ms", Default: "0"}, {Name: "updated_at_unix_ms", Default: "0"},
		},
		"ai_flower_handoffs": {
			{Name: "handoff_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "source_thread_id", Default: "''"},
			{Name: "destination_thread_id", Default: "''"}, {Name: "idempotency_key", Default: "''"}, {Name: "envelope_hash", Default: "''"},
			{Name: "state", Default: "'created'"}, {Name: "envelope_json", Default: "'{}'"}, {Name: "created_at_unix_ms", Default: "0"},
			{Name: "updated_at_unix_ms", Default: "0"},
		},
		"ai_permission_snapshots": {
			{Name: "snapshot_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "owner_thread_id", Default: "''"},
			{Name: "owner_run_id", Default: "''"}, {Name: "permission_type", Default: "'approval_required'"}, {Name: "snapshot_json", Default: "'{}'"},
			{Name: "snapshot_hash", Default: "''"}, {Name: "registry_hash", Default: "''"}, {Name: "schema_hash", Default: "''"},
			{Name: "presentation_hash", Default: "''"}, {Name: "created_at_unix_ms", Default: "0"},
		},
		"ai_child_permission_snapshots": {
			{Name: "child_snapshot_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "parent_snapshot_id", Default: "''"},
			{Name: "spawn_tool_call_id", Default: "''"}, {Name: "parent_thread_id", Default: "''"}, {Name: "parent_run_id", Default: "''"},
			{Name: "subagent_id", Default: "''"}, {Name: "child_thread_id", Default: "''"}, {Name: "child_run_id", Default: "''"},
			{Name: "state", Default: "'provisional'"}, {Name: "snapshot_json", Default: "'{}'"}, {Name: "snapshot_hash", Default: "''"},
			{Name: "registry_hash", Default: "''"}, {Name: "schema_hash", Default: "''"}, {Name: "presentation_hash", Default: "''"},
			{Name: "created_at_unix_ms", Default: "0"}, {Name: "finalized_at_unix_ms", Default: "0"},
		},
		"ai_thread_fork_operations": {
			{Name: "operation_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "source_thread_id", Required: true},
			{Name: "destination_thread_id", Required: true}, {Name: "request_fingerprint", Required: true}, {Name: "status", Required: true},
			{Name: "snapshot_schema_version", Required: true}, {Name: "snapshot_json", Required: true}, {Name: "retry_count", Default: "0"},
			{Name: "error_code", Default: "''"}, {Name: "error_message", Default: "''"}, {Name: "source_broadcasted_at_unix_ms", Default: "0"},
			{Name: "destination_broadcasted_at_unix_ms", Default: "0"}, {Name: "created_at_unix_ms", Required: true}, {Name: "updated_at_unix_ms", Required: true},
		},
		"ai_thread_delete_operations": {
			{Name: "operation_id", Required: true}, {Name: "endpoint_id", Required: true}, {Name: "thread_id", Required: true},
			{Name: "status", Required: true}, {Name: "snapshot_schema_version", Required: true}, {Name: "snapshot_json", Required: true},
			{Name: "read_state_required", Default: "0"}, {Name: "product_data_deleted_at_unix_ms", Default: "0"}, {Name: "files_cleaned_at_unix_ms", Default: "0"},
			{Name: "floret_deleted_at_unix_ms", Default: "0"}, {Name: "read_state_deleted_at_unix_ms", Default: "0"}, {Name: "retry_count", Default: "0"},
			{Name: "error_code", Default: "''"}, {Name: "error_message", Default: "''"}, {Name: "created_at_unix_ms", Required: true},
			{Name: "updated_at_unix_ms", Required: true}, {Name: "committed_at_unix_ms", Default: "0"},
		},
	}
	return columns[tableName]
}

func copyLegacyProductTable(tx *sql.Tx, sourceName string, targetName string, columns []schemaCopyColumn) error {
	sourceColumns, err := schemaTableColumns(tx, sourceName)
	if err != nil {
		return err
	}
	if len(columns) == 0 {
		return fmt.Errorf("no migration column mapping for %q", targetName)
	}
	targetNames := make([]string, 0, len(columns))
	expressions := make([]string, 0, len(columns))
	for _, column := range columns {
		targetNames = append(targetNames, quoteSchemaIdentifier(column.Name))
		if _, ok := sourceColumns[column.Name]; ok {
			expressions = append(expressions, fmt.Sprintf("COALESCE(%s, %s)", quoteSchemaIdentifier(sourceName)+"."+quoteSchemaIdentifier(column.Name), migrationDefault(column)))
			continue
		}
		if column.Required {
			return fmt.Errorf("legacy table %q is missing required column %q", sourceName, column.Name)
		}
		expressions = append(expressions, migrationDefault(column))
	}
	query := fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s", quoteSchemaIdentifier(targetName), strings.Join(targetNames, ", "), strings.Join(expressions, ", "), quoteSchemaIdentifier(sourceName))
	if _, err := tx.Exec(query); err != nil {
		return fmt.Errorf("copy legacy table %q to %q: %w", sourceName, targetName, err)
	}
	return nil
}

func copyLegacyQueuedTurns(tx *sql.Tx, sourceName string) error {
	sourceColumns, err := schemaTableColumns(tx, sourceName)
	if err != nil {
		return err
	}
	for _, required := range []string{"queue_id", "endpoint_id", "thread_id", "created_at_unix_ms"} {
		if _, ok := sourceColumns[required]; !ok {
			return fmt.Errorf("legacy table %q is missing required column %q", sourceName, required)
		}
	}
	column := func(name string, fallback string) string {
		if _, ok := sourceColumns[name]; ok {
			return fmt.Sprintf("COALESCE(%s, %s)", quoteSchemaIdentifier(sourceName)+"."+quoteSchemaIdentifier(name), fallback)
		}
		return fallback
	}
	turnID := "'turn_migrated_' || " + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("queue_id")
	if _, ok := sourceColumns["turn_id"]; ok {
		turnID = "COALESCE(NULLIF(" + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("turn_id") + ", ''), 'turn_migrated_' || " + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("queue_id") + ")"
	} else if _, ok := sourceColumns["message_id"]; ok {
		turnID = "COALESCE(NULLIF(" + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("message_id") + ", ''), 'turn_migrated_' || " + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("queue_id") + ")"
	}
	runID := "'run_migrated_' || " + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("queue_id")
	if _, ok := sourceColumns["run_id"]; ok {
		runID = "COALESCE(NULLIF(" + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("run_id") + ", ''), 'run_migrated_' || " + quoteSchemaIdentifier(sourceName) + "." + quoteSchemaIdentifier("queue_id") + ")"
	}
	targetNames := []string{
		"queue_id", "endpoint_id", "thread_id", "channel_id", "lane", "sort_index", "turn_id", "run_id", "model_id",
		"text_content", "attachments_json", "context_action_json", "options_json", "session_meta_json",
		"created_by_user_public_id", "created_by_user_email", "created_at_unix_ms", "updated_at_unix_ms",
	}
	expressions := []string{
		column("queue_id", "''"), column("endpoint_id", "''"), column("thread_id", "''"), column("channel_id", "''"),
		column("lane", "'queued'"), column("sort_index", "0"), turnID, runID, column("model_id", "''"),
		column("text_content", "''"), column("attachments_json", "'[]'"), column("context_action_json", "''"),
		column("options_json", "'{}'"), column("session_meta_json", "'{}'"), column("created_by_user_public_id", "''"),
		column("created_by_user_email", "''"), column("created_at_unix_ms", "0"), column("updated_at_unix_ms", "0"),
	}
	query := fmt.Sprintf("INSERT INTO ai_queued_turns (%s) SELECT %s FROM %s", quoteSchemaIdentifiers(targetNames), strings.Join(expressions, ", "), quoteSchemaIdentifier(sourceName))
	if _, err := tx.Exec(query); err != nil {
		return fmt.Errorf("copy legacy queued turns: %w", err)
	}
	return nil
}

func schemaTableColumns(tx *sql.Tx, tableName string) (map[string]struct{}, error) {
	rows, err := tx.Query(`PRAGMA table_info(` + quoteSchemaIdentifier(tableName) + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := make(map[string]struct{})
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		columns[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

func migrationDefault(column schemaCopyColumn) string {
	if strings.TrimSpace(column.Default) != "" {
		return column.Default
	}
	return "0"
}

func quoteSchemaIdentifier(name string) string {
	return `"` + strings.ReplaceAll(strings.TrimSpace(name), `"`, `""`) + `"`
}

func quoteSchemaIdentifiers(names []string) string {
	quoted := make([]string, 0, len(names))
	for _, name := range names {
		quoted = append(quoted, quoteSchemaIdentifier(name))
	}
	return strings.Join(quoted, ", ")
}

func ensurePendingTurnCommandsTableTx(tx *sql.Tx) error {
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

func ensureProviderCapabilitiesTableTx(tx *sql.Tx) error {
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

func ensureUploadTablesTx(tx *sql.Tx) error {
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

func ensureFlowerTransferHandoffTablesTx(tx *sql.Tx) error {
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

func ensurePermissionSnapshotTablesTx(tx *sql.Tx) error {
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

func createThreadForkOperationsTableTx(tx *sql.Tx) error {
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

func verifyThreadstoreSchema(tx *sql.Tx) error {
	requiredTables := []string{
		"ai_threads", "ai_queued_turns", "provider_capabilities", "ai_uploads", "ai_upload_refs",
		"ai_flower_thread_metadata", "ai_flower_transfers", "ai_flower_handoffs",
		"ai_permission_snapshots", "ai_child_permission_snapshots",
		"ai_thread_fork_operations", "ai_thread_delete_operations",
	}
	for _, tableName := range requiredTables {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing table %q", tableName)
		}
	}
	forbiddenTables := []string{
		"ai_messages", "ai_runs", "ai_tool_calls", "ai_run_events", "execution_spans",
		"ai_thread_state", "ai_thread_todos", "ai_thread_checkpoints",
		"transcript_messages", "conversation_turns", "memory_items", "memory_embeddings", "structured_user_inputs",
		"request_user_input_secret_answers", "ai_delegated_approval_requests", "ai_delegated_approval_events",
		"ai_delegated_approval_outbox", "ai_delegated_approval_idempotency",
	}
	for _, tableName := range forbiddenTables {
		exists, err := sqliteutil.TableExistsTx(tx, tableName)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("unexpected agent shadow table %q", tableName)
		}
	}
	for _, column := range []string{
		"run_status", "run_updated_at_unix_ms", "run_error_code", "run_error", "waiting_user_input_json",
		"flower_activity_revision", "flower_activity_signature", "flower_activity_waiting_prompt_id",
		"last_message_at_unix_ms", "last_message_preview", "execution_mode",
	} {
		exists, err := sqliteutil.ColumnExistsTx(tx, "ai_threads", column)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("unexpected agent shadow column ai_threads.%s", column)
		}
	}
	if exists, err := sqliteutil.ColumnExistsTx(tx, "ai_thread_fork_operations", "floret_result_json"); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("unexpected Floret fork result shadow column ai_thread_fork_operations.floret_result_json")
	}
	for _, tableName := range productThreadstoreTables {
		columns, err := schemaTableColumns(tx, tableName)
		if err != nil {
			return err
		}
		expected := productTableColumns(tableName)
		expectedSet := make(map[string]struct{}, len(expected))
		for _, column := range expected {
			expectedSet[column.Name] = struct{}{}
			if _, ok := columns[column.Name]; !ok {
				return fmt.Errorf("missing column %s.%s", tableName, column.Name)
			}
		}
		for column := range columns {
			if _, ok := expectedSet[column]; !ok {
				return fmt.Errorf("unexpected column %s.%s", tableName, column)
			}
		}
	}
	return nil
}
