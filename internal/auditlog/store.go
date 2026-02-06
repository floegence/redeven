package auditlog

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultMaxBytes   = int64(4 << 20) // 4 MiB
	defaultMaxBackups = 3
)

type Entry struct {
	CreatedAt string `json:"created_at"`

	// Action is a short, stable identifier (e.g. "session_opened", "codespace_start").
	Action string `json:"action"`

	// Status is "success" or "failure".
	Status string `json:"status"`

	// Error is a human-readable error summary (best-effort, non-secret).
	Error string `json:"error,omitempty"`

	ChannelID string `json:"channel_id,omitempty"`

	EnvPublicID       string `json:"env_public_id,omitempty"`
	NamespacePublicID string `json:"namespace_public_id,omitempty"`

	UserPublicID string `json:"user_public_id,omitempty"`
	UserEmail    string `json:"user_email,omitempty"`

	FloeApp     string `json:"floe_app,omitempty"`
	SessionKind string `json:"session_kind,omitempty"`
	CodeSpaceID string `json:"code_space_id,omitempty"`
	TunnelURL   string `json:"tunnel_url,omitempty"`
	CanRead     bool   `json:"can_read"`
	CanWrite    bool   `json:"can_write"`
	CanExecute  bool   `json:"can_execute"`
	CanAdmin    bool   `json:"can_admin"`

	// Detail is a small, action-specific object (avoid secrets).
	Detail map[string]any `json:"detail,omitempty"`
}

type Options struct {
	Logger *slog.Logger
	// StateDir is the agent state directory (e.g. ~/.redeven).
	StateDir string

	// MaxBytes limits the size of a single audit log file (rotation threshold).
	// If <= 0, a safe default is used.
	MaxBytes int64
	// MaxBackups keeps the latest N rotated files (in addition to the active file).
	// If <= 0, a safe default is used.
	MaxBackups int
}

type Store struct {
	log *slog.Logger

	dir        string
	activePath string

	maxBytes   int64
	maxBackups int

	mu sync.Mutex
}

func New(opts Options) (*Store, error) {
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	dir := filepath.Join(stateDir, "audit")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	maxBytes := opts.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultMaxBytes
	}
	maxBackups := opts.MaxBackups
	if maxBackups <= 0 {
		maxBackups = defaultMaxBackups
	}

	activePath := filepath.Join(dir, "events.jsonl")
	// Ensure the file exists with strict permissions (best-effort).
	if f, err := os.OpenFile(activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		_ = f.Close()
	} else {
		return nil, err
	}

	return &Store{
		log:        logger,
		dir:        dir,
		activePath: activePath,
		maxBytes:   maxBytes,
		maxBackups: maxBackups,
	}, nil
}

func (s *Store) Append(e Entry) {
	if s == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(e.CreatedAt) == "" {
		e.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(e.Status) == "" {
		e.Status = "success"
	}

	f, err := os.OpenFile(s.activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.log.Warn("auditlog append failed", "error", err)
		return
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(&e); err != nil {
		s.log.Warn("auditlog encode failed", "error", err)
		return
	}

	s.maybeRotateLocked()
}

func (s *Store) List(limit int) ([]Entry, error) {
	if s == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}

	s.mu.Lock()
	files := s.listFilesLocked()
	s.mu.Unlock()

	out := make([]Entry, 0, limit)
	for _, path := range files {
		if len(out) >= limit {
			break
		}
		entries, err := readFileNewestFirst(path, limit-len(out))
		if err != nil {
			// Best-effort: return what we have.
			s.log.Warn("auditlog read failed", "path", path, "error", err)
			continue
		}
		out = append(out, entries...)
	}
	return out, nil
}

func (s *Store) listFilesLocked() []string {
	// Order matters: newest first (active file, then rotated files).
	paths := []string{s.activePath}

	ents, err := os.ReadDir(s.dir)
	if err != nil {
		return paths
	}
	var rotated []string
	for _, ent := range ents {
		if ent == nil {
			continue
		}
		if ent.IsDir() {
			continue
		}
		name := ent.Name()
		// events-<unix_ms>.jsonl
		if !strings.HasPrefix(name, "events-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		rotated = append(rotated, filepath.Join(s.dir, name))
	}
	sort.Slice(rotated, func(i, j int) bool {
		// Names include UnixMilli, which sorts lexicographically in the same order.
		return rotated[i] > rotated[j]
	})
	paths = append(paths, rotated...)
	return paths
}

func (s *Store) maybeRotateLocked() {
	if s == nil {
		return
	}
	if s.maxBytes <= 0 {
		return
	}
	st, err := os.Stat(s.activePath)
	if err != nil {
		return
	}
	if st.Size() <= s.maxBytes {
		return
	}

	ts := time.Now().UnixMilli()
	dst := filepath.Join(s.dir, fmt.Sprintf("events-%d.jsonl", ts))
	if err := os.Rename(s.activePath, dst); err != nil {
		s.log.Warn("auditlog rotate failed", "error", err)
		return
	}
	// Re-create the active file.
	if f, err := os.OpenFile(s.activePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600); err == nil {
		_ = f.Close()
	}

	// Cleanup old backups (best-effort).
	ents, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	var rotated []string
	for _, ent := range ents {
		if ent == nil || ent.IsDir() {
			continue
		}
		name := ent.Name()
		if !strings.HasPrefix(name, "events-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		rotated = append(rotated, name)
	}
	sort.Strings(rotated) // oldest -> newest (lexicographically)
	if len(rotated) <= s.maxBackups {
		return
	}
	toDelete := rotated[:len(rotated)-s.maxBackups]
	for _, name := range toDelete {
		_ = os.Remove(filepath.Join(s.dir, name))
	}
}

func readFileNewestFirst(path string, limit int) ([]Entry, error) {
	p := strings.TrimSpace(path)
	if p == "" {
		return nil, nil
	}
	if limit <= 0 {
		return nil, nil
	}

	f, err := os.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	// Guard against accidental large lines.
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)

	var entries []Entry
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}

	// Newest first.
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}
