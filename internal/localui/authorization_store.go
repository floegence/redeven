package localui

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v2/controlplane"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/floegence/redeven/internal/session"
)

const (
	localAuthorizationDBKind          = "redeven.localui.flowersec_authority"
	localAuthorizationDBVersion       = 1
	localAuthorizationKeyVersion      = 1
	localAuthorizationPageSize        = 4096
	localAuthorizationMaxPageCount    = (128 * 1024 * 1024) / localAuthorizationPageSize
	localAuthorizationMaxRecord       = 96 * 1024
	localAuthorizationMaxPlaintext    = 160 * 1024
	localAuthorizationMaxCiphertext   = localAuthorizationMaxPlaintext + 64
	localAuthorizationMaxReceipt      = 256
	localAuthorizationMaxPairs        = 4096
	localAuthorizationMaxLogicalBytes = 64 * 1024 * 1024
	localAuthorizationCleanupBatch    = 512
	localAuthorizationRetention       = time.Hour
	localAuthorizationDatabaseFile    = "redeven-localui-authority.sqlite"
	localAuthorizationKeyringFile     = "flowersec-authority.key"
	localAuthorizationRecordsSchema   = `CREATE TABLE local_authorization_records (
  lookup_key TEXT PRIMARY KEY NOT NULL,
  record_ciphertext BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  access_session_id TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL,
  expires_at_unix_s INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','reserved','leased','burned','released','revoked')),
  lease_id TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  reserved_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  leased_at_unix_ms INTEGER NOT NULL DEFAULT 0,
	activated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  terminal_at_unix_ms INTEGER NOT NULL DEFAULT 0
)`
	localAuthorizationLeaseIndexSchema = `CREATE UNIQUE INDEX local_authorization_lease_id ON local_authorization_records(lease_id) WHERE lease_id <> ''`
	localBrowserSpendsSchema           = `CREATE TABLE local_browser_spends (
  receipt_hmac BLOB PRIMARY KEY NOT NULL,
  lookup_key TEXT NOT NULL UNIQUE REFERENCES local_authorization_records(lookup_key) ON DELETE RESTRICT,
  receipt_key_version INTEGER NOT NULL,
  artifact_digest_b64u TEXT NOT NULL UNIQUE,
  projection_digest_b64u TEXT NOT NULL,
  launcher_origin TEXT NOT NULL,
  runtime_origin TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  consumer TEXT NOT NULL CHECK(consumer IN ('trusted','isolated')),
  target_binding_json BLOB NOT NULL,
  expires_at_unix_s INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('unspent','spent','expired','revoked')),
  spent_attempt_hmac BLOB NOT NULL DEFAULT X'',
  attempt_key_version INTEGER NOT NULL DEFAULT 0,
  spent_at_unix_ms INTEGER NOT NULL DEFAULT 0
)`
	localAuthorizationBootSchema = `CREATE TABLE local_authorization_boot (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  boot_generation INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
)`
)

type localAuthorizationStore struct {
	mu          sync.Mutex
	db          *sql.DB
	path        string
	keyringPath string
	keyring     localAuthorizationKeyring
	generation  int64
}

var errLocalAuthorizationCapacity = errors.New("local authorization capacity reached")

// The keyring is deliberately kept outside SQLite. A row contains only an
// AEAD envelope; a copied database therefore cannot be used as an issuer.
// Older keys can remain decrypt-only during a bounded rotation window.
type localAuthorizationKeyring struct {
	Current int            `json:"current"`
	Keys    map[int][]byte `json:"keys"`
}

type localAuthorizationBinding struct {
	ChannelID                 string       `json:"channel_id"`
	AccessSessionID           string       `json:"access_session_id,omitempty"`
	InitExpireAtUnixS         int64        `json:"init_expire_at_unix_s"`
	Meta                      session.Meta `json:"meta"`
	TraceID                   string       `json:"trace_id,omitempty"`
	ConnectArtifactIssuedAtMs int64        `json:"connect_artifact_issued_at_ms"`
	PluginCredentialHashB64u  string       `json:"plugin_credential_hash_b64u"`
}

type localAuthorizationSecret struct {
	RecordEncoded []byte                    `json:"record_encoded"`
	Binding       localAuthorizationBinding `json:"binding"`
}

type localReservedAuthorization struct {
	LookupKey       string
	LeaseID         string
	ChannelID       string
	AccessSessionID string
	Binding         localAuthorizationBinding
	Record          controlplane.AuthorizationRecord
	Receipt         string
}

type localSpendRequest struct {
	AttemptID            string          `json:"attempt_id"`
	Receipt              string          `json:"receipt"`
	ArtifactDigestB64u   string          `json:"artifact_digest_b64u"`
	ProjectionDigestB64u string          `json:"projection_digest_b64u"`
	LauncherOrigin       string          `json:"launcher_origin"`
	RuntimeOrigin        string          `json:"runtime_origin"`
	AppOrigin            string          `json:"app_origin"`
	Consumer             string          `json:"consumer"`
	TargetBinding        json.RawMessage `json:"target_binding"`
	ExpiresAt            string          `json:"expires_at"`
}

type localSpendError struct {
	Status int
	Code   string
}

func (e *localSpendError) Error() string {
	if e == nil {
		return "local artifact spend failed"
	}
	return e.Code
}

func openLocalAuthorizationStore(path string) (*localAuthorizationStore, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || path == "" {
		return nil, errors.New("missing local authorization database path")
	}
	keyringPath := filepath.Join(filepath.Dir(path), localAuthorizationKeyringFile)
	allowKeyringCreate, err := localAuthorizationDatabaseIsFresh(path)
	if err != nil {
		return nil, err
	}
	keyring, err := loadLocalAuthorizationKeyring(keyringPath, allowKeyringCreate)
	if err != nil {
		return nil, err
	}
	store := &localAuthorizationStore{path: path, keyringPath: keyringPath, keyring: keyring}
	db, err := sqliteutil.Open(path, localAuthorizationSchemaSpec())
	if err != nil {
		return nil, err
	}
	store.db = db
	if err := store.validateRetainedRows(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("validate Local UI authorization rows: %w", err)
	}
	if err := store.advanceBootGeneration(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func localAuthorizationSchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           localAuthorizationDBKind,
		CurrentVersion: localAuthorizationDBVersion,
		MinimumVersion: localAuthorizationDBVersion,
		Pragmas: []string{
			"PRAGMA foreign_keys=ON",
			"PRAGMA trusted_schema=OFF",
			fmt.Sprintf("PRAGMA page_size=%d", localAuthorizationPageSize),
			fmt.Sprintf("PRAGMA max_page_count=%d", localAuthorizationMaxPageCount),
		},
		Initialize: func(tx *sql.Tx) error {
			if _, err := tx.Exec(localAuthorizationRecordsSchema); err != nil {
				return err
			}
			if _, err := tx.Exec(localAuthorizationLeaseIndexSchema); err != nil {
				return err
			}
			if _, err := tx.Exec(localBrowserSpendsSchema); err != nil {
				return err
			}
			if _, err := tx.Exec(localAuthorizationBootSchema); err != nil {
				return err
			}
			_, err := tx.Exec(`INSERT INTO local_authorization_boot(singleton, boot_generation, updated_at_unix_ms) VALUES(1, 0, 0)`)
			return err
		},
		Verify: verifyLocalAuthorizationSchema,
	}
}

func verifyLocalAuthorizationSchema(tx *sql.Tx) error {
	want := map[string]string{
		"local_authorization_records": localAuthorizationRecordsSchema,
		"local_browser_spends":        localBrowserSpendsSchema,
		"local_authorization_boot":    localAuthorizationBootSchema,
	}
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if len(tables) != len(want) {
		return fmt.Errorf("invalid local authorization table set")
	}
	for _, table := range tables {
		expected, ok := want[table]
		if !ok {
			return fmt.Errorf("unexpected local authorization table %q", table)
		}
		var actual string
		if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&actual); err != nil {
			return err
		}
		if strings.Join(strings.Fields(actual), " ") != strings.Join(strings.Fields(expected), " ") {
			return fmt.Errorf("invalid local authorization table %q definition", table)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 1 || indexes[0] != "local_authorization_lease_id" {
		return fmt.Errorf("invalid local authorization index set")
	}
	var indexSQL string
	if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'local_authorization_lease_id'`).Scan(&indexSQL); err != nil {
		return err
	}
	if strings.Join(strings.Fields(indexSQL), " ") != strings.Join(strings.Fields(localAuthorizationLeaseIndexSchema), " ") {
		return errors.New("invalid local authorization lease index")
	}
	rows, err := tx.Query(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
	if err != nil {
		return err
	}
	defer rows.Close()
	objects := make([]string, 0, 5)
	for rows.Next() {
		var objectType, name string
		if err := rows.Scan(&objectType, &name); err != nil {
			return err
		}
		objects = append(objects, objectType+":"+name)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	wantObjects := []string{
		"index:local_authorization_lease_id",
		"table:__redeven_db_meta",
		"table:local_authorization_boot",
		"table:local_authorization_records",
		"table:local_browser_spends",
	}
	if len(objects) != len(wantObjects) {
		return fmt.Errorf("invalid local authorization object set")
	}
	for index := range objects {
		if objects[index] != wantObjects[index] {
			return fmt.Errorf("invalid local authorization object %q", objects[index])
		}
	}
	var foreignKeyFailures int
	foreignKeys, err := tx.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	for foreignKeys.Next() {
		foreignKeyFailures++
	}
	if err := foreignKeys.Close(); err != nil {
		return err
	}
	if foreignKeyFailures != 0 {
		return errors.New("local authorization foreign key check failed")
	}
	var pageSize, maxPageCount int
	if err := tx.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return err
	}
	if err := tx.QueryRow(`PRAGMA max_page_count`).Scan(&maxPageCount); err != nil {
		return err
	}
	if pageSize != localAuthorizationPageSize || maxPageCount != localAuthorizationMaxPageCount {
		return errors.New("invalid local authorization physical size limit")
	}
	if err := verifyLocalAuthorizationRowsTx(tx); err != nil {
		return err
	}
	return nil
}

func verifyLocalAuthorizationRowsTx(tx *sql.Tx) error {
	if tx == nil {
		return errors.New("nil local authorization transaction")
	}
	var invalid int
	authorizationInvariant := `SELECT COUNT(1)
FROM local_authorization_records
WHERE lookup_key = ''
   OR length(record_ciphertext) = 0
   OR length(record_ciphertext) > ?
   OR key_version <= 0
   OR channel_id = ''
   OR access_session_id = ''
   OR generation <= 0
   OR generation > (SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1)
   OR expires_at_unix_s <= 0
   OR created_at_unix_ms <= 0
   OR expires_at_unix_s * 1000 < created_at_unix_ms
   OR CASE state
        WHEN 'pending' THEN lease_id <> '' OR reserved_at_unix_ms <> 0 OR leased_at_unix_ms <> 0 OR activated_at_unix_ms <> 0 OR terminal_at_unix_ms <> 0
        WHEN 'reserved' THEN lease_id = '' OR reserved_at_unix_ms <= 0 OR leased_at_unix_ms <> 0 OR activated_at_unix_ms <> 0 OR terminal_at_unix_ms <> 0
        WHEN 'leased' THEN lease_id = '' OR reserved_at_unix_ms <= 0 OR leased_at_unix_ms < reserved_at_unix_ms OR terminal_at_unix_ms <> 0 OR (activated_at_unix_ms <> 0 AND activated_at_unix_ms < leased_at_unix_ms)
        WHEN 'burned' THEN lease_id = '' OR reserved_at_unix_ms <= 0 OR terminal_at_unix_ms < max(reserved_at_unix_ms, leased_at_unix_ms, activated_at_unix_ms)
        WHEN 'released' THEN lease_id = '' OR reserved_at_unix_ms <= 0 OR leased_at_unix_ms < reserved_at_unix_ms OR activated_at_unix_ms < leased_at_unix_ms OR terminal_at_unix_ms < activated_at_unix_ms
        WHEN 'revoked' THEN terminal_at_unix_ms <= 0 OR NOT (
          (lease_id = '' AND reserved_at_unix_ms = 0 AND leased_at_unix_ms = 0 AND activated_at_unix_ms = 0)
          OR
          (lease_id <> '' AND reserved_at_unix_ms > 0 AND leased_at_unix_ms >= reserved_at_unix_ms AND terminal_at_unix_ms >= max(leased_at_unix_ms, activated_at_unix_ms))
        )
        ELSE 1
      END`
	if err := tx.QueryRow(authorizationInvariant, localAuthorizationMaxCiphertext).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("invalid local authorization row state")
	}
	spendInvariant := `SELECT COUNT(1)
FROM local_browser_spends AS spend
JOIN local_authorization_records AS authority ON authority.lookup_key = spend.lookup_key
WHERE length(spend.receipt_hmac) <> 32
   OR spend.receipt_key_version <= 0
   OR length(spend.artifact_digest_b64u) <> 43
   OR length(spend.projection_digest_b64u) <> 43
   OR spend.launcher_origin = ''
   OR spend.runtime_origin = ''
   OR spend.app_origin = ''
   OR spend.consumer <> 'trusted'
   OR length(spend.target_binding_json) = 0
   OR length(spend.target_binding_json) > 4096
   OR spend.expires_at_unix_s <> authority.expires_at_unix_s
   OR (authority.state IN ('burned','released','revoked') AND spend.state = 'unspent')
   OR CASE spend.state
        WHEN 'unspent' THEN length(spend.spent_attempt_hmac) <> 0 OR spend.attempt_key_version <> 0 OR spend.spent_at_unix_ms <> 0
        WHEN 'spent' THEN length(spend.spent_attempt_hmac) <> 32 OR spend.attempt_key_version <= 0 OR spend.spent_at_unix_ms <= 0
        WHEN 'expired' THEN length(spend.spent_attempt_hmac) <> 0 OR spend.attempt_key_version <> 0 OR spend.spent_at_unix_ms <> 0
        WHEN 'revoked' THEN length(spend.spent_attempt_hmac) <> 0 OR spend.attempt_key_version <> 0 OR spend.spent_at_unix_ms <> 0
        ELSE 1
      END`
	if err := tx.QueryRow(spendInvariant).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("invalid local browser spend row state")
	}
	var authorities, spends int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM local_authorization_records`).Scan(&authorities); err != nil {
		return err
	}
	if err := tx.QueryRow(`SELECT COUNT(1) FROM local_browser_spends`).Scan(&spends); err != nil {
		return err
	}
	if authorities != spends {
		return errors.New("local authorization rows are not paired one-to-one")
	}
	if pairs, logicalBytes, err := localAuthorizationCapacityUsageTx(tx); err != nil {
		return err
	} else if pairs > localAuthorizationMaxPairs || logicalBytes > localAuthorizationMaxLogicalBytes {
		return errLocalAuthorizationCapacity
	}
	return nil
}

func localAuthorizationDatabaseIsFresh(path string) (bool, error) {
	for _, candidate := range []string{path, path + "-wal", path + "-journal"} {
		info, err := os.Stat(candidate)
		if err == nil {
			if info.IsDir() {
				return false, fmt.Errorf("local authorization database path is a directory")
			}
			if info.Size() > 0 {
				return false, nil
			}
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
	}
	return true, nil
}

func (store *localAuthorizationStore) close() error {
	if store == nil {
		return nil
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.db == nil {
		return nil
	}
	err := store.db.Close()
	store.db = nil
	return err
}

func (store *localAuthorizationStore) advanceBootGeneration() error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var generation int64
	if err := tx.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&generation); err != nil {
		return err
	}
	if generation < 0 || generation == int64(^uint64(0)>>1) {
		return errors.New("invalid local authorization boot generation")
	}
	next := generation + 1
	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`UPDATE local_authorization_boot SET boot_generation = ?, updated_at_unix_ms = ? WHERE singleton = 1`, next, now); err != nil {
		return err
	}
	// An old process cannot safely resume a one-shot authority after a restart.
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = 'revoked', terminal_at_unix_ms = ?, lease_id = '' WHERE state = 'pending' AND generation < ?`, now, next); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE state IN ('reserved','leased') AND generation < ?`, now, next); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = 'revoked' WHERE state = 'unspent' AND lookup_key IN (SELECT lookup_key FROM local_authorization_records WHERE generation < ?)`, next); err != nil {
		return err
	}
	if err := store.maintainTx(tx, time.UnixMilli(now)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	store.generation = next
	return store.retireUnusedKeysLocked()
}

func (store *localAuthorizationStore) issue(record controlplane.AuthorizationRecord, binding pendingDirect, channelID, accessSessionID string, expiresAt time.Time, artifactDigest, projectionDigest, spendOrigin string, targetBinding []byte) (string, error) {
	if store == nil || store.db == nil {
		return "", errors.New("local authorization store is unavailable")
	}
	lookup := strings.TrimSpace(lookupKeyOf(record))
	channelID = strings.TrimSpace(channelID)
	accessSessionID = strings.TrimSpace(accessSessionID)
	if lookup == "" || channelID == "" || accessSessionID == "" || expiresAt.IsZero() || !expiresAt.After(time.Now()) {
		return "", errors.New("invalid local authorization binding")
	}
	encoded, err := record.Encode()
	if err != nil {
		return "", err
	}
	if len(encoded) == 0 || len(encoded) > localAuthorizationMaxRecord {
		return "", errors.New("authorization record exceeds storage limit")
	}
	hashText := base64.RawURLEncoding.EncodeToString(binding.pluginCredentialHash[:])
	secret := localAuthorizationSecret{RecordEncoded: encoded, Binding: localAuthorizationBinding{
		ChannelID: channelID, AccessSessionID: accessSessionID, InitExpireAtUnixS: expiresAt.Unix(),
		Meta: binding.meta, TraceID: binding.traceID, ConnectArtifactIssuedAtMs: binding.connectArtifactIssuedAtMs, PluginCredentialHashB64u: hashText,
	}}
	plain, err := json.Marshal(secret)
	if err != nil {
		return "", err
	}
	if len(plain) == 0 || len(plain) > localAuthorizationMaxPlaintext {
		return "", errors.New("local authorization secret exceeds storage limit")
	}
	artifactDigest = strings.TrimSpace(artifactDigest)
	projectionDigest = strings.TrimSpace(projectionDigest)
	if !validB64u32(artifactDigest) || !validB64u32(projectionDigest) {
		return "", errors.New("missing local spend digests")
	}
	spendOrigin = strings.TrimSpace(spendOrigin)
	if spendOrigin == "" || len(spendOrigin) > 2048 {
		return "", errors.New("missing local spend origin")
	}
	targetBinding, err = canonicalLocalJSON(targetBinding)
	if err != nil || len(targetBinding) == 0 || len(targetBinding) > 4096 {
		return "", errors.New("invalid local spend target binding")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.db == nil || store.generation <= 0 {
		return "", errors.New("local authorization store is unavailable")
	}
	tx, err := store.db.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var currentGeneration int64
	if err := tx.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&currentGeneration); err != nil {
		return "", err
	}
	if currentGeneration != store.generation {
		return "", errors.New("local authorization store generation changed")
	}
	if err := store.maintainTx(tx, time.Now()); err != nil {
		return "", err
	}
	ciphertext, keyVersion, err := store.encrypt(lookup, store.generation, channelID, accessSessionID, expiresAt.Unix(), plain)
	if err != nil {
		return "", err
	}
	if len(ciphertext) == 0 || len(ciphertext) > localAuthorizationMaxCiphertext {
		return "", errors.New("local authorization ciphertext exceeds storage limit")
	}
	receipt, receiptHMAC, receiptKeyVersion, err := store.newReceipt()
	if err != nil {
		return "", err
	}
	logicalBytes := localAuthorizationPairLogicalBytes(
		lookup, ciphertext, channelID, accessSessionID, "",
		receiptHMAC, artifactDigest, projectionDigest, spendOrigin, spendOrigin, spendOrigin, "trusted", targetBinding, nil,
	)
	if err := store.ensureCapacityTx(tx, logicalBytes); err != nil {
		return "", err
	}
	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`INSERT INTO local_authorization_records(lookup_key, record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s, state, lease_id, created_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`, lookup, ciphertext, keyVersion, channelID, accessSessionID, store.generation, expiresAt.Unix(), "pending", "", now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(`INSERT INTO local_browser_spends(receipt_hmac, lookup_key, receipt_key_version, artifact_digest_b64u, projection_digest_b64u, launcher_origin, runtime_origin, app_origin, consumer, target_binding_json, expires_at_unix_s, state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, receiptHMAC, lookup, receiptKeyVersion, artifactDigest, projectionDigest, spendOrigin, spendOrigin, spendOrigin, "trusted", targetBinding, expiresAt.Unix(), "unspent"); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return receipt, nil
}

func lookupKeyOf(record controlplane.AuthorizationRecord) string { return record.LookupKey() }

func (store *localAuthorizationStore) reserve(request controlplane.RuntimeAuthorizationRequest) (localReservedAuthorization, error) {
	return store.reserveLookup(request.LookupKey())
}

func (store *localAuthorizationStore) reserveLookup(lookup string) (localReservedAuthorization, error) {
	if store == nil || store.db == nil {
		return localReservedAuthorization{}, errors.New("local authorization store is unavailable")
	}
	lookup = strings.TrimSpace(lookup)
	if lookup == "" {
		return localReservedAuthorization{}, errors.New("missing authorization lookup key")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return localReservedAuthorization{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var currentGeneration int64
	if err := tx.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&currentGeneration); err != nil {
		return localReservedAuthorization{}, err
	}
	if currentGeneration != store.generation || currentGeneration <= 0 {
		return localReservedAuthorization{}, errors.New("local authorization store generation changed")
	}
	if err := store.maintainTx(tx, time.Now()); err != nil {
		return localReservedAuthorization{}, err
	}
	var ciphertext []byte
	var keyVersion int
	var channelID, accessSessionID, state string
	var generation, expiresAt int64
	if err := tx.QueryRow(`SELECT record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s, state FROM local_authorization_records WHERE lookup_key = ?`, lookup).Scan(&ciphertext, &keyVersion, &channelID, &accessSessionID, &generation, &expiresAt, &state); err != nil {
		return localReservedAuthorization{}, err
	}
	now := time.Now().Unix()
	if state != "pending" || expiresAt <= now {
		if err := tx.Commit(); err != nil {
			return localReservedAuthorization{}, err
		}
		return localReservedAuthorization{}, errors.New("authorization record is not pending")
	}
	if generation != currentGeneration {
		return localReservedAuthorization{}, errors.New("authorization record belongs to an old boot generation")
	}
	leaseID, err := randomLeaseID()
	if err != nil {
		return localReservedAuthorization{}, err
	}
	updated, err := tx.Exec(`UPDATE local_authorization_records SET state = 'reserved', lease_id = ?, reserved_at_unix_ms = ? WHERE lookup_key = ? AND state = 'pending' AND generation = ?`, leaseID, time.Now().UnixMilli(), lookup, currentGeneration)
	if err != nil {
		return localReservedAuthorization{}, err
	}
	if count, _ := updated.RowsAffected(); count != 1 {
		return localReservedAuthorization{}, errors.New("authorization record reservation lost race")
	}
	burnAndCommit := func(cause error) (localReservedAuthorization, error) {
		if _, updateErr := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE lookup_key = ? AND lease_id = ? AND state = 'reserved'`, time.Now().UnixMilli(), lookup, leaseID); updateErr != nil {
			return localReservedAuthorization{}, errors.Join(cause, updateErr)
		}
		if _, updateErr := tx.Exec(`UPDATE local_browser_spends SET state = 'revoked' WHERE lookup_key = ? AND state = 'unspent'`, lookup); updateErr != nil {
			return localReservedAuthorization{}, errors.Join(cause, updateErr)
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return localReservedAuthorization{}, errors.Join(cause, commitErr)
		}
		return localReservedAuthorization{}, cause
	}
	plain, err := store.decrypt(lookup, generation, channelID, accessSessionID, expiresAt, keyVersion, ciphertext)
	if err != nil {
		return burnAndCommit(err)
	}
	var secret localAuthorizationSecret
	if err := json.Unmarshal(plain, &secret); err != nil || len(secret.RecordEncoded) == 0 || len(secret.RecordEncoded) > localAuthorizationMaxRecord ||
		secret.Binding.ChannelID != channelID || secret.Binding.AccessSessionID != accessSessionID || secret.Binding.InitExpireAtUnixS != expiresAt {
		return burnAndCommit(errors.New("invalid local authorization secret"))
	}
	record, err := controlplane.ParseAuthorizationRecord(secret.RecordEncoded)
	if err != nil || record.LookupKey() != lookup {
		if err != nil {
			return burnAndCommit(err)
		}
		return burnAndCommit(errors.New("authorization record lookup mismatch"))
	}
	if err := tx.Commit(); err != nil {
		return localReservedAuthorization{}, err
	}
	return localReservedAuthorization{LookupKey: lookup, LeaseID: leaseID, ChannelID: channelID, AccessSessionID: accessSessionID, Binding: secret.Binding, Record: record}, nil
}

func (store *localAuthorizationStore) markLeased(lookup, leaseID string) error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	result, err := store.db.Exec(`UPDATE local_authorization_records
SET state = 'leased', leased_at_unix_ms = ?
WHERE lookup_key = ? AND lease_id = ? AND generation = ? AND state = 'reserved'`, time.Now().UnixMilli(), strings.TrimSpace(lookup), strings.TrimSpace(leaseID), store.generation)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("authorization lease state changed")
	}
	return nil
}

func (store *localAuthorizationStore) burn(lookup, leaseID string) error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE lookup_key = ? AND lease_id = ? AND state IN ('reserved','leased')`, time.Now().UnixMilli(), strings.TrimSpace(lookup), strings.TrimSpace(leaseID))
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		var state string
		if queryErr := tx.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ? AND lease_id = ?`, strings.TrimSpace(lookup), strings.TrimSpace(leaseID)).Scan(&state); queryErr != nil {
			return errors.New("authorization lease state changed")
		}
		if state != "burned" {
			return errors.New("authorization lease state changed")
		}
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = 'revoked' WHERE lookup_key = ? AND state = 'unspent'`, strings.TrimSpace(lookup)); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *localAuthorizationStore) burnLeased(lookup string) error {
	if store == nil || store.db == nil || strings.TrimSpace(lookup) == "" {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var leaseID string
	if err := store.db.QueryRow(`SELECT lease_id FROM local_authorization_records WHERE lookup_key = ? AND state = 'leased'`, strings.TrimSpace(lookup)).Scan(&leaseID); err != nil {
		return err
	}
	return store.burnLeasedLocked(strings.TrimSpace(lookup), leaseID)
}

func (store *localAuthorizationStore) burnLeasedLocked(lookup, leaseID string) error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE lookup_key = ? AND lease_id = ? AND state = 'leased'`, time.Now().UnixMilli(), strings.TrimSpace(lookup), strings.TrimSpace(leaseID))
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		var state string
		if err := tx.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ? AND lease_id = ?`, strings.TrimSpace(lookup), strings.TrimSpace(leaseID)).Scan(&state); err != nil || state != "burned" {
			return errors.New("authorization leased cleanup lost race")
		}
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = 'revoked' WHERE lookup_key = ? AND state = 'unspent'`, strings.TrimSpace(lookup)); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *localAuthorizationStore) markActivated(channelID string) error {
	if store == nil || store.db == nil || strings.TrimSpace(channelID) == "" {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	result, err := store.db.Exec(`UPDATE local_authorization_records
SET activated_at_unix_ms = CASE WHEN activated_at_unix_ms = 0 THEN ? ELSE activated_at_unix_ms END
WHERE channel_id = ? AND generation = ? AND state = 'leased'`, time.Now().UnixMilli(), strings.TrimSpace(channelID), store.generation)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("authorization activation state changed")
	}
	return nil
}

func (store *localAuthorizationStore) releaseChannel(channelID string) error {
	if store == nil || store.db == nil {
		return nil
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var lookup, leaseID, state string
	var activatedAt int64
	if err := tx.QueryRow(`SELECT lookup_key, lease_id, state, activated_at_unix_ms FROM local_authorization_records WHERE channel_id = ?`, strings.TrimSpace(channelID)).Scan(&lookup, &leaseID, &state, &activatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if state == "pending" || state == "reserved" || state == "leased" {
		terminalState := "released"
		if state == "pending" {
			terminalState = "revoked"
		} else if state == "reserved" {
			terminalState = "burned"
		} else if activatedAt == 0 {
			terminalState = "burned"
		}
		result, err := tx.Exec(`UPDATE local_authorization_records SET state = ?, terminal_at_unix_ms = ? WHERE lookup_key = ? AND channel_id = ? AND lease_id = ? AND state = ?`, terminalState, time.Now().UnixMilli(), lookup, strings.TrimSpace(channelID), leaseID, state)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return errors.New("authorization exact lease release lost race")
		}
		if _, err := tx.Exec(`UPDATE local_browser_spends SET state = CASE WHEN state = 'unspent' THEN 'revoked' ELSE state END WHERE lookup_key = ?`, lookup); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// releaseLease handles Flowersec's Acceptor.Release callback, whose argument
// is the durable authorization lease ID rather than the artifact channel ID.
func (store *localAuthorizationStore) releaseLease(leaseID string) (string, error) {
	if store == nil || store.db == nil || strings.TrimSpace(leaseID) == "" {
		return "", nil
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	leaseID = strings.TrimSpace(leaseID)
	var channelID, lookup, state string
	var activatedAt int64
	if err := tx.QueryRow(`SELECT channel_id, lookup_key, state, activated_at_unix_ms FROM local_authorization_records WHERE lease_id = ?`, leaseID).Scan(&channelID, &lookup, &state, &activatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if state == "leased" || state == "reserved" {
		terminalState := "burned"
		if state == "leased" && activatedAt > 0 {
			terminalState = "released"
		}
		result, err := tx.Exec(`UPDATE local_authorization_records SET state = ?, terminal_at_unix_ms = ? WHERE lookup_key = ? AND lease_id = ? AND state = ?`, terminalState, time.Now().UnixMilli(), lookup, leaseID, state)
		if err != nil {
			return "", err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return "", errors.New("authorization lease release lost race")
		}
	} else if state != "burned" && state != "released" && state != "revoked" {
		return "", errors.New("authorization lease is not releasable")
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = CASE WHEN state = 'unspent' THEN 'revoked' ELSE state END WHERE lookup_key = ?`, lookup); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return channelID, nil
}

// revokeAccessSession terminates every authority owned by one access session
// in one transaction. Individual channel release remains exact-lease scoped;
// this owner operation is reserved for logout, expiry, and shutdown.
func (store *localAuthorizationStore) revokeAccessSession(accessSessionID string) error {
	if store == nil || store.db == nil || strings.TrimSpace(accessSessionID) == "" {
		return nil
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = CASE WHEN state = 'reserved' THEN 'burned' ELSE 'revoked' END, terminal_at_unix_ms = ? WHERE access_session_id = ? AND generation = ? AND state IN ('pending','reserved','leased')`, now, strings.TrimSpace(accessSessionID), store.generation); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = 'revoked' WHERE lookup_key IN (SELECT lookup_key FROM local_authorization_records WHERE access_session_id = ? AND generation = ?) AND state = 'unspent'`, strings.TrimSpace(accessSessionID), store.generation); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *localAuthorizationStore) bindingByLookup(lookupKey string) (pendingDirect, string, bool) {
	if strings.TrimSpace(lookupKey) == "" {
		return pendingDirect{}, "", false
	}
	return store.bindingByQuery(`lookup_key = ?`, lookupKey)
}

func (store *localAuthorizationStore) bindingByQuery(predicate string, arg string) (pendingDirect, string, bool) {
	if store == nil || store.db == nil || strings.TrimSpace(predicate) == "" {
		return pendingDirect{}, "", false
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var ciphertext []byte
	var keyVersion int
	var lookup, accessSessionID, state, storedChannel, leaseID string
	var generation, expiresAt int64
	query := `SELECT lookup_key, record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s, state, lease_id FROM local_authorization_records WHERE ` + predicate
	if err := store.db.QueryRow(query, arg).Scan(&lookup, &ciphertext, &keyVersion, &storedChannel, &accessSessionID, &generation, &expiresAt, &state, &leaseID); err != nil || state != "leased" || generation != store.generation {
		return pendingDirect{}, "", false
	}
	plain, err := store.decrypt(lookup, generation, storedChannel, accessSessionID, expiresAt, keyVersion, ciphertext)
	if err != nil {
		_ = store.burnLeasedLocked(lookup, leaseID)
		return pendingDirect{}, "", false
	}
	var secret localAuthorizationSecret
	if err := json.Unmarshal(plain, &secret); err != nil || secret.Binding.ChannelID != storedChannel ||
		secret.Binding.AccessSessionID != accessSessionID || secret.Binding.InitExpireAtUnixS != expiresAt {
		_ = store.burnLeasedLocked(lookup, leaseID)
		return pendingDirect{}, "", false
	}
	hashBytes, err := base64.RawURLEncoding.DecodeString(secret.Binding.PluginCredentialHashB64u)
	if err != nil || len(hashBytes) != sha256.Size {
		_ = store.burnLeasedLocked(lookup, leaseID)
		return pendingDirect{}, "", false
	}
	var hash [sha256.Size]byte
	copy(hash[:], hashBytes)
	return pendingDirect{pluginCredentialHash: hash, accessSessionID: secret.Binding.AccessSessionID, initExpireAtUnixS: secret.Binding.InitExpireAtUnixS, meta: secret.Binding.Meta, traceID: secret.Binding.TraceID, connectArtifactIssuedAtMs: secret.Binding.ConnectArtifactIssuedAtMs}, storedChannel, true
}

func (store *localAuthorizationStore) spend(request localSpendRequest) error {
	if store == nil || store.db == nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	if len(request.Receipt) == 0 || len(request.Receipt) > localAuthorizationMaxReceipt || !validB64u32(request.AttemptID) {
		return &localSpendError{Status: 400, Code: "invalid_spend_request"}
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	_, receiptHMAC, err := store.receiptHMAC(request.Receipt)
	if err != nil {
		return &localSpendError{Status: 400, Code: "invalid_spend_request"}
	}
	tx, err := store.db.Begin()
	if err != nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	defer func() { _ = tx.Rollback() }()
	var currentGeneration int64
	if err := tx.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&currentGeneration); err != nil || currentGeneration != store.generation {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	var artifactDigest, projectionDigest, launcherOrigin, runtimeOrigin, appOrigin, consumer string
	var targetBinding []byte
	var expiresAt int64
	var state string
	var spentAttempt []byte
	var receiptKeyVersion, attemptKeyVersion int
	query := `SELECT receipt_key_version, artifact_digest_b64u, projection_digest_b64u, launcher_origin, runtime_origin, app_origin, consumer, target_binding_json, expires_at_unix_s, state, spent_attempt_hmac, attempt_key_version FROM local_browser_spends WHERE receipt_hmac = ?`
	err = tx.QueryRow(query, receiptHMAC).Scan(&receiptKeyVersion, &artifactDigest, &projectionDigest, &launcherOrigin, &runtimeOrigin, &appOrigin, &consumer, &targetBinding, &expiresAt, &state, &spentAttempt, &attemptKeyVersion)
	if err != nil && errors.Is(err, sql.ErrNoRows) {
		for version := range store.keyring.Keys {
			if version <= 0 {
				continue
			}
			_, candidate, candidateErr := store.receiptHMACForVersion(request.Receipt, version)
			if candidateErr != nil {
				continue
			}
			if queryErr := tx.QueryRow(query, candidate).Scan(&receiptKeyVersion, &artifactDigest, &projectionDigest, &launcherOrigin, &runtimeOrigin, &appOrigin, &consumer, &targetBinding, &expiresAt, &state, &spentAttempt, &attemptKeyVersion); queryErr == nil {
				receiptHMAC = candidate
				err = nil
				break
			}
		}
	}
	if err != nil {
		return &localSpendError{Status: 400, Code: "invalid_spend_receipt"}
	}
	_, storedReceiptHMAC, keyErr := store.receiptHMACForVersion(request.Receipt, receiptKeyVersion)
	if keyErr != nil || !hmac.Equal(receiptHMAC, storedReceiptHMAC) {
		return &localSpendError{Status: 400, Code: "invalid_spend_receipt"}
	}
	requestExpiry, expiryErr := time.Parse(time.RFC3339Nano, request.ExpiresAt)
	requestedTarget, targetErr := canonicalLocalJSON(request.TargetBinding)
	storedTarget, storedTargetErr := canonicalLocalJSON(targetBinding)
	if request.ArtifactDigestB64u != artifactDigest || request.ProjectionDigestB64u != projectionDigest || request.LauncherOrigin != launcherOrigin || request.RuntimeOrigin != runtimeOrigin || request.AppOrigin != appOrigin || request.Consumer != consumer || targetErr != nil || storedTargetErr != nil || !bytes.Equal(requestedTarget, storedTarget) || expiryErr != nil || requestExpiry.Unix() != expiresAt {
		return &localSpendError{Status: 400, Code: "spend_binding_mismatch"}
	}
	if state == "spent" {
		if attemptKeyVersion <= 0 {
			return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
		}
		attemptHMAC, attemptErr := store.attemptHMACForVersion(request.AttemptID, attemptKeyVersion)
		if attemptErr == nil && hmac.Equal(spentAttempt, attemptHMAC) {
			return tx.Commit()
		}
		return &localSpendError{Status: 409, Code: "already_spent"}
	}
	if state != "unspent" || expiresAt <= time.Now().Unix() {
		if state == "unspent" && expiresAt <= time.Now().Unix() {
			_, _ = tx.Exec(`UPDATE local_browser_spends SET state = 'expired' WHERE receipt_hmac = ? AND state = 'unspent'`, receiptHMAC)
			_, _ = tx.Exec(`UPDATE local_authorization_records SET state = CASE WHEN state = 'reserved' THEN 'burned' ELSE 'revoked' END, terminal_at_unix_ms = ? WHERE lookup_key = (SELECT lookup_key FROM local_browser_spends WHERE receipt_hmac = ?) AND state IN ('pending','reserved')`, time.Now().UnixMilli(), receiptHMAC)
			_ = tx.Commit()
		}
		return &localSpendError{Status: 410, Code: "spend_expired"}
	}
	currentAttemptKeyVersion, keyErr := store.keyVersionForLabel("attempt")
	if keyErr != nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	attemptHMAC, keyErr := store.attemptHMACForVersion(request.AttemptID, currentAttemptKeyVersion)
	if keyErr != nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends SET state = 'spent', spent_attempt_hmac = ?, attempt_key_version = ?, spent_at_unix_ms = ? WHERE receipt_hmac = ? AND state = 'unspent'`, attemptHMAC, currentAttemptKeyVersion, time.Now().UnixMilli(), receiptHMAC); err != nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	if err := tx.Commit(); err != nil {
		return &localSpendError{Status: 503, Code: "local_authority_unavailable"}
	}
	return nil
}

func (store *localAuthorizationStore) newReceipt() (string, []byte, int, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", nil, 0, err
	}
	receipt := "r1.local." + base64.RawURLEncoding.EncodeToString(buf)
	version, hash, err := store.receiptHMAC(receipt)
	return receipt, hash, version, err
}

func randomLeaseID() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return "lease." + base64.RawURLEncoding.EncodeToString(buf), nil
}

func validB64u32(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func (store *localAuthorizationStore) receiptHMAC(receipt string) (int, []byte, error) {
	return store.receiptHMACForVersion(receipt, 0)
}

func (store *localAuthorizationStore) receiptHMACForVersion(receipt string, requestedVersion int) (int, []byte, error) {
	if !strings.HasPrefix(receipt, "r1.local.") {
		return 0, nil, errors.New("invalid local receipt")
	}
	version, key, err := store.keyForLabelVersion("receipt", requestedVersion)
	if err != nil {
		return 0, nil, err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(receipt))
	return version, mac.Sum(nil), nil
}

func (store *localAuthorizationStore) attemptHMACForVersion(attempt string, requestedVersion int) ([]byte, error) {
	_, key, err := store.keyForLabelVersion("attempt", requestedVersion)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(attempt))
	return mac.Sum(nil), nil
}

func (store *localAuthorizationStore) keyForLabel(label string) (int, []byte, error) {
	return store.keyForLabelVersion(label, 0)
}

func (store *localAuthorizationStore) keyVersionForLabel(label string) (int, error) {
	version, _, err := store.keyForLabelVersion(label, 0)
	return version, err
}

func (store *localAuthorizationStore) keyForLabelVersion(label string, requestedVersion int) (int, []byte, error) {
	if store == nil {
		return 0, nil, errors.New("missing keyring")
	}
	version := requestedVersion
	if version <= 0 {
		version = store.keyring.Current
	}
	master, ok := store.keyring.Keys[version]
	if !ok || len(master) != 32 {
		return 0, nil, errors.New("invalid local authorization keyring")
	}
	mac := hmac.New(sha256.New, master)
	_, _ = mac.Write([]byte("redeven.localui." + label))
	return version, mac.Sum(nil), nil
}

func (store *localAuthorizationStore) encrypt(lookup string, generation int64, channelID, accessSessionID string, expiresAt int64, plain []byte) ([]byte, int, error) {
	version, key, err := store.keyForLabel("record")
	if err != nil {
		return nil, 0, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, 0, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, 0, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, 0, err
	}
	aad, err := localAuthorizationAAD(lookup, generation, channelID, accessSessionID, expiresAt, version)
	if err != nil {
		return nil, 0, err
	}
	return gcm.Seal(nonce, nonce, plain, aad), version, nil
}

func (store *localAuthorizationStore) decrypt(lookup string, generation int64, channelID, accessSessionID string, expiresAt int64, version int, ciphertext []byte) ([]byte, error) {
	if store == nil {
		return nil, errors.New("missing local authorization keyring")
	}
	return decryptWithRing(store.keyring, lookup, generation, channelID, accessSessionID, expiresAt, version, ciphertext)
}

func decryptWithRing(ring localAuthorizationKeyring, lookup string, generation int64, channelID, accessSessionID string, expiresAt int64, version int, ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 || len(ciphertext) > localAuthorizationMaxCiphertext {
		return nil, errors.New("invalid local authorization ciphertext")
	}
	master, ok := ring.Keys[version]
	if !ok || len(master) != 32 {
		return nil, errors.New("local authorization key version unavailable")
	}
	mac := hmac.New(sha256.New, master)
	_, _ = mac.Write([]byte("redeven.localui.record"))
	block, err := aes.NewCipher(mac.Sum(nil))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(ciphertext) < gcm.NonceSize() {
		return nil, errors.New("invalid local authorization envelope")
	}
	aad, err := localAuthorizationAAD(lookup, generation, channelID, accessSessionID, expiresAt, version)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():], aad)
}

func localAuthorizationAAD(lookup string, generation int64, channelID, accessSessionID string, expiresAt int64, version int) ([]byte, error) {
	var aad bytes.Buffer
	aad.WriteString("redeven.localui.authorization.v1")
	for _, value := range []string{lookup, channelID, accessSessionID} {
		if uint64(len(value)) > uint64(^uint32(0)) {
			return nil, errors.New("local authorization AAD field is too large")
		}
		if err := binary.Write(&aad, binary.BigEndian, uint32(len(value))); err != nil {
			return nil, err
		}
		if _, err := aad.WriteString(value); err != nil {
			return nil, err
		}
	}
	for _, value := range []int64{generation, expiresAt, int64(version)} {
		if err := binary.Write(&aad, binary.BigEndian, value); err != nil {
			return nil, err
		}
	}
	return aad.Bytes(), nil
}

func loadLocalAuthorizationKeyring(path string, allowCreate bool) (localAuthorizationKeyring, error) {
	path = filepath.Clean(path)
	if raw, err := os.ReadFile(path); err == nil {
		var ring localAuthorizationKeyring
		if json.Unmarshal(raw, &ring) != nil || validateLocalAuthorizationKeyring(ring) != nil {
			return localAuthorizationKeyring{}, errors.New("invalid local authorization keyring")
		}
		return ring, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return localAuthorizationKeyring{}, err
	}
	if !allowCreate {
		return localAuthorizationKeyring{}, errors.New("local authorization keyring is missing for an existing database")
	}
	master := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, master); err != nil {
		return localAuthorizationKeyring{}, err
	}
	ring := localAuthorizationKeyring{Current: localAuthorizationKeyVersion, Keys: map[int][]byte{localAuthorizationKeyVersion: master}}
	encoded, err := json.Marshal(ring)
	if err != nil {
		return localAuthorizationKeyring{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return localAuthorizationKeyring{}, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return loadLocalAuthorizationKeyring(path, false)
		}
		return localAuthorizationKeyring{}, err
	}
	if _, err := file.Write(encoded); err != nil {
		_ = file.Close()
		return localAuthorizationKeyring{}, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return localAuthorizationKeyring{}, err
	}
	if err := file.Close(); err != nil {
		return localAuthorizationKeyring{}, err
	}
	if err := syncLocalAuthorizationDirectory(filepath.Dir(path)); err != nil {
		return localAuthorizationKeyring{}, err
	}
	return ring, nil
}

func validateLocalAuthorizationKeyring(ring localAuthorizationKeyring) error {
	if ring.Current <= 0 || len(ring.Keys) == 0 {
		return errors.New("invalid local authorization keyring")
	}
	for version, key := range ring.Keys {
		if version <= 0 || len(key) != 32 {
			return errors.New("invalid local authorization keyring")
		}
	}
	if len(ring.Keys[ring.Current]) != 32 {
		return errors.New("invalid local authorization current key")
	}
	return nil
}

func syncLocalAuthorizationDirectory(path string) error {
	directory, err := os.Open(filepath.Clean(path))
	if err != nil {
		return err
	}
	defer func() { _ = directory.Close() }()
	return directory.Sync()
}

func persistLocalAuthorizationKeyring(path string, ring localAuthorizationKeyring) error {
	encoded, err := json.Marshal(ring)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".flowersec-authority-key-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(encoded); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	return syncLocalAuthorizationDirectory(filepath.Dir(path))
}

// RotateKey is intentionally explicit; callers can deploy a new key while
// retaining the old key for decrypt-only reads until all rows have expired.
func (store *localAuthorizationStore) RotateKey() error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var currentGeneration int64
	if err := store.db.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&currentGeneration); err != nil {
		return err
	}
	if currentGeneration != store.generation || currentGeneration <= 0 {
		return errors.New("local authorization store generation changed")
	}
	master := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, master); err != nil {
		return err
	}
	nextVersion := store.keyring.Current + 1
	nextRing := localAuthorizationKeyring{Current: nextVersion, Keys: make(map[int][]byte, len(store.keyring.Keys)+1)}
	for version, key := range store.keyring.Keys {
		nextRing.Keys[version] = append([]byte(nil), key...)
	}
	nextRing.Keys[nextVersion] = master
	previousRing := store.keyring
	store.keyring = nextRing
	if err := persistLocalAuthorizationKeyring(store.keyringPath, nextRing); err != nil {
		store.keyring = previousRing
		return err
	}
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := store.maintainTx(tx, time.Now()); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT lookup_key, record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s FROM local_authorization_records WHERE state IN ('pending','reserved','leased')`)
	if err != nil {
		return err
	}
	type row struct {
		lookup, channel, accessSessionID string
		ciphertext                       []byte
		version                          int
		generation, expiresAt            int64
	}
	var records []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.lookup, &item.ciphertext, &item.version, &item.channel, &item.accessSessionID, &item.generation, &item.expiresAt); err != nil {
			_ = rows.Close()
			return err
		}
		records = append(records, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range records {
		plain, err := decryptWithRing(previousRing, item.lookup, item.generation, item.channel, item.accessSessionID, item.expiresAt, item.version, item.ciphertext)
		if err != nil {
			return err
		}
		ciphertext, version, err := store.encrypt(item.lookup, item.generation, item.channel, item.accessSessionID, item.expiresAt, plain)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE local_authorization_records SET record_ciphertext = ?, key_version = ? WHERE lookup_key = ? AND key_version = ?`, ciphertext, version, item.lookup, item.version); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return store.retireUnusedKeysLocked()
}

func (store *localAuthorizationStore) maintain(now time.Time) error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var generation int64
	if err := tx.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&generation); err != nil {
		return err
	}
	if generation != store.generation || generation <= 0 {
		return errors.New("local authorization store generation changed")
	}
	if err := store.maintainTx(tx, now); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return store.retireUnusedKeysLocked()
}

func (store *localAuthorizationStore) maintainTx(tx *sql.Tx, now time.Time) error {
	if tx == nil {
		return errors.New("nil local authorization transaction")
	}
	if now.IsZero() {
		now = time.Now()
	}
	nowMS := now.UnixMilli()
	nowS := now.Unix()
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = 'revoked', terminal_at_unix_ms = ? WHERE state = 'pending' AND expires_at_unix_s <= ?`, nowMS, nowS); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE state = 'reserved' AND expires_at_unix_s <= ?`, nowMS, nowS); err != nil {
		return err
	}
	// A lease that never reached OnSession has an uncertain post-allow outcome.
	// Active sessions are closed by Flowersec and exact Release instead.
	if _, err := tx.Exec(`UPDATE local_authorization_records SET state = 'burned', terminal_at_unix_ms = ? WHERE state = 'leased' AND activated_at_unix_ms = 0 AND expires_at_unix_s <= ?`, nowMS, nowS); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE local_browser_spends
SET state = CASE WHEN expires_at_unix_s <= ? THEN 'expired' ELSE 'revoked' END
WHERE state = 'unspent' AND (
  expires_at_unix_s <= ? OR lookup_key IN (
    SELECT lookup_key FROM local_authorization_records WHERE state IN ('burned','released','revoked')
  )
)`, nowS, nowS); err != nil {
		return err
	}
	retentionMS := localAuthorizationRetention.Milliseconds()
	for {
		rows, err := tx.Query(`SELECT lookup_key
FROM local_authorization_records
WHERE state IN ('burned','released','revoked')
  AND terminal_at_unix_ms > 0
  AND ? >= max(expires_at_unix_s * 1000, terminal_at_unix_ms) + ?
ORDER BY terminal_at_unix_ms, lookup_key
LIMIT ?`, nowMS, retentionMS, localAuthorizationCleanupBatch)
		if err != nil {
			return err
		}
		lookups := make([]string, 0, localAuthorizationCleanupBatch)
		for rows.Next() {
			var lookup string
			if err := rows.Scan(&lookup); err != nil {
				_ = rows.Close()
				return err
			}
			lookups = append(lookups, lookup)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, lookup := range lookups {
			if _, err := tx.Exec(`DELETE FROM local_browser_spends WHERE lookup_key = ?`, lookup); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM local_authorization_records WHERE lookup_key = ? AND state IN ('burned','released','revoked')`, lookup); err != nil {
				return err
			}
		}
		if len(lookups) < localAuthorizationCleanupBatch {
			break
		}
	}
	return nil
}

func (store *localAuthorizationStore) ensureCapacityTx(tx *sql.Tx, incomingBytes int64) error {
	if tx == nil || incomingBytes < 0 || incomingBytes > localAuthorizationMaxLogicalBytes {
		return errLocalAuthorizationCapacity
	}
	pairs, logicalBytes, err := localAuthorizationCapacityUsageTx(tx)
	if err != nil {
		return err
	}
	if incomingBytes == 0 {
		if pairs > localAuthorizationMaxPairs || logicalBytes > localAuthorizationMaxLogicalBytes {
			return errLocalAuthorizationCapacity
		}
		return nil
	}
	if pairs >= localAuthorizationMaxPairs || logicalBytes > localAuthorizationMaxLogicalBytes-incomingBytes {
		return errLocalAuthorizationCapacity
	}
	return nil
}

func localAuthorizationCapacityUsageTx(tx *sql.Tx) (int64, int64, error) {
	var pairs, logicalBytes int64
	query := `SELECT COUNT(1), COALESCE(SUM(
  length(authority.lookup_key) + length(authority.record_ciphertext) + length(authority.channel_id) +
  length(authority.access_session_id) + max(length(authority.lease_id), 128) +
  length(spend.receipt_hmac) + length(spend.artifact_digest_b64u) + length(spend.projection_digest_b64u) +
  length(spend.launcher_origin) + length(spend.runtime_origin) + length(spend.app_origin) +
  length(spend.consumer) + length(spend.target_binding_json) + length(spend.spent_attempt_hmac)
), 0)
	FROM local_authorization_records AS authority
	JOIN local_browser_spends AS spend ON spend.lookup_key = authority.lookup_key`
	if err := tx.QueryRow(query).Scan(&pairs, &logicalBytes); err != nil {
		return 0, 0, err
	}
	return pairs, logicalBytes, nil
}

func localAuthorizationPairLogicalBytes(
	lookup string,
	ciphertext []byte,
	channelID, accessSessionID, leaseID string,
	receiptHMAC []byte,
	artifactDigest, projectionDigest, launcherOrigin, runtimeOrigin, appOrigin, consumer string,
	targetBinding, attemptHMAC []byte,
) int64 {
	leaseBytes := len(leaseID)
	if leaseBytes < 128 {
		leaseBytes = 128
	}
	return int64(len(lookup) + len(ciphertext) + len(channelID) + len(accessSessionID) + leaseBytes +
		len(receiptHMAC) + len(artifactDigest) + len(projectionDigest) + len(launcherOrigin) + len(runtimeOrigin) +
		len(appOrigin) + len(consumer) + len(targetBinding) + len(attemptHMAC))
}

func (store *localAuthorizationStore) retireUnusedKeysLocked() error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	referenced := map[int]struct{}{store.keyring.Current: {}}
	queries := []string{
		`SELECT DISTINCT key_version FROM local_authorization_records`,
		`SELECT DISTINCT receipt_key_version FROM local_browser_spends`,
		`SELECT DISTINCT attempt_key_version FROM local_browser_spends WHERE attempt_key_version > 0`,
	}
	for _, query := range queries {
		rows, err := store.db.Query(query)
		if err != nil {
			return err
		}
		for rows.Next() {
			var version int
			if err := rows.Scan(&version); err != nil {
				_ = rows.Close()
				return err
			}
			if _, ok := store.keyring.Keys[version]; !ok {
				_ = rows.Close()
				return fmt.Errorf("local authorization key version %d is unavailable", version)
			}
			referenced[version] = struct{}{}
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	if len(referenced) == len(store.keyring.Keys) {
		return nil
	}
	next := localAuthorizationKeyring{Current: store.keyring.Current, Keys: make(map[int][]byte, len(referenced))}
	for version := range referenced {
		next.Keys[version] = append([]byte(nil), store.keyring.Keys[version]...)
	}
	if err := persistLocalAuthorizationKeyring(store.keyringPath, next); err != nil {
		return err
	}
	store.keyring = next
	return nil
}

func (store *localAuthorizationStore) validateRetainedRows() error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := validateLocalAuthorizationKeyring(store.keyring); err != nil {
		return err
	}
	rows, err := store.db.Query(`SELECT lookup_key, record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s FROM local_authorization_records ORDER BY lookup_key`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var lookup, channelID, accessSessionID string
		var ciphertext []byte
		var keyVersion int
		var generation, expiresAt int64
		if err := rows.Scan(&lookup, &ciphertext, &keyVersion, &channelID, &accessSessionID, &generation, &expiresAt); err != nil {
			_ = rows.Close()
			return err
		}
		plain, err := decryptWithRing(store.keyring, lookup, generation, channelID, accessSessionID, expiresAt, keyVersion, ciphertext)
		if err != nil {
			_ = rows.Close()
			return err
		}
		if len(plain) == 0 || len(plain) > localAuthorizationMaxPlaintext {
			_ = rows.Close()
			return errors.New("invalid local authorization plaintext")
		}
		var secret localAuthorizationSecret
		if err := json.Unmarshal(plain, &secret); err != nil || len(secret.RecordEncoded) == 0 || len(secret.RecordEncoded) > localAuthorizationMaxRecord ||
			secret.Binding.ChannelID != channelID || secret.Binding.AccessSessionID != accessSessionID || secret.Binding.InitExpireAtUnixS != expiresAt {
			_ = rows.Close()
			return errors.New("invalid retained local authorization binding")
		}
		record, err := controlplane.ParseAuthorizationRecord(secret.RecordEncoded)
		if err != nil || record.LookupKey() != lookup {
			_ = rows.Close()
			return errors.New("invalid retained local authorization record")
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	keyRows, err := store.db.Query(`SELECT receipt_key_version, attempt_key_version, artifact_digest_b64u, projection_digest_b64u, target_binding_json FROM local_browser_spends`)
	if err != nil {
		return err
	}
	for keyRows.Next() {
		var receiptVersion, attemptVersion int
		var artifactDigest, projectionDigest string
		var targetBinding []byte
		if err := keyRows.Scan(&receiptVersion, &attemptVersion, &artifactDigest, &projectionDigest, &targetBinding); err != nil {
			_ = keyRows.Close()
			return err
		}
		if len(store.keyring.Keys[receiptVersion]) != 32 || (attemptVersion > 0 && len(store.keyring.Keys[attemptVersion]) != 32) ||
			!validB64u32(artifactDigest) || !validB64u32(projectionDigest) {
			_ = keyRows.Close()
			return errors.New("invalid retained local spend key reference")
		}
		canonical, err := canonicalLocalJSON(targetBinding)
		if err != nil || !bytes.Equal(canonical, targetBinding) {
			_ = keyRows.Close()
			return errors.New("invalid retained local spend binding")
		}
	}
	return keyRows.Close()
}

type LocalAuthorizationKeyRotationResult struct {
	PreviousVersion int `json:"previous_version"`
	CurrentVersion  int `json:"current_version"`
	RetainedKeys    int `json:"retained_keys"`
}

func RotateLocalAuthorizationKey(stateRoot string) (LocalAuthorizationKeyRotationResult, error) {
	stateRoot = filepath.Clean(strings.TrimSpace(stateRoot))
	if stateRoot == "" || stateRoot == "." {
		return LocalAuthorizationKeyRotationResult{}, errors.New("missing Local UI state root")
	}
	path := filepath.Join(stateRoot, localAuthorizationDatabaseFile)
	fresh, err := localAuthorizationDatabaseIsFresh(path)
	if err != nil {
		return LocalAuthorizationKeyRotationResult{}, err
	}
	if fresh {
		return LocalAuthorizationKeyRotationResult{}, errors.New("Local UI authorization store does not exist")
	}
	store, err := openLocalAuthorizationStore(path)
	if err != nil {
		return LocalAuthorizationKeyRotationResult{}, err
	}
	defer func() { _ = store.close() }()
	store.mu.Lock()
	previous := store.keyring.Current
	store.mu.Unlock()
	if err := store.RotateKey(); err != nil {
		return LocalAuthorizationKeyRotationResult{}, err
	}
	store.mu.Lock()
	result := LocalAuthorizationKeyRotationResult{PreviousVersion: previous, CurrentVersion: store.keyring.Current, RetainedKeys: len(store.keyring.Keys)}
	store.mu.Unlock()
	return result, nil
}

func digestB64u(value []byte) string {
	digest := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func canonicalLocalJSON(raw []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("multiple JSON values")
	}
	return json.Marshal(value)
}

func localProjectionJSON() string {
	// This is the single local issuer projection. The artifact remains opaque;
	// consumers validate this exact string through Floe's decoder-first API.
	return `{"scope":"proxy.runtime","scope_version":2,"critical":true,"payload":` + localProxyRuntimePayloadJSON() + `}`
}

func localProxyRuntimePayloadJSON() string {
	return `{"version":2,"mode":"service_worker","appBasePath":"/_redeven_proxy/env/","serviceWorker":{"scriptUrl":"/_redeven_proxy/env/_redeven_sw.js","scope":"/_redeven_proxy/env/"}}`
}

func localTargetBindingJSON() []byte {
	return []byte(`{"v":1,"kind":"env","env_public_id":"env_local","floe_app":"com.floegence.redeven.agent","launcher_kind":"env","launcher_id":"env_local"}`)
}

func (store *localAuthorizationStore) ensureOpen() error {
	if store == nil || store.db == nil {
		return errors.New("local authorization store is unavailable")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var generation int64
	if err := store.db.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&generation); err != nil {
		return err
	}
	if generation != store.generation || generation <= 0 {
		return errors.New("local authorization store generation changed")
	}
	return nil
}
