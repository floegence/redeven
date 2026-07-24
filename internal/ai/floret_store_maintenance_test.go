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
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

// The opaque fixtures were created by blank modules pinned to the named
// published tags using only runtime.OpenSQLiteStore and host capability APIs.
func TestFloretStoreMaintenanceOpensPublishedFixturesAcrossRestart(t *testing.T) {
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

			inspection, err := flruntime.InspectSQLiteStore(context.Background(), storePath)
			if err != nil {
				t.Fatalf("inspect published fixture: %v", err)
			}
			if inspection.State != flruntime.SQLiteStoreStateCurrent || inspection.Observed.Version != "16" {
				t.Fatalf("published fixture inspection state=%s schema=%s", inspection.State, inspection.Observed.Version)
			}

			for restart := 0; restart < 2; restart++ {
				store, err := openMaintainedFloretStore(context.Background(), storePath, publicFloretStoreMaintenanceAPI{})
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

type fakeFloretStoreMaintenanceAPI struct {
	inspectResults []flruntime.SQLiteStoreInspection
	inspectErrors  []error
	verifyResult   flruntime.SQLiteStoreVerification
	verifyErr      error
	migrateResult  flruntime.SQLiteStoreMigrationResult
	migrateErr     error
	openErr        error

	inspectCalls int
	verifyCalls  int
	migrateCalls int
	openCalls    int
	migrateReq   flruntime.SQLiteStoreMigrationRequest
	openReq      flruntime.SQLiteStoreOpenRequest
}

func (f *fakeFloretStoreMaintenanceAPI) Inspect(context.Context, string, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreInspection, error) {
	index := f.inspectCalls
	f.inspectCalls++
	if index < len(f.inspectErrors) && f.inspectErrors[index] != nil {
		return flruntime.SQLiteStoreInspection{}, f.inspectErrors[index]
	}
	if index >= len(f.inspectResults) {
		return flruntime.SQLiteStoreInspection{}, errors.New("unexpected inspect")
	}
	return f.inspectResults[index], nil
}

func (f *fakeFloretStoreMaintenanceAPI) Verify(context.Context, string, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreVerification, error) {
	f.verifyCalls++
	return f.verifyResult, f.verifyErr
}

func (f *fakeFloretStoreMaintenanceAPI) Migrate(_ context.Context, _ string, request flruntime.SQLiteStoreMigrationRequest, _ ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreMigrationResult, error) {
	f.migrateCalls++
	f.migrateReq = request
	result := f.migrateResult
	if result.OperationID == "request" {
		result.OperationID = request.OperationID
	}
	return result, f.migrateErr
}

func (f *fakeFloretStoreMaintenanceAPI) Open(_ context.Context, _ string, request flruntime.SQLiteStoreOpenRequest, _ ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	f.openCalls++
	f.openReq = request
	if f.openErr != nil {
		return nil, f.openErr
	}
	return flruntime.NewMemoryStore(), nil
}

func TestFloretStoreMaintenanceInitializesMissingAndEmptyWithoutMigration(t *testing.T) {
	for _, state := range []flruntime.SQLiteStoreState{flruntime.SQLiteStoreStateMissing, flruntime.SQLiteStoreStateEmpty} {
		t.Run(string(state), func(t *testing.T) {
			inspection := initialFloretStoreInspection(state)
			api := &fakeFloretStoreMaintenanceAPI{inspectResults: []flruntime.SQLiteStoreInspection{inspection}}
			store, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			if err != nil {
				t.Fatalf("open maintained Store: %v", err)
			}
			defer store.Close()
			if api.inspectCalls != 1 || api.verifyCalls != 0 || api.migrateCalls != 0 || api.openCalls != 1 {
				t.Fatalf("calls inspect=%d verify=%d migrate=%d open=%d", api.inspectCalls, api.verifyCalls, api.migrateCalls, api.openCalls)
			}
			if api.openReq.ExpectedState != state || api.openReq.ExpectedSchema != (flruntime.StoreSchemaIdentity{}) {
				t.Fatalf("open request=%+v", api.openReq)
			}
		})
	}
}

func TestFloretStoreMaintenanceVerifiesCurrentBeforeInspectionBoundOpen(t *testing.T) {
	inspection := currentFloretStoreInspection()
	api := &fakeFloretStoreMaintenanceAPI{
		inspectResults: []flruntime.SQLiteStoreInspection{inspection},
		verifyResult:   validFloretStoreVerification(),
	}
	store, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
	if err != nil {
		t.Fatalf("open maintained Store: %v", err)
	}
	defer store.Close()
	if api.verifyCalls != 1 || api.migrateCalls != 0 || api.openCalls != 1 {
		t.Fatalf("calls verify=%d migrate=%d open=%d", api.verifyCalls, api.migrateCalls, api.openCalls)
	}
	if api.openReq.ExpectedState != flruntime.SQLiteStoreStateCurrent || api.openReq.ExpectedSchema != inspection.Observed {
		t.Fatalf("open request=%+v", api.openReq)
	}
}

func TestFloretStoreMaintenanceMigratesExactObservedSchemaThenVerifies(t *testing.T) {
	before := upgradeableFloretStoreInspection()
	after := currentFloretStoreInspection()
	api := &fakeFloretStoreMaintenanceAPI{
		inspectResults: []flruntime.SQLiteStoreInspection{before},
		migrateResult: flruntime.SQLiteStoreMigrationResult{
			OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
			Before: before, After: after, Status: flruntime.SQLiteStoreMaintenanceReady,
			Changed: true, Committed: true,
		},
		verifyResult: validFloretStoreVerification(),
	}
	store, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
	if err != nil {
		t.Fatalf("open maintained Store: %v", err)
	}
	defer store.Close()
	if api.migrateReq.Mode != flruntime.SQLiteStoreMigrationApply || api.migrateReq.ExpectedSchema != before.Observed {
		t.Fatalf("migration request=%+v", api.migrateReq)
	}
	if api.inspectCalls != 1 || api.migrateCalls != 1 || api.verifyCalls != 1 || api.openCalls != 1 {
		t.Fatalf("calls inspect=%d migrate=%d verify=%d open=%d", api.inspectCalls, api.migrateCalls, api.verifyCalls, api.openCalls)
	}
}

func TestFloretStoreMaintenanceReinspectsStaleMigrationBeforeProceeding(t *testing.T) {
	before := upgradeableFloretStoreInspection()
	api := &fakeFloretStoreMaintenanceAPI{
		inspectResults: []flruntime.SQLiteStoreInspection{before, currentFloretStoreInspection()},
		migrateResult: flruntime.SQLiteStoreMigrationResult{
			OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
			Status: flruntime.SQLiteStoreMaintenanceFailed, Reason: flruntime.SQLiteStoreReasonInspectionStale,
			Retryable: true, SafeToRetry: true,
		},
		migrateErr: &flruntime.SQLiteStoreMaintenanceError{
			Operation: flruntime.SQLiteStoreOperationMigrate,
			Reason:    flruntime.SQLiteStoreReasonInspectionStale,
			Retryable: true, SafeToRetry: true,
		},
		verifyResult: validFloretStoreVerification(),
	}
	store, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
	if err != nil {
		t.Fatalf("open after fresh current inspection: %v", err)
	}
	defer store.Close()
	if api.inspectCalls != 2 || api.migrateCalls != 1 || api.verifyCalls != 1 || api.openCalls != 1 {
		t.Fatalf("calls inspect=%d migrate=%d verify=%d open=%d", api.inspectCalls, api.migrateCalls, api.verifyCalls, api.openCalls)
	}
}

func TestFloretStoreMaintenanceMigrationFailuresRemainTypedAndClosed(t *testing.T) {
	before := upgradeableFloretStoreInspection()
	tests := []struct {
		name      string
		result    flruntime.SQLiteStoreMigrationResult
		wantClass FloretStoreStartupClass
	}{
		{
			name: "rolled_back",
			result: flruntime.SQLiteStoreMigrationResult{
				OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
				Status: flruntime.SQLiteStoreMaintenanceFailed, Reason: flruntime.SQLiteStoreReasonMigrationFailed,
				RolledBack: true, SafeToRetry: true,
			},
			wantClass: FloretStoreStartupMigrationRolledBack,
		},
		{
			name: "committed_but_unverified",
			result: flruntime.SQLiteStoreMigrationResult{
				OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
				Status: flruntime.SQLiteStoreMaintenanceFailed, Reason: flruntime.SQLiteStoreReasonMigrationFailed,
				Committed: true,
			},
			wantClass: FloretStoreStartupPostCommitVerification,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakeFloretStoreMaintenanceAPI{
				inspectResults: []flruntime.SQLiteStoreInspection{before, before},
				migrateResult:  test.result,
				migrateErr: &flruntime.SQLiteStoreMaintenanceError{
					Operation:   flruntime.SQLiteStoreOperationMigrate,
					Reason:      flruntime.SQLiteStoreReasonMigrationFailed,
					SafeToRetry: test.result.SafeToRetry,
				},
			}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			assertFloretStoreStartupClass(t, err, test.wantClass)
			if api.verifyCalls != 0 || api.openCalls != 0 {
				t.Fatalf("failure proceeded to verify/open: verify=%d open=%d", api.verifyCalls, api.openCalls)
			}
		})
	}
}

func TestFloretStoreMaintenanceMapsPublicFactsWithoutStringParsing(t *testing.T) {
	tests := []struct {
		name      string
		inspect   flruntime.SQLiteStoreInspection
		wantClass FloretStoreStartupClass
		wantSafe  bool
	}{
		{name: "busy", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateBusy, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonBusy, SafeToRetry: true}, wantClass: FloretStoreStartupTemporarilyBlocked, wantSafe: true},
		{name: "future", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateFuture, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonNewerReader}, wantClass: FloretStoreStartupUpdateRequired},
		{name: "unsupported", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateUnsupportedOlder, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonUnsupported}, wantClass: FloretStoreStartupUnsupportedStore},
		{name: "drifted", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateDrifted, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonFingerprint}, wantClass: FloretStoreStartupIntegrityError},
		{name: "corrupt", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateCorrupt, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonCorrupt}, wantClass: FloretStoreStartupIntegrityError},
		{name: "permission", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStatePermissionDenied, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonPermission}, wantClass: FloretStoreStartupEnvironmentPermissionError},
		{name: "io_retryable", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateIOError, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonIO, SafeToRetry: true}, wantClass: FloretStoreStartupIOError, wantSafe: true},
		{name: "lease_mismatch", inspect: func() flruntime.SQLiteStoreInspection {
			value := currentFloretStoreInspection()
			value.LeasePolicyState = flruntime.SQLiteStoreLeasePolicyMismatch
			value.Reason = flruntime.SQLiteStoreReasonLeaseMismatch
			return value
		}(), wantClass: FloretStoreStartupConfigurationError},
		{name: "unknown", inspect: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreState("new_state"), SafeToRetry: true}, wantClass: FloretStoreStartupContractError},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakeFloretStoreMaintenanceAPI{inspectResults: []flruntime.SQLiteStoreInspection{test.inspect}}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			startupErr := assertFloretStoreStartupClass(t, err, test.wantClass)
			if startupErr.SafeToRetry != test.wantSafe {
				t.Fatalf("SafeToRetry=%v, want %v", startupErr.SafeToRetry, test.wantSafe)
			}
			if api.openCalls != 0 {
				t.Fatalf("open calls=%d, want 0", api.openCalls)
			}
		})
	}
}

func TestFloretStoreMaintenanceCancellationAndUnknownErrorsFailClosed(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantClass FloretStoreStartupClass
	}{
		{
			name: "cancelled",
			err: &flruntime.SQLiteStoreMaintenanceError{
				Operation:   flruntime.SQLiteStoreOperationInspect,
				Reason:      flruntime.SQLiteStoreReasonCancelled,
				SafeToRetry: true,
				Err:         context.Canceled,
			},
			wantClass: FloretStoreStartupCancelled,
		},
		{name: "unknown_error", err: errors.New("opaque failure"), wantClass: FloretStoreStartupContractError},
		{
			name: "unknown_typed_reason",
			err: &flruntime.SQLiteStoreMaintenanceError{
				Operation: flruntime.SQLiteStoreOperationInspect,
				Reason:    flruntime.SQLiteStoreReason("new_reason"),
			},
			wantClass: FloretStoreStartupContractError,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakeFloretStoreMaintenanceAPI{inspectErrors: []error{test.err}}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			startupErr := assertFloretStoreStartupClass(t, err, test.wantClass)
			if test.wantClass == FloretStoreStartupCancelled && !errors.Is(startupErr, context.Canceled) {
				t.Fatalf("cancelled error does not unwrap context cancellation: %v", startupErr)
			}
			if startupErr.SafeToRetry {
				t.Fatal("cancelled or unknown startup result must not authorize an automatic retry")
			}
		})
	}
}

func TestFloretStoreMaintenanceRejectsInvalidVerificationAndMigrationContracts(t *testing.T) {
	t.Run("failed verification check", func(t *testing.T) {
		verification := validFloretStoreVerification()
		verification.Checks[0].Passed = false
		api := &fakeFloretStoreMaintenanceAPI{
			inspectResults: []flruntime.SQLiteStoreInspection{currentFloretStoreInspection()},
			verifyResult:   verification,
		}
		_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
		assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
		if api.openCalls != 0 {
			t.Fatal("invalid verification proceeded to open")
		}
	})

	for _, test := range []struct {
		name   string
		mutate func(*flruntime.SQLiteStoreVerification)
	}{
		{name: "verification current marked missing", mutate: func(value *flruntime.SQLiteStoreVerification) { value.Inspection.Exists = false }},
		{name: "verification current marked empty", mutate: func(value *flruntime.SQLiteStoreVerification) { value.Inspection.Empty = true }},
		{name: "verification current has busy reason", mutate: func(value *flruntime.SQLiteStoreVerification) {
			value.Inspection.Reason = flruntime.SQLiteStoreReasonBusy
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			verification := validFloretStoreVerification()
			test.mutate(&verification)
			api := &fakeFloretStoreMaintenanceAPI{
				inspectResults: []flruntime.SQLiteStoreInspection{currentFloretStoreInspection()},
				verifyResult:   verification,
			}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
			if api.openCalls != 0 {
				t.Fatal("inconsistent verification inspection proceeded to open")
			}
		})
	}

	t.Run("mismatched migration operation", func(t *testing.T) {
		before := upgradeableFloretStoreInspection()
		api := &fakeFloretStoreMaintenanceAPI{
			inspectResults: []flruntime.SQLiteStoreInspection{before},
			migrateResult: flruntime.SQLiteStoreMigrationResult{
				OperationID: "wrong", Mode: flruntime.SQLiteStoreMigrationApply,
				Before: before, After: currentFloretStoreInspection(),
				Status: flruntime.SQLiteStoreMaintenanceReady, Changed: true, Committed: true,
			},
		}
		_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
		assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
		if api.verifyCalls != 0 || api.openCalls != 0 {
			t.Fatal("invalid migration result proceeded to verify/open")
		}
	})

	t.Run("verification diverges from committed result", func(t *testing.T) {
		before := upgradeableFloretStoreInspection()
		after := currentFloretStoreInspection()
		verification := validFloretStoreVerification()
		verification.Inspection.Observed = flruntime.StoreSchemaIdentity{Version: "v-other", Fingerprint: "fingerprint-other"}
		verification.Inspection.Current = verification.Inspection.Observed
		api := &fakeFloretStoreMaintenanceAPI{
			inspectResults: []flruntime.SQLiteStoreInspection{before},
			migrateResult: flruntime.SQLiteStoreMigrationResult{
				OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
				Before: before, After: after, Status: flruntime.SQLiteStoreMaintenanceReady,
				Changed: true, Committed: true,
			},
			verifyResult: verification,
		}
		_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
		assertFloretStoreStartupClass(t, err, FloretStoreStartupPostCommitVerification)
		if api.inspectCalls != 2 || api.openCalls != 0 {
			t.Fatalf("divergent verification inspect=%d open=%d", api.inspectCalls, api.openCalls)
		}
	})

	t.Run("failed migration reports unsettled change", func(t *testing.T) {
		before := upgradeableFloretStoreInspection()
		api := &fakeFloretStoreMaintenanceAPI{
			inspectResults: []flruntime.SQLiteStoreInspection{before},
			migrateResult: flruntime.SQLiteStoreMigrationResult{
				OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
				Status: flruntime.SQLiteStoreMaintenanceFailed, Changed: true,
				Reason: flruntime.SQLiteStoreReasonMigrationFailed,
			},
			migrateErr: &flruntime.SQLiteStoreMaintenanceError{
				Operation: flruntime.SQLiteStoreOperationMigrate,
				Reason:    flruntime.SQLiteStoreReasonMigrationFailed,
			},
		}
		_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
		assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
		if api.inspectCalls != 1 || api.verifyCalls != 0 || api.openCalls != 0 {
			t.Fatalf("invalid failure continued: inspect=%d verify=%d open=%d", api.inspectCalls, api.verifyCalls, api.openCalls)
		}
	})

	for _, test := range []struct {
		name   string
		mutate func(*flruntime.SQLiteStoreMaintenanceError)
	}{
		{name: "failed migration error operation disagrees", mutate: func(value *flruntime.SQLiteStoreMaintenanceError) {
			value.Operation = flruntime.SQLiteStoreOperationVerify
		}},
		{name: "failed migration error reason disagrees", mutate: func(value *flruntime.SQLiteStoreMaintenanceError) { value.Reason = flruntime.SQLiteStoreReasonBusy }},
		{name: "failed migration error retry facts disagree", mutate: func(value *flruntime.SQLiteStoreMaintenanceError) { value.Retryable = true }},
	} {
		t.Run(test.name, func(t *testing.T) {
			before := upgradeableFloretStoreInspection()
			maintenanceErr := &flruntime.SQLiteStoreMaintenanceError{
				Operation: flruntime.SQLiteStoreOperationMigrate,
				Reason:    flruntime.SQLiteStoreReasonMigrationFailed,
			}
			test.mutate(maintenanceErr)
			api := &fakeFloretStoreMaintenanceAPI{
				inspectResults: []flruntime.SQLiteStoreInspection{before},
				migrateResult: flruntime.SQLiteStoreMigrationResult{
					OperationID: "request", Mode: flruntime.SQLiteStoreMigrationApply,
					Status: flruntime.SQLiteStoreMaintenanceFailed, Reason: flruntime.SQLiteStoreReasonMigrationFailed,
				},
				migrateErr: maintenanceErr,
			}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
			if api.inspectCalls != 1 || api.verifyCalls != 0 || api.openCalls != 0 {
				t.Fatalf("inconsistent failure continued: inspect=%d verify=%d open=%d", api.inspectCalls, api.verifyCalls, api.openCalls)
			}
		})
	}
}

func TestFloretStoreMaintenanceReinspectsOpenFailureWithoutReusingThePlan(t *testing.T) {
	inspection := currentFloretStoreInspection()
	api := &fakeFloretStoreMaintenanceAPI{
		inspectResults: []flruntime.SQLiteStoreInspection{inspection, inspection},
		verifyResult:   validFloretStoreVerification(),
		openErr: &flruntime.SQLiteStoreMaintenanceError{
			Operation: flruntime.SQLiteStoreOperationOpen,
			Reason:    flruntime.SQLiteStoreReasonInspectionStale,
			Retryable: true, SafeToRetry: true,
		},
	}
	_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
	assertFloretStoreStartupClass(t, err, FloretStoreStartupTemporarilyBlocked)
	if api.inspectCalls != 2 || api.openCalls != 1 {
		t.Fatalf("calls inspect=%d open=%d", api.inspectCalls, api.openCalls)
	}
}

func TestFloretStoreMaintenanceReinspectsInitializeOpenFailure(t *testing.T) {
	api := &fakeFloretStoreMaintenanceAPI{
		inspectResults: []flruntime.SQLiteStoreInspection{
			initialFloretStoreInspection(flruntime.SQLiteStoreStateMissing),
			currentFloretStoreInspection(),
		},
		openErr: &flruntime.SQLiteStoreMaintenanceError{
			Operation: flruntime.SQLiteStoreOperationOpen,
			Reason:    flruntime.SQLiteStoreReasonInspectionStale,
			Retryable: true, SafeToRetry: true,
		},
	}
	_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
	assertFloretStoreStartupClass(t, err, FloretStoreStartupTemporarilyBlocked)
	if api.inspectCalls != 2 || api.verifyCalls != 0 || api.migrateCalls != 0 || api.openCalls != 1 {
		t.Fatalf("calls inspect=%d verify=%d migrate=%d open=%d", api.inspectCalls, api.verifyCalls, api.migrateCalls, api.openCalls)
	}
}

func TestFloretStoreMaintenanceRejectsMalformedInspectionFacts(t *testing.T) {
	tests := []struct {
		name       string
		inspection flruntime.SQLiteStoreInspection
	}{
		{name: "current marked missing", inspection: func() flruntime.SQLiteStoreInspection {
			value := currentFloretStoreInspection()
			value.Exists = false
			return value
		}()},
		{name: "missing with current reason", inspection: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreStateMissing, Kind: flruntime.SQLiteStoreKindUnknown, LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable, Reason: flruntime.SQLiteStoreReasonCurrent}},
		{name: "upgradeable lease mismatch", inspection: func() flruntime.SQLiteStoreInspection {
			value := upgradeableFloretStoreInspection()
			value.LeasePolicyState = flruntime.SQLiteStoreLeasePolicyMismatch
			value.Reason = flruntime.SQLiteStoreReasonMigrationAvailable
			return value
		}()},
		{name: "upgradeable lease matches", inspection: func() flruntime.SQLiteStoreInspection {
			value := upgradeableFloretStoreInspection()
			value.LeasePolicyState = flruntime.SQLiteStoreLeasePolicyMatches
			return value
		}()},
		{name: "upgradeable unknown lease state", inspection: func() flruntime.SQLiteStoreInspection {
			value := upgradeableFloretStoreInspection()
			value.LeasePolicyState = flruntime.SQLiteStoreLeasePolicyState("future_value")
			return value
		}()},
		{name: "unknown state with lease mismatch", inspection: flruntime.SQLiteStoreInspection{State: flruntime.SQLiteStoreState("new_state"), LeasePolicyState: flruntime.SQLiteStoreLeasePolicyMismatch, Reason: flruntime.SQLiteStoreReasonLeaseMismatch}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakeFloretStoreMaintenanceAPI{inspectResults: []flruntime.SQLiteStoreInspection{test.inspection}}
			_, err := openMaintainedFloretStore(context.Background(), "/opaque/floret.sqlite", api)
			assertFloretStoreStartupClass(t, err, FloretStoreStartupContractError)
			if api.verifyCalls != 0 || api.migrateCalls != 0 || api.openCalls != 0 {
				t.Fatal("malformed inspection reached a Store operation")
			}
		})
	}
}

func TestNewServiceContextCancelsBeforeStoreOrProductRecovery(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stateDir := t.TempDir()
	_, err := NewServiceContext(ctx, Options{StateDir: stateDir, AgentHomeDir: t.TempDir()})
	assertFloretStoreStartupClass(t, err, FloretStoreStartupCancelled)
	if _, statErr := os.Stat(filepath.Join(stateDir, "ai", "threads.sqlite")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("cancelled startup reached product thread recovery Store: %v", statErr)
	}
	if _, err := NewServiceContext(nil, Options{}); err == nil {
		t.Fatal("nil startup context was accepted")
	}
}

func currentFloretStoreInspection() flruntime.SQLiteStoreInspection {
	identity := flruntime.StoreSchemaIdentity{Version: "v-current", Fingerprint: "fingerprint-current"}
	return flruntime.SQLiteStoreInspection{
		Kind: flruntime.SQLiteStoreKindFloret, State: flruntime.SQLiteStoreStateCurrent,
		Exists:   true,
		Observed: identity, Current: identity,
		LeasePolicyState: flruntime.SQLiteStoreLeasePolicyMatches,
		Reason:           flruntime.SQLiteStoreReasonCurrent,
	}
}

func initialFloretStoreInspection(state flruntime.SQLiteStoreState) flruntime.SQLiteStoreInspection {
	inspection := flruntime.SQLiteStoreInspection{
		State: state, Kind: flruntime.SQLiteStoreKindUnknown,
		LeasePolicyState: flruntime.SQLiteStoreLeasePolicyUnavailable,
		Reason:           flruntime.SQLiteStoreReasonStoreMissing,
	}
	if state == flruntime.SQLiteStoreStateEmpty {
		inspection.Exists = true
		inspection.Empty = true
		inspection.Reason = flruntime.SQLiteStoreReasonStoreEmpty
	}
	return inspection
}

func upgradeableFloretStoreInspection() flruntime.SQLiteStoreInspection {
	inspection := currentFloretStoreInspection()
	inspection.State = flruntime.SQLiteStoreStateUpgradeable
	inspection.Observed = flruntime.StoreSchemaIdentity{Version: "v-old", Fingerprint: "fingerprint-old"}
	inspection.LeasePolicyState = flruntime.SQLiteStoreLeasePolicyUnavailable
	inspection.Reason = flruntime.SQLiteStoreReasonMigrationAvailable
	return inspection
}

func validFloretStoreVerification() flruntime.SQLiteStoreVerification {
	return flruntime.SQLiteStoreVerification{
		Inspection: currentFloretStoreInspection(),
		Checks:     []flruntime.SQLiteStoreVerificationCheck{{Code: "public_contract", Passed: true}},
	}
}

func assertFloretStoreStartupClass(t *testing.T, err error, want FloretStoreStartupClass) *FloretStoreStartupError {
	t.Helper()
	if err == nil {
		t.Fatalf("error=nil, want class %s", want)
	}
	var startupErr *FloretStoreStartupError
	if !errors.As(err, &startupErr) {
		t.Fatalf("error type=%T, want *FloretStoreStartupError", err)
	}
	if startupErr.Class != want {
		t.Fatalf("class=%s, want %s (error=%v cause=%v)", startupErr.Class, want, err, startupErr.cause)
	}
	return startupErr
}
