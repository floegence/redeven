package accessgate

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"golang.org/x/crypto/bcrypt"
)

const authDatabaseName = "access-auth.sqlite"
const authKeyName = "access-auth.key"
const authTable = `CREATE TABLE authentication (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), generation INTEGER NOT NULL, sealed BLOB NOT NULL)`

type authState struct {
	PasswordHash    []byte   `json:"password_hash"`
	Revision        uint64   `json:"revision"`
	CredentialID    string   `json:"credential_id"`
	Secret          string   `json:"secret"`
	RecoverySalt    string   `json:"recovery_salt"`
	RecoveryHashes  []string `json:"recovery_hashes"`
	LastStep        int64    `json:"last_step"`
	LastCodeHash    string   `json:"last_code_hash"`
	LastCodeUntil   int64    `json:"last_code_until"`
	Failures        int      `json:"failures"`
	LastFailure     int64    `json:"last_failure"`
	CooldownUntil   int64    `json:"cooldown_until"`
	RecoveryPending bool     `json:"recovery_pending"`
}

type authKey struct {
	EnvironmentID string `json:"environment_id"`
	Key           []byte `json:"key"`
	Initialized   bool   `json:"initialized"`
}

type authStore struct {
	db            *sql.DB
	aead          cipher.AEAD
	environmentID string
	generation    int64
}

func privateFile(path string, allowMissing bool) error {
	info, err := os.Lstat(path)
	if allowMissing && errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return errors.New("authentication state must use private regular files (0600)")
	}
	return nil
}

func authSpec(initial []byte) sqliteutil.Spec {
	verify := func(tx *sql.Tx) error {
		var actual string
		if err := tx.QueryRow("SELECT sql FROM sqlite_master WHERE name='authentication' AND type='table'").Scan(&actual); err != nil {
			return err
		}
		if strings.Join(strings.Fields(actual), " ") != authTable {
			return errors.New("authentication schema drift")
		}
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('authentication','__redeven_db_meta')").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return errors.New("unexpected authentication schema objects")
		}
		if err := tx.QueryRow("SELECT count(*) FROM authentication WHERE singleton=1 AND generation>0 AND length(sealed)>0").Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return errors.New("missing authentication authority")
		}
		return nil
	}
	return sqliteutil.Spec{Kind: "runtime_access_auth_v1", CurrentVersion: 1, MinimumVersion: 1,
		Pragmas: []string{"PRAGMA busy_timeout=5000", "PRAGMA synchronous=FULL", "PRAGMA journal_mode=DELETE"},
		ValidateExisting: func(tx *sql.Tx) error {
			var version int
			var kind string
			if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
				return err
			}
			if err := tx.QueryRow("SELECT db_kind FROM __redeven_db_meta WHERE singleton=1").Scan(&kind); err != nil {
				return err
			}
			if version != 1 || kind != "runtime_access_auth_v1" {
				return errors.New("unsupported authentication database; preserve state and use a compatible Runtime")
			}
			return verify(tx)
		},
		Initialize: func(tx *sql.Tx) error {
			if len(initial) == 0 {
				return errors.New("authentication database is missing; restore the original state")
			}
			if _, err := tx.Exec(authTable); err != nil {
				return err
			}
			_, err := tx.Exec("INSERT INTO authentication VALUES(1,1,?)", initial)
			return err
		}, Verify: verify}
}

func (s *authStore) seal(state authState) ([]byte, error) {
	plain, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, plain, []byte("redeven/access-auth/v1/"+s.environmentID)), nil
}

// openAuthStore runs under the environment owner's state lock. Once initialized,
// neither a missing database nor a missing key may restore password-only access.
func openAuthStore(dir string, initialHash []byte) (*authStore, authState, error) {
	return openAuthStoreMode(dir, initialHash, false)
}

func openAuthStoreMode(dir string, initialHash []byte, readOnly bool) (*authStore, authState, error) {
	var state authState
	keyPath, dbPath := filepath.Join(dir, authKeyName), filepath.Join(dir, authDatabaseName)
	if !readOnly {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, state, err
		}
	}
	for _, path := range []string{keyPath, dbPath, dbPath + "-journal", dbPath + "-wal", dbPath + "-shm"} {
		if err := privateFile(path, true); err != nil {
			return nil, state, err
		}
	}
	var key authKey
	raw, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		if readOnly {
			return nil, state, errors.New("authentication key is missing")
		}
		if _, e := os.Lstat(dbPath); !errors.Is(e, os.ErrNotExist) {
			return nil, state, errors.New("authentication key is missing")
		}
		key.EnvironmentID, err = randomToken(16)
		if err != nil {
			return nil, state, err
		}
		key.Key = make([]byte, 32)
		if _, err = rand.Read(key.Key); err != nil {
			return nil, state, err
		}
		raw, err = json.Marshal(key)
		if err != nil {
			return nil, state, err
		}
		f, e := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if e != nil {
			return nil, state, e
		}
		_, e = f.Write(raw)
		if e == nil {
			e = f.Sync()
		}
		e = errors.Join(e, f.Close())
		if e != nil {
			return nil, state, e
		}
	} else if err != nil {
		return nil, state, err
	} else if err = json.Unmarshal(raw, &key); err != nil {
		return nil, state, errors.New("invalid authentication key")
	}
	if len(key.Key) != 32 || len(key.EnvironmentID) < 8 || len(key.EnvironmentID) > 128 {
		return nil, state, errors.New("invalid authentication key")
	}
	block, err := aes.NewCipher(key.Key)
	if err != nil {
		return nil, state, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, state, err
	}
	store := &authStore{aead: aead, environmentID: key.EnvironmentID}
	var initial []byte
	info, statErr := os.Lstat(dbPath)
	if errors.Is(statErr, os.ErrNotExist) {
		if key.Initialized || readOnly {
			return nil, state, errors.New("authentication database is missing; restore the original state")
		}
		state = authState{PasswordHash: initialHash, Revision: 1, LastStep: -1}
		initial, err = store.seal(state)
		if err != nil {
			return nil, state, err
		}
		f, e := os.OpenFile(dbPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if e != nil {
			return nil, state, e
		}
		if e = f.Close(); e != nil {
			return nil, state, e
		}
	} else if statErr != nil {
		return nil, state, statErr
	} else if info.Size() == 0 {
		if key.Initialized || readOnly {
			return nil, state, errors.New("authentication database is empty; restore the original state")
		}
		state = authState{PasswordHash: initialHash, Revision: 1, LastStep: -1}
		initial, err = store.seal(state)
		if err != nil {
			return nil, state, err
		}
	}
	if len(initial) > 0 {
		store.db, err = sqliteutil.Open(dbPath, authSpec(initial))
	} else {
		inspection, inspectErr := sqliteutil.Inspect(dbPath, authSpec(nil))
		if inspectErr != nil {
			return nil, state, inspectErr
		}
		if !inspection.Exists || inspection.MigrationRequired {
			return nil, state, errors.New("authentication authority requires repair")
		}
		uri := url.URL{Scheme: "file", Path: dbPath, RawQuery: "mode=ro"}
		store.db, err = sql.Open("sqlite", uri.String())
		if err == nil {
			store.db.SetMaxOpenConns(1)
		}
	}
	if err != nil {
		return nil, state, err
	}
	fail := func(e error) (*authStore, authState, error) { _ = store.db.Close(); return nil, authState{}, e }
	var sealed []byte
	if err = store.db.QueryRow("SELECT generation,sealed FROM authentication WHERE singleton=1").Scan(&store.generation, &sealed); err != nil {
		return fail(err)
	}
	if len(sealed) < aead.NonceSize() {
		return fail(errors.New("invalid authentication state"))
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte("redeven/access-auth/v1/"+key.EnvironmentID))
	if err != nil {
		return fail(errors.New("cannot decrypt authentication state"))
	}
	if err = json.Unmarshal(plain, &state); err != nil {
		return fail(errors.New("invalid authentication state"))
	}
	if state.Revision == 0 || (state.Secret != "" && (len(state.PasswordHash) == 0 || state.CredentialID == "")) {
		return fail(errors.New("invalid authentication policy"))
	}
	if len(state.PasswordHash) > 0 {
		if _, err = bcrypt.Cost(state.PasswordHash); err != nil {
			return fail(err)
		}
	}
	if readOnly {
		return store, state, nil
	}
	if len(initial) == 0 {
		if err = store.db.Close(); err != nil {
			return nil, state, err
		}
		store.db, err = sqliteutil.Open(dbPath, authSpec(nil))
		if err != nil {
			return nil, state, err
		}
	}
	if !key.Initialized {
		key.Initialized = true
		raw, err = json.Marshal(key)
		if err != nil {
			return fail(err)
		}
		if err = writePrivateAtomic(keyPath, raw); err != nil {
			return fail(err)
		}
	}
	// The encrypted authority is committed before the legacy verifier is removed.
	if err = os.Remove(filepath.Join(dir, credentialFileName)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fail(err)
	}
	return store, state, nil
}

func writePrivateAtomic(path string, raw []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".access-auth-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err = f.Write(raw); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func (s *authStore) save(state authState) error {
	sealed, err := s.seal(state)
	if err != nil {
		return err
	}
	result, err := s.db.Exec("UPDATE authentication SET generation=generation+1,sealed=? WHERE singleton=1 AND generation=?", sealed, s.generation)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("authentication state changed; reconnect to the owning Runtime")
	}
	s.generation++
	return nil
}

func OpenPersistent(dir string) (*Gate, error) {
	var hash []byte
	var err error
	if info, e := os.Lstat(filepath.Join(dir, authDatabaseName)); errors.Is(e, os.ErrNotExist) || (e == nil && info.Size() == 0) {
		hash, err = readLegacyPasswordHash(dir)
		if err != nil {
			return nil, err
		}
	}
	store, state, err := openAuthStore(dir, hash)
	if err != nil {
		return nil, fmt.Errorf("open authentication authority: %w", err)
	}
	gate, err := NewWithPasswordHash(state.PasswordHash)
	if err != nil {
		_ = store.db.Close()
		return nil, err
	}
	gate.store = store
	gate.auth = state
	gate.enabled.Store(len(state.PasswordHash) > 0 || state.RecoveryPending)
	return gate, nil
}

func (g *Gate) Close() error {
	if g == nil || g.store == nil {
		return nil
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	g.mu.Lock()
	for _, channel := range g.channels {
		if channel.expiryTimer != nil {
			channel.expiryTimer.Stop()
		}
	}
	g.mu.Unlock()
	return g.store.db.Close()
}
