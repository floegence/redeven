package sqliteutil

import (
	"database/sql"
	"errors"
	"strings"
)

// Inspection describes committed product storage without a writable open.
type Inspection struct {
	Exists            bool
	Version           int
	MigrationRequired bool
}

// Inspect reuses the WAL-aware preflight used by Open. It never initializes a
// missing file or executes migration steps. Owners validate historical shapes
// through ValidateExisting; current stores also pass their final verifier.
func Inspect(path string, spec Spec) (result Inspection, err error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return result, errors.New("missing sqlite path")
	}
	if err = validateSpec(spec); err != nil {
		return result, err
	}
	err = preflightExisting(path, func(tx *sql.Tx) error {
		result.Exists = true
		var integrity string
		if err := tx.QueryRow("PRAGMA quick_check").Scan(&integrity); err != nil {
			return err
		}
		if integrity != "ok" {
			return &SchemaVerifyError{Kind: spec.Kind, Err: errors.New("SQLite integrity check failed")}
		}
		version, err := readUserVersionTx(tx)
		if err != nil {
			return err
		}
		result.Version = version
		hasMeta, err := TableExistsTx(tx, metaTableName)
		if err != nil {
			return err
		}
		if !hasMeta {
			tables, err := ListUserTablesTx(tx)
			if err != nil {
				return err
			}
			if version == 0 && len(tables) == 0 {
				result.MigrationRequired = true
				return nil
			}
			return &WrongDatabaseKindError{ExpectedKind: spec.Kind, Existing: tables}
		}
		if err = verifyMetaTableTx(tx); err != nil {
			return err
		}
		kind, err := readMetaKindTx(tx)
		if err != nil {
			return err
		}
		legacy, isLegacy, err := findLegacyKindMigration(spec, kind, version)
		if err != nil {
			return err
		}
		if isLegacy {
			version = legacy.ToVersion
		} else if strings.TrimSpace(kind) != spec.Kind {
			return &WrongDatabaseKindError{ExpectedKind: spec.Kind, ActualKind: kind}
		}
		if version > spec.CurrentVersion {
			return &DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: spec.CurrentVersion}
		}
		if version < spec.MinimumVersion {
			return &DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: spec.MinimumVersion}
		}
		if spec.ValidateExisting != nil {
			if err = spec.ValidateExisting(tx); err != nil {
				return err
			}
		}
		if !isLegacy && version == spec.CurrentVersion && spec.Verify != nil {
			if err = spec.Verify(tx); err != nil {
				return &SchemaVerifyError{Kind: kind, Err: err}
			}
		}
		result.MigrationRequired = isLegacy || version < spec.CurrentVersion
		return nil
	})
	return result, err
}
