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

var ErrForwardNotFound = errors.New("port forward not found")

type Forward struct {
	ForwardID          string `json:"forward_id"`
	TargetURL          string `json:"target_url"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	HealthPath         string `json:"health_path"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`

	CreatedAtUnixMs    int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64 `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64 `json:"last_opened_at_unix_ms"`
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

func (r *Registry) ListForwards(ctx context.Context) ([]Forward, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT forward_id, target_url, name, description, health_path, insecure_skip_verify, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM port_forwards
ORDER BY created_at_unix_ms ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Forward
	for rows.Next() {
		var f Forward
		var insecure int
		if err := rows.Scan(
			&f.ForwardID,
			&f.TargetURL,
			&f.Name,
			&f.Description,
			&f.HealthPath,
			&insecure,
			&f.CreatedAtUnixMs,
			&f.UpdatedAtUnixMs,
			&f.LastOpenedAtUnixMs,
		); err != nil {
			return nil, err
		}
		f.InsecureSkipVerify = insecure != 0
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *Registry) GetForward(ctx context.Context, forwardID string) (*Forward, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if id == "" {
		return nil, errors.New("missing forwardID")
	}

	var f Forward
	var insecure int
	err := r.db.QueryRowContext(ctx, `
SELECT forward_id, target_url, name, description, health_path, insecure_skip_verify, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
FROM port_forwards
WHERE forward_id = ?
`, id).Scan(
		&f.ForwardID,
		&f.TargetURL,
		&f.Name,
		&f.Description,
		&f.HealthPath,
		&insecure,
		&f.CreatedAtUnixMs,
		&f.UpdatedAtUnixMs,
		&f.LastOpenedAtUnixMs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	f.InsecureSkipVerify = insecure != 0
	return &f, nil
}

func (r *Registry) CreateForward(ctx context.Context, f Forward) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	f.ForwardID = strings.TrimSpace(f.ForwardID)
	f.TargetURL = strings.TrimSpace(f.TargetURL)
	f.Name = strings.TrimSpace(f.Name)
	f.Description = strings.TrimSpace(f.Description)
	f.HealthPath = strings.TrimSpace(f.HealthPath)

	id := strings.TrimSpace(f.ForwardID)
	if id == "" {
		return errors.New("missing forward_id")
	}
	if f.TargetURL == "" {
		return errors.New("missing target_url")
	}

	now := time.Now().UnixMilli()
	if f.CreatedAtUnixMs <= 0 {
		f.CreatedAtUnixMs = now
	}
	if f.UpdatedAtUnixMs <= 0 {
		f.UpdatedAtUnixMs = f.CreatedAtUnixMs
	}

	_, err := r.db.ExecContext(ctx, `
INSERT INTO port_forwards(
  forward_id, target_url, name, description, health_path, insecure_skip_verify,
  created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		f.ForwardID,
		f.TargetURL,
		f.Name,
		f.Description,
		f.HealthPath,
		boolToInt(f.InsecureSkipVerify),
		f.CreatedAtUnixMs,
		f.UpdatedAtUnixMs,
		f.LastOpenedAtUnixMs,
	)
	return err
}

type UpdateForwardPatch struct {
	TargetURL          *string
	Name               *string
	Description        *string
	HealthPath         *string
	InsecureSkipVerify *bool
	UpdatedAtUnixMs    int64
}

func (r *Registry) UpdateForward(ctx context.Context, forwardID string, patch UpdateForwardPatch) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if id == "" {
		return errors.New("missing forward_id")
	}

	if patch.UpdatedAtUnixMs <= 0 {
		patch.UpdatedAtUnixMs = time.Now().UnixMilli()
	}

	// Build an UPDATE with only the fields present.
	set := make([]string, 0, 6)
	args := make([]any, 0, 8)

	if patch.TargetURL != nil {
		set = append(set, "target_url = ?")
		args = append(args, strings.TrimSpace(*patch.TargetURL))
	}
	if patch.Name != nil {
		set = append(set, "name = ?")
		args = append(args, strings.TrimSpace(*patch.Name))
	}
	if patch.Description != nil {
		set = append(set, "description = ?")
		args = append(args, strings.TrimSpace(*patch.Description))
	}
	if patch.HealthPath != nil {
		set = append(set, "health_path = ?")
		args = append(args, strings.TrimSpace(*patch.HealthPath))
	}
	if patch.InsecureSkipVerify != nil {
		set = append(set, "insecure_skip_verify = ?")
		args = append(args, boolToInt(*patch.InsecureSkipVerify))
	}
	if len(set) == 0 {
		return errors.New("no fields to update")
	}
	set = append(set, "updated_at_unix_ms = ?")
	args = append(args, patch.UpdatedAtUnixMs)

	args = append(args, id)
	q := fmt.Sprintf("UPDATE port_forwards SET %s WHERE forward_id = ?", strings.Join(set, ", "))
	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrForwardNotFound
	}
	return nil
}

func (r *Registry) DeleteForward(ctx context.Context, forwardID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if id == "" {
		return errors.New("missing forward_id")
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM port_forwards WHERE forward_id = ?`, id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrForwardNotFound
	}
	return nil
}

func (r *Registry) TouchLastOpened(ctx context.Context, forwardID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if id == "" {
		return errors.New("missing forward_id")
	}
	now := time.Now().UnixMilli()
	res, err := r.db.ExecContext(ctx, `
UPDATE port_forwards
SET last_opened_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE forward_id = ?
`, now, now, id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrForwardNotFound
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
