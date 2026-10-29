package agentplugins

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/google/uuid"
)

var ErrConflict = errors.New("configuration_changed")
var ErrBusy = errors.New("plugin_in_use")
var ErrUnavailable = errors.New("component_unavailable")

type DiscoveredTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema"`
}
type ComponentState struct {
	Tools          []DiscoveredTool `json:"tools,omitempty"`
	CheckedAt      int64            `json:"checked_at,omitempty"`
	Enabled        bool             `json:"enabled"`
	CredentialRef  string           `json:"credential_ref,omitempty"`
	CredentialKeys []string         `json:"credential_keys,omitempty"`
}
type UpdateStatus struct {
	CheckedAt int64  `json:"checked_at"`
	Commit    string `json:"commit,omitempty"`
	Available bool   `json:"available"`
	Failed    bool   `json:"failed"`
}
type Install struct {
	AutoCheck   bool                      `json:"auto_check"`
	Update      UpdateStatus              `json:"update"`
	ID          string                    `json:"id"`
	Revision    int64                     `json:"revision"`
	Source      Source                    `json:"source"`
	Digest      string                    `json:"digest"`
	Package     Package                   `json:"package"`
	Enabled     bool                      `json:"enabled"`
	Components  map[string]ComponentState `json:"components"`
	InstalledAt int64                     `json:"installed_at"`
	UpdatedAt   int64                     `json:"updated_at"`
}
type Operation struct {
	ID               string   `json:"id"`
	Owner            string   `json:"-"`
	RequestID        string   `json:"-"`
	RequestDigest    string   `json:"-"`
	Kind             string   `json:"kind"`
	Status           string   `json:"status"`
	InstallID        string   `json:"install_id,omitempty"`
	ExpectedRevision int64    `json:"expected_revision"`
	Source           Source   `json:"source"`
	Digest           string   `json:"digest,omitempty"`
	Package          *Package `json:"package,omitempty"`
	Previous         *Package `json:"previous,omitempty"`
	CreatedAt        int64    `json:"created_at"`
	ExpiresAt        int64    `json:"expires_at"`
	Error            string   `json:"error,omitempty"`
	CommitSelection  string   `json:"-"`
}

// Operation authority is persisted separately from its public representation.
type storedOperation struct {
	Operation
	Owner           string `json:"owner"`
	RequestID       string `json:"request_id"`
	RequestDigest   string `json:"request_digest"`
	CommitSelection string `json:"commit_selection"`
}
type CatalogSource struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Name string `json:"name"`
}
type State struct {
	Revision   int64             `json:"revision"`
	Installs   []Install         `json:"installs"`
	Operations []storedOperation `json:"operations"`
	Sources    []CatalogSource   `json:"sources"`
}
type Manager struct {
	mu        sync.Mutex
	db        *sql.DB
	root      string
	state     State
	active    map[string]int
	http      *http.Client
	closed    bool
	ctx       context.Context
	cancel    context.CancelFunc
	workers   sync.WaitGroup
	preparing int
}

const registryDDL = `CREATE TABLE agent_plugin_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL)`

func Open(stateDir string) (*Manager, error) {
	root := filepath.Join(stateDir, "ai", "agent-plugins")
	if e := os.MkdirAll(root, 0700); e != nil {
		return nil, e
	}
	verify := func(tx *sql.Tx) error {
		var ddl string
		if e := tx.QueryRow(`SELECT sql FROM sqlite_schema WHERE name='agent_plugin_state'`).Scan(&ddl); e != nil {
			return e
		}
		if ddl != registryDDL {
			return errors.New("agent plugin registry schema drift")
		}
		var count int
		if e := tx.QueryRow(`SELECT count(*) FROM agent_plugin_state`).Scan(&count); e != nil {
			return e
		}
		if count != 1 {
			return errors.New("invalid agent plugin registry")
		}
		var rev int64
		var payload string
		if e := tx.QueryRow(`SELECT revision,payload FROM agent_plugin_state WHERE id=1`).Scan(&rev, &payload); e != nil {
			return e
		}
		var s State
		if e := decodeState([]byte(payload), &s); e != nil {
			return e
		}
		return validateState(s, rev)
	}
	db, e := sqliteutil.Open(filepath.Join(root, "registry.sqlite"), sqliteutil.Spec{Kind: "flower_agent_plugins", CurrentVersion: 1, MinimumVersion: 1, Pragmas: []string{`PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=3000`}, Initialize: func(tx *sql.Tx) error {
		if _, e := tx.Exec(registryDDL); e != nil {
			return e
		}
		b, _ := json.Marshal(State{Revision: 1, Installs: []Install{}, Operations: []storedOperation{}, Sources: []CatalogSource{}})
		_, e := tx.Exec(`INSERT INTO agent_plugin_state VALUES(1,1,?)`, string(b))
		return e
	}, Verify: verify, ValidateExisting: func(tx *sql.Tx) error {
		var version int
		var kind string
		if e := tx.QueryRow("PRAGMA user_version").Scan(&version); e != nil {
			return e
		}
		tables, e := sqliteutil.ListUserTablesTx(tx)
		if e != nil {
			return e
		}
		has, e := sqliteutil.TableExistsTx(tx, "__redeven_db_meta")
		if e != nil {
			return e
		}
		if version == 0 && !has && len(tables) == 0 {
			return nil
		}
		if !has {
			return &sqliteutil.WrongDatabaseKindError{ExpectedKind: "flower_agent_plugins", Existing: tables}
		}
		if e = tx.QueryRow("SELECT db_kind FROM __redeven_db_meta WHERE singleton=1").Scan(&kind); e != nil {
			return e
		}
		if kind != "flower_agent_plugins" {
			return &sqliteutil.WrongDatabaseKindError{ExpectedKind: "flower_agent_plugins", ActualKind: kind}
		}
		if version > 1 {
			return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: 1}
		}
		if version < 1 {
			return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: 1}
		}
		return verify(tx)
	}})
	if e != nil {
		return nil, e
	}
	lifetime, cancel := context.WithCancel(context.Background())
	m := &Manager{db: db, root: root, active: map[string]int{}, http: DistributionHTTP(), ctx: lifetime, cancel: cancel}
	var b string
	if e = db.QueryRow(`SELECT payload FROM agent_plugin_state WHERE id=1`).Scan(&b); e != nil {
		db.Close()
		return nil, e
	}
	if e = decodeState([]byte(b), &m.state); e != nil {
		db.Close()
		return nil, e
	}
	for _, dir := range []string{"packages", "staging", "data"} {
		if e = os.MkdirAll(filepath.Join(root, dir), 0700); e != nil {
			db.Close()
			return nil, e
		}
	}
	next := cloneState(m.state)
	changed := false
	for i := range next.Operations {
		op := &next.Operations[i]
		if op.Status == "preparing" {
			op.Status = "failed"
			op.Error = "interrupted"
			changed = true
		}
		if op.Status == "ready" && op.ExpiresAt < time.Now().UnixMilli() {
			op.Status = "expired"
			changed = true
		}
	}
	if changed {
		if e = m.saveLocked(next); e != nil {
			db.Close()
			return nil, e
		}
	}
	m.cleanupLocked()
	m.workers.Add(1)
	go func() { defer m.workers.Done(); m.runUpdateChecks() }()
	return m, nil
}

var digestPattern = regexp.MustCompile("^[0-9a-f]{64}$")

func decodeState(b []byte, state *State) error {
	if len(b) > 16<<20 {
		return errors.New("registry exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(state); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid registry payload")
	}
	return nil
}
func validID(id string) bool { u, e := uuid.Parse(id); return e == nil && u.String() == id }
func validateStoredPackage(p Package) error {
	if p.Manifest.Schema != ManifestSchema || len(p.Manifest.Name) > 64 || !pluginName.MatchString(p.Manifest.Name) || strings.Contains(p.Manifest.Name, "--") || strings.Contains(p.Manifest.Name, "..") || p.Skills == nil || p.MCP == nil || p.Diagnostics == nil {
		return errors.New("invalid stored package")
	}
	seen := map[string]bool{}
	for _, skill := range p.Skills {
		if seen[skill.Key] || len(skill.Name) > 64 || !skillName.MatchString(skill.Name) || strings.Contains(skill.Name, "--") || strings.TrimSpace(skill.Description) == "" || utf8.RuneCountInString(skill.Description) > 1024 || skill.Key != "skill:"+skill.Name || skill.Path != "skills/"+skill.Name+"/SKILL.md" {
			return errors.New("invalid stored skill")
		}
		seen[skill.Key] = true
	}
	for _, config := range p.MCP {
		b, err := json.Marshal(config)
		if err != nil {
			return err
		}
		if _, err = parseMCP(b); err != nil {
			return err
		}
		if config.Type == "sse" {
			return errors.New("unsupported stored transport")
		}
		if err = validateMCPPathSyntax(config); err != nil {
			return err
		}
	}
	return nil
}
func validateState(s State, rev int64) error {
	if rev < 1 || s.Revision != rev || s.Installs == nil || s.Operations == nil || s.Sources == nil || len(s.Installs) > 64 || len(s.Operations) > 256 || len(s.Sources) > 16 {
		return errors.New("invalid registry state")
	}
	seen := map[string]bool{}
	sources := map[string]bool{}
	for _, in := range s.Installs {
		if !validID(in.ID) {
			return errors.New("invalid installation id")
		}
		if seen[in.ID] || sources[in.Source.Key()] || !digestPattern.MatchString(in.Digest) || in.Revision < 1 || in.Components == nil {
			return errors.New("invalid installation identity")
		}
		if err := in.Source.validate(); err != nil {
			return err
		}
		if err := validateStoredPackage(in.Package); err != nil {
			return err
		}
		if len(in.Components) != len(in.Package.Skills)+len(in.Package.MCP) {
			return errors.New("incomplete stored components")
		}

		for key, c := range in.Components {
			if len(c.Tools) > 128 || c.CheckedAt < 0 {
				return errors.New("invalid tool discovery")
			}
			for _, tool := range c.Tools {
				if tool.Name == "" || len(tool.Schema) > 32<<10 || !json.Valid(tool.Schema) {
					return errors.New("invalid stored tool")
				}
			}
			if c.CredentialRef != "" && !validID(c.CredentialRef) {
				return errors.New("invalid credential reference")
			}
			found := false
			for _, skill := range in.Package.Skills {
				if skill.Key == key {
					found = true
				}
			}
			if strings.HasPrefix(key, "mcp:") {
				_, found = in.Package.MCP[strings.TrimPrefix(key, "mcp:")]
			}
			if !found {
				return errors.New("invalid stored component")
			}
		}
		seen[in.ID] = true
		sources[in.Source.Key()] = true
	}
	opIDs := map[string]bool{}
	for _, op := range s.Operations {
		if !validID(op.ID) || !validID(op.InstallID) || opIDs[op.ID] || op.Owner == "" {
			return errors.New("invalid operation identity")
		}
		if err := op.Source.validate(); err != nil {
			return err
		}
		if op.Kind != "install" && op.Kind != "update" {
			return errors.New("invalid operation kind")
		}
		if len(op.RequestID) < 8 || len(op.RequestID) > 128 || op.ExpectedRevision < 0 {
			return errors.New("invalid operation request")
		}
		if op.Package != nil {
			if err := validateStoredPackage(*op.Package); err != nil {
				return err
			}
		}
		if op.Previous != nil {
			if err := validateStoredPackage(*op.Previous); err != nil {
				return err
			}
		}
		opIDs[op.ID] = true
		switch op.Status {
		case "preparing", "ready", "committed", "failed", "expired":
		default:
			return errors.New("invalid operation status")
		}
		if op.Status == "ready" || op.Status == "committed" {
			if !digestPattern.MatchString(op.Digest) || op.Package == nil {
				return errors.New("invalid operation package")
			}
		}
	}
	for _, source := range s.Sources {
		if !validID(source.ID) || source.URL == "" {
			return errors.New("invalid catalog identity")
		}
	}

	return nil
}
func cloneState(s State) State {
	b, _ := json.Marshal(s)
	var next State
	_ = json.Unmarshal(b, &next)
	return next
}
func (m *Manager) saveLocked(next State) error {
	if m.closed {
		return errors.New("plugin manager closed")
	}
	next.Revision = m.state.Revision + 1
	if e := validateState(next, next.Revision); e != nil {
		return e
	}
	b, e := json.Marshal(next)
	if e != nil {
		return e
	}
	if len(b) > 16<<20 {
		return errors.New("registry exceeds limit")
	}
	result, e := m.db.Exec(`UPDATE agent_plugin_state SET revision=?,payload=? WHERE id=1 AND revision=?`, next.Revision, string(b), m.state.Revision)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return ErrConflict
	}
	m.state = next
	return nil
}
func (m *Manager) Close() error {
	m.mu.Lock()
	m.cancel()
	m.closed = true
	m.mu.Unlock()
	m.workers.Wait()
	return m.db.Close()
}
func (m *Manager) List() ([]Install, int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := cloneState(m.state)
	return s.Installs, s.Revision
}
func (m *Manager) Get(id string) (Install, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, in := range cloneState(m.state).Installs {
		if in.ID == id {
			return in, nil
		}
	}
	return Install{}, ErrUnavailable
}
func (m *Manager) Root(in Install) string { return filepath.Join(m.root, "packages", in.Digest) }
func (m *Manager) Data(id string) string  { return filepath.Join(m.root, "data", id) }
func (m *Manager) Operation(id, owner string) (Operation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, op := range cloneState(m.state).Operations {
		if op.ID == id && op.Owner == owner {
			return op.Operation, nil
		}
	}
	return Operation{}, ErrUnavailable
}

type PrepareRequest struct {
	RequestID string `json:"request_id"`
	Source    Source `json:"source"`
	InstallID string `json:"install_id,omitempty"`
	Revision  int64  `json:"revision"`
}

func (m *Manager) Prepare(ctx context.Context, owner string, req PrepareRequest) (Operation, error) {
	return m.prepare(ctx, owner, req, false)
}
func (m *Manager) Begin(owner string, req PrepareRequest) (Operation, error) {
	return m.prepare(m.ctx, owner, req, true)
}
func (m *Manager) prepare(ctx context.Context, owner string, req PrepareRequest, background bool) (Operation, error) {
	if owner == "" || len(req.RequestID) < 8 || len(req.RequestID) > 128 {
		return Operation{}, errors.New("invalid request identity")
	}
	// Installed commits are receipts; updates resolve the requested ref again.
	if req.InstallID != "" {
		req.Source.Commit = ""
	}
	source, e := req.Source.Normalize()
	if e != nil {
		return Operation{}, e
	}
	req.Source = source
	b, _ := json.Marshal(req)
	requestDigest := string(b)
	m.mu.Lock()
	for _, old := range m.state.Operations {
		if old.Owner == owner && old.RequestID == req.RequestID {
			m.mu.Unlock()
			if old.RequestDigest != requestDigest {
				return Operation{}, ErrConflict
			}
			return old.Operation, nil
		}
	}
	next := cloneState(m.state)
	op := storedOperation{Operation: Operation{ID: uuid.NewString(), Kind: "install", Status: "preparing", Source: source, InstallID: req.InstallID, ExpectedRevision: req.Revision, CreatedAt: time.Now().UnixMilli(), ExpiresAt: time.Now().Add(30 * time.Minute).UnixMilli()}, Owner: owner, RequestID: req.RequestID, RequestDigest: requestDigest}
	found := false
	for _, in := range next.Installs {
		if in.Source.Key() == source.Key() && in.ID != req.InstallID {
			m.mu.Unlock()
			return Operation{}, errors.New("source_already_installed")
		}
		if in.ID == req.InstallID {
			found = true
			if in.Revision != req.Revision || in.Source.Key() != source.Key() {
				m.mu.Unlock()
				return Operation{}, ErrConflict
			}
			previous := in.Package
			op.Previous = &previous
			op.Kind = "update"
		}
	}
	if req.InstallID != "" && !found {
		m.mu.Unlock()
		return Operation{}, ErrUnavailable
	}
	if req.InstallID == "" {
		op.InstallID = uuid.NewString()
		if len(next.Installs) >= 64 {
			m.mu.Unlock()
			return Operation{}, errors.New("installation_limit")
		}
	}
	if len(next.Operations) >= 256 {
		kept := next.Operations[:0]
		for _, old := range next.Operations {
			if old.Status == "preparing" || (old.Status == "ready" && old.ExpiresAt > time.Now().UnixMilli()) || old.CreatedAt > time.Now().Add(-24*time.Hour).UnixMilli() {
				kept = append(kept, old)
			}
		}
		next.Operations = kept
		if len(kept) >= 256 {
			m.mu.Unlock()
			return Operation{}, errors.New("operation_limit")
		}
	}
	if m.preparing >= 4 {
		m.mu.Unlock()
		return Operation{}, errors.New("preparation_limit")
	}
	next.Operations = append(next.Operations, op)
	e = m.saveLocked(next)
	if e == nil {
		m.preparing++
		m.workers.Add(1)
	}
	m.mu.Unlock()
	if e != nil {
		return Operation{}, e
	}
	if background {
		go func() { _, _ = m.finishPrepare(ctx, op) }()
		return op.Operation, nil
	}
	return m.finishPrepare(ctx, op)
}
func (m *Manager) finishPrepare(ctx context.Context, op storedOperation) (Operation, error) {
	defer func() { m.mu.Lock(); m.preparing--; m.mu.Unlock(); m.workers.Done() }()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	source := op.Source
	stage := filepath.Join(m.root, "staging", op.ID)
	resolved, fetchErr := Fetch(ctx, m.http, source, stage)
	var pkg Package
	var digest string
	if fetchErr == nil {
		pkg, fetchErr = Load(stage)
	}
	if fetchErr == nil {
		digest, fetchErr = Digest(stage)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i := range next.Operations {
		if next.Operations[i].ID == op.ID {
			current := &next.Operations[i]
			if fetchErr != nil {
				current.Status = "failed"
				current.Error = "package_preparation_failed"
				_ = os.RemoveAll(stage)
			} else {
				current.Status = "ready"
				current.Source = resolved
				current.Digest = digest
				current.Package = &pkg
			}
			op = *current
			break
		}
	}
	if e := m.saveLocked(next); e != nil {
		return Operation{}, e
	}
	return op.Operation, nil
}

type CommitRequest struct {
	OperationID string   `json:"operation_id"`
	Digest      string   `json:"digest"`
	Enabled     bool     `json:"enabled"`
	Components  []string `json:"components"`
}

func (m *Manager) Commit(owner string, req CommitRequest) (Install, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	index := -1
	for i, op := range next.Operations {
		if op.ID == req.OperationID && op.Owner == owner {
			index = i
			break
		}
	}
	if index < 0 {
		return Install{}, ErrUnavailable
	}
	op := &next.Operations[index]
	sorted := append([]string{}, req.Components...)
	sort.Strings(sorted)
	selection, _ := json.Marshal(struct {
		Enabled    bool
		Components []string
	}{req.Enabled, sorted})
	if op.Status == "committed" {
		if op.CommitSelection != string(selection) || op.Digest != req.Digest {
			return Install{}, ErrConflict
		}
		for _, in := range next.Installs {
			if in.ID == op.InstallID && in.Digest == op.Digest {
				return in, nil
			}
		}
		return Install{}, ErrConflict
	}
	if op.Status != "ready" || op.Digest != req.Digest || op.ExpiresAt < time.Now().UnixMilli() || op.Package == nil {
		return Install{}, ErrConflict
	}
	if m.active[op.InstallID] > 0 {
		return Install{}, ErrBusy
	}
	oldIndex := -1
	for i, in := range next.Installs {
		if in.ID == op.InstallID {
			oldIndex = i
			if in.Revision != op.ExpectedRevision {
				return Install{}, ErrConflict
			}
		} else if in.Source.Key() == op.Source.Key() {
			return Install{}, ErrConflict
		}
	}
	if op.Kind == "update" && oldIndex < 0 {
		return Install{}, ErrConflict
	}
	stage := filepath.Join(m.root, "staging", op.ID)
	target := filepath.Join(m.root, "packages", op.Digest)
	root := stage
	if _, e := os.Stat(stage); os.IsNotExist(e) {
		root = target
	}
	digest, e := Digest(root)
	if e != nil || digest != op.Digest {
		return Install{}, errors.New("package_changed")
	}
	pkg, e := Load(root)
	if e != nil {
		return Install{}, e
	}
	components := map[string]ComponentState{}
	for _, skill := range pkg.Skills {
		components[skill.Key] = ComponentState{}
	}
	for key := range pkg.MCP {
		components["mcp:"+key] = ComponentState{}
	}
	for _, key := range sorted {
		if _, ok := components[key]; !ok {
			return Install{}, errors.New("unknown_component")
		}
		components[key] = ComponentState{Enabled: true}
	}
	now := time.Now().UnixMilli()
	in := Install{AutoCheck: op.Source.Type == "github", ID: op.InstallID, Revision: 1, Source: op.Source, Digest: op.Digest, Package: pkg, Enabled: req.Enabled, Components: components, InstalledAt: now, UpdatedAt: now}
	if oldIndex >= 0 {
		old := next.Installs[oldIndex]
		in.AutoCheck = old.AutoCheck
		in.InstalledAt = old.InstalledAt
		in.Revision = old.Revision + 1
		for key, c := range in.Components {
			if previous, ok := old.Components[key]; ok {
				before, _ := json.Marshal(old.Package.MCP[strings.TrimPrefix(key, "mcp:")])
				after, _ := json.Marshal(pkg.MCP[strings.TrimPrefix(key, "mcp:")])
				if string(before) == string(after) {
					c.CredentialRef = previous.CredentialRef
					c.CredentialKeys = previous.CredentialKeys
					in.Components[key] = c
				}
			}
		}
	}
	if e = os.MkdirAll(m.Data(in.ID), 0700); e != nil {
		return Install{}, e
	}
	if _, e = os.Stat(target); os.IsNotExist(e) {
		if e = os.Rename(stage, target); e != nil {
			return Install{}, e
		}
	} else {
		existing, e := Digest(target)
		if e != nil || existing != digest {
			return Install{}, errors.New("package_changed")
		}
	}
	if oldIndex >= 0 {
		next.Installs[oldIndex] = in
	} else {
		next.Installs = append(next.Installs, in)
	}
	op.Status = "committed"
	op.CommitSelection = string(selection)
	if e = m.saveLocked(next); e != nil {
		return Install{}, e
	}
	_ = os.RemoveAll(stage)
	m.cleanupLocked()
	return in, nil
}

type Change struct {
	AutoCheck *bool  `json:"auto_check,omitempty"`
	ID        string `json:"id"`
	Revision  int64  `json:"revision"`
	Enabled   *bool  `json:"enabled,omitempty"`
	Component string `json:"component,omitempty"`
}

func (m *Manager) Change(req Change) (Install, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i := range next.Installs {
		in := &next.Installs[i]
		if in.ID != req.ID {
			continue
		}
		if in.Revision != req.Revision || (req.Enabled == nil && req.AutoCheck == nil) {
			return Install{}, ErrConflict
		}
		if req.AutoCheck != nil {
			if req.Component != "" || req.Enabled != nil || in.Source.Type != "github" {
				return Install{}, ErrUnavailable
			}
			in.AutoCheck = *req.AutoCheck
		} else if req.Component == "" {
			in.Enabled = *req.Enabled
		} else {
			c, ok := in.Components[req.Component]
			if !ok {
				return Install{}, ErrUnavailable
			}
			c.Enabled = *req.Enabled
			in.Components[req.Component] = c
		}
		in.Revision++
		in.UpdatedAt = time.Now().UnixMilli()
		if e := m.saveLocked(next); e != nil {
			return Install{}, e
		}
		return *in, nil
	}
	return Install{}, ErrUnavailable
}
func (m *Manager) BindCredential(id string, revision int64, key, ref string, keys []string) (Install, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i := range next.Installs {
		in := &next.Installs[i]
		if in.ID != id {
			continue
		}
		if in.Revision != revision {
			return Install{}, ErrConflict
		}
		c, ok := in.Components[key]
		if !ok || !strings.HasPrefix(key, "mcp:") {
			return Install{}, ErrUnavailable
		}
		c.Tools = nil
		c.CheckedAt = 0
		c.CredentialRef = ref
		c.CredentialKeys = keys
		in.Components[key] = c
		in.Revision++
		if e := m.saveLocked(next); e != nil {
			return Install{}, e
		}
		return *in, nil
	}
	return Install{}, ErrUnavailable
}
func (m *Manager) Remove(id string, revision int64, deleteData bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i, in := range next.Installs {
		if in.ID != id {
			continue
		}
		if in.Revision != revision {
			return ErrConflict
		}
		if m.active[id] > 0 {
			return ErrBusy
		}
		next.Installs = append(next.Installs[:i], next.Installs[i+1:]...)
		if e := m.saveLocked(next); e != nil {
			return e
		}
		m.cleanupLocked()
		if deleteData {
			return os.RemoveAll(m.Data(id))
		}
		return nil
	}
	return ErrUnavailable
}

// Acquire is a resource lease, not an invocation lifecycle. Floret still owns execution.
func (m *Manager) Acquire(id string, revision int64, key string) (Install, func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, in := range m.state.Installs {
		if in.ID != id {
			continue
		}
		c, ok := in.Components[key]
		if in.Revision != revision || !in.Enabled || !ok || !c.Enabled {
			return Install{}, nil, ErrUnavailable
		}
		digest, e := Digest(m.Root(in))
		if e != nil || digest != in.Digest {
			return Install{}, nil, errors.New("package_changed")
		}
		m.active[id]++
		var once sync.Once
		release := func() { once.Do(func() { m.mu.Lock(); m.active[id]--; m.mu.Unlock() }) }
		return in, release, nil
	}
	return Install{}, nil, ErrUnavailable
}
func (m *Manager) Current(id string, revision int64, key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, in := range m.state.Installs {
		if in.ID == id {
			return in.Revision == revision && in.Enabled && in.Components[key].Enabled
		}
	}
	return false
}

// Operations lets a reconnected administrator recover the exact prepared preview.
func (m *Manager) Operations(owner string) []Operation {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Operation{}
	for _, op := range cloneState(m.state).Operations {
		if op.Owner == owner && (op.Status == "preparing" || (op.Status == "ready" && op.ExpiresAt > time.Now().UnixMilli())) {
			out = append(out, op.Operation)
		}
	}
	return out
}
func (m *Manager) String() string { return fmt.Sprintf("Agent Plugins: %s", m.root) }

// Only unreferenced package and staging directories are collected. Retained data is never collected.
func (m *Manager) cleanupLocked() {
	roots := map[string]bool{}
	stages := map[string]bool{}
	for _, in := range m.state.Installs {
		roots[in.Digest] = true
	}
	for _, op := range m.state.Operations {
		if op.Status == "preparing" || (op.Status == "ready" && op.ExpiresAt > time.Now().UnixMilli()) {
			stages[op.ID] = true
			roots[op.Digest] = true
		}
	}
	for dir, keep := range map[string]map[string]bool{"packages": roots, "staging": stages} {
		entries, e := os.ReadDir(filepath.Join(m.root, dir))
		if e != nil {
			continue
		}
		for _, entry := range entries {
			if !keep[entry.Name()] && (validID(entry.Name()) || digestPattern.MatchString(entry.Name())) {
				_ = os.RemoveAll(filepath.Join(m.root, dir, entry.Name()))
			}
		}
	}
}

// RecordDiscovery persists metadata, never credentials or a parallel invocation lifecycle.
func (m *Manager) RecordDiscovery(id string, revision int64, key string, tools []DiscoveredTool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneState(m.state)
	for i := range next.Installs {
		in := &next.Installs[i]
		if in.ID != id {
			continue
		}
		c, ok := in.Components[key]
		if !ok || in.Revision != revision || !in.Enabled || !c.Enabled {
			return ErrConflict
		}
		c.Tools = tools
		c.CheckedAt = time.Now().UnixMilli()
		in.Components[key] = c
		return m.saveLocked(next)
	}
	return ErrUnavailable
}
