// Package webbinding owns Runtime consent for independently hosted Web entries.
// A binding authorizes an exact HTTPS origin and TLS client public key only;
// Runtime passwords, application permissions and management stay independent.
package webbinding

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"modernc.org/sqlite"
)

var ErrDenied = errors.New("Web entry binding is unavailable or not authorized")
var ErrConflict = errors.New("Web entry binding has changed")
var ErrCapacity = errors.New("Web entry binding capacity reached")

const MaxBindings = 32
const MaxActiveRequests = 256

const ownerSchema = "CREATE TABLE web_binding_owner (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), runtime_id TEXT NOT NULL)"

const schema = `CREATE TABLE web_bindings (id TEXT PRIMARY KEY, origin TEXT NOT NULL UNIQUE, runtime_id TEXT NOT NULL, app_scope TEXT NOT NULL CHECK(app_scope = 'envapp'), public_key_sha256 TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at INTEGER NOT NULL)`

type Binding struct {
	RuntimeID       string `json:"runtime_public_id"`
	AppScope        string `json:"allowed_app_scope"`
	ID              string `json:"id"`
	Origin          string `json:"origin"`
	PublicKeySHA256 string `json:"public_key_sha256"`
	Revision        int64  `json:"revision"`
	Enabled         bool   `json:"enabled"`
	UpdatedAt       int64  `json:"updated_at"`
}

type Store struct {
	runtimeID string
	mu        sync.Mutex
	db        *sql.DB
	closed    bool
	active    map[string]map[*Lease]struct{}
	onRevoke  func(string, int64)
}

// SetRevocationHandler runs after admission for the old generation is closed.
// Cleanup may reenter Store; it never runs while the admission mutex is held.
func (s *Store) SetRevocationHandler(handler func(string, int64)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onRevoke = handler
}

// WithCurrent serializes issuance with binding updates. Work must not reenter
// Store and must be bounded; no network operation is permitted here.
func (s *Store) WithCurrent(b Binding, work func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrDenied
	}
	var revision int64
	var enabled bool
	if err := s.db.QueryRow("SELECT revision,enabled FROM web_bindings WHERE id=?", b.ID).Scan(&revision, &enabled); err != nil || !enabled || revision != b.Revision {
		return ErrDenied
	}
	return work()
}

// Lease cancellation closes all requests established under a revoked binding.
// The same mutex protects registration and revocation, avoiding late streams.
type Lease struct {
	Binding Binding
	Context context.Context
	cancel  context.CancelFunc
	store   *Store
	once    sync.Once
}

func (l *Lease) Close() {
	if l == nil {
		return
	}
	l.once.Do(func() {
		l.store.mu.Lock()
		defer l.store.mu.Unlock()
		l.cancel()
		delete(l.store.active[l.Binding.ID], l)
		if len(l.store.active[l.Binding.ID]) == 0 {
			delete(l.store.active, l.Binding.ID)
		}
	})
}

// Open runs under the Runtime state lock. The identity marker and database
// must travel together during recovery; missing committed state fails closed.
func Open(dir, runtimeID string) (*Store, error) {
	if !validID(runtimeID) {
		return nil, ErrDenied
	}
	dir = filepath.Join(dir, "web-entry")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("Web binding directory must be private and not a symbolic link")
	}
	path := filepath.Join(dir, "web-bindings.sqlite")
	marker := filepath.Join(dir, "web-bindings.owner")
	for _, file := range []string{marker, path, path + "-wal", path + "-shm", path + "-journal"} {
		if info, err := os.Lstat(file); err == nil {
			if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
				return nil, errors.New("Web binding state must be private regular files")
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	raw, markerErr := os.ReadFile(marker)
	_, dbErr := os.Lstat(path)
	fresh := errors.Is(markerErr, os.ErrNotExist) && errors.Is(dbErr, os.ErrNotExist)
	if !fresh && (markerErr != nil || dbErr != nil || string(raw) != runtimeID+"\n") {
		return nil, errors.New("Web binding identity or state is missing; restore matching Runtime state")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	verify := func(tx *sql.Tx) error {
		var actual string
		if err := tx.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='web_bindings'").Scan(&actual); err != nil {
			return err
		}
		if actual != schema {
			return errors.New("Web binding schema drift")
		}
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('web_bindings','web_binding_owner','__redeven_db_meta')").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return errors.New("unexpected Web binding schema objects")
		}
		if err := tx.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='web_binding_owner'").Scan(&actual); err != nil || actual != ownerSchema {
			return errors.New("Web binding owner schema drift")
		}
		var owner string
		if err := tx.QueryRow("SELECT runtime_id FROM web_binding_owner WHERE singleton=1").Scan(&owner); err != nil || owner != runtimeID {
			return errors.New("Web binding Runtime identity mismatch")
		}
		if err := tx.QueryRow("SELECT count(*) FROM web_bindings WHERE runtime_id<>?", runtimeID).Scan(&count); err != nil || count != 0 {
			return ErrDenied
		}
		return nil
	}
	db, err := sqliteutil.Open(path, sqliteutil.Spec{Kind: "runtime-web-bindings", CurrentVersion: 1, MinimumVersion: 1, Initialize: func(tx *sql.Tx) error {
		if !fresh {
			return errors.New("Web binding database is uninitialized; restore original state")
		}
		if _, err := tx.Exec(schema); err != nil {
			return err
		}
		if _, err := tx.Exec(ownerSchema); err != nil {
			return err
		}
		_, err := tx.Exec("INSERT INTO web_binding_owner VALUES(1,?)", runtimeID)
		return err
	}, ValidateExisting: verify, Verify: verify, Pragmas: []string{"PRAGMA synchronous=FULL", "PRAGMA journal_mode=DELETE"}})
	if err != nil {
		return nil, err
	}
	if fresh {
		file, err := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			_, err = file.WriteString(runtimeID + "\n")
			if err == nil {
				err = file.Sync()
			}
			err = errors.Join(err, file.Close())
		}
		if err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	return &Store{db: db, runtimeID: runtimeID, active: map[string]map[*Lease]struct{}{}}, nil
}

func ValidateOrigin(origin string) error {
	u, err := url.Parse(origin)
	if len(origin) > 512 || err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || u.Opaque != "" || strings.ToLower(u.Host) != u.Host || strings.ContainsAny(u.Host, "*%\\ \t\r\n") || u.String() != origin {
		return ErrDenied
	}
	if strings.Contains(origin, "#") || strings.HasSuffix(u.Host, ":") {
		return ErrDenied
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 || n == 443 || strconv.Itoa(n) != port {
			return ErrDenied
		}
	}
	host := u.Hostname()
	if ip, err := netip.ParseAddr(host); err == nil {
		if ip.String() != host || ip.Zone() != "" || ip.Is4In6() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
			return ErrDenied
		}
		if ip.Is6() != strings.HasPrefix(u.Host, "[") {
			return ErrDenied
		}
	} else {
		if len(host) == 0 || len(host) > 253 || strings.ContainsAny(u.Host, "[]") {
			return ErrDenied
		}
		for _, label := range strings.Split(host, ".") {
			if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return ErrDenied
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
					return ErrDenied
				}
			}
		}
		// Browser URL parsers interpret numeric terminal labels as IPv4.
		last := host[strings.LastIndexByte(host, '.')+1:]
		if last[0] >= '0' && last[0] <= '9' {
			return ErrDenied
		}
	}
	return nil
}
func PublicKeyFingerprint(cert *x509.Certificate) string {
	if cert == nil {
		return ""
	}
	sum := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func validateBinding(b Binding) error {
	key, err := base64.RawURLEncoding.DecodeString(b.PublicKeySHA256)
	if b.RuntimeID == "" || len(b.RuntimeID) > 128 || b.AppScope != "envapp" || ValidateOrigin(b.Origin) != nil || err != nil || len(key) != 32 || base64.RawURLEncoding.EncodeToString(key) != b.PublicKeySHA256 || !validID(b.ID) || !validID(b.RuntimeID) {
		return ErrDenied
	}
	return nil
}
func (s *Store) Put(b Binding, expectedRevision int64) (Binding, error) {
	if validateBinding(b) != nil || b.RuntimeID != s.runtimeID || expectedRevision < 0 || expectedRevision == math.MaxInt64 {
		return Binding{}, ErrDenied
	}
	s.mu.Lock()
	var revoke func(string, int64)
	defer func() {
		s.mu.Unlock()
		if revoke != nil {
			revoke(b.ID, expectedRevision)
		}
	}()
	if s.closed {
		return Binding{}, ErrDenied
	}
	b.Revision = expectedRevision + 1
	b.UpdatedAt = time.Now().UnixMilli()
	var result sql.Result
	var err error
	if expectedRevision == 0 {
		var count int
		if err := s.db.QueryRow("SELECT count(*) FROM web_bindings").Scan(&count); err != nil {
			return Binding{}, err
		}
		if count >= MaxBindings {
			return Binding{}, ErrCapacity
		}
		result, err = s.db.Exec("INSERT INTO web_bindings(id,origin,runtime_id,app_scope,public_key_sha256,revision,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?)", b.ID, b.Origin, b.RuntimeID, b.AppScope, b.PublicKeySHA256, b.Revision, b.Enabled, b.UpdatedAt)
	} else {
		result, err = s.db.Exec("UPDATE web_bindings SET origin=?,runtime_id=?,app_scope=?,public_key_sha256=?,revision=?,enabled=?,updated_at=? WHERE id=? AND revision=?", b.Origin, b.RuntimeID, b.AppScope, b.PublicKeySHA256, b.Revision, b.Enabled, b.UpdatedAt, b.ID, expectedRevision)
	}
	if err != nil {
		var constraint *sqlite.Error
		if errors.As(err, &constraint) && constraint.Code()&255 == 19 {
			return Binding{}, ErrConflict
		}
		return Binding{}, fmt.Errorf("persist Web entry binding: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil || n != 1 {
		return Binding{}, ErrConflict
	}
	s.cancelLocked(b.ID)
	if expectedRevision > 0 && s.onRevoke != nil {
		revoke = s.onRevoke
	}
	return b, nil
}
func (s *Store) List() ([]Binding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, ErrDenied
	}
	rows, err := s.db.Query("SELECT id,origin,runtime_id,app_scope,public_key_sha256,revision,enabled,updated_at FROM web_bindings ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Binding{}
	for rows.Next() {
		var b Binding
		if err := rows.Scan(&b.ID, &b.Origin, &b.RuntimeID, &b.AppScope, &b.PublicKeySHA256, &b.Revision, &b.Enabled, &b.UpdatedAt); err != nil {
			return nil, err
		}
		if validateBinding(b) != nil {
			return nil, ErrDenied
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Admit requires a public key proven by the actual TLS 1.3 handshake. Headers
// cannot supply a certificate, origin mapping, or trusted management identity.
func (s *Store) Admit(ctx context.Context, state *tls.ConnectionState, host string) (*Lease, error) {
	if state == nil || state.Version != tls.VersionTLS13 || state.DidResume || !state.HandshakeComplete || len(state.PeerCertificates) != 1 {
		return nil, ErrDenied
	}
	cert := state.PeerCertificates[0]
	now := time.Now()
	if now.Before(cert.NotBefore) || !now.Before(cert.NotAfter) {
		return nil, ErrDenied
	}
	origin := "https://" + host
	if ValidateOrigin(origin) != nil {
		return nil, ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, ErrDenied
	}
	if ctx.Err() != nil {
		return nil, ErrDenied
	}
	count := 0
	for _, requests := range s.active {
		count += len(requests)
	}
	if count >= MaxActiveRequests {
		return nil, ErrCapacity
	}
	var b Binding
	err := s.db.QueryRow("SELECT id,origin,runtime_id,app_scope,public_key_sha256,revision,enabled,updated_at FROM web_bindings WHERE origin=? AND public_key_sha256=? AND enabled=1", origin, PublicKeyFingerprint(cert)).Scan(&b.ID, &b.Origin, &b.RuntimeID, &b.AppScope, &b.PublicKeySHA256, &b.Revision, &b.Enabled, &b.UpdatedAt)
	if err != nil || validateBinding(b) != nil {
		return nil, ErrDenied
	}
	child, cancel := context.WithCancel(ctx)
	l := &Lease{Binding: b, Context: child, cancel: cancel, store: s}
	if s.active[b.ID] == nil {
		s.active[b.ID] = map[*Lease]struct{}{}
	}
	s.active[b.ID][l] = struct{}{}
	context.AfterFunc(child, l.Close)
	return l, nil
}
func (s *Store) cancelLocked(id string) {
	for lease := range s.active[id] {
		lease.cancel()
	}
	delete(s.active, id)
}
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	for id := range s.active {
		s.cancelLocked(id)
	}
	return s.db.Close()
}

// Decode rejects unknown management fields and privileged application scopes.
// The store additionally checks the actual owning Runtime identity.
func Decode(raw []byte) (Binding, error) {
	var b Binding
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		return Binding{}, err
	}
	if dec.Decode(new(any)) != io.EOF {
		return Binding{}, ErrDenied
	}
	return b, validateBinding(b)
}

func validID(value string) bool {
	if len(value) == 0 || len(value) > 128 {
		return false
	}
	for _, c := range value {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}
