package registry

import (
	"database/sql"
	"fmt"
	"slices"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "codeapp_registry"
	registryLegacySchemaKind     = "codeapp_registry_legacy"
	registryCurrentSchemaVersion = 2

	registryCurrentTableSQL = `
CREATE TABLE code_spaces (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`
	registryReorderedV1TableSQL = `
CREATE TABLE code_spaces (
  code_space_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`
	registryRenamedCanonicalV1TableSQL = `
CREATE TABLE "code_spaces" (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`
	registryLegacyV1TableSQL = `
CREATE TABLE code_spaces (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  code_port INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`
)

var (
	registryCurrentColumns     = []string{"code_space_id", "workspace_path", "name", "description", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	registryReorderedV1Columns = []string{"code_space_id", "name", "description", "workspace_path", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
)

type registrySchemaObject struct {
	objectType string
	name       string
	tableName  string
	sql        string
}

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
		},
		LegacyKindMigrations: []sqliteutil.LegacyKindMigration{{
			FromKind:    registryLegacySchemaKind,
			FromVersion: 1,
			ToKind:      registrySchemaKind,
			ToVersion:   registryCurrentSchemaVersion,
			Apply:       migrateLegacyRegistryV1,
		}},
		Verify: verifyRegistrySchema,
	}
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(registryCurrentTableSQL)
	return err
}

func migrateRegistryToV2(tx *sql.Tx) error {
	tableTokens, err := registryTableTokens(tx)
	if err != nil {
		return fmt.Errorf("inspect codeapp registry v1: %w", err)
	}
	if registryTableSQLMatches(tableTokens, registryCurrentTableSQL) {
		return nil
	}
	if !registryTableSQLMatches(tableTokens, registryReorderedV1TableSQL) &&
		!registryTableSQLMatches(tableTokens, registryRenamedCanonicalV1TableSQL) {
		return fmt.Errorf("unsupported codeapp registry v1 table definition %q", tableTokens)
	}
	if _, err := tx.Exec(`ALTER TABLE code_spaces RENAME TO code_spaces_migration_v1;`); err != nil {
		return fmt.Errorf("rename codeapp registry v1: %w", err)
	}
	if _, err := tx.Exec(registryCurrentTableSQL); err != nil {
		return fmt.Errorf("create codeapp registry v2 table: %w", err)
	}
	if _, err := tx.Exec(`
INSERT INTO code_spaces(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
SELECT code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces_migration_v1;
DROP TABLE code_spaces_migration_v1;
`); err != nil {
		return fmt.Errorf("copy codeapp registry v1: %w", err)
	}
	return nil
}

func migrateLegacyRegistryV1(tx *sql.Tx) error {
	if err := verifyRegistryTableSQL(tx, registryLegacyV1TableSQL); err != nil {
		return fmt.Errorf("verify legacy codeapp registry v1: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE code_spaces RENAME TO code_spaces_legacy_v1;`); err != nil {
		return fmt.Errorf("rename legacy codeapp registry v1: %w", err)
	}
	if _, err := tx.Exec(registryCurrentTableSQL); err != nil {
		return fmt.Errorf("create codeapp registry v2 table: %w", err)
	}
	if _, err := tx.Exec(`
INSERT INTO code_spaces(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
SELECT code_space_id, workspace_path, '', '', created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces_legacy_v1;
DROP TABLE code_spaces_legacy_v1;
`); err != nil {
		return fmt.Errorf("copy legacy codeapp registry v1: %w", err)
	}
	return nil
}

func verifyRegistrySchema(tx *sql.Tx) error {
	return verifyRegistryTableSQL(tx, registryCurrentTableSQL)
}

func verifyRegistryTableSQL(tx *sql.Tx, expectedTableSQL string) error {
	tableTokens, err := registryTableTokens(tx)
	if err != nil {
		return err
	}
	want, err := tokenizeRegistryTableSQL(expectedTableSQL)
	if err != nil {
		return fmt.Errorf("tokenize expected codeapp registry table: %w", err)
	}
	if !slices.Equal(tableTokens, want) {
		return fmt.Errorf("codeapp registry table definition mismatch: got %q, want %q", tableTokens, want)
	}
	return nil
}

func registryTableTokens(tx *sql.Tx) ([]string, error) {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return nil, err
	}
	if !slices.Equal(tables, []string{"code_spaces"}) {
		return nil, fmt.Errorf("codeapp registry table set mismatch: got %v", tables)
	}

	rows, err := tx.Query(`
SELECT type, name, tbl_name, COALESCE(sql, '')
FROM sqlite_master
WHERE NOT (type = 'table' AND name = '__redeven_db_meta')
ORDER BY type ASC, name ASC, tbl_name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	objects := make([]registrySchemaObject, 0, 2)
	for rows.Next() {
		var object registrySchemaObject
		if err := rows.Scan(&object.objectType, &object.name, &object.tableName, &object.sql); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(objects) != 2 ||
		objects[0].objectType != "index" ||
		objects[0].name != "sqlite_autoindex_code_spaces_1" ||
		objects[0].tableName != "code_spaces" ||
		objects[0].sql != "" ||
		objects[1].objectType != "table" ||
		objects[1].name != "code_spaces" ||
		objects[1].tableName != "code_spaces" {
		return nil, fmt.Errorf("codeapp registry schema object mismatch: got %v", objects)
	}
	return tokenizeRegistryTableSQL(objects[1].sql)
}

func registryTableSQLMatches(actual []string, expectedSQL string) bool {
	expected, err := tokenizeRegistryTableSQL(expectedSQL)
	return err == nil && slices.Equal(actual, expected)
}

func tokenizeRegistryTableSQL(value string) ([]string, error) {
	tokens := make([]string, 0, len(registryCurrentColumns)*4)
	for index := 0; index < len(value); {
		if isRegistrySQLSpace(value[index]) {
			index++
			continue
		}
		start := index
		switch value[index] {
		case '(', ')', ',', ';':
			tokens = append(tokens, value[index:index+1])
			index++
		case '\'', '"', '`':
			quote := value[index]
			index++
			closed := false
			for index < len(value) {
				if value[index] != quote {
					index++
					continue
				}
				if index+1 < len(value) && value[index+1] == quote {
					index += 2
					continue
				}
				index++
				closed = true
				break
			}
			if !closed {
				return nil, fmt.Errorf("unterminated quoted token at byte %d", start)
			}
			tokens = append(tokens, value[start:index])
		case '[':
			index++
			for index < len(value) && value[index] != ']' {
				index++
			}
			if index == len(value) {
				return nil, fmt.Errorf("unterminated bracketed token at byte %d", start)
			}
			index++
			tokens = append(tokens, value[start:index])
		default:
			for index < len(value) &&
				!isRegistrySQLSpace(value[index]) &&
				!isRegistrySQLTokenBoundary(value[index]) {
				index++
			}
			tokens = append(tokens, value[start:index])
		}
	}
	if len(tokens) > 0 && tokens[len(tokens)-1] == ";" {
		tokens = tokens[:len(tokens)-1]
	}
	return tokens, nil
}

func isRegistrySQLSpace(value byte) bool {
	return value == ' ' || value == '\t' || value == '\n' || value == '\r' || value == '\f'
}

func isRegistrySQLTokenBoundary(value byte) bool {
	return value == '(' || value == ')' || value == ',' || value == ';' ||
		value == '\'' || value == '"' || value == '`' || value == '['
}
