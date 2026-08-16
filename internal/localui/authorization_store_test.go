package localui

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	flowercontrol "github.com/floegence/flowersec/flowersec-go/v2/controlplane"
)

func TestLocalAuthorizationStoreBootGenerationRevokesOldRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "authority.sqlite")
	store := newTestAuthorizationStore(t, path)
	issued, _, _ := issueTestAuthorization(t, store, "access-boot")
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	store, err := openLocalAuthorizationStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "revoked" {
		t.Fatalf("boot restart state = %q, want revoked", state)
	}
	var generation int64
	if err := store.db.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&generation); err != nil {
		t.Fatal(err)
	}
	if generation != 2 {
		t.Fatalf("boot generation = %d, want 2", generation)
	}
}

func TestLocalAuthorizationStoreConcurrentReserveHasOneWinner(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-race")
	const workers = 8
	results := make(chan error, workers)
	var group sync.WaitGroup
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			reserved, err := store.reserveLookup(issued.LookupKey())
			if err == nil {
				if reserved.LeaseID == "" {
					results <- errors.New("winner has no lease id")
					return
				}
				results <- nil
				return
			}
			results <- err
		}()
	}
	group.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("reserve winners = %d, want 1", winners)
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "reserved" {
		t.Fatalf("reserved state = %q, want reserved", state)
	}
}

func TestLocalAuthorizationStoreParseFailureBurnsReservedRow(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-burn")
	if _, err := store.db.Exec(`UPDATE local_authorization_records SET record_ciphertext = X'00' WHERE lookup_key = ?`, issued.LookupKey()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.reserveLookup(issued.LookupKey()); err == nil {
		t.Fatal("reserve corrupted record succeeded")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "burned" {
		t.Fatalf("corrupt record state = %q, want burned", state)
	}
}

func TestLocalAuthorizationStoreExpiredReserveConvergesToRevoked(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-expired")
	if _, err := store.db.Exec(`UPDATE local_authorization_records SET expires_at_unix_s = ? WHERE lookup_key = ?`, time.Now().Add(-time.Second).Unix(), issued.LookupKey()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.reserveLookup(issued.LookupKey()); err == nil {
		t.Fatal("expired authorization reserve succeeded")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "revoked" {
		t.Fatalf("expired authorization state = %q, want revoked", state)
	}
}

func TestLocalAuthorizationStoreHandlerFailureBurnsLeasedRow(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-handler-failure")
	reserved, err := store.reserveLookup(issued.LookupKey())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.markLeased(reserved.LookupKey, reserved.LeaseID); err != nil {
		t.Fatal(err)
	}
	if err := store.burnLeased(reserved.LookupKey); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "burned" {
		t.Fatalf("handler failure state = %q, want burned", state)
	}
}

func TestLocalAuthorizationStoreExactReleaseAndOwnerRevoke(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	first, _, _ := issueTestAuthorization(t, store, "access-release")
	second, _, _ := issueTestAuthorization(t, store, "access-release")
	reserved, err := store.reserveLookup(first.LookupKey())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.markLeased(reserved.LookupKey, reserved.LeaseID); err != nil {
		t.Fatal(err)
	}
	if err := store.markActivated(reserved.ChannelID); err != nil {
		t.Fatal(err)
	}
	if err := store.releaseChannel(reserved.ChannelID); err != nil {
		t.Fatal(err)
	}
	if err := store.releaseChannel(reserved.ChannelID); err != nil {
		t.Fatal("release should be idempotent:", err)
	}
	if _, err := store.reserveLookup(second.LookupKey()); err != nil {
		t.Fatal(err)
	}
	if err := store.revokeAccessSession("access-release"); err != nil {
		t.Fatal(err)
	}
	rows, err := store.db.Query(`SELECT state FROM local_authorization_records WHERE access_session_id = ? ORDER BY lookup_key`, "access-release")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var states []string
	for rows.Next() {
		var state string
		if err := rows.Scan(&state); err != nil {
			t.Fatal(err)
		}
		states = append(states, state)
	}
	if len(states) != 2 || !((states[0] == "released" && states[1] == "burned") || (states[0] == "burned" && states[1] == "released")) {
		t.Fatalf("owner revoke states = %#v, want released/burned", states)
	}
}

func TestLocalAuthorizationStoreSpendAttemptCASAndKeyRotation(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, receipt, expires := issueTestAuthorization(t, store, "access-spend")
	request := testSpendRequest(issued, receipt, expires, "attempt-one")
	if err := store.spend(request); err != nil {
		t.Fatal("first spend:", err)
	}
	if err := store.RotateKey(); err != nil {
		t.Fatal("RotateKey:", err)
	}
	if err := store.spend(request); err != nil {
		t.Fatal("same-attempt replay after key rotation:", err)
	}
	other := request
	other.AttemptID = testAttemptID("attempt-two")
	if err := store.spend(other); err == nil {
		t.Fatal("different attempt replay succeeded")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM local_browser_spends WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "spent" {
		t.Fatalf("spend state = %q, want spent", state)
	}
}

func TestLocalAuthorizationStoreRejectsFutureAndDriftedSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "authority.sqlite")
	store := newTestAuthorizationStore(t, path)
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`PRAGMA user_version = 99`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := openLocalAuthorizationStore(path); err == nil {
		t.Fatal("future schema opened successfully")
	}

	driftPath := filepath.Join(t.TempDir(), "drift.sqlite")
	store = newTestAuthorizationStore(t, driftPath)
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	raw, err = sql.Open("sqlite", driftPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`DROP TABLE local_browser_spends`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := openLocalAuthorizationStore(driftPath); err == nil {
		t.Fatal("drifted schema opened successfully")
	}
}

func TestLocalAuthorizationStoreRejectsConstraintDrift(t *testing.T) {
	path := filepath.Join(t.TempDir(), "constraint-drift.sqlite")
	store := newTestAuthorizationStore(t, path)
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`PRAGMA writable_schema=ON`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE sqlite_master SET sql = replace(sql, 'record_ciphertext BLOB NOT NULL', 'record_ciphertext TEXT NOT NULL') WHERE type = 'table' AND name = 'local_authorization_records'`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`PRAGMA writable_schema=OFF`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := openLocalAuthorizationStore(path); err == nil {
		t.Fatal("constraint-drifted schema opened successfully")
	}
}

func TestLocalAuthorizationStoreMissingKeyFailsClosed(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "authority.sqlite")
	store := newTestAuthorizationStore(t, path)
	issueTestAuthorization(t, store, "access-missing-key")
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(directory, localAuthorizationKeyringFile)
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	if _, err := openLocalAuthorizationStore(path); err == nil {
		t.Fatal("existing authority database opened without its keyring")
	}
	if _, err := os.Stat(keyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing keyring was recreated: %v", err)
	}
}

func TestLocalAuthorizationStoreRejectsUnexpectedSchemaObjects(t *testing.T) {
	for name, statement := range map[string]string{
		"trigger": `CREATE TRIGGER unexpected_authority_trigger AFTER UPDATE ON local_authorization_boot BEGIN SELECT 1; END`,
		"view":    `CREATE VIEW unexpected_authority_view AS SELECT lookup_key FROM local_authorization_records`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "authority.sqlite")
			store := newTestAuthorizationStore(t, path)
			if err := store.close(); err != nil {
				t.Fatal(err)
			}
			raw, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(statement); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := openLocalAuthorizationStore(path); err == nil {
				t.Fatalf("database with unexpected %s opened", name)
			}
		})
	}
}

func TestLocalAuthorizationStoreOwnerBindingTamperBurnsLease(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-owner")
	if _, err := store.db.Exec(`UPDATE local_authorization_records SET access_session_id = 'access-other' WHERE lookup_key = ?`, issued.LookupKey()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.reserveLookup(issued.LookupKey()); err == nil {
		t.Fatal("authorization with tampered owner binding was reserved")
	}
	var authorityState, spendState string
	if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&authorityState); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT state FROM local_browser_spends WHERE lookup_key = ?`, issued.LookupKey()).Scan(&spendState); err != nil {
		t.Fatal(err)
	}
	if authorityState != "burned" || spendState != "revoked" {
		t.Fatalf("tampered states = %q/%q, want burned/revoked", authorityState, spendState)
	}
}

func TestLocalAuthorizationStoreGenerationFenceRejectsStaleOpener(t *testing.T) {
	path := filepath.Join(t.TempDir(), "authority.sqlite")
	first := newTestAuthorizationStore(t, path)
	defer first.close()
	issued, receipt, expires := issueTestAuthorization(t, first, "access-generation")
	second, err := openLocalAuthorizationStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.close()
	if err := first.ensureOpen(); err == nil {
		t.Fatal("stale store reported open")
	}
	if err := first.RotateKey(); err == nil {
		t.Fatal("stale store rotated the keyring")
	}
	spendErr := first.spend(testSpendRequest(issued, receipt, expires, "stale-spend"))
	var typed *localSpendError
	if !errors.As(spendErr, &typed) || typed.Status != 503 {
		t.Fatalf("stale spend error = %v, want authority unavailable", spendErr)
	}
}

func TestLocalAuthorizationStoreBootConvergesEveryActiveState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "authority.sqlite")
	store := newTestAuthorizationStore(t, path)
	pending, _, _ := issueTestAuthorization(t, store, "access-pending")
	reserved, _, _ := issueTestAuthorization(t, store, "access-reserved")
	leased, leasedReceipt, leasedExpires := issueTestAuthorization(t, store, "access-leased")
	reservedLease, err := store.reserveLookup(reserved.LookupKey())
	if err != nil {
		t.Fatal(err)
	}
	leasedLease, err := store.reserveLookup(leased.LookupKey())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.markLeased(leasedLease.LookupKey, leasedLease.LeaseID); err != nil {
		t.Fatal(err)
	}
	if err := store.markActivated(leasedLease.ChannelID); err != nil {
		t.Fatal(err)
	}
	if err := store.spend(testSpendRequest(leased, leasedReceipt, leasedExpires, "boot-spend")); err != nil {
		t.Fatal(err)
	}
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	store, err = openLocalAuthorizationStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()
	wantStates := map[string]string{
		pending.LookupKey():  "revoked",
		reserved.LookupKey(): "burned",
		leased.LookupKey():   "burned",
	}
	for lookup, want := range wantStates {
		var state string
		if err := store.db.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, lookup).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state != want {
			t.Fatalf("boot state for %s = %q, want %q", lookup, state, want)
		}
	}
	var leaseID string
	if err := store.db.QueryRow(`SELECT lease_id FROM local_authorization_records WHERE lookup_key = ?`, reserved.LookupKey()).Scan(&leaseID); err != nil {
		t.Fatal(err)
	}
	if leaseID != reservedLease.LeaseID {
		t.Fatalf("reserved lease id = %q, want retained exact lease", leaseID)
	}
	var spendState string
	if err := store.db.QueryRow(`SELECT state FROM local_browser_spends WHERE lookup_key = ?`, leased.LookupKey()).Scan(&spendState); err != nil {
		t.Fatal(err)
	}
	if spendState != "spent" {
		t.Fatalf("spent state after boot = %q, want spent", spendState)
	}
}

func TestLocalAuthorizationStoreValidationFailureDoesNotAdvanceBoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "authority.sqlite")
	store := newTestAuthorizationStore(t, path)
	issued, _, _ := issueTestAuthorization(t, store, "access-invalid-boot")
	if err := store.close(); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`UPDATE local_authorization_records SET access_session_id = 'tampered' WHERE lookup_key = ?`, issued.LookupKey()); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := openLocalAuthorizationStore(path); err == nil {
		t.Fatal("store with invalid encrypted binding opened")
	}
	raw, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var generation int64
	var state string
	if err := raw.QueryRow(`SELECT boot_generation FROM local_authorization_boot WHERE singleton = 1`).Scan(&generation); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT state FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if generation != 1 || state != "pending" {
		t.Fatalf("failed open changed generation/state to %d/%q", generation, state)
	}
}

func TestLocalAuthorizationStoreExactLeaseReplayAndTimestamps(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, _ := issueTestAuthorization(t, store, "access-exact-release")
	reserved, err := store.reserveLookup(issued.LookupKey())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.markLeased(reserved.LookupKey, reserved.LeaseID); err != nil {
		t.Fatal(err)
	}
	if err := store.markActivated(reserved.ChannelID); err != nil {
		t.Fatal(err)
	}
	for replay := 0; replay < 2; replay++ {
		channelID, err := store.releaseLease(reserved.LeaseID)
		if err != nil {
			t.Fatal(err)
		}
		if channelID != reserved.ChannelID {
			t.Fatalf("release replay channel = %q, want %q", channelID, reserved.ChannelID)
		}
	}
	var state, leaseID string
	var reservedAt, leasedAt, activatedAt, terminalAt int64
	if err := store.db.QueryRow(`SELECT state, lease_id, reserved_at_unix_ms, leased_at_unix_ms, activated_at_unix_ms, terminal_at_unix_ms FROM local_authorization_records WHERE lookup_key = ?`, issued.LookupKey()).Scan(&state, &leaseID, &reservedAt, &leasedAt, &activatedAt, &terminalAt); err != nil {
		t.Fatal(err)
	}
	if state != "released" || leaseID != reserved.LeaseID || reservedAt <= 0 || leasedAt < reservedAt || activatedAt < leasedAt || terminalAt < activatedAt {
		t.Fatalf("invalid released row: state=%q lease=%q timestamps=%d/%d/%d/%d", state, leaseID, reservedAt, leasedAt, activatedAt, terminalAt)
	}
}

func TestLocalAuthorizationStoreRetentionDeletesPairsAndRetiresKeys(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	issued, _, expires := issueTestAuthorization(t, store, "access-retention")
	if err := store.RotateKey(); err != nil {
		t.Fatal(err)
	}
	if err := store.releaseChannel(issuedChannelID(issued)); err != nil {
		t.Fatal(err)
	}
	if err := store.maintain(expires.Add(59 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(1) FROM local_authorization_records`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("retention removed row early: count=%d", count)
	}
	if err := store.maintain(expires.Add(61 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT COUNT(1) FROM local_authorization_records`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("retention kept expired terminal row: count=%d", count)
	}
	store.mu.Lock()
	retainedKeys := len(store.keyring.Keys)
	store.mu.Unlock()
	if retainedKeys != 1 {
		t.Fatalf("retained keys = %d, want current key only", retainedKeys)
	}
}

func TestLocalAuthorizationStorePhysicalAndPairCapacityLimits(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	var pageSize, maxPageCount int
	if err := store.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`PRAGMA max_page_count`).Scan(&maxPageCount); err != nil {
		t.Fatal(err)
	}
	if pageSize != localAuthorizationPageSize || maxPageCount != localAuthorizationMaxPageCount {
		t.Fatalf("physical limits = %d/%d, want %d/%d", pageSize, maxPageCount, localAuthorizationPageSize, localAuthorizationMaxPageCount)
	}
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	recordStatement, err := tx.Prepare(`INSERT INTO local_authorization_records(lookup_key, record_ciphertext, key_version, channel_id, access_session_id, generation, expires_at_unix_s, state, lease_id, created_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		t.Fatal(err)
	}
	defer recordStatement.Close()
	spendStatement, err := tx.Prepare(`INSERT INTO local_browser_spends(receipt_hmac, lookup_key, receipt_key_version, artifact_digest_b64u, projection_digest_b64u, launcher_origin, runtime_origin, app_origin, consumer, target_binding_json, expires_at_unix_s, state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		t.Fatal(err)
	}
	defer spendStatement.Close()
	expiresAt := time.Now().Add(time.Hour).Unix()
	createdAt := time.Now().UnixMilli()
	for index := 0; index < localAuthorizationMaxPairs; index++ {
		digest := sha256.Sum256([]byte(fmt.Sprintf("capacity-%d", index)))
		lookup := base64.RawURLEncoding.EncodeToString(digest[:])
		channelID := fmt.Sprintf("capacity-channel-%d", index)
		if _, err := recordStatement.Exec(lookup, []byte{1}, store.keyring.Current, channelID, "capacity-access", store.generation, expiresAt, "pending", "", createdAt); err != nil {
			t.Fatal(err)
		}
		if _, err := spendStatement.Exec(digest[:], lookup, store.keyring.Current, lookup, digestB64u([]byte("projection")), "https://local.example", "https://local.example", "https://local.example", "trusted", []byte(`{}`), expiresAt, "unspent"); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.ensureCapacityTx(tx, 1); !errors.Is(err, errLocalAuthorizationCapacity) {
		t.Fatalf("capacity error = %v, want hard pair limit", err)
	}
}

func TestLocalAuthorizationStoreConcurrentSpendAndRotation(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	const artifacts = 12
	requests := make([]localSpendRequest, 0, artifacts)
	for index := 0; index < artifacts; index++ {
		issued, receipt, expires := issueTestAuthorization(t, store, fmt.Sprintf("access-race-%d", index))
		requests = append(requests, testSpendRequest(issued, receipt, expires, fmt.Sprintf("attempt-%d", index)))
	}
	results := make(chan error, artifacts+4)
	var group sync.WaitGroup
	for _, request := range requests {
		request := request
		group.Add(1)
		go func() {
			defer group.Done()
			results <- store.spend(request)
		}()
	}
	for index := 0; index < 4; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			results <- store.RotateKey()
		}()
	}
	group.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestLocalAuthorizationCiphertextSupportsMaximumPlaintext(t *testing.T) {
	store := newTestAuthorizationStore(t, filepath.Join(t.TempDir(), "authority.sqlite"))
	defer store.close()
	plain := make([]byte, localAuthorizationMaxPlaintext)
	expiresAt := time.Now().Add(time.Minute).Unix()
	store.mu.Lock()
	ciphertext, version, err := store.encrypt("lookup", store.generation, "channel", "access", expiresAt, plain)
	if err == nil {
		_, err = store.decrypt("lookup", store.generation, "channel", "access", expiresAt+1, version, ciphertext)
	}
	store.mu.Unlock()
	if err == nil {
		t.Fatal("decrypt unexpectedly accepted mismatched expiry AAD")
	}
	store.mu.Lock()
	ciphertext, version, err = store.encrypt("lookup", store.generation, "channel", "access", expiresAt, plain)
	if err == nil {
		var decoded []byte
		decoded, err = store.decrypt("lookup", store.generation, "channel", "access", expiresAt, version, ciphertext)
		if err == nil && len(decoded) != len(plain) {
			err = fmt.Errorf("decoded length = %d, want %d", len(decoded), len(plain))
		}
	}
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if len(ciphertext) > localAuthorizationMaxCiphertext {
		t.Fatalf("ciphertext length = %d, max = %d", len(ciphertext), localAuthorizationMaxCiphertext)
	}
}

func newTestAuthorizationStore(t *testing.T, path string) *localAuthorizationStore {
	t.Helper()
	store, err := openLocalAuthorizationStore(path)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func issueTestAuthorization(t *testing.T, store *localAuthorizationStore, accessSessionID string) (flowercontrol.IssuedArtifact, string, time.Time) {
	t.Helper()
	endpoints, err := flowercontrol.NewEndpointSet("wss://example.com/flowersec/v2/direct")
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(4 * time.Minute).Truncate(time.Second)
	issued, err := flowercontrol.NewIssuer().IssueDirect(flowercontrol.DirectIssueOptions{
		Session:   flowercontrol.SessionOptions{ChannelID: "local-test-" + accessSessionID + "-" + randomTestToken(), ExpiresAt: expires},
		Endpoints: endpoints, RendezvousGroupID: "local-test", ListenerAudience: "local-test", UpstreamAddress: "127.0.0.1:1",
	})
	if err != nil {
		t.Fatal(err)
	}
	pending := pendingDirect{accessSessionID: accessSessionID, initExpireAtUnixS: expires.Unix(), traceID: "test"}
	receipt, err := store.issue(issued.AuthorizationRecord(), pending, issuedChannelID(issued), accessSessionID, expires, digestB64u(issued.ArtifactJSON()), digestB64u([]byte(`{"scope":"proxy.runtime"}`)), "https://local.example", []byte(`{"env_public_id":"test"}`))
	if err != nil {
		t.Fatal(err)
	}
	return issued, receipt, expires
}

func issuedChannelID(issued flowercontrol.IssuedArtifact) string {
	// The test issuer uses the channel encoded in the artifact; the store only
	// needs a stable channel key, so derive one from the non-secret lookup key.
	return "channel-" + issued.LookupKey()[:16]
}

func testSpendRequest(issued flowercontrol.IssuedArtifact, receipt string, expires time.Time, attempt string) localSpendRequest {
	return localSpendRequest{
		AttemptID: attemptIDForTest(attempt), Receipt: receipt,
		ArtifactDigestB64u: digestB64u(issued.ArtifactJSON()), ProjectionDigestB64u: digestB64u([]byte(`{"scope":"proxy.runtime"}`)),
		LauncherOrigin: "https://local.example", RuntimeOrigin: "https://local.example", AppOrigin: "https://local.example", Consumer: "trusted",
		TargetBinding: []byte(`{"env_public_id":"test"}`), ExpiresAt: expires.UTC().Format(time.RFC3339Nano),
	}
}

func attemptIDForTest(seed string) string {
	digest := sha256.Sum256([]byte(seed))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func testAttemptID(seed string) string { return attemptIDForTest(seed) }

func randomTestToken() string {
	return base64.RawURLEncoding.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
}
