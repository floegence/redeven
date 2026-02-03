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
	Name               string `json:"name"`
	Description        string `json:"description"`
	WorkspacePath      string `json:"workspace_path"`
	CodePort           int    `json:"code_port"`
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
SELECT code_space_id, name, description, workspace_path, code_port, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
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
		if err := rows.Scan(&s.CodeSpaceID, &s.Name, &s.Description, &s.WorkspacePath, &s.CodePort, &s.CreatedAtUnixMs, &s.UpdatedAtUnixMs, &s.LastOpenedAtUnixMs); err != nil {
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
SELECT code_space_id, name, description, workspace_path, code_port, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM code_spaces
WHERE code_space_id = ?
`, id).Scan(&s.CodeSpaceID, &s.Name, &s.Description, &s.WorkspacePath, &s.CodePort, &s.CreatedAtUnixMs, &s.UpdatedAtUnixMs, &s.LastOpenedAtUnixMs)
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
	s.Name = strings.TrimSpace(s.Name)
	s.Description = strings.TrimSpace(s.Description)
	s.WorkspacePath = strings.TrimSpace(s.WorkspacePath)
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
INSERT INTO code_spaces(code_space_id, name, description, workspace_path, code_port, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)
`, s.CodeSpaceID, s.Name, s.Description, s.WorkspacePath, s.CodePort, s.CreatedAtUnixMs, s.UpdatedAtUnixMs, s.LastOpenedAtUnixMs)
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

func (r *Registry) UpdateCodePort(ctx context.Context, codeSpaceID string, codePort int) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" || codePort <= 0 || codePort > 65535 {
		return errors.New("invalid request")
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE code_spaces
SET code_port = ?, updated_at_unix_ms = ?
WHERE code_space_id = ?
`, codePort, time.Now().UnixMilli(), id)
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
SET last_opened_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE code_space_id = ?
`, time.Now().UnixMilli(), time.Now().UnixMilli(), id)
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
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS code_spaces (
  code_space_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  code_port INTEGER NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`)
	if err != nil {
		return fmt.Errorf("create table: %w", err)
	}

	// Migrate existing tables: add name and description columns if they don't exist.
	// SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first.
	var hasNameCol bool
	rows, err := db.Query(`PRAGMA table_info(code_spaces)`)
	if err != nil {
		return fmt.Errorf("pragma table_info: %w", err)
	}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scan table_info: %w", err)
		}
		if name == "name" {
			hasNameCol = true
		}
	}
	rows.Close()

	if !hasNameCol {
		if _, err := db.Exec(`ALTER TABLE code_spaces ADD COLUMN name TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("alter table add name: %w", err)
		}
		if _, err := db.Exec(`ALTER TABLE code_spaces ADD COLUMN description TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("alter table add description: %w", err)
		}
	}

	return nil
}
