// Package environmentcenter owns the self-hosted, single-administrator portal.
// Its state and authority are independent of Desktop and every target Runtime.
package environmentcenter

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/floegence/redeven/internal/webbinding"
)

var ErrDenied = errors.New("CENTER_ACCESS_DENIED")
var ErrConflict = errors.New("CENTER_REVISION_CONFLICT")
var ErrBusy = errors.New("CENTER_BUSY")
var ErrFactor = errors.New("CENTER_FACTOR_INVALID")
var ErrExpired = errors.New("CENTER_CHALLENGE_EXPIRED")

const schema = "CREATE TABLE center_state (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), generation INTEGER NOT NULL CHECK(generation > 0), sealed BLOB NOT NULL)"

type keyFile struct {
	Instance    string `json:"instance"`
	Origin      string `json:"origin"`
	Key         []byte `json:"key"`
	Initialized bool   `json:"initialized"`
}
type throttle struct {
	Failures int
	Until    int64
	Last     int64
}
type auditEvent struct {
	Time      int64  `json:"time"`
	Action    string `json:"action"`
	Result    string `json:"result"`
	Reference string `json:"reference,omitempty"`
	Revision  int64  `json:"revision"`
}
type persistentState struct {
	BootstrapHash     string
	BootstrapExpiry   int64
	Revision          int64
	PasswordHash      []byte
	Secret            string
	RecoveryHashes    []string
	LastStep          int64
	LastCodeHash      string
	LastCodeUntil     int64
	RecoveryPending   bool
	Failures          map[string]throttle
	Audit             []auditEvent
	DirectoryRevision int64
	Gateways          []GatewayRecord
	Bookmarks         []Bookmark
	Routes            []Route
}

// GatewayRecord persists only explicitly paired sources. Secret fields never
// appear in a browser DTO or diagnostic response.
type GatewayRecord struct {
	ID, Name, URL, GatewayID, PublicKey, ClientKeyID, ClientPrivateKey, TLSRoot string
}
type Route struct {
	ID                      string `json:"id"`
	SourceID                string `json:"source_id"`
	MemberID                string `json:"member_id"`
	RuntimeID               string `json:"runtime_id"`
	Origin                  string `json:"origin"`
	Label                   string `json:"label"`
	Favorite                bool   `json:"favorite"`
	Revision                int64  `json:"revision"`
	BindingRevision         int64  `json:"binding_revision"`
	Certificate, PrivateKey string `json:"-"`
}

// Persisted route secrets use a distinct shape so browser JSON cannot expose them.
type storedRoute struct {
	Route
	Certificate, PrivateKey string
}
type storedState struct {
	persistentState
	Routes []storedRoute
}

type Center struct {
	mu              sync.Mutex
	db              *sql.DB
	lock            *lockfile.Lock
	aead            cipher.AEAD
	key             keyFile
	state           persistentState
	generation      int64
	closed          bool
	now             func() time.Time
	sessions        map[string]*deviceSession
	challenges      map[string]*challenge
	setups          map[string]*setupOperation
	setupReceipt    *setupCommitReceipt
	grants          map[string]*actionGrant
	bootstrapHash   string
	bootstrapExpiry time.Time
	authBudget      chan struct{}
}

// Open takes the exclusive Center lock before inspecting or migrating state.
// Missing committed identity, database, or key is an error, never a new setup.
func Open(dir, origin string) (*Center, error) {
	if webbinding.ValidateOrigin(origin) != nil {
		return nil, errors.New("Center requires an exact HTTPS origin")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	dir = abs
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("Center state directory must be private (0700)")
	}
	// Resolve trusted platform aliases such as /tmp before checking ownership.
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, err
	}
	dir = resolved
	if err = validateStateOwnership(dir); err != nil {
		return nil, err
	}
	for _, name := range []string{"center.lock", "center.key", "center.sqlite", "center.sqlite-journal", "center.sqlite-wal", "center.sqlite-shm", "owner.sock"} {
		p := filepath.Join(dir, name)
		i, e := os.Lstat(p)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return nil, e
		}
		if i.Mode()&os.ModeSymlink != 0 || runtime.GOOS != "windows" && i.Mode().Perm()&0077 != 0 || name != "owner.sock" && !i.Mode().IsRegular() {
			return nil, errors.New("Center state contains an unsafe file")
		}
	}
	lock, err := lockfile.Acquire(filepath.Join(dir, "center.lock"))
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = lock.Release()
		}
	}()
	keyPath, dbPath := filepath.Join(dir, "center.key"), filepath.Join(dir, "center.sqlite")
	var key keyFile
	raw, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		if _, e := os.Lstat(dbPath); !errors.Is(e, os.ErrNotExist) {
			return nil, errors.New("Center key is missing; restore matching state")
		}
		key = keyFile{Instance: randomID(), Origin: origin, Key: make([]byte, 32)}
		if _, err = rand.Read(key.Key); err != nil {
			return nil, err
		}
		raw, _ = json.Marshal(key)
		f, e := os.OpenFile(keyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, e
		}
		_, e = f.Write(raw)
		if e == nil {
			e = f.Sync()
		}
		e = errors.Join(e, f.Close())
		if e != nil {
			return nil, e
		}
	} else if err != nil {
		return nil, err
	} else if json.Unmarshal(raw, &key) != nil {
		return nil, errors.New("Center key is damaged")
	}
	if len(key.Key) != 32 || len(key.Instance) != 43 || key.Origin != origin {
		return nil, errors.New("Center identity or origin does not match")
	}
	_, err = os.Lstat(dbPath)
	if key.Initialized && errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("Center database is missing; restore matching state")
	}
	block, err := aes.NewCipher(key.Key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	c := &Center{key: key, aead: aead, lock: lock, now: time.Now, sessions: map[string]*deviceSession{}, challenges: map[string]*challenge{}, setups: map[string]*setupOperation{}, grants: map[string]*actionGrant{}, authBudget: make(chan struct{}, 2)}
	c.state = persistentState{Revision: 1, DirectoryRevision: 1, LastStep: -1, Failures: map[string]throttle{}}
	initial, err := c.seal(c.state)
	if err != nil {
		return nil, err
	}
	verify := func(tx *sql.Tx) error {
		var ddl string
		var n int
		if e := tx.QueryRow("SELECT sql FROM sqlite_master WHERE name='center_state'").Scan(&ddl); e != nil || ddl != schema {
			return errors.New("Center database schema mismatch")
		}
		if e := tx.QueryRow("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('center_state','__redeven_db_meta')").Scan(&n); e != nil || n != 0 {
			return errors.New("unexpected Center schema objects")
		}
		return nil
	}
	file, err := os.OpenFile(dbPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	c.db, err = sqliteutil.Open(dbPath, sqliteutil.Spec{Kind: "environment-center-v1", CurrentVersion: 2, MinimumVersion: 1, Migrations: []sqliteutil.Migration{{FromVersion: 1, ToVersion: 2, Apply: c.migratePrivateAudit}}, Initialize: func(tx *sql.Tx) error {
		if key.Initialized {
			return errors.New("Center authentication authority is missing")
		}
		if _, e := tx.Exec(schema); e != nil {
			return e
		}
		_, e := tx.Exec("INSERT INTO center_state VALUES(1,1,?)", initial)
		return e
	}, ValidateExisting: verify, Verify: func(tx *sql.Tx) error {
		if err := verify(tx); err != nil {
			return err
		}
		return c.verifyPrivateAudit(tx)
	}, Pragmas: []string{"PRAGMA synchronous=FULL", "PRAGMA journal_mode=DELETE"}})
	if err != nil {
		return nil, err
	}
	defer func() {
		if !ok {
			_ = c.db.Close()
		}
	}()
	if err = os.Chmod(dbPath, 0600); err != nil {
		return nil, err
	}
	if err = c.db.QueryRow("SELECT generation,sealed FROM center_state WHERE singleton=1").Scan(&c.generation, &raw); err != nil {
		return nil, err
	}
	if len(raw) < aead.NonceSize() {
		return nil, errors.New("Center authentication state is damaged")
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], c.aad())
	if err != nil {
		return nil, errors.New("Center authentication key does not match state")
	}
	var saved storedState
	if json.Unmarshal(plain, &saved) != nil {
		return nil, errors.New("Center state is damaged")
	}
	c.state = saved.persistentState
	c.bootstrapHash = c.state.BootstrapHash
	c.bootstrapExpiry = time.UnixMilli(c.state.BootstrapExpiry)
	for _, r := range saved.Routes {
		r.Route.Certificate = r.Certificate
		r.Route.PrivateKey = r.PrivateKey
		c.state.Routes = append(c.state.Routes, r.Route)
	}
	if c.state.Revision < 1 || c.state.DirectoryRevision < 1 || c.state.Failures == nil {
		return nil, errors.New("Center state authority is incomplete")
	}
	if !key.Initialized {
		key.Initialized = true
		raw, _ = json.Marshal(key)
		if err = writePrivate(keyPath, raw); err != nil {
			return nil, err
		}
		c.key = key
	}
	ok = true
	return c, nil
}
func (c *Center) aad() []byte {
	return []byte("redeven/center/v1/" + c.key.Instance + "/" + c.key.Origin)
}
func (c *Center) seal(s persistentState) ([]byte, error) {
	stored := storedState{persistentState: s, Routes: []storedRoute{}}
	stored.persistentState.Routes = nil
	for _, r := range s.Routes {
		stored.Routes = append(stored.Routes, storedRoute{Route: r, Certificate: r.Certificate, PrivateKey: r.PrivateKey})
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, raw, c.aad()), nil
}
func (c *Center) saveLocked(next persistentState) error {
	if c.closed {
		return ErrDenied
	}
	raw, err := c.seal(next)
	if err != nil {
		return err
	}
	result, err := c.db.Exec("UPDATE center_state SET generation=generation+1,sealed=? WHERE singleton=1 AND generation=?", raw, c.generation)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil || n != 1 {
		return ErrConflict
	}
	c.generation++
	c.state = next
	return nil
}
func (c *Center) auditLocked(next *persistentState, action, result, reference string) {
	if action == "sensitive_authentication" {
		reference = auditActionKind(reference)
	}
	events := append([]auditEvent(nil), next.Audit...)
	events = append(events, auditEvent{Time: c.now().UnixMilli(), Action: action, Result: result, Reference: reference, Revision: next.Revision})
	if len(events) > 1000 {
		events = events[len(events)-1000:]
	}
	next.Audit = events
}
func (c *Center) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	c.revokeAllLocked()
	return errors.Join(c.db.Close(), c.lock.Release())
}
func randomID() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Errorf("secure random unavailable: %w", err))
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func digest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func writePrivate(path string, raw []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".center-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	if err == nil {
		err = f.Close()
	}
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	if err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
