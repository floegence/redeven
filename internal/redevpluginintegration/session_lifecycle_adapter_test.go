package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/sessionscope"
)

func TestSessionLifecycleAdapterFreshGenerationAndPriorProcessRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("newSessionLifecycleAdapter() error = %v", err)
	}
	generation := testPluginSessionGeneration("first")
	generation.ProcessGeneration = adapter.startupAuthority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), generation); err != nil {
		t.Fatalf("bindActiveGeneration() error = %v", err)
	}

	gateBefore := readTestSessionLifecycleGate(t, path)
	if err := authority.runtime.lock.Release(); err != nil {
		t.Fatalf("release prior runtime lock error = %v", err)
	}
	nextAuthority := testSessionLifecycleStartupAuthority(t, path)
	reopened, err := newSessionLifecycleAdapter(path, nextAuthority)
	if err != nil {
		t.Fatalf("reopen adapter error = %v", err)
	}
	gateAfter := readTestSessionLifecycleGate(t, path)
	if gateAfter.GenerationID != gateBefore.GenerationID || gateAfter.DescriptorSHA256 != gateBefore.DescriptorSHA256 {
		t.Fatalf("reopen changed generation: before=%+v after=%+v", gateBefore, gateAfter)
	}
	record, err := reopened.InspectSessionScopeMaintenance(context.Background(), host.InspectSessionScopeMaintenanceRequest{
		Session: generation.Session,
	})
	if err != nil {
		t.Fatalf("InspectSessionScopeMaintenance() error = %v", err)
	}
	if record.Phase != "" || !record.TerminalEvidence || !record.Valid() {
		t.Fatalf("recovered record = %+v, want valid terminal intent", record)
	}
	if _, err := reopened.ValidateTerminalSessionScopeClose(context.Background(), host.ValidateTerminalSessionScopeCloseRequest{
		Session: generation.Session,
	}); err != nil {
		t.Fatalf("ValidateTerminalSessionScopeClose() error = %v", err)
	}
}

func TestSessionLifecycleAdapterCloseAndFinalizationLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("newSessionLifecycleAdapter() error = %v", err)
	}
	generation := testPluginSessionGeneration("close")
	generation.ProcessGeneration = adapter.startupAuthority.runtime.processGeneration
	ctx := context.Background()
	if err := adapter.bindActiveGeneration(ctx, generation); err != nil {
		t.Fatalf("bindActiveGeneration() error = %v", err)
	}
	identity, err := adapter.PrepareSessionScopeClose(ctx, host.PrepareSessionScopeCloseRequest{Session: generation.Session})
	if err != nil {
		t.Fatalf("PrepareSessionScopeClose() error = %v", err)
	}
	if repeated, err := adapter.PrepareSessionScopeClose(ctx, host.PrepareSessionScopeCloseRequest{Session: generation.Session}); err != nil || !repeated.Matches(identity) {
		t.Fatalf("repeated PrepareSessionScopeClose() = %+v, %v", repeated, err)
	}
	if err := adapter.CommitSessionScopeClose(ctx, host.CommitSessionScopeCloseRequest{
		Session: generation.Session, Identity: identity,
	}); err != nil {
		t.Fatalf("CommitSessionScopeClose() error = %v", err)
	}
	if err := adapter.recordCloseContinuation(ctx, generation); err != nil {
		t.Fatalf("recordCloseContinuation() error = %v", err)
	}
	if _, err := adapter.ValidateTerminalSessionScopeClose(ctx, host.ValidateTerminalSessionScopeCloseRequest{
		Session: generation.Session, Identity: identity,
	}); !errors.Is(err, host.ErrSessionMaintenanceState) {
		t.Fatalf("terminal validation before terminal intent error = %v", err)
	}
	if err := adapter.recordTerminalIntent(ctx, generation); err != nil {
		t.Fatalf("recordTerminalIntent() error = %v", err)
	}
	terminal, err := adapter.ValidateTerminalSessionScopeClose(ctx, host.ValidateTerminalSessionScopeCloseRequest{
		Session: generation.Session, Identity: identity,
	})
	if err != nil {
		t.Fatalf("ValidateTerminalSessionScopeClose() error = %v", err)
	}
	if terminal.Phase != host.SessionScopeLifecycleClosed || !terminal.TerminalEvidence || !terminal.Identity.Matches(identity) {
		t.Fatalf("terminal record = %+v", terminal)
	}
	if err := adapter.PrepareSessionScopeFinalization(ctx, host.PrepareSessionScopeFinalizationRequest{
		Session: generation.Session, Identity: identity,
	}); err != nil {
		t.Fatalf("PrepareSessionScopeFinalization() error = %v", err)
	}

	reopened, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("reopen finalizing adapter error = %v", err)
	}
	finalizing, err := reopened.InspectSessionScopeMaintenance(ctx, host.InspectSessionScopeMaintenanceRequest{Session: generation.Session})
	if err != nil {
		t.Fatalf("InspectSessionScopeMaintenance() error = %v", err)
	}
	if finalizing.Phase != host.SessionScopeLifecycleFinalizing || !finalizing.TerminalEvidence {
		t.Fatalf("reopened record = %+v, want terminal finalizing", finalizing)
	}
	request := host.CommitSessionScopeFinalizationRequest{Session: generation.Session, Identity: identity}
	if err := reopened.CommitSessionScopeFinalization(ctx, request); err != nil {
		t.Fatalf("CommitSessionScopeFinalization() error = %v", err)
	}
	if err := reopened.CommitSessionScopeFinalization(ctx, request); err != nil {
		t.Fatalf("repeated CommitSessionScopeFinalization() error = %v", err)
	}
	if _, err := reopened.InspectSessionScopeMaintenance(ctx, host.InspectSessionScopeMaintenanceRequest{
		Session: generation.Session,
	}); !errors.Is(err, host.ErrSessionMaintenanceAbsent) {
		t.Fatalf("inspection after finalization error = %v", err)
	}
	if err := reopened.discardFinalizedGeneration(ctx, generation); err != nil {
		t.Fatalf("discardFinalizedGeneration() error = %v", err)
	}
}

func TestSessionLifecycleAdapterMigratesStrictV1IntoFailClosedGate(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "closed_sessions.json")
	session := testPluginSessionGeneration("legacy").Session
	proof, err := sessionscope.GenerateClosedSessionProof()
	if err != nil {
		t.Fatalf("GenerateClosedSessionProof() error = %v", err)
	}
	proofBytes, err := proof.BytesForDurableStorage()
	if err != nil {
		t.Fatalf("BytesForDurableStorage() error = %v", err)
	}
	legacyRaw, err := marshalSessionLifecycleJSON(sessionLifecycleV1Document{
		SchemaVersion: sessionLifecycleV1Schema,
		Records: []sessionLifecycleV1Record{{
			OwnerSessionHash:     session.OwnerSessionHash,
			OwnerUserHash:        session.OwnerUserHash,
			OwnerEnvHash:         session.OwnerEnvHash,
			SessionChannelIDHash: session.SessionChannelIDHash,
			OperationID:          "legacy-close-operation",
			Proof:                proofBytes,
			Closed:               true,
		}},
	})
	if err != nil {
		t.Fatalf("marshal legacy state error = %v", err)
	}
	if err := os.WriteFile(path, legacyRaw, 0o600); err != nil {
		t.Fatalf("write legacy state error = %v", err)
	}

	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("migrate adapter error = %v", err)
	}
	gate := readTestSessionLifecycleGate(t, path)
	if gate.SchemaVersion != sessionLifecycleGateSchema {
		t.Fatalf("gate schema = %q", gate.SchemaVersion)
	}
	if gate.SchemaVersion == sessionLifecycleV1Schema {
		t.Fatal("v1 reader would accept the committed gate")
	}
	inactivePath := filepath.Join(adapter.generationDir(gate.GenerationID), "inactive-v1.json")
	inactive, err := os.ReadFile(inactivePath)
	if err != nil {
		t.Fatalf("read inactive v1 error = %v", err)
	}
	if string(inactive) != string(legacyRaw) {
		t.Fatal("inactive v1 evidence differs from the exact source bytes")
	}
	record, err := adapter.InspectSessionScopeMaintenance(context.Background(), host.InspectSessionScopeMaintenanceRequest{Session: session})
	if err != nil {
		t.Fatalf("InspectSessionScopeMaintenance() error = %v", err)
	}
	if record.Phase != host.SessionScopeLifecycleClosed || !record.TerminalEvidence || !record.Valid() {
		t.Fatalf("migrated record = %+v", record)
	}

	reopened, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("reopen migrated adapter error = %v", err)
	}
	if reopened.generationID != adapter.generationID || reopened.revision != adapter.revision {
		t.Fatalf("migration was not idempotent: first=(%s,%d) reopened=(%s,%d)", adapter.generationID, adapter.revision, reopened.generationID, reopened.revision)
	}
}

func TestSessionLifecycleAdapterRejectsUnknownLegacyFieldWithoutMutation(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "closed_sessions.json")
	raw := []byte("{\n  \"schema_version\": \"" + sessionLifecycleV1Schema + "\",\n  \"records\": [],\n  \"unexpected\": true\n}\n")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write legacy state error = %v", err)
	}
	if _, err := newSessionLifecycleAdapter(path, testSessionLifecycleStartupAuthority(t, path)); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("newSessionLifecycleAdapter() error = %v, want unknown field", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read legacy state error = %v", err)
	}
	if string(after) != string(raw) {
		t.Fatal("invalid legacy source was mutated")
	}
}

func TestSessionLifecycleAdapterRequiresRuntimeAuthorityForLegacyMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	raw, err := marshalSessionLifecycleJSON(sessionLifecycleV1Document{
		SchemaVersion: sessionLifecycleV1Schema,
		Records:       []sessionLifecycleV1Record{},
	})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, raw)
	_, err = newSessionLifecycleAdapter(path, sessionLifecycleStartupAuthority{stateGenerationID: "state-generation-test"})
	if err == nil || !strings.Contains(err.Error(), "held runtime process lock") {
		t.Fatalf("migration without runtime authority error = %v", err)
	}
	if after := readTestFile(t, path); string(after) != string(raw) {
		t.Fatal("migration without runtime authority mutated v1 state")
	}
}

func TestSessionLifecycleAdapterRequiresRuntimeAuthorityForPriorProcessRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	generation := testPluginSessionGeneration("prior-authority")
	generation.ProcessGeneration = authority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), generation); err != nil {
		t.Fatal(err)
	}
	_, err = newSessionLifecycleAdapter(path, sessionLifecycleStartupAuthority{stateGenerationID: authority.stateGenerationID})
	if err == nil || !strings.Contains(err.Error(), "held runtime process lock") {
		t.Fatalf("recovery without runtime authority error = %v", err)
	}
}

func TestSessionLifecycleAdapterRejectsPrepareWithoutRegisteredGeneration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	adapter, err := newSessionLifecycleAdapter(path, testSessionLifecycleStartupAuthority(t, path))
	if err != nil {
		t.Fatal(err)
	}
	session := testPluginSessionGeneration("unregistered").Session
	if _, err := adapter.PrepareSessionScopeClose(context.Background(), host.PrepareSessionScopeCloseRequest{Session: session}); err == nil {
		t.Fatal("PrepareSessionScopeClose() accepted an unregistered session generation")
	}
}

func TestSessionLifecycleAdapterReconcileDoesNotCommitPreparedRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	generation := testPluginSessionGeneration("reconcile-prepared")
	generation.ProcessGeneration = authority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), generation); err != nil {
		t.Fatal(err)
	}
	identity, err := adapter.PrepareSessionScopeClose(context.Background(), host.PrepareSessionScopeCloseRequest{Session: generation.Session})
	if err != nil {
		t.Fatal(err)
	}
	store, err := sessionscope.NewMemoryStore(sessionscope.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	coordinator, err := sessionscope.NewCoordinator(store)
	if err != nil {
		t.Fatal(err)
	}
	scope, _ := generation.Session.SessionScope()
	teardown, _, err := coordinator.BeginTeardown(context.Background(), scope, identity, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	teardown.Release()
	retained, err := coordinator.ListRetained(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := adapter.ReconcileRetainedSessionScopes(context.Background(), host.ReconcileRetainedSessionScopesRequest{Scopes: retained}); err != nil {
		t.Fatalf("ReconcileRetainedSessionScopes() error = %v", err)
	}
	record, err := adapter.InspectSessionScopeMaintenance(context.Background(), host.InspectSessionScopeMaintenanceRequest{Session: generation.Session})
	if err != nil {
		t.Fatal(err)
	}
	if record.Phase != host.SessionScopeLifecyclePrepared {
		t.Fatalf("reconciled phase = %q, want prepared", record.Phase)
	}
}

func TestSessionLifecycleAdapterRejectsTamperedRecords(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, path string)
	}{
		{
			name: "checksum",
			mutate: func(t *testing.T, path string) {
				raw := readTestFile(t, path)
				raw = []byte(strings.Replace(string(raw), `"checksum": "`, `"checksum": "0`, 1))
				writeTestFile(t, path, raw)
			},
		},
		{
			name: "generation mismatch",
			mutate: func(t *testing.T, path string) {
				raw := readTestFile(t, path)
				var document sessionLifecycleRecordsDocument
				if err := decodeStrictJSON(raw, &document); err != nil {
					t.Fatalf("decode records error = %v", err)
				}
				document.GenerationID = "different-generation"
				document.Checksum, _ = sessionLifecycleRecordsChecksum(document.GenerationID, document.Revision, document.Records)
				rewritten, _ := marshalSessionLifecycleJSON(document)
				writeTestFile(t, path, rewritten)
			},
		},
		{
			name: "unknown field",
			mutate: func(t *testing.T, path string) {
				raw := readTestFile(t, path)
				raw = []byte(strings.Replace(string(raw), "{\n", "{\n  \"unexpected\": true,\n", 1))
				writeTestFile(t, path, raw)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "closed_sessions.json")
			authority := testSessionLifecycleStartupAuthority(t, path)
			adapter, err := newSessionLifecycleAdapter(path, authority)
			if err != nil {
				t.Fatalf("newSessionLifecycleAdapter() error = %v", err)
			}
			gate := readTestSessionLifecycleGate(t, path)
			recordsPath := filepath.Join(adapter.generationDir(gate.GenerationID), "records.json")
			test.mutate(t, recordsPath)
			if _, err := newSessionLifecycleAdapter(path, authority); err == nil {
				t.Fatal("newSessionLifecycleAdapter() succeeded for tampered records")
			}
		})
	}
}

func TestSessionLifecycleAdapterRejectsTamperedCommittedJournal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	journalPath := adapter.migrationPath()
	raw := readTestFile(t, journalPath)
	raw = []byte(strings.Replace(string(raw), `"phase": "prepared"`, `"phase": "tampered"`, 1))
	writeTestFile(t, journalPath, raw)
	if _, err := newSessionLifecycleAdapter(path, authority); err == nil || !strings.Contains(err.Error(), "journal") {
		t.Fatalf("reopen with tampered journal error = %v", err)
	}
}

func TestSessionLifecycleMigrationDoesNotCommitGateForIncompletePreparedGeneration(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	legacyRaw, err := marshalSessionLifecycleJSON(sessionLifecycleV1Document{
		SchemaVersion: sessionLifecycleV1Schema,
		Records:       []sessionLifecycleV1Record{},
	})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, legacyRaw)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, legacyRaw)
	if err := os.Remove(adapter.recordsPath); err != nil {
		t.Fatal(err)
	}
	if _, err := newSessionLifecycleAdapter(path, authority); err == nil {
		t.Fatal("incomplete prepared generation was committed")
	}
	if raw := readTestFile(t, path); string(raw) != string(legacyRaw) {
		t.Fatal("incomplete prepared generation replaced the v1 reader path")
	}
}

func TestSessionLifecycleAdapterRejectsSymlinkedAuthorityFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	recordsPath := adapter.recordsPath
	realPath := recordsPath + ".real"
	if err := os.Rename(recordsPath, realPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realPath, recordsPath); err != nil {
		t.Fatal(err)
	}
	if _, err := newSessionLifecycleAdapter(path, authority); err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("reopen with symlinked records error = %v", err)
	}
}

func TestSessionLifecycleAdapterPoisonsAfterPostRenameSyncFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	beforeRevision := adapter.revision
	adapter.syncDirectory = func(string) error { return errors.New("injected directory sync failure") }
	generation := testPluginSessionGeneration("sync-unknown")
	generation.ProcessGeneration = authority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), generation); !errors.Is(err, errSessionLifecycleMutationOutcomeUnknown) {
		t.Fatalf("bind after post-rename sync failure error = %v", err)
	}
	if !adapter.poisoned || adapter.revision != beforeRevision {
		t.Fatalf("adapter poison/revision = %v/%d, want true/%d", adapter.poisoned, adapter.revision, beforeRevision)
	}
	sibling := testPluginSessionGeneration("sync-unknown-sibling")
	sibling.ProcessGeneration = authority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), sibling); !errors.Is(err, errSessionLifecycleMutationOutcomeUnknown) {
		t.Fatalf("mutation after poison error = %v", err)
	}

	reopened, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("reopen after unknown outcome error = %v", err)
	}
	if reopened.revision != beforeRevision+1 {
		t.Fatalf("reopened revision = %d, want %d", reopened.revision, beforeRevision+1)
	}
	if _, err := reopened.InspectSessionScopeMaintenance(context.Background(), host.InspectSessionScopeMaintenanceRequest{
		Session: generation.Session,
	}); err != nil {
		t.Fatalf("reopened committed record error = %v", err)
	}
}

func TestSessionLifecycleAdapterIgnoresStaleTempAndPartialOrphanGeneration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	authority := testSessionLifecycleStartupAuthority(t, path)
	adapter, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(adapter.recordsPath), ".records.json-stale"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	orphan := adapter.generationDir("generation-orphan")
	if err := os.MkdirAll(orphan, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphan, "descriptor.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSessionLifecycleAdapter(path, authority)
	if err != nil {
		t.Fatalf("reopen with stale non-authority files error = %v", err)
	}
	if reopened.generationID != adapter.generationID || reopened.revision != adapter.revision {
		t.Fatalf("reopened authority changed: %#v", reopened)
	}
}

func TestWriteAtomicSyncedReportsPostRenameOutcomeUnknown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "records.json")
	err := writeAtomicSynced(path, []byte("committed\n"), 0o600, func(string) error {
		return errors.New("injected directory sync failure")
	})
	if !errors.Is(err, errSessionLifecycleMutationOutcomeUnknown) {
		t.Fatalf("writeAtomicSynced() error = %v", err)
	}
	if raw := readTestFile(t, path); string(raw) != "committed\n" {
		t.Fatalf("renamed bytes = %q", raw)
	}
}

func TestIntegrationStartupSessionMaintenanceCrashMatrix(t *testing.T) {
	tests := []struct {
		name        string
		seed        func(t *testing.T, integration *Integration, generation PluginSessionGeneration)
		wantOpenErr error
	}{
		{
			name: "fresh terminal intent",
			seed: func(t *testing.T, integration *Integration, generation PluginSessionGeneration) {
				t.Helper()
				if err := integration.RecordTerminalIntent(context.Background(), generation); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "prepared without fence",
			seed: func(t *testing.T, integration *Integration, generation PluginSessionGeneration) {
				t.Helper()
				if _, err := integration.sessionLifecycle.PrepareSessionScopeClose(context.Background(), host.PrepareSessionScopeCloseRequest{
					Session: generation.Session,
				}); err != nil {
					t.Fatal(err)
				}
				if err := integration.RecordTerminalIntent(context.Background(), generation); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "post platform commit finalizing",
			seed: func(t *testing.T, integration *Integration, generation PluginSessionGeneration) {
				t.Helper()
				identity := prepareAndCommitTestSessionClose(t, integration, generation)
				if err := integration.RecordTerminalIntent(context.Background(), generation); err != nil {
					t.Fatal(err)
				}
				if err := integration.sessionLifecycle.PrepareSessionScopeFinalization(context.Background(), host.PrepareSessionScopeFinalizationRequest{
					Session: generation.Session, Identity: identity,
				}); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "closed without fence",
			seed: func(t *testing.T, integration *Integration, generation PluginSessionGeneration) {
				t.Helper()
				_ = prepareAndCommitTestSessionClose(t, integration, generation)
				if err := integration.RecordTerminalIntent(context.Background(), generation); err != nil {
					t.Fatal(err)
				}
			},
			wantOpenErr: host.ErrSessionMaintenanceState,
		},
		{
			name: "complete fence and closed record",
			seed: func(t *testing.T, integration *Integration, generation PluginSessionGeneration) {
				t.Helper()
				if err := integration.RecordTerminalIntent(context.Background(), generation); err != nil {
					t.Fatal(err)
				}
				result, err := integration.host.CloseAuthenticatedSessionScope(context.Background(), host.CloseAuthenticatedSessionScopeRequest{
					Session: generation.Session, Now: time.Now().UTC(),
				})
				if err != nil {
					t.Fatal(err)
				}
				if result.Status != host.SessionScopeTeardownComplete {
					t.Fatalf("close status = %q", result.Status)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			firstLock, firstAuthority := testIntegrationRuntimeAuthority(t, stateDir, "runtime-first")
			options := ownerScopeTestOptions(t, stateDir)
			options.RuntimeAuthority = firstAuthority
			integration, err := New(context.Background(), options)
			if err != nil {
				t.Fatalf("first New() error = %v", err)
			}
			generation := testPluginSessionGeneration(strings.ReplaceAll(test.name, " ", "-"))
			generation.ProcessGeneration = firstAuthority.ProcessGeneration()
			if err := integration.BindActiveGeneration(context.Background(), generation); err != nil {
				t.Fatal(err)
			}
			test.seed(t, integration, generation)
			if err := integration.Close(); err != nil {
				t.Fatal(err)
			}
			if err := firstLock.Release(); err != nil {
				t.Fatal(err)
			}

			_, nextAuthority := testIntegrationRuntimeAuthority(t, stateDir, "runtime-next")
			nextOptions := ownerScopeTestOptions(t, stateDir)
			nextOptions.RuntimeAuthority = nextAuthority
			reopened, err := New(context.Background(), nextOptions)
			if test.wantOpenErr != nil {
				if reopened != nil || !errors.Is(err, test.wantOpenErr) {
					t.Fatalf("reopen = %#v, %v, want %v", reopened, err, test.wantOpenErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("reopen error = %v", err)
			}
			defer reopened.Close()
			if _, err := reopened.sessionLifecycle.InspectSessionScopeMaintenance(context.Background(), host.InspectSessionScopeMaintenanceRequest{
				Session: generation.Session,
			}); !errors.Is(err, host.ErrSessionMaintenanceAbsent) {
				t.Fatalf("record after startup reconciliation error = %v", err)
			}
		})
	}
}

func prepareAndCommitTestSessionClose(t *testing.T, integration *Integration, generation PluginSessionGeneration) sessionscope.TeardownIdentity {
	t.Helper()
	identity, err := integration.sessionLifecycle.PrepareSessionScopeClose(context.Background(), host.PrepareSessionScopeCloseRequest{
		Session: generation.Session,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := integration.sessionLifecycle.CommitSessionScopeClose(context.Background(), host.CommitSessionScopeCloseRequest{
		Session: generation.Session, Identity: identity,
	}); err != nil {
		t.Fatal(err)
	}
	return identity
}

func testIntegrationRuntimeAuthority(t *testing.T, stateDir, processGeneration string) (*lockfile.Lock, *RuntimeProcessAuthority) {
	t.Helper()
	lockPath := filepath.Join(stateDir, "agent.lock")
	runtimeLock, err := lockfile.Acquire(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtimeLock.Release() })
	authority, err := NewRuntimeProcessAuthority(runtimeLock, lockPath, processGeneration)
	if err != nil {
		t.Fatal(err)
	}
	return runtimeLock, authority
}

func TestSessionLifecycleAdapterRejectsGenerationMismatchAndPrematureDiscard(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed_sessions.json")
	adapter, err := newSessionLifecycleAdapter(path, testSessionLifecycleStartupAuthority(t, path))
	if err != nil {
		t.Fatalf("newSessionLifecycleAdapter() error = %v", err)
	}
	generation := testPluginSessionGeneration("exact")
	generation.ProcessGeneration = adapter.startupAuthority.runtime.processGeneration
	if err := adapter.bindActiveGeneration(context.Background(), generation); err != nil {
		t.Fatalf("bindActiveGeneration() error = %v", err)
	}
	wrong := generation
	wrong.SessionGeneration = "sibling-generation"
	if err := adapter.recordTerminalIntent(context.Background(), wrong); err == nil {
		t.Fatal("recordTerminalIntent() accepted a sibling generation")
	}
	if err := adapter.discardFinalizedGeneration(context.Background(), generation); err == nil {
		t.Fatal("discardFinalizedGeneration() discarded live authority")
	}
}

func testPluginSessionGeneration(suffix string) PluginSessionGeneration {
	return PluginSessionGeneration{
		Session: sessionctx.Context{
			OwnerSessionHash:     "owner-session-" + suffix,
			OwnerUserHash:        "owner-user-" + suffix,
			OwnerEnvHash:         "owner-env-" + suffix,
			SessionChannelIDHash: "channel-" + suffix,
		},
		ProcessGeneration: "process-generation-" + suffix,
		SessionGeneration: "session-generation-" + suffix,
	}
}

func testSessionLifecycleStartupAuthority(t *testing.T, gatePath string) sessionLifecycleStartupAuthority {
	t.Helper()
	lockPath := filepath.Join(filepath.Dir(gatePath), "agent.lock")
	runtimeLock, err := lockfile.Acquire(lockPath)
	if err != nil {
		t.Fatalf("acquire runtime lock error = %v", err)
	}
	t.Cleanup(func() { _ = runtimeLock.Release() })
	processGeneration, err := randomSessionLifecycleID("runtime-instance-test")
	if err != nil {
		t.Fatalf("create process generation error = %v", err)
	}
	runtimeAuthority, err := NewRuntimeProcessAuthority(runtimeLock, lockPath, processGeneration)
	if err != nil {
		t.Fatalf("NewRuntimeProcessAuthority() error = %v", err)
	}
	return sessionLifecycleStartupAuthority{
		runtime: runtimeAuthority, stateGenerationID: "state-generation-test",
	}
}

func readTestSessionLifecycleGate(t *testing.T, path string) sessionLifecycleGate {
	t.Helper()
	raw := readTestFile(t, path)
	var gate sessionLifecycleGate
	if err := json.Unmarshal(raw, &gate); err != nil {
		t.Fatalf("decode gate error = %v", err)
	}
	return gate
}

func readTestFile(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s error = %v", path, err)
	}
	return raw
}

func writeTestFile(t *testing.T, path string, raw []byte) {
	t.Helper()
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write %s error = %v", path, err)
	}
}
