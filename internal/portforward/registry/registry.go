package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

var ErrForwardNotFound = errors.New("port forward not found")

const (
	AccessModeUnifiedProxy    = "unified_proxy"
	AccessModeDesktopLoopback = "desktop_loopback"
)

type Forward struct {
	ForwardID          string `json:"forward_id"`
	TargetURL          string `json:"target_url"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	HealthPath         string `json:"health_path"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`
	AccessMode         string `json:"access_mode"`

	CreatedAtUnixMs    int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64 `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64 `json:"last_opened_at_unix_ms"`
}

type Registry struct {
	db *sql.DB
}

func Open(path string) (*Registry, error) {
	if err := preflightExistingRegistry(path); err != nil {
		return nil, err
	}
	db, err := sqliteutil.Open(path, registrySchemaSpec())
	if err != nil {
		return nil, err
	}
	return &Registry{db: db}, nil
}

// preflightExistingRegistry validates an existing file through a read-only
// connection. Rejected legacy, future, or drifted databases must remain
// byte-for-byte unchanged; writable pragmas are applied only after this gate.
func preflightExistingRegistry(path string) error {
	path = filepath.Clean(strings.TrimSpace(path))
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) || (err == nil && info.Size() == 0) {
		return nil
	}
	if err != nil {
		return err
	}
	u := url.URL{Scheme: "file", Path: path}
	query := u.Query()
	query.Set("mode", "ro")
	u.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var kind string
	if err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton=1`).Scan(&kind); err != nil {
		tables, _ := sqliteutil.ListUserTablesTx(tx)
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: registrySchemaKind, Existing: tables}
	}
	if kind != registrySchemaKind {
		tables, _ := sqliteutil.ListUserTablesTx(tx)
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: registrySchemaKind, ActualKind: kind, Existing: tables}
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > registryCurrentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: registryCurrentSchemaVersion}
	}
	if version < registryCurrentSchemaVersion {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: registryCurrentSchemaVersion}
	}
	if err := verifyRegistryV1(tx); err != nil {
		return &sqliteutil.SchemaVerifyError{Kind: kind, Err: err}
	}
	return nil
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
SELECT forward_id, target_url, name, description, health_path, insecure_skip_verify, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms, access_mode
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
			&f.AccessMode,
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
SELECT forward_id, target_url, name, description, health_path, insecure_skip_verify, created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms, access_mode
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
		&f.AccessMode,
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
	var err error
	f.AccessMode, err = normalizedAccessMode(f.AccessMode)
	if err != nil {
		return err
	}

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

	_, err = r.db.ExecContext(ctx, `
INSERT INTO port_forwards(
  forward_id, target_url, name, description, health_path, insecure_skip_verify,
  created_at_unix_ms, updated_at_unix_ms, last_opened_at_unix_ms, access_mode
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		f.AccessMode,
	)
	return err
}

type UpdateForwardPatch struct {
	TargetURL          *string
	Name               *string
	Description        *string
	HealthPath         *string
	InsecureSkipVerify *bool
	AccessMode         *string
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
	if patch.AccessMode != nil {
		mode, err := normalizedAccessMode(*patch.AccessMode)
		if err != nil {
			return err
		}
		set = append(set, "access_mode = ?")
		args = append(args, mode)
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
	var managedCount int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM managed_web_services WHERE forward_id = ?`, id).Scan(&managedCount); err != nil {
		return err
	}
	if managedCount > 0 {
		return ErrManagedForward
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

func normalizedAccessMode(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case "", AccessModeUnifiedProxy:
		return AccessModeUnifiedProxy, nil
	case AccessModeDesktopLoopback:
		return AccessModeDesktopLoopback, nil
	default:
		return "", errors.New("invalid access_mode")
	}
}
