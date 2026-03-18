package diagnostics

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

type Event struct {
	CreatedAt  string         `json:"created_at"`
	Source     string         `json:"source,omitempty"`
	Scope      string         `json:"scope"`
	Kind       string         `json:"kind"`
	TraceID    string         `json:"trace_id,omitempty"`
	Method     string         `json:"method,omitempty"`
	Path       string         `json:"path,omitempty"`
	StatusCode int            `json:"status_code,omitempty"`
	DurationMs int64          `json:"duration_ms,omitempty"`
	Slow       bool           `json:"slow,omitempty"`
	Message    string         `json:"message,omitempty"`
	Detail     map[string]any `json:"detail,omitempty"`
}

type Options struct {
	Logger     *slog.Logger
	StateDir   string
	Source     string
	MaxBytes   int64
	MaxBackups int
}

type Store struct {
	log        *slog.Logger
	dir        string
	source     string
	activePath string
	maxBytes   int64
	maxBackups int
	mu         sync.Mutex
}

func New(opts Options) (*Store, error) {
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	source, err := normalizeSourceName(opts.Source)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(stateDir, "diagnostics")
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
	activePath := activeFilePath(stateDir, source)
	if f, err := os.OpenFile(activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		_ = f.Close()
	} else {
		return nil, err
	}
	return &Store{log: logger, dir: dir, source: source, activePath: activePath, maxBytes: maxBytes, maxBackups: maxBackups}, nil
}

func (s *Store) Append(e Event) {
	if s == nil {
		return
	}
	e = normalizeEvent(e, s.source)
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.log.Warn("diagnostics append failed", "source", s.source, "error", err)
		return
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(&e); err != nil {
		s.log.Warn("diagnostics encode failed", "source", s.source, "error", err)
		return
	}
	s.maybeRotateLocked()
}

func (s *Store) List(limit int) ([]Event, error) {
	if s == nil {
		return nil, nil
	}
	return ListSource(filepath.Dir(s.dir), s.source, limit)
}

func ListSource(stateDir string, source string, limit int) ([]Event, error) {
	cleanStateDir := strings.TrimSpace(stateDir)
	if cleanStateDir == "" {
		return nil, nil
	}
	normalizedSource, err := normalizeSourceName(source)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	files, err := listSourceFiles(cleanStateDir, normalizedSource)
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, limit)
	for _, path := range files {
		if len(out) >= limit {
			break
		}
		events, err := readFileNewestFirst(path, normalizedSource, limit-len(out))
		if err != nil {
			continue
		}
		out = append(out, events...)
	}
	return out, nil
}

func activeFilePath(stateDir string, source string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "diagnostics", source+"-events.jsonl")
}

func rotatedFilePattern(source string) string {
	return source + "-events-"
}

func listSourceFiles(stateDir string, source string) ([]string, error) {
	dir := filepath.Join(strings.TrimSpace(stateDir), "diagnostics")
	activePath := activeFilePath(stateDir, source)
	paths := []string{activePath}
	ents, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return paths, nil
		}
		return nil, err
	}
	var rotated []string
	prefix := rotatedFilePattern(source)
	for _, ent := range ents {
		if ent == nil || ent.IsDir() {
			continue
		}
		name := ent.Name()
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		rotated = append(rotated, filepath.Join(dir, name))
	}
	sort.Slice(rotated, func(i, j int) bool { return rotated[i] > rotated[j] })
	return append(paths, rotated...), nil
}

func normalizeSourceName(source string) (string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return "", errors.New("missing diagnostics source")
	}
	for i := 0; i < len(source); i++ {
		c := source[i]
		switch {
		case c >= 'a' && c <= 'z':
		case c >= '0' && c <= '9':
		case c == '-':
		default:
			return "", fmt.Errorf("invalid diagnostics source: %q", source)
		}
	}
	return source, nil
}

func normalizeEvent(e Event, source string) Event {
	e.CreatedAt = strings.TrimSpace(e.CreatedAt)
	if e.CreatedAt == "" {
		e.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	e.Source = strings.TrimSpace(e.Source)
	if e.Source == "" {
		e.Source = source
	}
	e.Scope = strings.TrimSpace(e.Scope)
	e.Kind = strings.TrimSpace(e.Kind)
	e.TraceID = strings.TrimSpace(e.TraceID)
	e.Method = strings.ToUpper(strings.TrimSpace(e.Method))
	e.Path = strings.TrimSpace(e.Path)
	e.Message = sanitizeText(e.Message, 240)
	e.Detail = sanitizeDetailMap(e.Detail)
	e.Slow = e.Slow || ShouldMarkSlow(e.Scope, e.Kind, e.DurationMs)
	return e
}

func sanitizeText(value string, max int) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	if max > 0 && len(value) > max {
		return value[:max] + "..."
	}
	return value
}

func sanitizeDetailMap(detail map[string]any) map[string]any {
	if len(detail) == 0 {
		return nil
	}
	out := make(map[string]any, len(detail))
	for key, value := range detail {
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" {
			continue
		}
		if sensitiveKey(cleanKey) {
			out[cleanKey] = "[redacted]"
			continue
		}
		out[cleanKey] = sanitizeDetailValue(value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeDetailValue(value any) any {
	switch v := value.(type) {
	case string:
		return sanitizeText(v, 512)
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, sanitizeText(item, 512))
		}
		return out
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, sanitizeDetailValue(item))
		}
		return out
	case map[string]any:
		return sanitizeDetailMap(v)
	case map[string]string:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[key] = item
		}
		return sanitizeDetailMap(out)
	default:
		return value
	}
}

func sensitiveKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return false
	}
	for _, token := range []string{"token", "secret", "password", "authorization", "cookie", "api_key", "apikey", "psk"} {
		if strings.Contains(key, token) {
			return true
		}
	}
	return false
}

func (s *Store) maybeRotateLocked() {
	if s == nil || s.maxBytes <= 0 {
		return
	}
	st, err := os.Stat(s.activePath)
	if err != nil || st.Size() <= s.maxBytes {
		return
	}
	dst := filepath.Join(s.dir, fmt.Sprintf("%s-events-%d.jsonl", s.source, time.Now().UnixNano()))
	if err := os.Rename(s.activePath, dst); err != nil {
		s.log.Warn("diagnostics rotate failed", "source", s.source, "error", err)
		return
	}
	if f, err := os.OpenFile(s.activePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600); err == nil {
		_ = f.Close()
	}
	ents, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	var rotated []string
	prefix := rotatedFilePattern(s.source)
	for _, ent := range ents {
		if ent == nil || ent.IsDir() {
			continue
		}
		name := ent.Name()
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		rotated = append(rotated, name)
	}
	sort.Strings(rotated)
	if len(rotated) <= s.maxBackups {
		return
	}
	for _, name := range rotated[:len(rotated)-s.maxBackups] {
		_ = os.Remove(filepath.Join(s.dir, name))
	}
}

func readFileNewestFirst(path string, source string, limit int) ([]Event, error) {
	path = strings.TrimSpace(path)
	if path == "" || limit <= 0 {
		return nil, nil
	}
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	var events []Event
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e Event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		events = append(events, normalizeEvent(e, source))
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	if len(events) > limit {
		events = events[:limit]
	}
	return events, nil
}
