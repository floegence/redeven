package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Space struct {
	CodeSpaceID        string `json:"code_space_id"`
	WorkspacePath      string `json:"workspace_path"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64  `json:"last_opened_at_unix_ms"`
}

type Registry struct {
	db *sql.DB
}

func Open(path string) (*Registry, error) {
	p := filepath.Clean(strings.TrimSpace(path))
	if p == "" {
		return nil, errors.New("missing registry path")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}

	// modernc.org/sqlite uses a file path as DSN.
	db, err := sql.Open("sqlite", p)
	if err != nil {
		return nil, err
	}
	if err := initSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	// Keep the connection open (single-process local DB).
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	return &Registry{db: db}, nil
}

func (r *Registry) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

func (r *Registry) ListSpaces(ctx context.Context) ([]Space, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces
ORDER BY created_at_unix_ms ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Space
	for rows.Next() {
		var s Space
		if err := rows.Scan(&s.CodeSpaceID, &s.WorkspacePath, &s.Name, &s.Description, &s.CreatedAtUnixMs, &s.UpdatedAtUnixMs, &s.LastOpenedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Registry) GetSpace(ctx context.Context, codeSpaceID string) (*Space, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return nil, errors.New("missing codeSpaceID")
	}

	var s Space
	err := r.db.QueryRowContext(ctx, `
SELECT code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces
WHERE code_space_id = ?
`, id).Scan(&s.CodeSpaceID, &s.WorkspacePath, &s.Name, &s.Description, &s.CreatedAtUnixMs, &s.UpdatedAtUnixMs, &s.LastOpenedAtUnixMs)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (r *Registry) CreateSpace(ctx context.Context, s Space) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.CodeSpaceID = strings.TrimSpace(s.CodeSpaceID)
	s.WorkspacePath = strings.TrimSpace(s.WorkspacePath)
	s.Name = strings.TrimSpace(s.Name)
	s.Description = strings.TrimSpace(s.Description)
	if s.CodeSpaceID == "" || s.WorkspacePath == "" {
		return errors.New("invalid space")
	}
	if s.CreatedAtUnixMs <= 0 {
		s.CreatedAtUnixMs = time.Now().UnixMilli()
	}
	if s.UpdatedAtUnixMs <= 0 {
		s.UpdatedAtUnixMs = s.CreatedAtUnixMs
	}

	_, err := r.db.ExecContext(ctx, `
INSERT INTO code_spaces(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, s.CodeSpaceID, s.WorkspacePath, s.Name, s.Description, s.CreatedAtUnixMs, s.UpdatedAtUnixMs, s.LastOpenedAtUnixMs)
	return err
}

func (r *Registry) DeleteSpace(ctx context.Context, codeSpaceID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return errors.New("missing codeSpaceID")
	}
	_, err := r.db.ExecContext(ctx, `DELETE FROM code_spaces WHERE code_space_id = ?`, id)
	return err
}

func (r *Registry) UpdateMeta(ctx context.Context, codeSpaceID string, name string, description string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return errors.New("invalid request")
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE code_spaces
SET name = ?, description = ?, updated_at_unix_ms = ?
WHERE code_space_id = ?
`, strings.TrimSpace(name), strings.TrimSpace(description), time.Now().UnixMilli(), id)
	return err
}

func (r *Registry) TouchLastOpened(ctx context.Context, codeSpaceID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return errors.New("missing codeSpaceID")
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE code_spaces
SET last_opened_at_unix_ms = ?
WHERE code_space_id = ?
`, time.Now().UnixMilli(), id)
	return err
}

func initSchema(db *sql.DB) error {
	if db == nil {
		return errors.New("nil db")
	}
	// WAL is safer for local concurrent readers.
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		return fmt.Errorf("pragma journal_mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=3000;`); err != nil {
		return fmt.Errorf("pragma busy_timeout: %w", err)
	}
	return migrateSchema(db)
}

func migrateSchema(db *sql.DB) error {
	if db == nil {
		return errors.New("nil db")
	}

	// Schema versions:
	// - v0: code_spaces has code_port
	// - v1: add name/description, remove code_port (port is runtime only)
	const targetVersion = 1

	var v int
	if err := db.QueryRow(`PRAGMA user_version;`).Scan(&v); err != nil {
		return fmt.Errorf("pragma user_version: %w", err)
	}
	if v >= targetVersion {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	// If this is a fresh database (no table yet), create v1 directly.
	var exists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = 'code_spaces'
`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`); err != nil {
			return fmt.Errorf("create table v1: %w", err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version=%d;", targetVersion)); err != nil {
			return fmt.Errorf("set user_version: %w", err)
		}
		return tx.Commit()
	}

	// v0 -> v1 migration: create a new table, copy, drop, rename.
	if _, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces_v1 (
  code_space_id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`); err != nil {
		return fmt.Errorf("create table code_spaces_v1: %w", err)
	}

	// Best-effort copy from v0. This drops the old code_port column (runtime only)
	// and initializes name/description to empty strings.
	if _, err := tx.Exec(`
INSERT INTO code_spaces_v1(code_space_id, workspace_path, name, description, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
SELECT code_space_id, workspace_path, '', '', created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces
`); err != nil {
		return fmt.Errorf("copy code_spaces: %w", err)
	}

	if _, err := tx.Exec(`DROP TABLE code_spaces;`); err != nil {
		return fmt.Errorf("drop old table: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE code_spaces_v1 RENAME TO code_spaces;`); err != nil {
		return fmt.Errorf("rename table: %w", err)
	}

	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version=%d;", targetVersion)); err != nil {
		return fmt.Errorf("set user_version: %w", err)
	}

	return tx.Commit()
}
