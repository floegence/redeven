package tessiven

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/google/uuid"
)

var (
	ErrNotFound        = errors.New("tessiven canvas or version not found")
	ErrConflict        = errors.New("tessiven canvas has a newer version; read it before saving")
	ErrRequestConflict = errors.New("tessiven request identity was already used with different content")
	ErrArchived        = errors.New("tessiven canvas is archived")
	ErrInvalidRequest  = errors.New("invalid Tessiven request")
)

type Canvas struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	LatestVersion int64  `json:"latest_version"`
	Archived      bool   `json:"archived"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}
type Version struct {
	CanvasID     string    `json:"canvas_id"`
	Number       int64     `json:"number"`
	DocumentYAML string    `json:"document_yaml"`
	Digest       string    `json:"digest"`
	CreatedAt    int64     `json:"created_at"`
	Source       string    `json:"source"`
	Summary      string    `json:"summary"`
	Document     *Document `json:"document,omitempty"`
}
type SaveRequest struct {
	RequestID       string `json:"request_id"`
	CanvasID        string `json:"canvas_id,omitempty"`
	ExpectedVersion int64  `json:"expected_version"`
	DocumentYAML    string `json:"document_yaml"`
	Summary         string `json:"summary"`
}
type RevisionRequest struct {
	RequestID       string `json:"request_id"`
	ExpectedVersion int64  `json:"expected_version"`
	Version         int64  `json:"version"`
	Title           string `json:"title,omitempty"`
}
type SaveResult struct {
	Canvas  Canvas  `json:"canvas"`
	Version Version `json:"version"`
}
type Library struct {
	Canvases   []Canvas `json:"canvases"`
	NextCursor string   `json:"next_cursor,omitempty"`
}
type Service struct {
	db          *sql.DB
	mu          sync.Mutex
	subscribers map[chan struct{}]struct{}
	closed      bool
}

//go:embed example.yaml
var exampleCanvasYAML string

func Open(path string) (*Service, error) {
	if _, err := sqliteutil.Inspect(path, schemaSpec()); err != nil {
		return nil, err
	}
	db, err := sqliteutil.Open(path, schemaSpec())
	if err != nil {
		return nil, err
	}
	s := &Service{db: db, subscribers: map[chan struct{}]struct{}{}}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM canvases`).Scan(&count); err == nil && count == 0 {
		// This runs before the library accepts requests. The stable request ID
		// makes concurrent startup idempotent; archived canvases still count.
		_, err = s.Save(context.Background(), SaveRequest{RequestID: "tessiven-starter-example-v1", DocumentYAML: exampleCanvasYAML, Summary: "Create illustrative starter canvas"}, "example")
	}
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Create starts an empty canvas immediately. Canvas content is edited by Flower.
func (s *Service) Create(ctx context.Context, requestID, title string) (SaveResult, error) {
	if strings.TrimSpace(title) == "" {
		return SaveResult{}, ErrInvalidRequest
	}
	source, err := documentYAML(&Document{APIVersion: "redeven.io/tessiven/v1", Kind: "ServiceCanvas", Metadata: Metadata{Title: title}})
	if err != nil {
		return SaveResult{}, err
	}
	return s.Save(ctx, SaveRequest{RequestID: requestID, DocumentYAML: source, Summary: "Create canvas"}, "created")
}
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.closed = true
	for ch := range s.subscribers {
		close(ch)
		delete(s.subscribers, ch)
	}
	s.mu.Unlock()
	return s.db.Close()
}

// Subscribe emits invalidations, not discovery or a replay journal. Subscribe
// before reading snapshots, and read snapshots again after a reconnection.
func (s *Service) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.mu.Lock()
	if s.closed {
		close(ch)
	} else {
		s.subscribers[ch] = struct{}{}
		ch <- struct{}{}
	}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if _, ok := s.subscribers[ch]; ok {
			delete(s.subscribers, ch)
			close(ch)
		}
	}
}
func (s *Service) publish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *Service) List(ctx context.Context, query, cursor string, archived bool) (Library, error) {
	result := Library{Canvases: []Canvas{}}
	rows, err := s.db.QueryContext(ctx, `SELECT id,title,description,latest_version,archived,created_at,updated_at FROM canvases WHERE archived=? AND id>? AND (instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0) ORDER BY id LIMIT 101`, archived, cursor, query, query)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Canvas
		if err = scanCanvas(rows, &c); err != nil {
			return result, err
		}
		result.Canvases = append(result.Canvases, c)
	}
	if len(result.Canvases) > 100 {
		result.Canvases = result.Canvases[:100]
		result.NextCursor = result.Canvases[99].ID
	}
	return result, rows.Err()
}

type scanner interface{ Scan(...any) error }

func scanCanvas(row scanner, c *Canvas) error {
	return row.Scan(&c.ID, &c.Title, &c.Description, &c.LatestVersion, &c.Archived, &c.CreatedAt, &c.UpdatedAt)
}
func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func (s *Service) Canvas(ctx context.Context, id string) (Canvas, error) {
	var c Canvas
	err := scanCanvas(s.db.QueryRowContext(ctx, `SELECT id,title,description,latest_version,archived,created_at,updated_at FROM canvases WHERE id=?`, id), &c)
	return c, notFound(err)
}
func readVersion(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string, number int64) (Version, error) {
	var v Version
	err := q.QueryRowContext(ctx, `SELECT canvas_id,number,document_yaml,digest,created_at,source,summary FROM versions WHERE canvas_id=? AND number=?`, id, number).Scan(&v.CanvasID, &v.Number, &v.DocumentYAML, &v.Digest, &v.CreatedAt, &v.Source, &v.Summary)
	if err != nil {
		return v, notFound(err)
	}
	validation := Validate(v.DocumentYAML)
	if !validation.Valid || digest(v.DocumentYAML) != v.Digest {
		return v, errors.New("tessiven stored version failed integrity validation")
	}
	v.Document = validation.Document
	return v, nil
}
func (s *Service) Version(ctx context.Context, id string, number int64) (Version, error) {
	if number == 0 {
		c, err := s.Canvas(ctx, id)
		if err != nil {
			return Version{}, err
		}
		number = c.LatestVersion
	}
	return readVersion(ctx, s.db, id, number)
}
func (s *Service) Versions(ctx context.Context, id string, before int64) ([]Version, error) {
	if _, err := s.Canvas(ctx, id); err != nil {
		return nil, err
	}
	if before <= 0 {
		before = 1 << 62
	}
	rows, err := s.db.QueryContext(ctx, `SELECT canvas_id,number,digest,created_at,source,summary FROM versions WHERE canvas_id=? AND number<? ORDER BY number DESC LIMIT 100`, id, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Version{}
	for rows.Next() {
		var v Version
		if err = rows.Scan(&v.CanvasID, &v.Number, &v.Digest, &v.CreatedAt, &v.Source, &v.Summary); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *Service) Save(ctx context.Context, req SaveRequest, source string) (SaveResult, error) {
	if !requestIDPattern.MatchString(req.RequestID) || req.ExpectedVersion < 0 || len(req.Summary) > 2000 {
		return SaveResult{}, ErrInvalidRequest
	}
	switch source {
	case "manual", "flower", "import", "restore", "duplicate", "rename", "created", "example":
	default:
		return SaveResult{}, ErrInvalidRequest
	}
	validation := Validate(req.DocumentYAML)
	if !validation.Valid {
		return SaveResult{}, &ValidationError{Diagnostics: validation.Diagnostics}
	}
	raw, _ := json.Marshal(struct {
		SaveRequest
		Source string
	}{req, source})
	fingerprint := digest(string(raw))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SaveResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var oldFingerprint, oldResult string
	err = tx.QueryRowContext(ctx, `SELECT fingerprint,result_json FROM requests WHERE request_id=?`, req.RequestID).Scan(&oldFingerprint, &oldResult)
	if err == nil {
		if fingerprint != oldFingerprint {
			return SaveResult{}, ErrRequestConflict
		}
		var result SaveResult
		err = json.Unmarshal([]byte(oldResult), &result)
		return result, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SaveResult{}, err
	}
	now := time.Now().UnixMilli()
	c := Canvas{ID: req.CanvasID, CreatedAt: now}
	if c.ID == "" {
		if req.ExpectedVersion != 0 {
			return SaveResult{}, ErrConflict
		}
		c.ID = uuid.NewString()
	} else {
		err = scanCanvas(tx.QueryRowContext(ctx, `SELECT id,title,description,latest_version,archived,created_at,updated_at FROM canvases WHERE id=?`, c.ID), &c)
		if err != nil {
			return SaveResult{}, notFound(err)
		}
		if c.Archived {
			return SaveResult{}, ErrArchived
		}
		if c.LatestVersion != req.ExpectedVersion {
			return SaveResult{}, ErrConflict
		}
	}
	c.Title = validation.Document.Metadata.Title
	c.Description = validation.Document.Metadata.Description
	c.LatestVersion++
	c.UpdatedAt = now
	v := Version{CanvasID: c.ID, Number: c.LatestVersion, DocumentYAML: req.DocumentYAML, Digest: digest(req.DocumentYAML), CreatedAt: now, Source: source, Summary: req.Summary, Document: validation.Document}
	if req.CanvasID == "" {
		_, err = tx.ExecContext(ctx, `INSERT INTO canvases(id,title,description,latest_version,archived,created_at,updated_at) VALUES(?,?,?,?,0,?,?)`, c.ID, c.Title, c.Description, c.LatestVersion, c.CreatedAt, now)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE canvases SET title=?,description=?,latest_version=?,updated_at=? WHERE id=?`, c.Title, c.Description, c.LatestVersion, now, c.ID)
	}
	if err != nil {
		return SaveResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO versions(canvas_id,number,document_yaml,digest,created_at,source,summary) VALUES(?,?,?,?,?,?,?)`, v.CanvasID, v.Number, v.DocumentYAML, v.Digest, v.CreatedAt, v.Source, v.Summary)
	if err != nil {
		return SaveResult{}, err
	}
	result := SaveResult{Canvas: c, Version: v}
	encoded, err := json.Marshal(result)
	if err != nil {
		return SaveResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO requests(request_id,fingerprint,result_json) VALUES(?,?,?)`, req.RequestID, fingerprint, string(encoded))
	if err != nil {
		return SaveResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return SaveResult{}, err
	}
	s.publish()
	return result, nil
}

func (s *Service) Restore(ctx context.Context, id string, req RevisionRequest) (SaveResult, error) {
	if req.Version <= 0 {
		return SaveResult{}, ErrInvalidRequest
	}
	v, err := s.Version(ctx, id, req.Version)
	if err != nil {
		return SaveResult{}, err
	}
	return s.Save(ctx, SaveRequest{RequestID: req.RequestID, CanvasID: id, ExpectedVersion: req.ExpectedVersion, DocumentYAML: v.DocumentYAML, Summary: fmt.Sprintf("Restore version %d", req.Version)}, "restore")
}
func (s *Service) Duplicate(ctx context.Context, id string, req RevisionRequest) (SaveResult, error) {
	if req.Version <= 0 {
		return SaveResult{}, ErrInvalidRequest
	}
	v, err := s.Version(ctx, id, req.Version)
	if err != nil {
		return SaveResult{}, err
	}
	if req.Title != "" {
		v.Document.Metadata.Title = req.Title
	}
	source, err := documentYAML(v.Document)
	if err != nil {
		return SaveResult{}, err
	}
	return s.Save(ctx, SaveRequest{RequestID: req.RequestID, DocumentYAML: source, Summary: fmt.Sprintf("Copy %s version %d", id, req.Version)}, "duplicate")
}
func (s *Service) Rename(ctx context.Context, id string, req RevisionRequest) (SaveResult, error) {
	if req.ExpectedVersion <= 0 || strings.TrimSpace(req.Title) == "" {
		return SaveResult{}, ErrInvalidRequest
	}
	v, err := s.Version(ctx, id, req.ExpectedVersion)
	if err != nil {
		return SaveResult{}, err
	}
	v.Document.Metadata.Title = req.Title
	source, err := documentYAML(v.Document)
	if err != nil {
		return SaveResult{}, err
	}
	return s.Save(ctx, SaveRequest{RequestID: req.RequestID, CanvasID: id, ExpectedVersion: req.ExpectedVersion, DocumentYAML: source, Summary: "Rename canvas"}, "rename")
}
func (s *Service) Archive(ctx context.Context, id string, expected int64, archived bool) error {
	result, err := s.db.ExecContext(ctx, `UPDATE canvases SET archived=?,updated_at=? WHERE id=? AND latest_version=?`, archived, time.Now().UnixMilli(), id, expected)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrConflict
	}
	s.publish()
	return nil
}
