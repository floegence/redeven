package browserstore

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

type SourceKind string

const (
	Managed   SourceKind = "managed"
	CDP       SourceKind = "cdp"
	Extension SourceKind = "extension"
)

var (
	ErrSourceChanged   = errors.New("browser source kind cannot change")
	ErrProfileMissing  = errors.New("browser profile does not exist")
	ErrExternalRestore = errors.New("external browser tabs are not restorable by URL")
)

type Profile struct {
	ID   string     `json:"id"`
	Name string     `json:"name"`
	Kind SourceKind `json:"kind"`
}
type Tab struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Pinned   bool   `json:"pinned"`
	Selected bool   `json:"selected"`
}
type Entry struct {
	URL                 string `json:"url"`
	Title               string `json:"title"`
	Visits              int    `json:"visits,omitempty"`
	LastVisitedAtUnixMs int64  `json:"last_visited_at_unix_ms,omitempty"`
}

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	db, err := sqliteutil.Open(path, schemaSpec())
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func normalizeOwner(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 128 || strings.ContainsRune(value, '\x00') {
		return "", errors.New("invalid browser owner")
	}
	return value, nil
}
func normalizeProfileID(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || value == "." || value == ".." || len(value) > 96 || strings.ContainsAny(value, "\x00/\\") {
		return "", errors.New("invalid browser profile")
	}
	return value, nil
}
func normalizeName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 120 {
		return "", errors.New("invalid browser profile name")
	}
	return value, nil
}
func validKind(kind SourceKind) bool { return kind == Managed || kind == CDP || kind == Extension }
func normalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "about:blank" {
		return raw, nil
	}
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 8192 || u.User != nil || u.Hostname() == "" {
		return "", errors.New("invalid browser URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("unsupported browser URL scheme")
	}
	return raw, nil
}

func (s *Store) PutProfile(ctx context.Context, owner string, profile Profile) error {
	owner, err := normalizeOwner(owner)
	if err != nil {
		return err
	}
	id, err := normalizeProfileID(profile.ID)
	if err != nil {
		return err
	}
	name, err := normalizeName(profile.Name)
	if err != nil {
		return err
	}
	if !validKind(profile.Kind) {
		return errors.New("unsupported browser source kind")
	}
	now := time.Now().UnixMilli()
	var existing string
	err = s.db.QueryRowContext(ctx, `SELECT source_kind FROM browser_profiles WHERE owner_id=? AND profile_id=?`, owner, id).Scan(&existing)
	if err == nil {
		if SourceKind(existing) != profile.Kind {
			return ErrSourceChanged
		}
		_, err = s.db.ExecContext(ctx, `UPDATE browser_profiles SET name=?, updated_at_unix_ms=? WHERE owner_id=? AND profile_id=?`, name, now, owner, id)
		return err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO browser_profiles(owner_id,profile_id,name,source_kind,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?)`, owner, id, name, profile.Kind, now, now)
	return err
}
func (s *Store) Profiles(ctx context.Context, owner string) ([]Profile, error) {
	owner, err := normalizeOwner(owner)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT profile_id,name,source_kind FROM browser_profiles WHERE owner_id=? ORDER BY created_at_unix_ms,profile_id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Profile, 0)
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.Name, &p.Kind); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) requireProfile(ctx context.Context, owner, id string) (SourceKind, error) {
	owner, err := normalizeOwner(owner)
	if err != nil {
		return "", err
	}
	id, err = normalizeProfileID(id)
	if err != nil {
		return "", err
	}
	var kind SourceKind
	if err := s.db.QueryRowContext(ctx, `SELECT source_kind FROM browser_profiles WHERE owner_id=? AND profile_id=?`, owner, id).Scan(&kind); errors.Is(err, sql.ErrNoRows) {
		return "", ErrProfileMissing
	} else if err != nil {
		return "", err
	}
	return kind, nil
}

func validateTabs(tabs []Tab) error {
	if len(tabs) == 0 || len(tabs) > 128 {
		return errors.New("invalid browser tab snapshot")
	}
	selected := 0
	for _, tab := range tabs {
		if _, err := normalizeURL(tab.URL); err != nil {
			return err
		}
		if len(tab.Title) > 512 {
			return errors.New("browser tab title too long")
		}
		if tab.Selected {
			selected++
		}
	}
	if selected != 1 {
		return errors.New("browser tab snapshot requires one selected tab")
	}
	return nil
}
func (s *Store) SaveTabs(ctx context.Context, owner, profileID string, tabs []Tab) error {
	kind, err := s.requireProfile(ctx, owner, profileID)
	if err != nil {
		return err
	}
	if kind != Managed {
		return ErrExternalRestore
	}
	if err := validateTabs(tabs); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM browser_tabs WHERE owner_id=? AND profile_id=?`, owner, profileID); err != nil {
		return err
	}
	for i, tab := range tabs {
		u, err := normalizeURL(tab.URL)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO browser_tabs(owner_id,profile_id,position,url,title,pinned,selected) VALUES(?,?,?,?,?,?,?)`, owner, profileID, i, u, tab.Title, tab.Pinned, tab.Selected); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) Tabs(ctx context.Context, owner, profileID string) ([]Tab, error) {
	kind, err := s.requireProfile(ctx, owner, profileID)
	if err != nil {
		return nil, err
	}
	if kind != Managed {
		return nil, ErrExternalRestore
	}
	rows, err := s.db.QueryContext(ctx, `SELECT url,title,pinned,selected FROM browser_tabs WHERE owner_id=? AND profile_id=? ORDER BY position`, owner, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Tab, 0)
	for rows.Next() {
		var tab Tab
		var pinned, selected int
		if err := rows.Scan(&tab.URL, &tab.Title, &pinned, &selected); err != nil {
			return nil, err
		}
		tab.Pinned = pinned != 0
		tab.Selected = selected != 0
		out = append(out, tab)
	}
	return out, rows.Err()
}

func (s *Store) PutBookmark(ctx context.Context, owner, profileID string, entry Entry) error {
	return s.putEntry(ctx, "browser_bookmarks", owner, profileID, entry, false)
}
func (s *Store) DeleteBookmark(ctx context.Context, owner, profileID, rawURL string) error {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return err
	}
	u, err := normalizeURL(rawURL)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM browser_bookmarks WHERE owner_id=? AND profile_id=? AND url=?`, owner, profileID, u)
	return err
}
func (s *Store) Visit(ctx context.Context, owner, profileID string, entry Entry) error {
	return s.putEntry(ctx, "browser_history", owner, profileID, entry, true)
}

// A later source title update is metadata, not another navigation or visit.
func (s *Store) UpdateVisitTitle(ctx context.Context, owner, profileID string, entry Entry) error {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return err
	}
	u, err := normalizeURL(entry.URL)
	if err != nil || len(entry.Title) > 1024 {
		return errors.New("invalid browser history metadata")
	}
	_, err = s.db.ExecContext(ctx, `UPDATE browser_history SET title=? WHERE owner_id=? AND profile_id=? AND url=?`, entry.Title, owner, profileID, u)
	return err
}
func (s *Store) putEntry(ctx context.Context, table, owner, profileID string, entry Entry, visit bool) error {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return err
	}
	u, err := normalizeURL(entry.URL)
	if err != nil {
		return err
	}
	if len(entry.Title) > 1024 {
		return errors.New("browser entry title too long")
	}
	now := time.Now().UnixMilli()
	if visit {
		_, err = s.db.ExecContext(ctx, `INSERT INTO browser_history(owner_id,profile_id,url,title,visits,last_visited_at_unix_ms) VALUES(?,?,?,?,1,?) ON CONFLICT(owner_id,profile_id,url) DO UPDATE SET title=excluded.title,visits=browser_history.visits+1,last_visited_at_unix_ms=excluded.last_visited_at_unix_ms`, owner, profileID, u, entry.Title, now)
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO browser_bookmarks(owner_id,profile_id,url,title,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,profile_id,url) DO UPDATE SET title=excluded.title,updated_at_unix_ms=excluded.updated_at_unix_ms`, owner, profileID, u, entry.Title, now, now)
	return err
}
func (s *Store) Bookmarks(ctx context.Context, owner, profileID string) ([]Entry, error) {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT url,title FROM browser_bookmarks WHERE owner_id=? AND profile_id=? ORDER BY updated_at_unix_ms DESC,url`, owner, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.URL, &e.Title); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
func (s *Store) History(ctx context.Context, owner, profileID, query string, limit int) ([]Entry, error) {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return nil, err
	}
	limit = max(1, min(limit, 200))
	query = strings.ToLower(query)
	rows, err := s.db.QueryContext(ctx, `SELECT url,title,visits,last_visited_at_unix_ms FROM browser_history WHERE owner_id=? AND profile_id=? AND (lower(title) LIKE '%' || ? || '%' ESCAPE '\' OR lower(url) LIKE '%' || ? || '%' ESCAPE '\') ORDER BY last_visited_at_unix_ms DESC,url LIMIT ?`, owner, profileID, escapeLike(query), escapeLike(query), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.URL, &e.Title, &e.Visits, &e.LastVisitedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
func escapeLike(value string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(value)
}
func (s *Store) ClearHistory(ctx context.Context, owner, profileID string) error {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM browser_history WHERE owner_id=? AND profile_id=?`, owner, profileID)
	return err
}
func (s *Store) SetZoom(ctx context.Context, owner, profileID, rawOrigin string, zoom float64) error {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return err
	}
	origin, err := normalizeOrigin(rawOrigin)
	if err != nil {
		return err
	}
	if math.IsNaN(zoom) || zoom < 0.25 || zoom > 5 {
		return errors.New("invalid browser zoom")
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO browser_zoom(owner_id,profile_id,origin,zoom) VALUES(?,?,?,?) ON CONFLICT(owner_id,profile_id,origin) DO UPDATE SET zoom=excluded.zoom`, owner, profileID, origin, zoom)
	return err
}
func (s *Store) Zoom(ctx context.Context, owner, profileID, rawOrigin string) (float64, error) {
	if _, err := s.requireProfile(ctx, owner, profileID); err != nil {
		return 0, err
	}
	origin, err := normalizeOrigin(rawOrigin)
	if err != nil {
		return 0, err
	}
	var zoom float64
	err = s.db.QueryRowContext(ctx, `SELECT zoom FROM browser_zoom WHERE owner_id=? AND profile_id=? AND origin=?`, owner, profileID, origin).Scan(&zoom)
	if errors.Is(err, sql.ErrNoRows) {
		return 1, nil
	}
	return zoom, err
}
func normalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 8192 || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || raw != u.Scheme+"://"+u.Host {
		return "", errors.New("invalid browser zoom origin")
	}
	host := strings.ToLower(u.Host)
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		host = strings.TrimSuffix(host, ":"+u.Port())
	}
	return u.Scheme + "://" + host, nil
}
