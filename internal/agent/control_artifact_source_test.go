package agent

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/config"
)

const controlArtifactFixture = `{"v":2,"profile":"flowersec/2","session":{"channel_id":"channel-1","init_expire_at_unix_s":4102444800,"idle_timeout_seconds":60,"establish_timeout_seconds":30,"rekey_prepare_timeout_seconds":10,"rekey_completion_timeout_seconds":30,"max_inbound_streams":64,"e2ee_psk_b64u":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA","allowed_suites":[1,2],"default_suite":1,"selected_features":0,"contract_hash_b64u":"ioBJP5DPhg471caMR-huV5I9RlNKY2Pr9fs2GkP8CmA"},"path":{"kind":"direct","rendezvous_group_id":"group-1","listener_audience":"listener-1","routing_token":"routing-token","candidates":[{"id":"w1","carrier":"websocket","url":"wss://example.com/flowersec/v2/direct","wire_profile":"flowersec-direct/2"}]},"scoped":[],"correlation":{"v":2,"tags":[]}}`

func TestControlArtifactSourceUsesPublishedFlowersecLeaseAndPersistsSpend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	digest := sha256.Sum256([]byte(controlArtifactFixture))
	cfg := &config.Config{
		BindingGeneration: 7,
		ControlArtifactPool: &config.ControlArtifactPool{
			SchemaVersion:         config.ControlArtifactPoolSchemaVersion,
			LogicalBindingID:      "provider-binding-1",
			TargetWaterline:       config.ControlArtifactTargetWaterline,
			RefreshHorizonSeconds: config.ControlArtifactRefreshHorizonS,
			BindingGeneration:     7,
			RecoveryState:         config.ControlArtifactRecoveryReady,
			Entries: []config.ControlArtifactEntry{{
				Sequence:       1,
				ArtifactJSON:   []byte(controlArtifactFixture),
				ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
				ChannelID:      "control-channel-1",
				ExpiresAtUnixS: time.Now().Add(5 * time.Minute).Unix(),
			}},
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	a := &Agent{cfg: cfg, configPath: path}
	source := &controlArtifactSource{agent: a}
	var _ flowersec.ArtifactSource = source
	if _, sourceErr := source.Acquire(context.Background()); sourceErr != nil {
		t.Fatalf("Acquire() error = %v", sourceErr)
	}
	if err := a.commitControlArtifactPoolSpend(context.Background(), 7, 1, base64.RawURLEncoding.EncodeToString(digest[:]), []byte(controlArtifactFixture), cfg.ControlArtifactPool.Entries[0].ExpiresAtUnixS); err != nil {
		t.Fatalf("commitControlArtifactSpend() error = %v", err)
	}
	restarted, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.ControlArtifactPool == nil || len(restarted.ControlArtifactPool.Entries) != 1 ||
		!restarted.ControlArtifactPool.Entries[0].Spent || len(restarted.ControlArtifactPool.Entries[0].ArtifactJSON) != 0 {
		t.Fatalf("control artifact spend was not persisted: %#v", restarted.ControlArtifactPool)
	}
	if _, sourceErr := source.Acquire(context.Background()); sourceErr == nil ||
		sourceErr.RetryDisposition().Kind != flowersec.RetryDispositionTerminal {
		t.Fatalf("Acquire() spent artifact error = %v, want terminal", sourceErr)
	}
}

func TestControlArtifactSpendRejectsStaleBinding(t *testing.T) {
	a := &Agent{cfg: &config.Config{
		BindingGeneration: 8,
	}, configPath: filepath.Join(t.TempDir(), "config.json")}
	if err := a.commitControlArtifactPoolSpend(context.Background(), 7, 1, "digest", []byte(controlArtifactFixture), time.Now().Add(time.Minute).Unix()); err == nil {
		t.Fatal("commitControlArtifactSpend() error = nil, want stale binding rejection")
	}
}

func TestArtifactSpendLedgerUsesOneDigestAcrossDataAndControl(t *testing.T) {
	artifact := []byte(controlArtifactFixture)
	digest := sha256.Sum256(artifact)
	expiresAt := time.Now().Add(5 * time.Minute).Unix()
	first := &Agent{stateDir: t.TempDir()}
	if err := first.commitDataArtifactSpend(context.Background(), digest, expiresAt); err != nil {
		t.Fatal(err)
	}
	if err := first.commitSpendLedger(base64.RawURLEncoding.EncodeToString(digest[:]), artifact, expiresAt); err == nil {
		t.Fatal("control wrapper reused a data-plane artifact digest")
	}

	second := &Agent{stateDir: t.TempDir()}
	if err := second.commitSpendLedger(base64.RawURLEncoding.EncodeToString(digest[:]), artifact, expiresAt); err != nil {
		t.Fatal(err)
	}
	if err := second.commitDataArtifactSpend(context.Background(), digest, expiresAt); err == nil {
		t.Fatal("data wrapper reused a control-plane artifact digest")
	}
}

func TestArtifactSpendCallbacksBurnAfterContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	artifact := []byte(controlArtifactFixture)
	digest := sha256.Sum256(artifact)
	expiresAt := time.Now().Add(5 * time.Minute).Unix()

	t.Run("data", func(t *testing.T) {
		a := &Agent{stateDir: t.TempDir()}
		if err := a.commitDataArtifactSpend(ctx, digest, expiresAt); err != nil {
			t.Fatalf("commitDataArtifactSpend() error = %v", err)
		}
		if err := a.commitDataArtifactSpend(context.Background(), digest, expiresAt); err == nil {
			t.Fatal("canceled callback did not leave a durable data spend tombstone")
		}
	})

	t.Run("control", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, "config.json")
		encodedDigest := base64.RawURLEncoding.EncodeToString(digest[:])
		cfg := poolTestConfig(path, []config.ControlArtifactEntry{{
			Sequence:       1,
			ArtifactJSON:   artifact,
			ArtifactDigest: encodedDigest,
			ChannelID:      "canceled-control-channel",
			ExpiresAtUnixS: expiresAt,
		}})
		if err := config.Save(path, cfg); err != nil {
			t.Fatal(err)
		}
		a := &Agent{cfg: cfg, configPath: path, stateDir: root}
		if err := a.commitControlArtifactPoolSpend(ctx, cfg.BindingGeneration, 1, encodedDigest, artifact, expiresAt); err != nil {
			t.Fatalf("commitControlArtifactPoolSpend() error = %v", err)
		}
		persisted, err := config.Load(path)
		if err != nil {
			t.Fatal(err)
		}
		if persisted.ControlArtifactPool == nil || len(persisted.ControlArtifactPool.Entries) != 1 ||
			!persisted.ControlArtifactPool.Entries[0].Spent || len(persisted.ControlArtifactPool.Entries[0].ArtifactJSON) != 0 {
			t.Fatalf("canceled callback did not persist control spend: %#v", persisted.ControlArtifactPool)
		}
	})
}

func TestControlArtifactSourceReconcilesLedgerAfterConfigSaveFailure(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	blockedPath := filepath.Join(root, "blocked-config-path")
	if err := os.Mkdir(blockedPath, 0o700); err != nil {
		t.Fatal(err)
	}
	firstRaw, firstChannel := issuePoolTestArtifact(t, "restart-first")
	secondRaw, secondChannel := issuePoolTestArtifact(t, "restart-second")
	expiresAt := time.Now().Add(4 * time.Minute).Unix()
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{
		{Sequence: 1, ArtifactJSON: firstRaw, ArtifactDigest: digestB64uForTest(firstRaw), ChannelID: firstChannel, ExpiresAtUnixS: expiresAt},
		{Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: secondChannel, ExpiresAtUnixS: expiresAt},
	})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	first := &Agent{cfg: cfg, configPath: blockedPath, stateDir: root}
	if err := first.commitControlArtifactPoolSpend(context.Background(), 7, 1, digestB64uForTest(firstRaw), firstRaw, expiresAt); err == nil {
		t.Fatal("commit succeeded despite injected config rename failure")
	}

	stale, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if stale.ControlArtifactPool.Entries[0].Spent {
		t.Fatal("stale config unexpectedly recorded the first spend")
	}
	restarted := &Agent{cfg: stale, configPath: path, stateDir: root}
	entry, generation, err := restarted.acquireControlArtifactEntry()
	if err != nil {
		t.Fatal(err)
	}
	if generation != 7 || entry.Sequence != 2 {
		t.Fatalf("restarted Acquire() = generation %d sequence %d, want 7/2", generation, entry.Sequence)
	}
	persisted, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.ControlArtifactPool.Entries[0].Spent || len(persisted.ControlArtifactPool.Entries[0].ArtifactJSON) != 0 {
		t.Fatalf("ledger reconciliation did not persist a tombstone: %#v", persisted.ControlArtifactPool.Entries[0])
	}
}

func TestArtifactSpendLedgerPrunesOnlyPastRetention(t *testing.T) {
	root := t.TempDir()
	a := &Agent{stateDir: root}
	oldDigest := sha256.Sum256([]byte("expired-artifact"))
	if err := a.createSpendLedgerEntry(oldDigest, time.Now().Add(-2*artifactSpendLedgerRetention).Unix()); err != nil {
		t.Fatal(err)
	}
	liveDigest := sha256.Sum256([]byte("live-artifact"))
	if err := a.createSpendLedgerEntry(liveDigest, time.Now().Add(time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(root, artifactSpendLedgerDirectory))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != fmt.Sprintf("%x.spent", liveDigest) {
		t.Fatalf("spend ledger entries = %#v, want only live digest", entries)
	}
}

func TestControlArtifactSourceRevokesLegacyDirectAndRequiresRelink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &config.Config{
		BindingGeneration: 7,
		Direct:            &config.DirectConnectInfo{ArtifactJSON: []byte(controlArtifactFixture), ExpiresAtUnixS: 4102444800},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path}
	source := &controlArtifactSource{agent: a}
	if _, sourceErr := source.Acquire(context.Background()); sourceErr == nil || sourceErr.RetryDisposition().Kind != flowersec.RetryDispositionTerminal {
		t.Fatalf("legacy Direct Acquire() error = %v, want terminal relink", sourceErr)
	}
	restarted, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Direct != nil || restarted.ControlArtifactPool == nil || restarted.ControlArtifactPool.RecoveryState != config.ControlArtifactRecoveryRelink {
		t.Fatalf("legacy Direct was not converted to relink pool: %#v", restarted)
	}
	if len(restarted.ControlArtifactPool.Entries) != 1 || !restarted.ControlArtifactPool.Entries[0].Revoked || restarted.ControlArtifactPool.Entries[0].ArtifactJSON != nil {
		t.Fatalf("legacy Direct tombstone = %#v", restarted.ControlArtifactPool.Entries)
	}
}
