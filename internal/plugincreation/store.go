// Package plugincreation owns product drafts and their dedicated Flower thread.
// ReDevPlugin owns every workspace, package, preview and installation resource.
package plugincreation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrNotFound         = errors.New("plugin draft not found")
	ErrInvalid          = errors.New("invalid plugin draft request")
	ErrConflict         = errors.New("plugin draft changed; read its current state")
	ErrDeleting         = errors.New("plugin draft is being deleted")
	ErrThreadReferenced = errors.New("delete the plugin draft to remove its dedicated conversation")
)

type Owner struct{ User, Environment string }

func OwnerFromSession(meta *session.Meta) (Owner, error) {
	if meta == nil || !meta.CanRead || strings.TrimSpace(meta.UserPublicID) == "" || strings.TrimSpace(meta.EndpointID) == "" {
		return Owner{}, ErrNotFound
	}
	return Owner{meta.UserPublicID, meta.EndpointID}, nil
}
func (o Owner) valid() bool {
	return o.User != "" && o.Environment != "" && len(o.User) <= 256 && len(o.Environment) <= 256
}

type Draft struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	IconURL             string `json:"icon_url,omitempty"`
	Revision            int64  `json:"revision"`
	Lifecycle           string `json:"lifecycle"`
	WorkspaceID         string `json:"workspace_id,omitempty"`
	ThreadID            string `json:"thread_id,omitempty"`
	LaunchPending       bool   `json:"launch_pending"`
	LaunchRequestID     string `json:"-"`
	LaunchSnapshot      string `json:"-"`
	InstalledPluginID   string `json:"installed_plugin_id,omitempty"`
	InstallRequestID    string `json:"install_request_id,omitempty"`
	InstallArtifactID   string `json:"install_artifact_id,omitempty"`
	InstallInspectionID string `json:"install_inspection_id,omitempty"`
	CleanupStage        string `json:"cleanup_stage,omitempty"`
	CreatedAt           int64  `json:"created_at"`
	UpdatedAt           int64  `json:"updated_at"`
}

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

const columns = `id,title,revision,lifecycle,workspace_id,thread_id,launch_request_id,launch_snapshot,installed_plugin_id,install_request_id,install_artifact_id,install_inspection_id,cleanup_stage,created_at,updated_at`
const schema = `CREATE TABLE drafts (id TEXT PRIMARY KEY,owner_user TEXT NOT NULL,owner_env TEXT NOT NULL,request_id TEXT NOT NULL,title TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),lifecycle TEXT NOT NULL CHECK(lifecycle IN ('preparing','active','deleting','deleted')),workspace_id TEXT NOT NULL DEFAULT '',thread_id TEXT NOT NULL DEFAULT '',launch_request_id TEXT NOT NULL DEFAULT '',launch_snapshot TEXT NOT NULL DEFAULT '',installed_plugin_id TEXT NOT NULL DEFAULT '',install_request_id TEXT NOT NULL DEFAULT '',install_artifact_id TEXT NOT NULL DEFAULT '',install_inspection_id TEXT NOT NULL DEFAULT '',cleanup_stage TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner_user,owner_env,request_id))`
const threadIndex = `CREATE UNIQUE INDEX draft_thread ON drafts(thread_id) WHERE thread_id<>''`

func Open(path string) (*Store, error) {
	spec := sqliteutil.Spec{Kind: "redeven_plugin_drafts", CurrentVersion: 1, MinimumVersion: 1, Pragmas: []string{"PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=3000"}, ValidateExisting: verifySchema, Verify: verifySchema, Initialize: func(tx *sql.Tx) error {
		for _, s := range []string{schema, threadIndex} {
			if _, err := tx.Exec(s); err != nil {
				return err
			}
		}
		return nil
	}}
	if _, err := sqliteutil.Inspect(path, spec); err != nil {
		return nil, err
	}
	db, err := sqliteutil.Open(path, spec)
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}
func verifySchema(tx *sql.Tx) error {
	expected := map[string]bool{schema: true, threadIndex: true}
	rows, err := tx.Query(`SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'__redeven_db_meta'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		if err = rows.Scan(&s); err != nil {
			return err
		}
		if !expected[s] {
			return fmt.Errorf("unsupported plugin draft schema")
		}
		delete(expected, s)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if len(expected) != 0 {
		return errors.New("incomplete plugin draft schema")
	}
	return nil
}
func (s *Store) Close() error { return s.db.Close() }

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Draft, error) {
	var d Draft
	err := row.Scan(&d.ID, &d.Title, &d.Revision, &d.Lifecycle, &d.WorkspaceID, &d.ThreadID, &d.LaunchRequestID, &d.LaunchSnapshot, &d.InstalledPluginID, &d.InstallRequestID, &d.InstallArtifactID, &d.InstallInspectionID, &d.CleanupStage, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	d.LaunchPending = d.LaunchRequestID != "" && d.ThreadID == ""
	return d, err
}
func (s *Store) Get(ctx context.Context, o Owner, id string) (Draft, error) {
	if !o.valid() {
		return Draft{}, ErrNotFound
	}
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM drafts WHERE id=? AND owner_user=? AND owner_env=?`, id, o.User, o.Environment))
}
func (s *Store) List(ctx context.Context, o Owner) ([]Draft, error) {
	if !o.valid() {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+columns+` FROM drafts WHERE owner_user=? AND owner_env=? AND lifecycle<>'deleted' ORDER BY updated_at DESC,id`, o.User, o.Environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Draft{}
	for rows.Next() {
		d, e := scan(rows)
		if e != nil {
			return nil, e
		}
		result = append(result, d)
	}
	return result, rows.Err()
}
func (s *Store) Create(ctx context.Context, o Owner, requestID string) (Draft, error) {
	if !o.valid() || strings.TrimSpace(requestID) == "" || len(requestID) > 128 {
		return Draft{}, ErrInvalid
	}
	// Scope the request before canonical creation so retries cannot change owner.
	digest := sha256.Sum256([]byte(o.User + "\x00" + o.Environment + "\x00" + requestID))
	id := "draft_" + hex.EncodeToString(digest[:16])
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `INSERT INTO drafts(id,owner_user,owner_env,request_id,title,revision,lifecycle,created_at,updated_at) VALUES(?,?,?,?,?,1,'preparing',?,?) ON CONFLICT(owner_user,owner_env,request_id) DO NOTHING`, id, o.User, o.Environment, requestID, "", now, now)
	if err != nil {
		return Draft{}, err
	}
	return s.Get(ctx, o, id)
}
func (s *Store) Activate(ctx context.Context, o Owner, id, workspace string) (Draft, error) {
	if workspace == "" {
		return Draft{}, ErrConflict
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle == "active" && d.WorkspaceID == workspace {
		return d, nil
	}
	if d.Lifecycle != "preparing" {
		return d, ErrConflict
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET workspace_id=?,lifecycle='active',revision=revision+1,updated_at=? WHERE id=?`, workspace, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}

func (s *Store) BindThread(ctx context.Context, o Owner, id, request, thread string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle != "active" && !(d.Lifecycle == "deleting" && d.CleanupStage == "thread") {
		return d, ErrDeleting
	}
	if request == "" || request != d.LaunchRequestID || thread == "" {
		return d, ErrConflict
	}
	if d.ThreadID != "" {
		if d.ThreadID != thread {
			return d, ErrConflict
		}
		return d, nil
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET thread_id=?,revision=revision+1,updated_at=? WHERE id=?`, thread, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}
func (s *Store) ForThread(ctx context.Context, o Owner, thread string) (Draft, error) {
	if !o.valid() || thread == "" {
		return Draft{}, ErrNotFound
	}
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM drafts WHERE owner_user=? AND owner_env=? AND thread_id=?`, o.User, o.Environment, thread))
}

// ManagedThreadIDs projects navigation ownership, including deleting and retained
// deleted drafts. It does not grant read or execution authority. Bound batches
// keep list/observer admission independent of the size of the project library.
func (s *Store) ManagedThreadIDs(ctx context.Context, environment string, ids []string) (map[string]bool, error) {
	out := make(map[string]bool)
	if environment == "" {
		return nil, ErrInvalid
	}
	for start := 0; start < len(ids); start += 200 {
		batch := ids[start:min(start+200, len(ids))]
		args := []any{environment}
		for _, id := range batch {
			args = append(args, id)
		}
		rows, err := s.db.QueryContext(ctx, `SELECT thread_id FROM drafts WHERE owner_env=? AND thread_id<>'' AND thread_id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) Rename(ctx context.Context, o Owner, id string, revision int64, title string) (Draft, error) {
	title = strings.TrimSpace(title)
	if len([]rune(title)) > 120 {
		return Draft{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.db.ExecContext(ctx, `UPDATE drafts SET title=?,revision=revision+1,updated_at=? WHERE id=? AND owner_user=? AND owner_env=? AND revision=? AND lifecycle='active'`, title, time.Now().UnixMilli(), id, o.User, o.Environment, revision)
	if err != nil {
		return Draft{}, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return Draft{}, ErrConflict
	}
	return s.Get(ctx, o, id)
}

// BeginDelete freezes all new operations. The durable stages are resumed by the
// product coordinator; installed plugin inventory is outside this lifecycle.
func (s *Store) BeginDelete(ctx context.Context, o Owner, id string, revision int64) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle == "deleting" || d.Lifecycle == "deleted" {
		return d, nil
	}
	if revision != d.Revision {
		return d, ErrConflict
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET lifecycle='deleting',cleanup_stage='thread',revision=revision+1,updated_at=? WHERE id=?`, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}
func (s *Store) AdvanceDelete(ctx context.Context, o Owner, id, expected string) (Draft, error) {
	next := map[string]string{"thread": "workspace", "workspace": "complete"}[expected]
	if next == "" {
		return Draft{}, ErrConflict
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.CleanupStage == next {
		return d, nil
	}
	if d.Lifecycle != "deleting" || d.CleanupStage != expected {
		return d, ErrConflict
	}
	state := "deleting"
	if next == "complete" {
		state = "deleted"
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET lifecycle=?,cleanup_stage=?,revision=revision+1,updated_at=? WHERE id=?`, state, next, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}

// FreezeLaunch records the exact canonical creation arguments before admission.
func (s *Store) FreezeLaunch(ctx context.Context, o Owner, id, request, snapshot string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle != "active" {
		return d, ErrDeleting
	}
	if request == "" || len(request) > 128 || snapshot == "" || len(snapshot) > 16384 {
		return d, ErrConflict
	}
	if d.LaunchRequestID != "" && d.LaunchRequestID != request {
		return d, ErrConflict
	}
	if d.LaunchSnapshot != "" {
		if d.LaunchSnapshot != snapshot {
			return d, ErrConflict
		}
		return d, nil
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET launch_request_id=?,launch_snapshot=?,revision=revision+1,updated_at=? WHERE id=?`, request, snapshot, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}
func (s *Store) ForAnyThread(ctx context.Context, thread string) (Draft, Owner, error) {
	var o Owner
	var id string
	if thread == "" {
		return Draft{}, o, ErrNotFound
	}
	if err := s.db.QueryRowContext(ctx, `SELECT id,owner_user,owner_env FROM drafts WHERE thread_id=?`, thread).Scan(&id, &o.User, &o.Environment); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = ErrNotFound
		}
		return Draft{}, o, err
	}
	d, err := s.Get(ctx, o, id)
	return d, o, err
}

// BindInstall persists only opaque platform operation references. Platform
// Execution and installed registry remain the sole authorities for the outcome.
func (s *Store) BindInstall(ctx context.Context, o Owner, id string, revision int64, request, artifact, inspection string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle != "active" {
		return d, ErrDeleting
	}
	if request == "" || artifact == "" || inspection == "" || len(request) > 160 || len(artifact) > 160 || len(inspection) > 160 {
		return d, ErrInvalid
	}
	if d.InstallRequestID == request {
		if d.InstallArtifactID != artifact || d.InstallInspectionID != inspection {
			return d, ErrConflict
		}
		return d, nil
	}
	if d.Revision != revision {
		return d, ErrConflict
	}
	_, err = s.db.ExecContext(ctx, `UPDATE drafts SET install_request_id=?,install_artifact_id=?,install_inspection_id=?,revision=revision+1,updated_at=? WHERE id=?`, request, artifact, inspection, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}

func (s *Store) ForWorkspace(ctx context.Context, o Owner, workspace string) (Draft, error) {
	if !o.valid() || workspace == "" {
		return Draft{}, ErrNotFound
	}
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM drafts WHERE owner_user=? AND owner_env=? AND workspace_id=?`, o.User, o.Environment, workspace))
}

// RecordInstalled retains only the opaque instance selected by a completed
// platform operation. Failed later updates cannot lose that association.
func (s *Store) RecordInstalled(ctx context.Context, o Owner, id, request, instance string) (Draft, error) {
	if instance == "" || request == "" {
		return Draft{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.InstallRequestID != request || d.Lifecycle != "active" {
		return d, ErrConflict
	}
	if d.InstalledPluginID == instance {
		return d, nil
	}
	_, err = s.db.ExecContext(ctx, "UPDATE drafts SET installed_plugin_id=?,revision=revision+1,updated_at=? WHERE id=?", instance, time.Now().UnixMilli(), id)
	if err != nil {
		return d, err
	}
	return s.Get(ctx, o, id)
}
