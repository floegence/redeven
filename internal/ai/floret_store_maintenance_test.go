package ai

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

// The opaque fixtures were created by blank modules pinned to the named
// published tags using only runtime.OpenSQLiteStore and host capability APIs.
func TestFloretStoreStartupOpensPublishedFixturesAcrossRestart(t *testing.T) {
	fixtures := []struct {
		version  string
		threadID flruntime.ThreadID
		title    string
		sha256   string
	}{
		{version: "0_24_0", threadID: "fixture-v024-thread", title: "Published v0.24 fixture", sha256: "2246d4a022708e028420db0b04bd27bf664700a037be4aba4515c35d1cb4eea1"},
		{version: "0_26_0", threadID: "fixture-v026-thread", title: "Published v0.26 fixture", sha256: "f9769e891c291f5d6a51d474f968caa759811a66bc1bb333184213374f607aa1"},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.version, func(t *testing.T) {
			storePath := filepath.Join(t.TempDir(), "floret.sqlite")
			fixturePath := filepath.Join("testdata", "floret_v"+fixture.version+"_current.sqlite.gz")
			fixtureBytes, err := os.ReadFile(fixturePath)
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(fixtureBytes)
			if got := hex.EncodeToString(digest[:]); got != fixture.sha256 {
				t.Fatalf("opaque published fixture checksum=%s, want %s", got, fixture.sha256)
			}
			expandGzipFixture(t, fixturePath, storePath)

			for restart := 0; restart < 2; restart++ {
				store, err := openMaintainedFloretStore(context.Background(), storePath, publicFloretStoreStartupAPI{})
				if err != nil {
					t.Fatalf("restart %d open: %v", restart, err)
				}
				bootstrap := testFloretBootstrap(t, store)
				read, err := bootstrap.newThreadRead(context.Background(), fixture.threadID)
				if err != nil {
					_ = bootstrap.close()
					t.Fatalf("restart %d bind read: %v", restart, err)
				}
				overview, err := read.ReadThreadOverview(context.Background(), fixture.threadID)
				if err != nil {
					_ = bootstrap.close()
					t.Fatalf("restart %d read canonical thread: %v", restart, err)
				}
				if overview.Thread.ID != fixture.threadID || overview.Thread.Title != fixture.title {
					_ = bootstrap.close()
					t.Fatalf("restart %d thread=%+v", restart, overview.Thread)
				}
				if err := bootstrap.close(); err != nil {
					t.Fatalf("restart %d close: %v", restart, err)
				}
			}
		})
	}
}

func expandGzipFixture(t *testing.T, sourcePath string, destinationPath string) {
	t.Helper()
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	compressed, err := gzip.NewReader(source)
	if err != nil {
		t.Fatal(err)
	}
	defer compressed.Close()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(destination, compressed); err != nil {
		_ = destination.Close()
		t.Fatal(err)
	}
	if err := destination.Close(); err != nil {
		t.Fatal(err)
	}
}

type fakeFloretStoreStartupAPI struct {
	result   flruntime.SQLiteStartupResult
	err      error
	updates  []flruntime.SQLiteStartupProgress
	requests []flruntime.SQLiteStartupRequest
}

func (f *fakeFloretStoreStartupAPI) Start(_ context.Context, _ string, request flruntime.SQLiteStartupRequest, _ ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStartupResult, error) {
	f.requests = append(f.requests, request)
	for _, update := range f.updates {
		if request.Progress != nil {
			request.Progress(update)
		}
	}
	return f.result, f.err
}

func TestFloretStoreStartupUsesStandardCompatibleEntryPoint(t *testing.T) {
	store := flruntime.NewMemoryStore()
	defer store.Close()
	inspection := flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateCurrent}
	verification := flruntime.SQLiteStoreVerification{Inspection: inspection}
	migration := flruntime.SQLiteStoreMigrationResult{
		OperationID: "derived-by-floret", Committed: true,
	}
	fake := &fakeFloretStoreStartupAPI{
		result: flruntime.SQLiteStartupResult{
			Store: store, Inspection: &inspection, Verification: &verification, Migration: &migration,
		},
		updates: []flruntime.SQLiteStartupProgress{
			{Phase: flruntime.SQLiteStartupInspecting},
			{Phase: flruntime.SQLiteStartupMigrating},
			{Phase: flruntime.SQLiteStartupMigrating, Maintenance: &flruntime.SQLiteStoreMaintenanceProgress{}},
			{Phase: flruntime.SQLiteStartupVerifying},
			{Phase: flruntime.SQLiteStartupOpening},
		},
	}
	var phases []FloretStoreStartupPhase
	got, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", observingFloretStoreStartupAPI{
		next: fake, progress: func(phase FloretStoreStartupPhase) { phases = append(phases, phase) },
	})
	if err != nil {
		t.Fatalf("open maintained Store: %v", err)
	}
	if got != store {
		t.Fatal("startup did not return the Store produced by Floret")
	}
	if len(fake.requests) != 1 {
		t.Fatalf("startup calls=%d, want 1", len(fake.requests))
	}
	request := fake.requests[0]
	if request.MigrationPolicy != flruntime.SQLiteMigrationApplyCompatible {
		t.Fatalf("migration policy=%q", request.MigrationPolicy)
	}
	if request.MigrationOperationID != "" {
		t.Fatalf("Redeven must let Floret derive migration identity, got %q", request.MigrationOperationID)
	}
	wantPhases := []FloretStoreStartupPhase{
		FloretStoreStartupInspecting,
		FloretStoreStartupMigrating,
		FloretStoreStartupVerifying,
	}
	if !reflect.DeepEqual(phases, wantPhases) {
		t.Fatalf("phases=%v, want %v", phases, wantPhases)
	}
}

func TestFloretStoreStartupProjectsTypedPublicFailures(t *testing.T) {
	tests := []struct {
		name      string
		state     flruntime.SQLiteStoreState
		operation flruntime.SQLiteStoreMaintenanceOperation
		reason    flruntime.SQLiteStoreReason
		retryable bool
		safe      bool
		wantClass FloretStoreStartupClass
	}{
		{name: "busy", state: flruntime.SQLiteStoreStateBusy, operation: flruntime.SQLiteStoreOperationInspect, reason: flruntime.SQLiteStoreReasonBusy, retryable: true, safe: true, wantClass: FloretStoreStartupTemporarilyBlocked},
		{name: "future", state: flruntime.SQLiteStoreStateFuture, operation: flruntime.SQLiteStoreOperationOpen, reason: flruntime.SQLiteStoreReasonNewerReader, wantClass: FloretStoreStartupUpdateRequired},
		{name: "unsupported", state: flruntime.SQLiteStoreStateUnsupportedOlder, operation: flruntime.SQLiteStoreOperationOpen, reason: flruntime.SQLiteStoreReasonUnsupported, wantClass: FloretStoreStartupUnsupportedStore},
		{name: "corrupt", state: flruntime.SQLiteStoreStateCorrupt, operation: flruntime.SQLiteStoreOperationOpen, reason: flruntime.SQLiteStoreReasonCorrupt, wantClass: FloretStoreStartupIntegrityError},
		{name: "lease mismatch", state: flruntime.SQLiteStoreStateCurrent, operation: flruntime.SQLiteStoreOperationOpen, reason: flruntime.SQLiteStoreReasonLeaseMismatch, wantClass: FloretStoreStartupConfigurationError},
		{name: "permission", state: flruntime.SQLiteStoreStatePermissionDenied, operation: flruntime.SQLiteStoreOperationInspect, reason: flruntime.SQLiteStoreReasonPermission, wantClass: FloretStoreStartupEnvironmentPermissionError},
		{name: "io", state: flruntime.SQLiteStoreStateIOError, operation: flruntime.SQLiteStoreOperationInspect, reason: flruntime.SQLiteStoreReasonIO, retryable: true, safe: true, wantClass: FloretStoreStartupIOError},
		{name: "cancelled", operation: flruntime.SQLiteStoreOperationInspect, reason: flruntime.SQLiteStoreReasonCancelled, retryable: true, safe: true, wantClass: FloretStoreStartupCancelled},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			inspection := flruntime.SQLiteStoreInspection{State: test.state}
			fake := &fakeFloretStoreStartupAPI{
				result: flruntime.SQLiteStartupResult{Inspection: &inspection},
				err: &flruntime.SQLiteStoreMaintenanceError{
					Operation: test.operation, Reason: test.reason,
					Retryable: test.retryable, SafeToRetry: test.safe,
				},
			}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", fake)
			startupErr := assertFloretStoreStartupClass(t, err, test.wantClass)
			if startupErr.State != test.state || startupErr.Operation != test.operation || startupErr.Reason != test.reason {
				t.Fatalf("startup error=%+v", startupErr)
			}
			if startupErr.Retryable != test.retryable {
				t.Fatalf("Retryable=%v, want %v", startupErr.Retryable, test.retryable)
			}
			wantSafe := test.safe && (test.reason == flruntime.SQLiteStoreReasonBusy || test.reason == flruntime.SQLiteStoreReasonInspectionStale || test.reason == flruntime.SQLiteStoreReasonIO)
			if startupErr.SafeToRetry != wantSafe {
				t.Fatalf("SafeToRetry=%v, want %v", startupErr.SafeToRetry, wantSafe)
			}
		})
	}
}

func TestFloretStoreStartupPreservesMigrationSettlementFacts(t *testing.T) {
	tests := []struct {
		name      string
		migration flruntime.SQLiteStoreMigrationResult
		operation flruntime.SQLiteStoreMaintenanceOperation
		wantClass FloretStoreStartupClass
		wantSafe  bool
		wantState flruntime.SQLiteStoreState
	}{
		{
			name: "committed but startup failed",
			migration: flruntime.SQLiteStoreMigrationResult{
				OperationID: "migration-committed", Committed: true,
				Reason: flruntime.SQLiteStoreReasonMigrationFailed, Retryable: true,
				After: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateCurrent},
			},
			operation: flruntime.SQLiteStoreOperationVerify,
			wantClass: FloretStoreStartupPostCommitVerification,
			wantState: flruntime.SQLiteStoreStateCurrent,
		},
		{
			name: "rolled back",
			migration: flruntime.SQLiteStoreMigrationResult{
				OperationID: "migration-rolled-back", RolledBack: true,
				Reason: flruntime.SQLiteStoreReasonMigrationFailed, Retryable: true, SafeToRetry: true,
			},
			operation: flruntime.SQLiteStoreOperationMigrate,
			wantClass: FloretStoreStartupMigrationRolledBack,
			wantSafe:  true,
			wantState: flruntime.SQLiteStoreStateUpgradeable,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			inspection := flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateUpgradeable}
			fake := &fakeFloretStoreStartupAPI{
				result: flruntime.SQLiteStartupResult{Inspection: &inspection, Migration: &test.migration},
				err: &flruntime.SQLiteStoreMaintenanceError{
					Operation: test.operation,
					Reason:    flruntime.SQLiteStoreReasonMigrationFailed,
					Retryable: true,
				},
			}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", fake)
			startupErr := assertFloretStoreStartupClass(t, err, test.wantClass)
			if startupErr.OperationID != test.migration.OperationID || startupErr.Committed != test.migration.Committed || startupErr.RolledBack != test.migration.RolledBack {
				t.Fatalf("startup error=%+v", startupErr)
			}
			if startupErr.State != test.wantState {
				t.Fatalf("State=%s, want %s", startupErr.State, test.wantState)
			}
			if startupErr.SafeToRetry != test.wantSafe {
				t.Fatalf("SafeToRetry=%v, want %v", startupErr.SafeToRetry, test.wantSafe)
			}
		})
	}
}

func TestFloretStoreStartupFailsClosedOnInvalidAdapterResults(t *testing.T) {
	tests := []struct {
		name string
		api  floretStoreStartupAPI
	}{
		{name: "unknown error", api: &fakeFloretStoreStartupAPI{err: errors.New("opaque failure")}},
		{name: "unknown typed reason", api: &fakeFloretStoreStartupAPI{err: &flruntime.SQLiteStoreMaintenanceError{Operation: flruntime.SQLiteStoreOperationOpen, Reason: flruntime.SQLiteStoreReason("future_reason")}}},
		{name: "success without Store", api: &fakeFloretStoreStartupAPI{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", test.api)
			_ = assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
		})
	}
	for _, test := range []struct {
		name string
		ctx  context.Context
		path string
		api  floretStoreStartupAPI
	}{
		{name: "nil context", path: "/opaque/floret.sqlite", api: &fakeFloretStoreStartupAPI{}},
		{name: "empty path", ctx: context.Background(), api: &fakeFloretStoreStartupAPI{}},
		{name: "nil API", ctx: context.Background(), path: "/opaque/floret.sqlite"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := openMaintainedFloretStore(test.ctx, test.path, test.api)
			_ = assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
		})
	}
}

func assertFloretStoreStartupClass(t *testing.T, err error, want FloretStoreStartupClass) *FloretStoreStartupError {
	t.Helper()
	if err == nil {
		t.Fatalf("expected startup class %s", want)
	}
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) {
		t.Fatalf("error type=%T, want *FloretStoreStartupError", err)
	}
	if startupErr.Class != want {
		t.Fatalf("startup class=%s, want %s", startupErr.Class, want)
	}
	return startupErr
}
