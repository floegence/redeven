package threadstore

import (
	"database/sql"
	"fmt"
)

func createThreadForkOperationsTableV1Tx(tx *sql.Tx) error {
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
  floret_result_json TEXT NOT NULL DEFAULT '',
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

func migrateProductV1ToV2(tx *sql.Tx) error {
	if err := verifyProductV1Schema(tx); err != nil {
		return fmt.Errorf("verify product threadstore v1: %w", err)
	}
	if _, err := tx.Exec(`
DROP INDEX idx_ai_thread_fork_operations_status_updated;
DROP INDEX idx_ai_thread_fork_operations_source;
ALTER TABLE ai_thread_fork_operations RENAME TO product_v1_thread_fork_operations;
`); err != nil {
		return err
	}
	if err := createThreadForkOperationsTableTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`
INSERT INTO ai_thread_fork_operations(
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  retry_count, error_code, error_message, source_broadcasted_at_unix_ms,
  destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
)
SELECT
  operation_id, endpoint_id, source_thread_id, destination_thread_id,
  request_fingerprint, status, snapshot_schema_version, snapshot_json,
  retry_count, error_code, error_message, source_broadcasted_at_unix_ms,
  destination_broadcasted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms
FROM product_v1_thread_fork_operations;
DROP TABLE product_v1_thread_fork_operations;
`); err != nil {
		return err
	}
	return nil
}

func verifyProductV1Schema(tx *sql.Tx) error {
	return verifyProductSchemaVersion(tx, 1)
}
