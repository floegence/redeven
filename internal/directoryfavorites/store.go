// Package directoryfavorites owns personal filesystem navigation shortcuts.
package directoryfavorites

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

type Scope struct{ Namespace, Endpoint, User string }
type Snapshot struct {
	Paths    []string `json:"paths"`
	Revision int64    `json:"revision"`
}
type Store struct{ db *sql.DB }

const scopesSQL = `CREATE TABLE favorite_scopes (
 namespace TEXT NOT NULL CHECK(length(namespace)>0),
 endpoint TEXT NOT NULL CHECK(length(endpoint)>0),
 user_id TEXT NOT NULL CHECK(length(user_id)>0),
 revision INTEGER NOT NULL CHECK(revision>=0),
 PRIMARY KEY(namespace,endpoint,user_id)
)`
const pathsSQL = `CREATE TABLE directory_favorites (
 namespace TEXT NOT NULL, endpoint TEXT NOT NULL, user_id TEXT NOT NULL,
 path TEXT NOT NULL CHECK(substr(path,1,1)='/'),
 added_order INTEGER NOT NULL CHECK(added_order>0),
 PRIMARY KEY(namespace,endpoint,user_id,path),
 UNIQUE(namespace,endpoint,user_id,added_order),
 FOREIGN KEY(namespace,endpoint,user_id) REFERENCES favorite_scopes(namespace,endpoint,user_id)
)`

func Open(path string) (*Store, error) {
	db, err := sqliteutil.Open(path, sqliteutil.Spec{
		Kind: "directory_favorites", CurrentVersion: 1, MinimumVersion: 1,
		Pragmas:          []string{`PRAGMA foreign_keys=ON`, `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=3000`},
		Initialize:       func(tx *sql.Tx) error { _, err := tx.Exec(scopesSQL + ";" + pathsSQL); return err },
		Verify:           verifySchema,
		ValidateExisting: validateExisting,
	})
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	return s.db.Close()
}
func (s Scope) validate() error {
	for _, value := range []string{s.Namespace, s.Endpoint, s.User} {
		if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) || strings.ContainsRune(value, 0) {
			return errors.New("invalid directory favorites scope")
		}
	}
	return nil
}

// NormalizePath preserves the logical address rather than resolving symlink aliases.
func NormalizePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return "", errors.New("expected absolute directory path")
	}
	return filepath.Clean(path), nil
}
func (s *Store) Snapshot(ctx context.Context, scope Scope) (Snapshot, error) {
	if err := scope.validate(); err != nil {
		return Snapshot{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	out, err := snapshot(ctx, tx, scope)
	if err != nil {
		return Snapshot{}, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return out, nil
}
func snapshot(ctx context.Context, tx *sql.Tx, scope Scope) (Snapshot, error) {
	out := Snapshot{Paths: []string{}}
	err := tx.QueryRowContext(ctx, `SELECT revision FROM favorite_scopes WHERE namespace=? AND endpoint=? AND user_id=?`, scope.Namespace, scope.Endpoint, scope.User).Scan(&out.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT path FROM directory_favorites WHERE namespace=? AND endpoint=? AND user_id=? ORDER BY added_order DESC`, scope.Namespace, scope.Endpoint, scope.User)
	if err != nil {
		return Snapshot{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			return Snapshot{}, err
		}
		out.Paths = append(out.Paths, path)
	}
	return out, rows.Err()
}

// Set changes one item and returns its commit snapshot. No-op writes retain order and revision.
func (s *Store) Set(ctx context.Context, scope Scope, path string, favorite bool) (Snapshot, error) {
	if err := scope.validate(); err != nil {
		return Snapshot{}, err
	}
	path, err := NormalizePath(path)
	if err != nil {
		return Snapshot{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	var exists int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_favorites WHERE namespace=? AND endpoint=? AND user_id=? AND path=?`, scope.Namespace, scope.Endpoint, scope.User, path).Scan(&exists)
	if err != nil {
		return Snapshot{}, err
	}
	if (exists != 0) != favorite {
		if _, err = tx.ExecContext(ctx, `INSERT INTO favorite_scopes(namespace,endpoint,user_id,revision) VALUES(?,?,?,0) ON CONFLICT DO NOTHING`, scope.Namespace, scope.Endpoint, scope.User); err != nil {
			return Snapshot{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE favorite_scopes SET revision=revision+1 WHERE namespace=? AND endpoint=? AND user_id=?`, scope.Namespace, scope.Endpoint, scope.User); err != nil {
			return Snapshot{}, err
		}
		if favorite {
			_, err = tx.ExecContext(ctx, `INSERT INTO directory_favorites(namespace,endpoint,user_id,path,added_order) SELECT namespace,endpoint,user_id,?,revision FROM favorite_scopes WHERE namespace=? AND endpoint=? AND user_id=?`, path, scope.Namespace, scope.Endpoint, scope.User)
		} else {
			_, err = tx.ExecContext(ctx, `DELETE FROM directory_favorites WHERE namespace=? AND endpoint=? AND user_id=? AND path=?`, scope.Namespace, scope.Endpoint, scope.User, path)
		}
		if err != nil {
			return Snapshot{}, err
		}
	}
	out, err := snapshot(ctx, tx, scope)
	if err != nil {
		return Snapshot{}, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return out, nil
}
func validateExisting(tx *sql.Tx) error {
	var version int
	var kind string
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	hasMeta, err := sqliteutil.TableExistsTx(tx, "__redeven_db_meta")
	if err != nil {
		return err
	}
	if version == 0 && !hasMeta && len(tables) == 0 {
		return nil
	}
	if !hasMeta {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: "directory_favorites", Existing: tables}
	}
	if err = tx.QueryRow("SELECT db_kind FROM __redeven_db_meta WHERE singleton=1").Scan(&kind); err != nil {
		return err
	}
	if kind != "directory_favorites" {
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: "directory_favorites", ActualKind: kind}
	}
	if version > 1 {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: 1}
	}
	if version < 1 {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: 1}
	}
	return verifySchema(tx)
}

func verifySchema(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"directory_favorites", "favorite_scopes"}) {
		return fmt.Errorf("unexpected directory favorites tables: %v", tables)
	}
	compact := func(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), "")) }
	for name, want := range map[string]string{"favorite_scopes": scopesSQL, "directory_favorites": pathsSQL} {
		var got string
		if err = tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&got); err != nil {
			return err
		}
		if compact(got) != compact(want) {
			return fmt.Errorf("invalid %s schema", name)
		}
	}
	var unexpected int
	if err = tx.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type IN ('trigger','view') OR (type='index' AND name NOT LIKE 'sqlite_autoindex_%')`).Scan(&unexpected); err != nil {
		return err
	}
	if unexpected != 0 {
		return errors.New("unexpected directory favorites schema objects")
	}
	scopes, err := tx.Query("SELECT namespace,endpoint,user_id,revision FROM favorite_scopes")
	if err != nil {
		return err
	}
	for scopes.Next() {
		var scope Scope
		var revision int64
		if err = scopes.Scan(&scope.Namespace, &scope.Endpoint, &scope.User, &revision); err != nil {
			scopes.Close()
			return err
		}
		if scope.validate() != nil || revision < 0 {
			scopes.Close()
			return errors.New("invalid directory favorites scope record")
		}
	}
	if err = scopes.Err(); err != nil {
		scopes.Close()
		return err
	}
	scopes.Close()
	rows, err := tx.Query(`SELECT f.path,f.added_order,s.revision FROM directory_favorites f LEFT JOIN favorite_scopes s USING(namespace,endpoint,user_id)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		var order, revision int64
		if err = rows.Scan(&path, &order, &revision); err != nil {
			return err
		}
		normalized, e := NormalizePath(path)
		if e != nil || normalized != path || order <= 0 || order > revision {
			return errors.New("invalid directory favorite record")
		}
	}
	return rows.Err()
}
