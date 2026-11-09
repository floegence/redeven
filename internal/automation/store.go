package automation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/floegence/redevplugin/v3/pkg/capability"
)

type Store struct {
	processLock    *lockfile.Lock
	pluginMu       sync.RWMutex
	pluginValidate func(context.Context, capability.ExecutionBinding) error
	db             *sql.DB
	mu             sync.Mutex
}

var tables = []string{
	`CREATE TABLE workflows(id TEXT PRIMARY KEY, owner_user TEXT NOT NULL, owner_env TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(owner_user,owner_env,request_id))`,
	`CREATE TABLE publications(workflow_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(workflow_id,version))`,
	`CREATE TABLE grants(workflow_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(workflow_id,version))`,
	`CREATE TABLE runs(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, owner_user TEXT NOT NULL, owner_env TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(owner_user,owner_env,request_id))`,
	`CREATE TABLE work_threads(thread_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, run_id TEXT NOT NULL, attempt_id TEXT NOT NULL, owner_user TEXT NOT NULL, owner_env TEXT NOT NULL, UNIQUE(workflow_id,run_id,attempt_id))`,
}

func Open(path string) (*Store, error) {
	if !filepath.IsAbs(path) {
		return nil, ErrInvalid
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	processLock, err := lockfile.Acquire(path + ".lock")
	if err != nil {
		return nil, err
	}
	transferred := false
	defer func() {
		if !transferred {
			_ = processLock.Release()
		}
	}()

	verify := func(tx *sql.Tx) error {
		var version int
		if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		expected := map[string]bool{}
		for _, s := range tables {
			expected[s] = true
		}
		rows, e := tx.Query(`SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'__redeven_db_meta'`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var sql string
			if e = rows.Scan(&sql); e != nil {
				return e
			}
			if version == 1 && sql == `CREATE TABLE grants(workflow_id TEXT PRIMARY KEY, body TEXT NOT NULL)` {
				sql = tables[2]
			}
			if !expected[sql] {
				return fmt.Errorf("%w: automation schema drift", ErrInvalid)
			}
			delete(expected, sql)
		}
		if e = rows.Err(); e != nil {
			return e
		}
		if len(expected) > 0 {
			return ErrInvalid
		}
		return nil
	}
	spec := sqliteutil.Spec{Kind: "redeven_automation", CurrentVersion: 3, MinimumVersion: 1, Pragmas: []string{"PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=3000"}, ValidateExisting: verify, Verify: verify, Migrations: []sqliteutil.Migration{{FromVersion: 1, ToVersion: 2, Apply: func(tx *sql.Tx) error {
		for _, q := range []string{"ALTER TABLE grants RENAME TO grants_old", tables[2], "INSERT INTO grants(workflow_id,version,body) SELECT workflow_id,json_extract(body,'$.revision'),body FROM grants_old", "DROP TABLE grants_old"} {
			if _, err := tx.Exec(q); err != nil {
				return err
			}
		}
		return nil
	}}, {FromVersion: 2, ToVersion: 3, Apply: migratePublishedRevision}}, Initialize: func(tx *sql.Tx) error {
		for _, s := range tables {
			if _, e := tx.Exec(s); e != nil {
				return e
			}
		}
		return nil
	}}
	db, e := sqliteutil.Open(path, spec)
	if e != nil {
		return nil, e
	}
	transferred = true
	return &Store{db: db, processLock: processLock}, nil
}

// Recover the editable/published relationship from the retained definitions,
// without granting a changed draft or rewriting private plugin authority.
func migratePublishedRevision(tx *sql.Tx) error {
	rows, err := tx.Query("SELECT body FROM workflows")
	if err != nil {
		return err
	}
	var workflows []Workflow
	for rows.Next() {
		w, e := decodeRow[Workflow](rows)
		if e != nil {
			_ = rows.Close()
			return e
		}
		workflows = append(workflows, w)
	}
	err = rows.Err()
	if closeErr := rows.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	for _, w := range workflows {
		revision := int64(0)
		if w.PublishedVersion > 0 {
			p, e := decodeRow[Published](tx.QueryRow("SELECT body FROM publications WHERE workflow_id=? AND version=?", w.ID, w.PublishedVersion))
			if e != nil {
				return e
			}
			if jsonText(w.Definition) == jsonText(p.Definition) {
				revision = w.Revision
			}
		}
		if _, err = tx.Exec("UPDATE workflows SET body=json_set(body,'$.published_revision',?) WHERE id=?", revision, w.ID); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Close() error { return errors.Join(s.db.Close(), s.processLock.Release()) }
func stableID(prefix string, parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		_, _ = h.Write([]byte(p))
		_, _ = h.Write([]byte{0})
	}
	return prefix + hex.EncodeToString(h.Sum(nil)[:16])
}
func jsonText(v any) string { b, _ := json.Marshal(v); return string(b) }
func decodeRow[T any](row interface{ Scan(...any) error }) (T, error) {
	var v T
	var raw string
	e := row.Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if e != nil {
		return v, e
	}
	e = json.Unmarshal([]byte(raw), &v)
	if e == nil {
		if w, ok := any(&v).(*Workflow); ok {
			e = restoreWorkflowPrivate(raw, w)
		}
	}
	return v, e
}
func (s *Store) Get(ctx context.Context, o Owner, id string) (Workflow, error) {
	if !o.valid() {
		return Workflow{}, ErrNotFound
	}
	return decodeRow[Workflow](s.db.QueryRowContext(ctx, "SELECT body FROM workflows WHERE id=? AND owner_user=? AND owner_env=?", id, o.User, o.Environment))
}
func (s *Store) List(ctx context.Context, o Owner) ([]Workflow, error) {
	if !o.valid() {
		return nil, ErrNotFound
	}
	rows, e := s.db.QueryContext(ctx, "SELECT body FROM workflows WHERE owner_user=? AND owner_env=? ORDER BY id", o.User, o.Environment)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Workflow{}
	for rows.Next() {
		v, e := decodeRow[Workflow](rows)
		if e != nil {
			return nil, e
		}
		if !v.Archived {
			out = append(out, v)
		}
	}
	return out, rows.Err()
}
func (s *Store) Create(ctx context.Context, o Owner, request string, d Definition) (Workflow, error) {
	return s.create(ctx, o, request, d, nil)
}
func (s *Store) create(ctx context.Context, o Owner, request string, d Definition, plugin *PluginWork) (Workflow, error) {
	if !o.valid() || !identityPattern.MatchString(request) || d.checkDraft() != nil {
		return Workflow{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := stableID("flow_", o.User, o.Environment, request)
	if old, e := s.Get(ctx, o, id); e == nil {
		var hash string
		if err := s.db.QueryRowContext(ctx, "SELECT request_hash FROM workflows WHERE id=?", id).Scan(&hash); err != nil {
			return Workflow{}, err
		}
		if hash != stableID("", jsonText(d)) {
			return Workflow{}, ErrConflict
		}
		return old, nil
	} else if !errors.Is(e, ErrNotFound) {
		return Workflow{}, e
	}
	now := time.Now().UTC()
	w := Workflow{Plugin: plugin, ID: id, Revision: 1, Definition: d, CreatedAt: now, UpdatedAt: now}
	_, e := s.db.ExecContext(ctx, "INSERT INTO workflows(id,owner_user,owner_env,request_id,request_hash,body) VALUES(?,?,?,?,?,?)", id, o.User, o.Environment, request, stableID("", jsonText(d)), encodeWorkflow(w))
	return w, e
}
func (s *Store) Save(ctx context.Context, o Owner, id string, revision int64, d Definition) (Workflow, error) {
	if d.checkDraft() != nil {
		return Workflow{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	w, e := s.Get(ctx, o, id)
	if e != nil {
		return w, e
	}
	if w.Plugin != nil {
		allowed := w.Definition
		allowed.Model = d.Model
		allowed.WorkingDirectory = d.WorkingDirectory
		if jsonText(allowed) != jsonText(d) {
			return w, ErrUnauthorized
		}
	}
	if w.Archived {
		return w, ErrConflict
	}
	if w.Revision != revision {
		return w, ErrConflict
	}
	w.Definition = d
	w.Revision++
	w.UpdatedAt = time.Now().UTC()
	_, e = s.db.ExecContext(ctx, "UPDATE workflows SET body=? WHERE id=?", encodeWorkflow(w), id)
	return w, e
}
func (s *Store) Publish(ctx context.Context, o Owner, id string, revision int64, g Grant) (Published, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, e := s.Get(ctx, o, id)
	if e != nil {
		return Published{}, e
	}
	if w.Archived {
		return Published{}, ErrConflict
	}
	if w.Revision != revision {
		return Published{}, ErrConflict
	}
	if e = w.Definition.check(); e != nil {
		return Published{}, e
	}
	for _, n := range w.Definition.Nodes {
		if (n.Kind == "agent" || n.Kind == "parallel") && (w.Definition.Model == "" || w.Definition.WorkingDirectory == "") {
			return Published{}, ErrInvalid
		}
	}
	if !g.Authority.Read || !g.Authority.Write || !g.Authority.Execute || g.Authority.Namespace == "" || g.Authority.App == "" {
		return Published{}, ErrUnauthorized
	}
	if err := w.validatePluginPublication(g); err != nil {
		return Published{}, err
	}
	if len(g.Tools) > 128 {
		return Published{}, ErrInvalid
	}
	seen := map[string]bool{}
	for _, tool := range g.Tools {
		if !identityPattern.MatchString(tool) || seen[tool] {
			return Published{}, ErrInvalid
		}
		seen[tool] = true
	}
	if !g.ExpiresAt.After(time.Now()) || g.ExpiresAt.After(time.Now().Add(366*24*time.Hour)) || g.Model != w.Definition.Model || g.WorkingDirectory != w.Definition.WorkingDirectory {
		return Published{}, ErrInvalid
	}
	w.PublishedVersion++
	w.Revision++
	w.PublishedRevision = w.Revision
	w.UpdatedAt = time.Now().UTC()
	p := Published{w.ID, w.PublishedVersion, w.Definition, w.UpdatedAt}
	g.Revision = w.PublishedVersion
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return p, e
	}
	defer func() { _ = tx.Rollback() }()
	for _, q := range []struct {
		sql  string
		args []any
	}{{"INSERT INTO publications(workflow_id,version,body) VALUES(?,?,?)", []any{id, p.Version, jsonText(p)}}, {"UPDATE workflows SET body=? WHERE id=?", []any{encodeWorkflow(w), id}}, {"INSERT INTO grants(workflow_id,version,body) VALUES(?,?,?)", []any{id, p.Version, jsonText(g)}}} {
		if _, e = tx.ExecContext(ctx, q.sql, q.args...); e != nil {
			return p, e
		}
	}
	return p, tx.Commit()
}
func (s *Store) Publication(ctx context.Context, o Owner, id string, v int64) (Published, error) {
	if _, e := s.Get(ctx, o, id); e != nil {
		return Published{}, e
	}
	return decodeRow[Published](s.db.QueryRowContext(ctx, "SELECT body FROM publications WHERE workflow_id=? AND version=?", id, v))
}
func (s *Store) Grant(ctx context.Context, o Owner, id string) (Grant, error) {
	if _, e := s.Get(ctx, o, id); e != nil {
		return Grant{}, e
	}
	return decodeRow[Grant](s.db.QueryRowContext(ctx, "SELECT body FROM grants WHERE workflow_id=? ORDER BY version DESC LIMIT 1", id))
}
func (s *Store) GrantVersion(ctx context.Context, o Owner, id string, version int64) (Grant, error) {
	if _, err := s.Get(ctx, o, id); err != nil {
		return Grant{}, err
	}
	return decodeRow[Grant](s.db.QueryRowContext(ctx, "SELECT body FROM grants WHERE workflow_id=? AND version=?", id, version))
}
func (s *Store) Revoke(ctx context.Context, o Owner, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.Get(ctx, o, id); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, "UPDATE grants SET body=json_set(body,'$.enabled',json('false')) WHERE workflow_id=?", id)
	return err
}

type Contribution struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	NodeID      string          `json:"node_id,omitempty"`
	AttemptID   string          `json:"attempt_id,omitempty"`
	Text        string          `json:"text"`
	Data        json.RawMessage `json:"data,omitempty"`
	Basis       int64           `json:"basis"`
	Revision    int64           `json:"revision"`
	Supersedes  string          `json:"supersedes,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	Invalidated bool            `json:"invalidated,omitempty"`
}
type Attempt struct {
	Invalidated     bool            `json:"invalidated,omitempty"`
	ID              string          `json:"id"`
	NodeID          string          `json:"node_id"`
	Item            *Item           `json:"item,omitempty"`
	Number          int             `json:"number"`
	ThreadID        string          `json:"thread_id,omitempty"`
	RequestID       string          `json:"request_id"`
	State           string          `json:"state"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           string          `json:"error,omitempty"`
	ContextRevision int64           `json:"context_revision"`
	StartedAt       time.Time       `json:"started_at"`
	FinishedAt      time.Time       `json:"finished_at,omitempty"`
}
type Artifact struct {
	Invalidated     bool      `json:"invalidated,omitempty"`
	ID              string    `json:"id"`
	NodeID          string    `json:"node_id"`
	MediaType       string    `json:"media_type"`
	Content         string    `json:"content"`
	Digest          string    `json:"digest"`
	ContextRevision int64     `json:"context_revision"`
	CreatedAt       time.Time `json:"created_at"`
}
type Run struct {
	ID                string         `json:"id"`
	WorkflowID        string         `json:"workflow_id"`
	DefinitionVersion int64          `json:"definition_version"`
	Definition        Definition     `json:"definition"`
	Revision          int64          `json:"revision"`
	ContextRevision   int64          `json:"context_revision"`
	Status            string         `json:"status"`
	DeadlineAt        time.Time      `json:"deadline_at"`
	Purpose           string         `json:"purpose"`
	TriggerID         string         `json:"trigger_id"`
	ScheduledAt       time.Time      `json:"scheduled_at"`
	CreatedAt         time.Time      `json:"created_at"`
	FinishedAt        time.Time      `json:"finished_at,omitempty"`
	Attempts          []Attempt      `json:"attempts"`
	Contributions     []Contribution `json:"contributions"`
	Artifacts         []Artifact     `json:"artifacts"`
	CancelRequested   bool           `json:"cancel_requested"`
}

func (s *Store) CreateRun(ctx context.Context, o Owner, id, request string, version int64, purpose string, at time.Time) (Run, error) {
	if !identityPattern.MatchString(request) || (purpose != "test" && purpose != "live") || at.IsZero() {
		return Run{}, ErrInvalid
	}
	w, e := s.Get(ctx, o, id)
	if e != nil {
		return Run{}, e
	}
	if w.Archived {
		return Run{}, ErrConflict
	}
	p, e := s.Publication(ctx, o, id, version)
	if e != nil {
		return Run{}, e
	}
	hash := stableID("", id, fmt.Sprint(version), purpose, at.UTC().Format(time.RFC3339Nano))
	runID := stableID("run_", o.User, o.Environment, request)
	s.mu.Lock()
	defer s.mu.Unlock()
	var raw, priorHash string
	e = s.db.QueryRowContext(ctx, "SELECT body,request_hash FROM runs WHERE id=? AND owner_user=? AND owner_env=?", runID, o.User, o.Environment).Scan(&raw, &priorHash)
	if e == nil {
		if hash != priorHash {
			return Run{}, ErrConflict
		}
		var r Run
		e = json.Unmarshal([]byte(raw), &r)
		return r, e
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return Run{}, e
	}
	w, e = s.Get(ctx, o, id)
	if e != nil {
		return Run{}, e
	}
	if w.Archived {
		return Run{}, ErrConflict
	}
	if w.Plugin != nil {
		var count int
		if e = s.db.QueryRowContext(ctx, "SELECT count(*) FROM runs WHERE workflow_id=?", id).Scan(&count); e != nil {
			return Run{}, e
		}
		if count != 0 {
			return Run{}, ErrConflict
		}
	}
	r := Run{ID: runID, WorkflowID: id, DefinitionVersion: version, Definition: p.Definition, Revision: 1, ContextRevision: 1, Status: "ready", Purpose: purpose, TriggerID: request, ScheduledAt: at, CreatedAt: time.Now().UTC(), DeadlineAt: time.Now().UTC().Add(time.Duration(p.Definition.TimeoutSeconds) * time.Second), Attempts: []Attempt{}, Contributions: []Contribution{}, Artifacts: []Artifact{}}
	_, e = s.db.ExecContext(ctx, "INSERT INTO runs(id,workflow_id,owner_user,owner_env,request_id,request_hash,body) VALUES(?,?,?,?,?,?,?)", r.ID, id, o.User, o.Environment, request, hash, jsonText(r))
	return r, e
}
func (s *Store) Run(ctx context.Context, o Owner, id string) (Run, error) {
	if !o.valid() {
		return Run{}, ErrNotFound
	}
	return decodeRow[Run](s.db.QueryRowContext(ctx, "SELECT body FROM runs WHERE id=? AND owner_user=? AND owner_env=?", id, o.User, o.Environment))
}
func (s *Store) Runs(ctx context.Context, o Owner, id string) ([]Run, error) {
	if _, e := s.Get(ctx, o, id); e != nil {
		return nil, e
	}
	rows, e := s.db.QueryContext(ctx, "SELECT body FROM runs WHERE workflow_id=? AND owner_user=? AND owner_env=? ORDER BY rowid DESC LIMIT 100", id, o.User, o.Environment)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		v, e := decodeRow[Run](rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) UpdateRun(ctx context.Context, o Owner, id string, change func(*Run) error) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, e := s.Run(ctx, o, id)
	if e != nil {
		return r, e
	}
	before := jsonText(r)
	if e = change(&r); e != nil {
		return r, e
	}
	if before == jsonText(r) {
		return r, nil
	}
	r.Revision++
	raw := jsonText(r)
	if len(raw) > 8<<20 {
		return r, ErrInvalid
	}
	_, e = s.db.ExecContext(ctx, "UPDATE runs SET body=? WHERE id=?", raw, id)
	return r, e
}
func (s *Store) Contribute(ctx context.Context, o Owner, id string, c Contribution) (Run, error) {
	if (c.Kind != "finding" && c.Kind != "requirement" && c.Kind != "decision") || !identityPattern.MatchString(c.ID) || len(c.Text) > 16000 || len(c.Data) > 65536 || (len(c.Data) > 0 && !json.Valid(c.Data)) {
		return Run{}, ErrInvalid
	}
	return s.UpdateRun(ctx, o, id, func(r *Run) error {
		for _, old := range r.Contributions {
			if old.ID == c.ID {
				if old.Text == c.Text && string(old.Data) == string(c.Data) && old.AttemptID == c.AttemptID && old.NodeID == c.NodeID && old.Kind == c.Kind && old.Basis == c.Basis && old.Supersedes == c.Supersedes {
					return nil
				}
				return ErrConflict
			}
		}
		if terminal(r.Status) || c.Basis < 1 || c.Basis > r.ContextRevision || (c.Kind != "finding" && c.Kind != "requirement" && c.Kind != "decision") {
			return ErrInvalid
		}
		if c.AttemptID != "" {
			found := false
			for _, a := range r.Attempts {
				if a.ID == c.AttemptID && a.NodeID == c.NodeID && a.State == "submitted" {
					found = true
				}
			}
			if !found {
				return ErrConflict
			}
		} else if c.NodeID != "" {
			return ErrInvalid
		}
		if c.Supersedes != "" {
			found := false
			for _, old := range r.Contributions {
				if old.ID == c.Supersedes {
					found = true
				}
			}
			if !found {
				return ErrInvalid
			}
		}

		if len(r.Contributions) >= 2000 {
			return ErrInvalid
		}
		if c.Kind == "requirement" {
			// A changed run-wide requirement invalidates prior business results;
			// active canonical work is observed before it becomes retryable.
			for i := range r.Attempts {
				a := &r.Attempts[i]
				if !a.Invalidated && (a.State == "completed" || a.State == "review") {
					a.State = "failed"
					a.Error = "requirements_changed"
				}
			}
			for i := range r.Contributions {
				if r.Contributions[i].Kind == "result" {
					r.Contributions[i].Invalidated = true
				}
			}
			for i := range r.Artifacts {
				r.Artifacts[i].Invalidated = true
			}
		}
		c.CreatedAt = time.Now().UTC()
		r.ContextRevision++
		c.Revision = r.ContextRevision
		r.Contributions = append(r.Contributions, c)
		return nil
	})
}
func (s *Store) BindThread(ctx context.Context, o Owner, workflow, run, attempt, thread string) error {
	if _, e := s.Get(ctx, o, workflow); e != nil {
		return e
	}
	if run != "" {
		current, err := s.Run(ctx, o, run)
		if err != nil {
			return err
		}
		if current.WorkflowID != workflow {
			return ErrNotFound
		}
		found := false
		for _, a := range current.Attempts {
			if a.ID == attempt {
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
	} else if attempt != "" {
		return ErrInvalid
	}
	if thread == "" {
		return ErrInvalid
	}
	_, e := s.db.ExecContext(ctx, "INSERT INTO work_threads(thread_id,workflow_id,run_id,attempt_id,owner_user,owner_env) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING", thread, workflow, run, attempt, o.User, o.Environment)
	if e != nil {
		return e
	}
	var actual string
	e = s.db.QueryRowContext(ctx, "SELECT thread_id FROM work_threads WHERE workflow_id=? AND run_id=? AND attempt_id=? AND owner_user=? AND owner_env=?", workflow, run, attempt, o.User, o.Environment).Scan(&actual)
	if e != nil || actual != thread {
		return ErrConflict
	}
	return nil
}

type ThreadBinding struct {
	WorkflowID string
	RunID      string
	AttemptID  string
}

func (s *Store) ForThread(ctx context.Context, o Owner, thread string) (ThreadBinding, error) {
	var b ThreadBinding
	if !o.valid() {
		return b, ErrNotFound
	}
	e := s.db.QueryRowContext(ctx, "SELECT workflow_id,run_id,attempt_id FROM work_threads WHERE thread_id=? AND owner_user=? AND owner_env=?", thread, o.User, o.Environment).Scan(&b.WorkflowID, &b.RunID, &b.AttemptID)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return b, e
}

func (s *Store) AnyThread(ctx context.Context, thread string) (Owner, ThreadBinding, error) {
	var o Owner
	var b ThreadBinding
	e := s.db.QueryRowContext(ctx, "SELECT owner_user,owner_env,workflow_id,run_id,attempt_id FROM work_threads WHERE thread_id=?", thread).Scan(&o.User, &o.Environment, &b.WorkflowID, &b.RunID, &b.AttemptID)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return o, b, e
}
func (s *Store) ThreadForWork(ctx context.Context, o Owner, workflow, run, attempt string) (string, error) {
	var thread string
	e := s.db.QueryRowContext(ctx, "SELECT thread_id FROM work_threads WHERE owner_user=? AND owner_env=? AND workflow_id=? AND run_id=? AND attempt_id=?", o.User, o.Environment, workflow, run, attempt).Scan(&thread)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return thread, e
}

// ActiveRuns enumerates durable product work without inferring execution outcomes.
func (s *Store) ActiveRuns(ctx context.Context) ([]OwnedRun, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT owner_user,owner_env,body FROM runs WHERE json_extract(body,'$.status') NOT IN ('completed','partial','failed','canceled') ORDER BY rowid")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OwnedRun{}
	for rows.Next() {
		var item OwnedRun
		var raw string
		if err := rows.Scan(&item.Owner.User, &item.Owner.Environment, &raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &item.Run); err != nil {
			return nil, err
		}
		if !terminal(item.Run.Status) {
			out = append(out, item)
		}
	}
	return out, rows.Err()
}

type OwnedRun struct {
	Owner Owner
	Run   Run
}

func (s *Store) RequestCancel(ctx context.Context, o Owner, id string) (Run, error) {
	return s.UpdateRun(ctx, o, id, func(r *Run) error {
		if terminal(r.Status) {
			return ErrConflict
		}
		r.CancelRequested = true
		r.Status = "canceling"
		return nil
	})
}

func (s *Store) ThreadForAttempt(ctx context.Context, o Owner, attempt string) (string, error) {
	var thread string
	err := s.db.QueryRowContext(ctx, "SELECT thread_id FROM work_threads WHERE owner_user=? AND owner_env=? AND attempt_id=?", o.User, o.Environment, attempt).Scan(&thread)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return thread, err
}

// Archive removes future authoring and admission while retaining all history.
func (s *Store) Archive(ctx context.Context, o Owner, id string, revision int64) (Workflow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, err := s.Get(ctx, o, id)
	if err != nil {
		return w, err
	}
	if w.Revision != revision {
		return w, ErrConflict
	}
	w.Archived = true
	w.Revision++
	w.UpdatedAt = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, "UPDATE workflows SET body=? WHERE id=?", encodeWorkflow(w), id)
	return w, err
}

// RunSummary keeps polling independent from retained report and context bytes.
type RunSummary struct {
	ID                string    `json:"id"`
	Status            string    `json:"status"`
	DefinitionVersion int64     `json:"definition_version"`
	Revision          int64     `json:"revision"`
	ScheduledAt       time.Time `json:"scheduled_at"`
}

func (s *Store) RunSummaries(ctx context.Context, o Owner, id string) ([]RunSummary, error) {
	if _, err := s.Get(ctx, o, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT json_object('id',id,'status',json_extract(body,'$.status'),'definition_version',json_extract(body,'$.definition_version'),'revision',json_extract(body,'$.revision'),'scheduled_at',json_extract(body,'$.scheduled_at')) FROM runs WHERE workflow_id=? AND owner_user=? AND owner_env=? ORDER BY rowid DESC LIMIT 100`, id, o.User, o.Environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunSummary{}
	for rows.Next() {
		v, err := decodeRow[RunSummary](rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
