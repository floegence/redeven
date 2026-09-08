package threadreadstate

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

// Backup snapshots read state while its service generation is closed.
func Backup(ctx context.Context, source, destination string) error {
	return sqliteutil.Backup(ctx, source, destination, schemaSpec())
}

// Inspect validates the read-state store before a coordinated Flower upgrade.
func Inspect(path string) (sqliteutil.Inspection, error) {
	return sqliteutil.Inspect(path, schemaSpec())
}

func validateExisting(tx *sql.Tx) error {
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	hasMeta, err := sqliteutil.TableExistsTx(tx, "__redeven_db_meta")
	if err != nil {
		return err
	}
	if hasMeta {
		var kind string
		if err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
			return err
		}
		if kind != schemaKind {
			return &sqliteutil.WrongDatabaseKindError{ExpectedKind: schemaKind, ActualKind: kind}
		}
	} else if version != 0 {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: schemaKind}
	}
	if version > currentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: schemaKind, Version: version, CurrentVersion: currentSchemaVersion}
	}
	if version < 0 {
		return &sqliteutil.DatabaseTooOldError{Kind: schemaKind, Version: version, MinimumVersion: 0}
	}
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	var expectedTables []string
	if version >= 1 {
		expectedTables = []string{"thread_read_state"}
	}
	if version >= 2 {
		expectedTables = append(expectedTables, "thread_read_state_retirements")
	}
	if !slices.Equal(tables, expectedTables) {
		return &sqliteutil.SchemaVerifyError{Kind: schemaKind, Err: fmt.Errorf("unexpected historical table set")}
	}
	if version == 0 {
		return nil
	}
	expected := []string{"endpoint_id", "scope_id", "surface", "thread_id", "last_seen_activity_revision", "last_read_message_at_unix_ms", "last_seen_waiting_prompt_id", "last_read_updated_at_unix_s", "last_seen_activity_signature", "updated_at_unix_ms"}
	if version == 4 {
		expected = []string{"endpoint_id", "scope_id", "surface", "thread_id", "last_seen_activity_revision", "updated_at_unix_ms"}
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "thread_read_state")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, expected) {
		return &sqliteutil.SchemaVerifyError{Kind: schemaKind, Err: fmt.Errorf("unexpected historical column set")}
	}
	if version >= 2 {
		columns, err = sqliteutil.TableColumnNamesTx(tx, "thread_read_state_retirements")
		if err != nil {
			return err
		}
		if !slices.Equal(columns, []string{"endpoint_id", "surface", "thread_id", "retired_at_unix_ms"}) {
			return &sqliteutil.SchemaVerifyError{Kind: schemaKind, Err: fmt.Errorf("unexpected retirement columns")}
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(indexes, []string{"idx_thread_read_state_scope"}) {
		return &sqliteutil.SchemaVerifyError{Kind: schemaKind, Err: fmt.Errorf("unexpected historical index set")}
	}
	return nil
}
