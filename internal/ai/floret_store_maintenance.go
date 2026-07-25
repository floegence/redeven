package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type FloretStoreStartupClass string

type FloretStoreStartupPhase string

const (
	FloretStoreStartupInspecting FloretStoreStartupPhase = "inspecting"
	FloretStoreStartupMigrating  FloretStoreStartupPhase = "migrating"
	FloretStoreStartupVerifying  FloretStoreStartupPhase = "verifying"
)

const (
	FloretStoreStartupTemporarilyBlocked         FloretStoreStartupClass = "temporarily_blocked"
	FloretStoreStartupUpdateRequired             FloretStoreStartupClass = "update_required"
	FloretStoreStartupUnsupportedStore           FloretStoreStartupClass = "unsupported_store"
	FloretStoreStartupIntegrityError             FloretStoreStartupClass = "store_integrity_error"
	FloretStoreStartupConfigurationError         FloretStoreStartupClass = "configuration_error"
	FloretStoreStartupEnvironmentPermissionError FloretStoreStartupClass = "environment_permission_error"
	FloretStoreStartupIOError                    FloretStoreStartupClass = "store_io_error"
	FloretStoreStartupMigrationRolledBack        FloretStoreStartupClass = "migration_rolled_back"
	FloretStoreStartupPostCommitVerification     FloretStoreStartupClass = "post_commit_verification_error"
	FloretStoreStartupCancelled                  FloretStoreStartupClass = "cancelled"
	FloretStoreStartupContractError              FloretStoreStartupClass = "contract_error"
)

// FloretStoreStartupError is Redeven's typed startup projection of Floret's
// public maintenance facts. It contains no Store content or schema internals.
type FloretStoreStartupError struct {
	Class       FloretStoreStartupClass
	Operation   flruntime.SQLiteStoreMaintenanceOperation
	State       flruntime.SQLiteStoreState
	Reason      flruntime.SQLiteStoreReason
	OperationID string
	Retryable   bool
	SafeToRetry bool
	Committed   bool
	RolledBack  bool
	cause       error
}

func (e *FloretStoreStartupError) Error() string {
	if e == nil {
		return "Floret Store startup failed"
	}
	return fmt.Sprintf("Floret Store startup failed: class=%s operation=%s", e.Class, e.Operation)
}

func (e *FloretStoreStartupError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type floretStoreStartupAPI interface {
	Start(context.Context, string, flruntime.SQLiteStartupRequest, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStartupResult, error)
}

type publicFloretStoreStartupAPI struct{}

type observingFloretStoreStartupAPI struct {
	next     floretStoreStartupAPI
	progress func(FloretStoreStartupPhase)
}

func (publicFloretStoreStartupAPI) Start(ctx context.Context, path string, request flruntime.SQLiteStartupRequest, options ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStartupResult, error) {
	return flruntime.StartSQLiteStore(ctx, path, request, options...)
}

func (a observingFloretStoreStartupAPI) Start(ctx context.Context, path string, request flruntime.SQLiteStartupRequest, options ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStartupResult, error) {
	previous := request.Progress
	var last FloretStoreStartupPhase
	request.Progress = func(update flruntime.SQLiteStartupProgress) {
		if previous != nil {
			previous(update)
		}
		phase, ok := redevenFloretStoreStartupPhase(update.Phase)
		if !ok || a.progress == nil || phase == last {
			return
		}
		last = phase
		a.progress(phase)
	}
	return a.next.Start(ctx, path, request, options...)
}

func redevenFloretStoreStartupPhase(phase flruntime.SQLiteStartupPhase) (FloretStoreStartupPhase, bool) {
	switch phase {
	case flruntime.SQLiteStartupInspecting:
		return FloretStoreStartupInspecting, true
	case flruntime.SQLiteStartupMigrating:
		return FloretStoreStartupMigrating, true
	case flruntime.SQLiteStartupVerifying:
		return FloretStoreStartupVerifying, true
	default:
		return "", false
	}
}

// IMPORTANT: Floret maintenance facts are consumed only through its public API;
// Redeven must not inspect or repair Floret-owned storage.
func openMaintainedFloretStore(ctx context.Context, path string, api floretStoreStartupAPI, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	if ctx == nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, "startup context is required")
	}
	if strings.TrimSpace(path) == "" || api == nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, "startup input is incomplete")
	}

	result, err := api.Start(ctx, path, flruntime.SQLiteStartupRequest{
		MigrationPolicy: flruntime.SQLiteMigrationApplyCompatible,
	}, options...)
	if err != nil {
		return nil, floretStoreErrorFromStartup(result, err)
	}
	if result.Store == nil {
		return nil, floretStoreContractErrorFromStartup(result, errors.New("Floret startup returned no Store"))
	}
	return result.Store, nil
}

func floretStoreErrorFromStartup(result flruntime.SQLiteStartupResult, err error) error {
	projected := floretStoreErrorFromMaintenance(err)
	applyFloretStoreStartupFacts(projected, result)
	if projected.Committed {
		projected.Class = FloretStoreStartupPostCommitVerification
		projected.SafeToRetry = false
	} else if projected.RolledBack {
		projected.Class = FloretStoreStartupMigrationRolledBack
		if result.Migration != nil {
			projected.Retryable = result.Migration.Retryable
			projected.SafeToRetry = result.Migration.SafeToRetry
		}
	}
	return projected
}

func floretStoreContractErrorFromStartup(result flruntime.SQLiteStartupResult, err error) error {
	projected := &FloretStoreStartupError{Class: FloretStoreStartupContractError, cause: err}
	applyFloretStoreStartupFacts(projected, result)
	return projected
}

func applyFloretStoreStartupFacts(target *FloretStoreStartupError, result flruntime.SQLiteStartupResult) {
	if result.Inspection != nil {
		target.State = result.Inspection.State
	}
	if result.Migration != nil {
		target.OperationID = result.Migration.OperationID
		target.Committed = result.Migration.Committed
		target.RolledBack = result.Migration.RolledBack
		if result.Migration.Committed && result.Migration.After.State != "" {
			target.State = result.Migration.After.State
		}
		if target.Reason == "" {
			target.Reason = result.Migration.Reason
		}
	}
	if result.Verification != nil {
		target.State = result.Verification.Inspection.State
	}
}

func floretStoreErrorFromMaintenance(err error) *FloretStoreStartupError {
	var maintenanceErr *flruntime.SQLiteStoreMaintenanceError
	if !errors.As(err, &maintenanceErr) {
		return &FloretStoreStartupError{Class: FloretStoreStartupContractError, cause: err}
	}
	if !knownFloretStoreOperation(maintenanceErr.Operation) || !knownFloretStoreReason(maintenanceErr.Reason) {
		return &FloretStoreStartupError{
			Class: FloretStoreStartupContractError, Operation: maintenanceErr.Operation,
			Reason: maintenanceErr.Reason, cause: err,
		}
	}
	class := FloretStoreStartupContractError
	safeToRetry := false
	switch maintenanceErr.Reason {
	case flruntime.SQLiteStoreReasonCancelled:
		class = FloretStoreStartupCancelled
	case flruntime.SQLiteStoreReasonBusy, flruntime.SQLiteStoreReasonInspectionStale:
		class = FloretStoreStartupTemporarilyBlocked
		safeToRetry = maintenanceErr.SafeToRetry
	case flruntime.SQLiteStoreReasonNewerReader:
		class = FloretStoreStartupUpdateRequired
	case flruntime.SQLiteStoreReasonUnsupported, flruntime.SQLiteStoreReasonLegacyMigration:
		class = FloretStoreStartupUnsupportedStore
	case flruntime.SQLiteStoreReasonCorrupt, flruntime.SQLiteStoreReasonUnrecognized,
		flruntime.SQLiteStoreReasonSchemaMetadata, flruntime.SQLiteStoreReasonFingerprint,
		flruntime.SQLiteStoreReasonContract:
		class = FloretStoreStartupIntegrityError
	case flruntime.SQLiteStoreReasonLeaseMismatch:
		class = FloretStoreStartupConfigurationError
	case flruntime.SQLiteStoreReasonPermission:
		class = FloretStoreStartupEnvironmentPermissionError
	case flruntime.SQLiteStoreReasonIO:
		class = FloretStoreStartupIOError
		safeToRetry = maintenanceErr.SafeToRetry
	}
	return &FloretStoreStartupError{
		Class: class, Operation: maintenanceErr.Operation, Reason: maintenanceErr.Reason,
		Retryable: maintenanceErr.Retryable, SafeToRetry: safeToRetry, cause: err,
	}
}

func knownFloretStoreOperation(operation flruntime.SQLiteStoreMaintenanceOperation) bool {
	switch operation {
	case flruntime.SQLiteStoreOperationInspect, flruntime.SQLiteStoreOperationVerify,
		flruntime.SQLiteStoreOperationMigrate, flruntime.SQLiteStoreOperationOpen:
		return true
	default:
		return false
	}
}

func knownFloretStoreReason(reason flruntime.SQLiteStoreReason) bool {
	switch reason {
	case flruntime.SQLiteStoreReasonInvalidRequest, flruntime.SQLiteStoreReasonCancelled,
		flruntime.SQLiteStoreReasonBusy, flruntime.SQLiteStoreReasonPermission,
		flruntime.SQLiteStoreReasonIO, flruntime.SQLiteStoreReasonCorrupt,
		flruntime.SQLiteStoreReasonInspectionStale, flruntime.SQLiteStoreReasonStoreMissing,
		flruntime.SQLiteStoreReasonStoreEmpty, flruntime.SQLiteStoreReasonUnrecognized,
		flruntime.SQLiteStoreReasonSchemaMetadata, flruntime.SQLiteStoreReasonNewerReader,
		flruntime.SQLiteStoreReasonUnsupported, flruntime.SQLiteStoreReasonFingerprint,
		flruntime.SQLiteStoreReasonContract, flruntime.SQLiteStoreReasonLegacyMigration,
		flruntime.SQLiteStoreReasonMigrationAvailable, flruntime.SQLiteStoreReasonLeaseMismatch,
		flruntime.SQLiteStoreReasonCurrent, flruntime.SQLiteStoreReasonMigrationFailed:
		return true
	default:
		return false
	}
}

func newFloretStoreContractError(operation flruntime.SQLiteStoreMaintenanceOperation, detail string) error {
	return &FloretStoreStartupError{
		Class:     FloretStoreStartupContractError,
		Operation: operation,
		cause:     errors.New(detail),
	}
}
