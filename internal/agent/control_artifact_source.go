package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/config"
)

type controlArtifactSource struct {
	agent *Agent
}

type controlArtifactSessionBinding struct {
	BindingGeneration int64
	Sequence          uint64
	ChannelID         string
}

const (
	artifactSpendLedgerVersion    = 1
	artifactSpendLedgerDirectory  = "flowersec-spend"
	artifactSpendLedgerMaxEntries = 65_536
	artifactSpendLedgerRetention  = time.Hour
)

type artifactSpendLedgerRecord struct {
	Version          int   `json:"version"`
	ExpiresAtUnixS   int64 `json:"expires_at_unix_s"`
	RetainUntilUnixS int64 `json:"retain_until_unix_s"`
}

func (source *controlArtifactSource) Acquire(ctx context.Context) (flowersec.ArtifactLease, *flowersec.ArtifactSourceError) {
	if source == nil || source.agent == nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(errors.New("missing control artifact source"))
	}
	if err := ctx.Err(); err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	entry, generation, err := source.agent.acquireControlArtifactEntry()
	if err != nil {
		return flowersec.ArtifactLease{}, classifyControlArtifactSourceError(err)
	}
	artifact, err := flowersec.ParseArtifact(entry.ArtifactJSON)
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(spendCtx context.Context) error {
		return source.agent.commitControlArtifactPoolSpend(spendCtx, generation, entry.Sequence, entry.ArtifactDigest, entry.ArtifactJSON, entry.ExpiresAtUnixS)
	})
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	return lease, nil
}

func classifyControlArtifactSourceError(err error) *flowersec.ArtifactSourceError {
	if err == nil {
		return flowersec.NewTerminalArtifactSourceError(errors.New("control artifact unavailable"))
	}
	// Exhausted/expired pools are terminal until the authenticated control
	// session performs a bounded top-up; retrying a fixed empty pool is noise.
	if errors.Is(err, errControlArtifactPoolDegraded) || errors.Is(err, errControlArtifactPoolEmpty) {
		return flowersec.NewTerminalArtifactSourceError(err)
	}
	return flowersec.NewTerminalArtifactSourceError(err)
}

var (
	errControlArtifactPoolDegraded       = errors.New("control artifact pool is degraded")
	errControlArtifactPoolEmpty          = errors.New("control artifact pool is exhausted")
	errControlArtifactPoolRelinkRequired = errors.New("control artifact pool requires relink")
)

func (a *Agent) acquireControlArtifactEntry() (config.ControlArtifactEntry, int64, error) {
	if a == nil {
		return config.ControlArtifactEntry{}, 0, errors.New("missing agent")
	}
	now := time.Now().Unix()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return config.ControlArtifactEntry{}, 0, errors.New("missing config")
	}
	if a.cfg.ControlArtifactPool == nil {
		if a.cfg.Direct == nil || len(a.cfg.Direct.ArtifactJSON) == 0 {
			return config.ControlArtifactEntry{}, 0, errControlArtifactPoolEmpty
		}
		// Legacy Direct envelopes have no Portal-side durable sequence/channel
		// authority. Preserve only a revoked digest tombstone and require relink.
		pool := config.NewControlArtifactPool(a.cfg.BindingGeneration)
		digest := sha256.Sum256(a.cfg.Direct.ArtifactJSON)
		pool.LogicalBindingID = "legacy-untrusted"
		pool.RecoveryState = config.ControlArtifactRecoveryRelink
		pool.Entries = append(pool.Entries, config.ControlArtifactEntry{
			Sequence:       1,
			ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
			ExpiresAtUnixS: a.cfg.Direct.ExpiresAtUnixS,
			Revoked:        true,
		})
		next := *a.cfg
		next.ControlArtifactPool = pool
		next.Direct = nil
		if err := config.Save(a.configPath, &next); err != nil {
			return config.ControlArtifactEntry{}, 0, fmt.Errorf("migrate control artifact pool: %w", err)
		}
		a.cfg = &next
		return config.ControlArtifactEntry{}, pool.BindingGeneration, errControlArtifactPoolEmpty
	}
	pool := a.cfg.ControlArtifactPool
	if pool.BindingGeneration != a.cfg.BindingGeneration {
		return config.ControlArtifactEntry{}, 0, errors.New("control artifact pool binding generation mismatch")
	}
	poolCopy := cloneControlArtifactPool(pool)
	changed, err := a.reconcileControlArtifactPoolSpendLedger(poolCopy)
	if err != nil {
		return config.ControlArtifactEntry{}, 0, fmt.Errorf("reconcile control artifact spend ledger: %w", err)
	}
	changed = normalizeControlArtifactPool(poolCopy, now) || changed
	if usableControlArtifactCount(poolCopy, now) < poolCopy.TargetWaterline && poolCopy.RecoveryState == config.ControlArtifactRecoveryReady {
		poolCopy.RecoveryState = config.ControlArtifactRecoveryDegraded
		changed = true
	}
	if changed {
		next := *a.cfg
		next.ControlArtifactPool = poolCopy
		if err := config.Save(a.configPath, &next); err != nil {
			return config.ControlArtifactEntry{}, 0, fmt.Errorf("persist normalized control artifact pool: %w", err)
		}
		a.cfg = &next
		pool = poolCopy
	}
	if pool.RecoveryState == config.ControlArtifactRecoveryRelink ||
		(pool.PendingTopUp != nil && pool.PendingTopUp.State == config.ControlArtifactTopUpTerminal) {
		return config.ControlArtifactEntry{}, pool.BindingGeneration, errControlArtifactPoolRelinkRequired
	}
	for _, entry := range pool.Entries {
		if entry.Spent || entry.Revoked || entry.ExpiresAtUnixS <= now+pool.RefreshHorizonSeconds {
			continue
		}
		if len(entry.ArtifactJSON) == 0 || len(entry.ArtifactJSON) > config.ControlArtifactMaxJSONBytes {
			continue
		}
		return cloneControlArtifactEntry(entry), pool.BindingGeneration, nil
	}
	if pool.RecoveryState != config.ControlArtifactRecoveryRelink && pool.RecoveryState != config.ControlArtifactRecoveryExhausted {
		next := *a.cfg
		nextPool := cloneControlArtifactPool(pool)
		nextPool.RecoveryState = config.ControlArtifactRecoveryExhausted
		next.ControlArtifactPool = nextPool
		if err := config.Save(a.configPath, &next); err != nil {
			return config.ControlArtifactEntry{}, pool.BindingGeneration, fmt.Errorf("persist exhausted control artifact pool: %w", err)
		}
		a.cfg = &next
	}
	return config.ControlArtifactEntry{}, pool.BindingGeneration, errControlArtifactPoolEmpty
}

func cloneControlArtifactEntry(entry config.ControlArtifactEntry) config.ControlArtifactEntry {
	entry.ArtifactJSON = append([]byte(nil), entry.ArtifactJSON...)
	return entry
}

func (a *Agent) commitControlArtifactPoolSpend(_ context.Context, bindingGeneration int64, sequence uint64, digest string, artifactJSON []byte, expiresAtUnixS int64) error {
	if a == nil {
		return errors.New("missing agent")
	}
	if err := a.commitSpendLedger(digest, artifactJSON, expiresAtUnixS); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || a.cfg.BindingGeneration != bindingGeneration {
		return errors.New("control artifact binding changed before spend commit")
	}
	next := *a.cfg
	pool := *a.cfg.ControlArtifactPool
	pool.Entries = make([]config.ControlArtifactEntry, len(a.cfg.ControlArtifactPool.Entries))
	copy(pool.Entries, a.cfg.ControlArtifactPool.Entries)
	found := false
	channelID := ""
	for index := range pool.Entries {
		entry := &pool.Entries[index]
		if entry.Sequence != sequence || entry.ArtifactDigest != digest || entry.ExpiresAtUnixS != expiresAtUnixS || !bytesEqual(entry.ArtifactJSON, artifactJSON) {
			continue
		}
		if entry.Spent {
			return errors.New("control artifact already spent")
		}
		entry.Spent = true
		entry.ArtifactJSON = nil
		channelID = entry.ChannelID
		found = true
		break
	}
	if !found {
		return errors.New("control artifact entry changed before spend commit")
	}
	next.ControlArtifactPool = &pool
	// Keep the retired Direct record as a spent tombstone for one release so
	// an interrupted config migration cannot make the old shape appear unused.
	if next.Direct != nil && bytesEqual(next.Direct.ArtifactJSON, artifactJSON) {
		directCopy := *next.Direct
		directCopy.Spent = true
		next.Direct = &directCopy
	}
	if err := config.Save(a.configPath, &next); err != nil {
		// The durable spend ledger already burned this artifact. Keep the
		// process-local pool from selecting it again even though config save failed.
		for index := range a.cfg.ControlArtifactPool.Entries {
			entry := &a.cfg.ControlArtifactPool.Entries[index]
			if entry.Sequence == sequence && entry.ArtifactDigest == digest {
				entry.Spent = true
				entry.ArtifactJSON = nil
			}
		}
		return err
	}
	a.cfg = &next
	a.controlArtifact = controlArtifactSessionBinding{
		BindingGeneration: bindingGeneration,
		Sequence:          sequence,
		ChannelID:         channelID,
	}
	return nil
}

func bytesEqual(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// commitDataArtifactSpend is the remote data-plane durable one-shot boundary.
// The ledger is create-new and fsynced before Connect can send any bytes.
func (a *Agent) commitDataArtifactSpend(_ context.Context, digest [32]byte, expiresAtUnixS int64) error {
	if a == nil {
		return errors.New("missing agent")
	}
	return a.createSpendLedgerEntry(digest, expiresAtUnixS)
}

func (a *Agent) commitSpendLedger(digest string, artifactJSON []byte, expiresAtUnixS int64) error {
	if len(artifactJSON) == 0 || len(artifactJSON) > config.ControlArtifactMaxJSONBytes {
		return errors.New("invalid artifact spend ledger input")
	}
	computed := sha256.Sum256(artifactJSON)
	if digest == "" || digest != base64.RawURLEncoding.EncodeToString(computed[:]) {
		return errors.New("artifact spend digest mismatch")
	}
	return a.createSpendLedgerEntry(computed, expiresAtUnixS)
}

func (a *Agent) createSpendLedgerEntry(digest [sha256.Size]byte, expiresAtUnixS int64) error {
	if a == nil {
		return errors.New("missing agent")
	}
	if expiresAtUnixS <= 0 {
		return errors.New("missing artifact expiry for spend ledger")
	}
	a.spendLedgerMu.Lock()
	defer a.spendLedgerMu.Unlock()
	dir, err := a.artifactSpendLedgerDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	remaining, removed, err := pruneArtifactSpendLedger(dir, time.Now().Unix())
	if err != nil {
		return err
	}
	if removed > 0 && a.log != nil {
		a.log.Info("pruned expired Flowersec spend ledger tombstones", "count", removed)
	}
	path := filepath.Join(dir, hex.EncodeToString(digest[:])+".spent")
	if _, err := os.Lstat(path); err == nil {
		return errors.New("artifact spend already committed")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if remaining >= artifactSpendLedgerMaxEntries {
		return errors.New("artifact spend ledger reached its fail-closed entry limit")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return errors.New("artifact spend already committed")
		}
		return err
	}
	defer func() { _ = file.Close() }()
	record := artifactSpendLedgerRecord{
		Version:          artifactSpendLedgerVersion,
		ExpiresAtUnixS:   expiresAtUnixS,
		RetainUntilUnixS: expiresAtUnixS + int64(artifactSpendLedgerRetention/time.Second),
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if _, err := file.Write(encoded); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	directory, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer func() { _ = directory.Close() }()
	return directory.Sync()
}

func (a *Agent) artifactSpendLedgerDir() (string, error) {
	root := strings.TrimSpace(a.stateDir)
	if root == "" {
		root = filepath.Dir(strings.TrimSpace(a.configPath))
	}
	if root == "" || root == "." {
		return "", errors.New("missing durable state directory")
	}
	return filepath.Join(root, artifactSpendLedgerDirectory), nil
}

func (a *Agent) hasArtifactSpendLedgerEntry(digest string) (bool, error) {
	digestBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(digest))
	if err != nil || len(digestBytes) != sha256.Size || base64.RawURLEncoding.EncodeToString(digestBytes) != digest {
		return false, errors.New("invalid artifact spend digest")
	}
	dir, err := a.artifactSpendLedgerDir()
	if err != nil {
		return false, err
	}
	path := filepath.Join(dir, hex.EncodeToString(digestBytes)+".spent")
	if _, err := os.Lstat(path); err == nil {
		return true, nil
	} else if errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else {
		return false, err
	}
}

func (a *Agent) reconcileControlArtifactPoolSpendLedger(pool *config.ControlArtifactPool) (bool, error) {
	if pool == nil {
		return false, nil
	}
	changed := false
	for index := range pool.Entries {
		entry := &pool.Entries[index]
		if entry.Spent || entry.Revoked {
			continue
		}
		spent, err := a.hasArtifactSpendLedgerEntry(entry.ArtifactDigest)
		if err != nil {
			return false, err
		}
		if spent {
			entry.Spent = true
			entry.ArtifactJSON = nil
			changed = true
		}
	}
	return changed, nil
}

func pruneArtifactSpendLedger(dir string, nowUnixS int64) (remaining, removed int, err error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0, err
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".spent") {
			remaining++
			continue
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return 0, 0, readErr
		}
		var record artifactSpendLedgerRecord
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&record); decodeErr != nil || record.Version != artifactSpendLedgerVersion || record.RetainUntilUnixS <= record.ExpiresAtUnixS {
			remaining++
			continue
		}
		var extra any
		if decodeErr := decoder.Decode(&extra); !errors.Is(decodeErr, io.EOF) {
			remaining++
			continue
		}
		if nowUnixS < record.RetainUntilUnixS {
			remaining++
			continue
		}
		if removeErr := os.Remove(path); removeErr != nil {
			return 0, 0, removeErr
		}
		removed++
	}
	if removed == 0 {
		return remaining, 0, nil
	}
	directory, err := os.Open(dir)
	if err != nil {
		return 0, 0, err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return 0, 0, err
	}
	return remaining, removed, nil
}
