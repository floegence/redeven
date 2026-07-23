package redevpluginintegration

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
	"github.com/floegence/redevplugin/pkg/releasetrust"
)

const (
	releaseTrustStateSchemaKind    = "redevplugin_release_trust"
	releaseTrustStateSchemaVersion = 1
	emptyTrustStateSHA256          = "0000000000000000000000000000000000000000000000000000000000000000"
	localTrustedTimeKeyID          = "redeven_local_trusted_time"
	localTrustedTimeLogID          = "redeven_local_trusted_time_log"
)

type releaseTrustStore struct {
	db *sql.DB
}

func openReleaseTrustStore(filename string) (*releaseTrustStore, error) {
	db, err := sqliteutil.Open(filename, sqliteutil.Spec{
		Kind:           releaseTrustStateSchemaKind,
		CurrentVersion: releaseTrustStateSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=5000;`},
		Migrations: []sqliteutil.Migration{{FromVersion: 0, ToVersion: 1, Apply: func(tx *sql.Tx) error {
			_, err := tx.Exec(`
CREATE TABLE release_trust_state (
  source_id TEXT PRIMARY KEY,
  committed_state BLOB NOT NULL,
  committed_sha256 TEXT NOT NULL,
  pending_state BLOB NOT NULL,
  pending_sha256 TEXT NOT NULL,
  monotonic_counter INTEGER NOT NULL CHECK (monotonic_counter >= 0),
  monotonic_sha256 TEXT NOT NULL
);

CREATE TABLE trusted_time_leaves (
  sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
  leaf BLOB NOT NULL
);
`)
			return err
		}}},
		Verify: verifyReleaseTrustSchema,
	})
	if err != nil {
		return nil, err
	}
	return &releaseTrustStore{db: db}, nil
}

func verifyReleaseTrustSchema(tx *sql.Tx) error {
	checks := map[string][]string{
		"release_trust_state": {"source_id", "committed_state", "committed_sha256", "pending_state", "pending_sha256", "monotonic_counter", "monotonic_sha256"},
		"trusted_time_leaves": {"sequence", "leaf"},
	}
	for table, expected := range checks {
		columns, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, expected) {
			return fmt.Errorf("release trust table %s has unexpected columns", table)
		}
	}
	return nil
}

func (store *releaseTrustStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func (store *releaseTrustStore) ensureSource(ctx context.Context, sourceID string) error {
	if store == nil || store.db == nil {
		return errors.New("release trust store is closed")
	}
	_, err := store.db.ExecContext(ctx, `
INSERT INTO release_trust_state(
  source_id, committed_state, committed_sha256, pending_state, pending_sha256, monotonic_counter, monotonic_sha256
) VALUES (?, X'', ?, X'', ?, 0, ?)
ON CONFLICT(source_id) DO NOTHING
`, sourceID, emptyTrustStateSHA256, emptyTrustStateSHA256, emptyTrustStateSHA256)
	return err
}

func (store *releaseTrustStore) LoadSourceTrustState(ctx context.Context, request releasetrust.SourceTrustStateLoadRequest) (releasetrust.SourceTrustStateLoadResult, error) {
	if err := store.ensureSource(ctx, request.SourceID()); err != nil {
		return releasetrust.SourceTrustStateLoadResult{}, err
	}
	var committed, pending []byte
	if err := store.db.QueryRowContext(ctx, `
SELECT committed_state, pending_state FROM release_trust_state WHERE source_id = ?
`, request.SourceID()).Scan(&committed, &pending); err != nil {
		return releasetrust.SourceTrustStateLoadResult{}, err
	}
	return releasetrust.NewSourceTrustStateLoadResult(request, committed, pending)
}

func (store *releaseTrustStore) PrepareSourceTrustState(ctx context.Context, request releasetrust.SourceTrustStatePrepareRequest) (releasetrust.StateMutationOutcome, error) {
	pending := request.PendingBytes()
	if trustDigest(pending) != request.PendingSHA256() {
		return releasetrust.StateMutationConflict, nil
	}
	if err := store.ensureSource(ctx, request.SourceID()); err != nil {
		return "", err
	}
	result, err := store.db.ExecContext(ctx, `
UPDATE release_trust_state
SET pending_state = ?, pending_sha256 = ?
WHERE source_id = ?
  AND committed_sha256 = ?
  AND (length(pending_state) = 0 OR pending_sha256 = ?)
`, pending, request.PendingSHA256(), request.SourceID(), request.ExpectedCommittedSHA256(), request.PendingSHA256())
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return releasetrust.StateMutationUnknown, nil
	}
	if rows != 1 {
		return releasetrust.StateMutationConflict, nil
	}
	return releasetrust.StateMutationApplied, nil
}

func (store *releaseTrustStore) CommitSourceTrustState(ctx context.Context, request releasetrust.SourceTrustStateCommitRequest) (releasetrust.StateMutationOutcome, error) {
	next := request.NextStateBytes()
	if trustDigest(next) != request.NextStateSHA256() {
		return releasetrust.StateMutationConflict, nil
	}
	result, err := store.db.ExecContext(ctx, `
UPDATE release_trust_state
SET committed_state = ?, committed_sha256 = ?, pending_state = X'', pending_sha256 = ?
WHERE source_id = ? AND pending_sha256 = ? AND length(pending_state) > 0
`, next, request.NextStateSHA256(), emptyTrustStateSHA256, request.SourceID(), request.PendingSHA256())
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return releasetrust.StateMutationUnknown, nil
	}
	if rows != 1 {
		return releasetrust.StateMutationConflict, nil
	}
	return releasetrust.StateMutationApplied, nil
}

func (store *releaseTrustStore) ReadMonotonicState(ctx context.Context, request releasetrust.MonotonicStateReadRequest) (releasetrust.MonotonicStateReadResult, error) {
	if err := store.ensureSource(ctx, request.SourceID()); err != nil {
		return releasetrust.MonotonicStateReadResult{}, err
	}
	var counter uint64
	var digest string
	if err := store.db.QueryRowContext(ctx, `
SELECT monotonic_counter, monotonic_sha256 FROM release_trust_state WHERE source_id = ?
`, request.SourceID()).Scan(&counter, &digest); err != nil {
		return releasetrust.MonotonicStateReadResult{}, err
	}
	return releasetrust.NewMonotonicStateReadResult(request, counter, digest)
}

func (store *releaseTrustStore) CompareAndSwapMonotonicState(ctx context.Context, request releasetrust.MonotonicStateCASRequest) (releasetrust.StateMutationOutcome, error) {
	if request.NextCounter() != request.ExpectedCounter()+1 {
		return releasetrust.StateMutationConflict, nil
	}
	if err := store.ensureSource(ctx, request.SourceID()); err != nil {
		return "", err
	}
	result, err := store.db.ExecContext(ctx, `
UPDATE release_trust_state
SET monotonic_counter = ?, monotonic_sha256 = ?
WHERE source_id = ? AND monotonic_counter = ? AND monotonic_sha256 = ?
`, request.NextCounter(), request.NextSHA256(), request.SourceID(), request.ExpectedCounter(), request.PreviousSHA256())
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return releasetrust.StateMutationUnknown, nil
	}
	if rows != 1 {
		return releasetrust.StateMutationConflict, nil
	}
	return releasetrust.StateMutationApplied, nil
}

func (store *releaseTrustStore) trustedTimeLeaves(ctx context.Context) ([][]byte, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT leaf FROM trusted_time_leaves ORDER BY sequence ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var leaves [][]byte
	for rows.Next() {
		var leaf []byte
		if err := rows.Scan(&leaf); err != nil {
			return nil, err
		}
		leaves = append(leaves, slices.Clone(leaf))
	}
	return leaves, rows.Err()
}

func (store *releaseTrustStore) appendTrustedTimeLeaf(ctx context.Context, sequence int, leaf []byte) error {
	_, err := store.db.ExecContext(ctx, `INSERT INTO trusted_time_leaves(sequence, leaf) VALUES (?, ?)`, sequence, leaf)
	return err
}

type localTrustedTimeAdapter struct {
	mu         sync.Mutex
	store      *releaseTrustStore
	privateKey ed25519.PrivateKey
	now        func() time.Time
}

func newLocalTrustedTimeAdapter(store *releaseTrustStore, stateDir string, now func() time.Time) (*localTrustedTimeAdapter, error) {
	if store == nil || store.db == nil {
		return nil, errors.New("release trust store is required")
	}
	if now == nil {
		return nil, errors.New("trusted time clock is required")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(stateDir, 0o700); err != nil {
		return nil, err
	}
	key, err := loadOrCreateTrustedTimeKey(filepath.Join(stateDir, "ed25519-private.key"))
	if err != nil {
		return nil, err
	}
	return &localTrustedTimeAdapter{store: store, privateKey: key, now: now}, nil
}

func loadOrCreateTrustedTimeKey(filename string) (ed25519.PrivateKey, error) {
	load := func() (ed25519.PrivateKey, error) {
		value, err := os.ReadFile(filename)
		if err != nil {
			return nil, err
		}
		if len(value) != ed25519.PrivateKeySize {
			return nil, errors.New("trusted time private key has invalid size")
		}
		if err := os.Chmod(filename, 0o600); err != nil {
			return nil, err
		}
		return ed25519.PrivateKey(value), nil
	}
	if key, err := load(); err == nil {
		return key, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return load()
	}
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(key); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	return key, nil
}

func (adapter *localTrustedTimeAdapter) PublicKey() ed25519.PublicKey {
	if adapter == nil || len(adapter.privateKey) != ed25519.PrivateKeySize {
		return nil
	}
	return slices.Clone(adapter.privateKey.Public().(ed25519.PublicKey))
}

func (adapter *localTrustedTimeAdapter) Observe(ctx context.Context, request releasetrust.TrustedTimeRequest) (releasetrust.TrustedTimeObservation, error) {
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	leaves, err := adapter.store.trustedTimeLeaves(ctx)
	if err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	minimum, err := time.Parse(time.RFC3339Nano, request.MinimumTime())
	if err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	integrated := adapter.now().UTC().Truncate(time.Second)
	if !integrated.After(minimum) {
		integrated = minimum.Add(time.Nanosecond)
	}
	leaf := releasetrust.TrustedTimeLeafV1{
		SchemaVersion: releasetrust.TrustedTimeLeafSchemaVersion, SourceID: request.SourceTrustKey().SourceID(),
		Channel: request.SourceTrustKey().Channel(), Nonce: request.Nonce(), MinimumTime: request.MinimumTime(),
		ClaimedTime: integrated.Format(time.RFC3339Nano), RequestSHA256: request.RequestSHA256(), LogID: request.LogID(),
	}
	leafBytes, err := json.Marshal(leaf)
	if err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	leafHashes := make([][]byte, 0, len(leaves)+1)
	for _, previous := range leaves {
		leafHashes = append(leafHashes, trustMerkleLeafHash(previous))
	}
	leafHashes = append(leafHashes, trustMerkleLeafHash(leafBytes))
	treeSize := uint64(len(leafHashes))
	rootHash := trustMerkleRoot(leafHashes)
	checkpoint := releasetrust.TrustedTimeCheckpointV1{
		SchemaVersion: releasetrust.TrustedTimeCheckpointSchemaVersion, LogID: request.LogID(), TreeSize: treeSize,
		RootHash: hex.EncodeToString(rootHash), CheckpointTime: integrated.Format(time.RFC3339Nano), KeyID: localTrustedTimeKeyID,
	}
	checkpointPreimage, _ := json.Marshal(struct {
		Domain         string `json:"domain"`
		SchemaVersion  string `json:"schema_version"`
		LogID          string `json:"log_id"`
		TreeSize       uint64 `json:"tree_size"`
		RootHash       string `json:"root_hash"`
		CheckpointTime string `json:"checkpoint_time"`
		KeyID          string `json:"key_id"`
	}{
		Domain: "redevplugin.trusted-time.checkpoint.v1", SchemaVersion: checkpoint.SchemaVersion,
		LogID: checkpoint.LogID, TreeSize: checkpoint.TreeSize, RootHash: checkpoint.RootHash,
		CheckpointTime: checkpoint.CheckpointTime, KeyID: checkpoint.KeyID,
	})
	checkpoint.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(adapter.privateKey, checkpointPreimage))
	leafSHA256 := trustDigest(leafBytes)
	setPreimage, _ := json.Marshal(struct {
		Domain         string `json:"domain"`
		LeafSHA256     string `json:"leaf_sha256"`
		IntegratedTime string `json:"integrated_time"`
		LogID          string `json:"log_id"`
	}{
		Domain: "redevplugin.trusted-time.set.v1", LeafSHA256: leafSHA256,
		IntegratedTime: integrated.Format(time.RFC3339Nano), LogID: request.LogID(),
	})
	consistency := []string{}
	if len(leaves) != 0 {
		consistency = trustEncodeProof(trustMerkleConsistencyProof(leafHashes, len(leaves)))
	}
	evidence := releasetrust.TrustedTimeEvidenceV1{
		SchemaVersion: releasetrust.TrustedTimeEvidenceSchemaVersion, Kind: releasetrust.TrustedTimeEvidenceTransparency,
		Leaf: leaf, LeafSHA256: leafSHA256, IntegratedTime: integrated.Format(time.RFC3339Nano),
		SignedEntryTimestamp: base64.StdEncoding.EncodeToString(ed25519.Sign(adapter.privateKey, setPreimage)),
		Checkpoint:           checkpoint, LeafIndex: treeSize - 1,
		InclusionProof:   trustEncodeProof(trustMerkleInclusionProof(leafHashes, len(leafHashes)-1)),
		ConsistencyProof: consistency,
	}
	evidenceBytes, err := json.Marshal(evidence)
	if err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	if err := adapter.store.appendTrustedTimeLeaf(ctx, len(leaves)+1, leafBytes); err != nil {
		return releasetrust.TrustedTimeObservation{}, err
	}
	return releasetrust.NewTransparencyTimeObservation(request, evidenceBytes)
}

func trustDigest(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func trustMerkleLeafHash(value []byte) []byte {
	digest := sha256.Sum256(append([]byte{0}, value...))
	return digest[:]
}

func trustMerkleNodeHash(left, right []byte) []byte {
	value := make([]byte, 1, 1+len(left)+len(right))
	value[0] = 1
	value = append(value, left...)
	value = append(value, right...)
	digest := sha256.Sum256(value)
	return digest[:]
}

func trustMerkleRoot(leaves [][]byte) []byte {
	if len(leaves) == 1 {
		return slices.Clone(leaves[0])
	}
	k := trustLargestPowerOfTwoLessThan(len(leaves))
	return trustMerkleNodeHash(trustMerkleRoot(leaves[:k]), trustMerkleRoot(leaves[k:]))
}

func trustMerkleInclusionProof(leaves [][]byte, index int) [][]byte {
	if len(leaves) <= 1 {
		return nil
	}
	k := trustLargestPowerOfTwoLessThan(len(leaves))
	if index < k {
		return append(trustMerkleInclusionProof(leaves[:k], index), trustMerkleRoot(leaves[k:]))
	}
	return append(trustMerkleInclusionProof(leaves[k:], index-k), trustMerkleRoot(leaves[:k]))
}

func trustMerkleConsistencyProof(leaves [][]byte, oldSize int) [][]byte {
	if oldSize <= 0 || oldSize >= len(leaves) {
		return nil
	}
	return trustMerkleConsistencySubproof(leaves, oldSize, true)
}

func trustMerkleConsistencySubproof(leaves [][]byte, oldSize int, complete bool) [][]byte {
	if oldSize == len(leaves) {
		if complete {
			return nil
		}
		return [][]byte{trustMerkleRoot(leaves)}
	}
	k := trustLargestPowerOfTwoLessThan(len(leaves))
	if oldSize <= k {
		return append(trustMerkleConsistencySubproof(leaves[:k], oldSize, complete), trustMerkleRoot(leaves[k:]))
	}
	return append(trustMerkleConsistencySubproof(leaves[k:], oldSize-k, false), trustMerkleRoot(leaves[:k]))
}

func trustLargestPowerOfTwoLessThan(value int) int {
	result := 1
	for result<<1 < value {
		result <<= 1
	}
	return result
}

func trustEncodeProof(values [][]byte) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = hex.EncodeToString(value)
	}
	return result
}

var _ releasetrust.SourceTrustStateStore = (*releaseTrustStore)(nil)
var _ releasetrust.MonotonicStateAdapter = (*releaseTrustStore)(nil)
var _ releasetrust.TrustedTimeAdapter = (*localTrustedTimeAdapter)(nil)
