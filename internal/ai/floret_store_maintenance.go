package ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type FloretStoreStartupClass string

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

type floretStoreMaintenanceAPI interface {
	Inspect(context.Context, string, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreInspection, error)
	Verify(context.Context, string, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreVerification, error)
	Migrate(context.Context, string, flruntime.SQLiteStoreMigrationRequest, ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreMigrationResult, error)
	Open(context.Context, string, flruntime.SQLiteStoreOpenRequest, ...flruntime.SQLiteStoreOption) (*flruntime.Store, error)
}

type publicFloretStoreMaintenanceAPI struct{}

func (publicFloretStoreMaintenanceAPI) Inspect(ctx context.Context, path string, options ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreInspection, error) {
	return flruntime.InspectSQLiteStore(ctx, path, options...)
}

func (publicFloretStoreMaintenanceAPI) Verify(ctx context.Context, path string, options ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreVerification, error) {
	return flruntime.VerifySQLiteStore(ctx, path, options...)
}

func (publicFloretStoreMaintenanceAPI) Migrate(ctx context.Context, path string, request flruntime.SQLiteStoreMigrationRequest, options ...flruntime.SQLiteStoreOption) (flruntime.SQLiteStoreMigrationResult, error) {
	return flruntime.MigrateSQLiteStore(ctx, path, request, options...)
}

func (publicFloretStoreMaintenanceAPI) Open(ctx context.Context, path string, request flruntime.SQLiteStoreOpenRequest, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	return flruntime.OpenSQLiteStore(ctx, path, request, options...)
}

// IMPORTANT: Floret maintenance facts are consumed only through its public API;
// Redeven must not inspect or repair Floret-owned storage.
func openMaintainedFloretStore(ctx context.Context, path string, api floretStoreMaintenanceAPI, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	if ctx == nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, "startup context is required")
	}
	if strings.TrimSpace(path) == "" || api == nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, "maintenance input is incomplete")
	}

	inspection, err := api.Inspect(ctx, path, options...)
	if err != nil {
		return nil, floretStoreErrorFromMaintenance(err)
	}
	if err := validateFloretInspection(inspection); err != nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, err.Error())
	}
	return openFloretStoreFromInspection(ctx, path, api, inspection, options...)
}

func openFloretStoreFromInspection(ctx context.Context, path string, api floretStoreMaintenanceAPI, inspection flruntime.SQLiteStoreInspection, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	if inspection.LeasePolicyState == flruntime.SQLiteStoreLeasePolicyMismatch {
		return nil, floretStoreErrorFromInspection(inspection)
	}

	switch inspection.State {
	case flruntime.SQLiteStoreStateMissing, flruntime.SQLiteStoreStateEmpty:
		store, err := api.Open(ctx, path, flruntime.SQLiteStoreOpenRequest{
			ExpectedState: inspection.State,
		}, options...)
		if err != nil {
			return nil, floretStoreErrorAfterOpenFailure(ctx, path, api, false, "", err, options...)
		}
		return store, nil
	case flruntime.SQLiteStoreStateCurrent:
		return verifyAndOpenFloretStore(ctx, path, api, false, "", nil, options...)
	case flruntime.SQLiteStoreStateUpgradeable:
		return migrateVerifyAndOpenFloretStore(ctx, path, api, inspection, options...)
	default:
		return nil, floretStoreErrorFromInspection(inspection)
	}
}

func migrateVerifyAndOpenFloretStore(ctx context.Context, path string, api floretStoreMaintenanceAPI, inspection flruntime.SQLiteStoreInspection, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	operationID, err := newFloretStoreOperationID()
	if err != nil {
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationMigrate, "operation identity is unavailable")
	}
	result, migrateErr := api.Migrate(ctx, path, flruntime.SQLiteStoreMigrationRequest{
		OperationID:    operationID,
		Mode:           flruntime.SQLiteStoreMigrationApply,
		ExpectedSchema: inspection.Observed,
	}, options...)
	if migrateErr != nil {
		return handleFloretMigrationFailure(ctx, path, api, operationID, result, migrateErr, options...)
	}
	if err := validateFloretMigrationResult(operationID, inspection, result); err != nil {
		return nil, floretStoreContractErrorWithResult(flruntime.SQLiteStoreOperationMigrate, operationID, result, err)
	}
	return verifyAndOpenFloretStore(ctx, path, api, true, operationID, &result.After, options...)
}

func handleFloretMigrationFailure(ctx context.Context, path string, api floretStoreMaintenanceAPI, operationID string, result flruntime.SQLiteStoreMigrationResult, migrateErr error, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	if err := validateFloretFailedMigrationResult(operationID, result, migrateErr); err != nil {
		return nil, floretStoreContractErrorWithResult(flruntime.SQLiteStoreOperationMigrate, operationID, result, err)
	}
	if result.Committed {
		_, _ = api.Inspect(ctx, path, options...)
		return nil, &FloretStoreStartupError{
			Class: FloretStoreStartupPostCommitVerification, Operation: flruntime.SQLiteStoreOperationMigrate,
			Reason: result.Reason, OperationID: operationID, Committed: true,
			Retryable: result.Retryable, SafeToRetry: false, cause: migrateErr,
		}
	}
	if result.RolledBack {
		return nil, &FloretStoreStartupError{
			Class: FloretStoreStartupMigrationRolledBack, Operation: flruntime.SQLiteStoreOperationMigrate,
			Reason: result.Reason, OperationID: operationID, RolledBack: true,
			Retryable: result.Retryable, SafeToRetry: result.SafeToRetry, cause: migrateErr,
		}
	}

	var maintenanceErr *flruntime.SQLiteStoreMaintenanceError
	if errors.As(migrateErr, &maintenanceErr) && (maintenanceErr.Reason == flruntime.SQLiteStoreReasonInspectionStale || maintenanceErr.Reason == flruntime.SQLiteStoreReasonBusy) {
		latest, inspectErr := api.Inspect(ctx, path, options...)
		if inspectErr != nil {
			return nil, floretStoreErrorFromMaintenance(inspectErr)
		}
		if err := validateFloretInspection(latest); err != nil {
			return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, err.Error())
		}
		if latest.State == flruntime.SQLiteStoreStateCurrent {
			return verifyAndOpenFloretStore(ctx, path, api, false, "", nil, options...)
		}
		if latest.State != flruntime.SQLiteStoreStateUpgradeable {
			return nil, floretStoreErrorFromInspection(latest)
		}
		return nil, &FloretStoreStartupError{
			Class: FloretStoreStartupTemporarilyBlocked, Operation: flruntime.SQLiteStoreOperationMigrate,
			State: latest.State, Reason: maintenanceErr.Reason, OperationID: operationID,
			Retryable: maintenanceErr.Retryable, SafeToRetry: maintenanceErr.SafeToRetry, cause: migrateErr,
		}
	}
	return nil, floretStoreErrorFromMaintenanceWithOperationID(migrateErr, operationID)
}

func verifyAndOpenFloretStore(ctx context.Context, path string, api floretStoreMaintenanceAPI, afterMigration bool, operationID string, expectedAfter *flruntime.SQLiteStoreInspection, options ...flruntime.SQLiteStoreOption) (*flruntime.Store, error) {
	verification, err := api.Verify(ctx, path, options...)
	if err != nil {
		if afterMigration {
			return nil, floretPostCommitErrorAfterInspection(ctx, path, api, flruntime.SQLiteStoreOperationVerify, operationID, err, options...)
		}
		return nil, floretStoreErrorFromMaintenance(err)
	}
	if err := validateFloretVerification(verification); err != nil {
		if afterMigration {
			return nil, floretPostCommitErrorAfterInspection(ctx, path, api, flruntime.SQLiteStoreOperationVerify, operationID, err, options...)
		}
		return nil, newFloretStoreContractError(flruntime.SQLiteStoreOperationVerify, err.Error())
	}
	if expectedAfter != nil && (verification.Inspection.Observed != expectedAfter.Observed || verification.Inspection.Current != expectedAfter.Current) {
		return nil, floretPostCommitErrorAfterInspection(ctx, path, api, flruntime.SQLiteStoreOperationVerify, operationID, errors.New("verification does not match the committed migration result"), options...)
	}

	store, err := api.Open(ctx, path, flruntime.SQLiteStoreOpenRequest{
		ExpectedState:  verification.Inspection.State,
		ExpectedSchema: verification.Inspection.Observed,
	}, options...)
	if err != nil {
		return nil, floretStoreErrorAfterOpenFailure(ctx, path, api, afterMigration, operationID, err, options...)
	}
	return store, nil
}

func validateFloretInspection(inspection flruntime.SQLiteStoreInspection) error {
	switch inspection.LeasePolicyState {
	case flruntime.SQLiteStoreLeasePolicyUnavailable, flruntime.SQLiteStoreLeasePolicyMatches, flruntime.SQLiteStoreLeasePolicyMismatch:
	default:
		return errors.New("Store inspection has an unknown lease policy state")
	}
	if inspection.LeasePolicyState == flruntime.SQLiteStoreLeasePolicyMismatch {
		if inspection.State != flruntime.SQLiteStoreStateCurrent || !inspection.Exists || inspection.Empty || inspection.Kind != flruntime.SQLiteStoreKindFloret || inspection.Observed == (flruntime.StoreSchemaIdentity{}) || inspection.Observed != inspection.Current || inspection.Reason != flruntime.SQLiteStoreReasonLeaseMismatch {
			return errors.New("lease mismatch inspection has an inconsistent reason")
		}
		return nil
	}
	zeroSchema := flruntime.StoreSchemaIdentity{}
	switch inspection.State {
	case flruntime.SQLiteStoreStateMissing:
		if inspection.Exists || inspection.Empty || !floretStoreKindUnavailable(inspection.Kind) || inspection.Observed != zeroSchema || inspection.LeasePolicyState != flruntime.SQLiteStoreLeasePolicyUnavailable || inspection.Reason != flruntime.SQLiteStoreReasonStoreMissing {
			return errors.New("missing Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateEmpty:
		if !inspection.Exists || !inspection.Empty || !floretStoreKindUnavailable(inspection.Kind) || inspection.Observed != zeroSchema || inspection.LeasePolicyState != flruntime.SQLiteStoreLeasePolicyUnavailable || inspection.Reason != flruntime.SQLiteStoreReasonStoreEmpty {
			return errors.New("empty Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateCurrent:
		if !inspection.Exists || inspection.Empty || inspection.Kind != flruntime.SQLiteStoreKindFloret || inspection.Observed == zeroSchema || inspection.Observed != inspection.Current || inspection.LeasePolicyState != flruntime.SQLiteStoreLeasePolicyMatches || inspection.Reason != flruntime.SQLiteStoreReasonCurrent {
			return errors.New("current Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateUpgradeable:
		if !inspection.Exists || inspection.Empty || inspection.Kind != flruntime.SQLiteStoreKindFloret || inspection.Observed == zeroSchema || inspection.Current == zeroSchema || inspection.Observed == inspection.Current || inspection.LeasePolicyState != flruntime.SQLiteStoreLeasePolicyUnavailable || inspection.Reason != flruntime.SQLiteStoreReasonMigrationAvailable {
			return errors.New("upgradeable Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateFuture:
		if inspection.Reason != flruntime.SQLiteStoreReasonNewerReader {
			return errors.New("future Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateUnsupportedOlder:
		if inspection.Reason != flruntime.SQLiteStoreReasonUnsupported && inspection.Reason != flruntime.SQLiteStoreReasonLegacyMigration {
			return errors.New("unsupported Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateDrifted:
		if inspection.Reason != flruntime.SQLiteStoreReasonFingerprint && inspection.Reason != flruntime.SQLiteStoreReasonContract {
			return errors.New("drifted Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateCorrupt:
		if inspection.Reason != flruntime.SQLiteStoreReasonCorrupt && inspection.Reason != flruntime.SQLiteStoreReasonUnrecognized && inspection.Reason != flruntime.SQLiteStoreReasonSchemaMetadata {
			return errors.New("corrupt Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateBusy:
		if inspection.Reason != flruntime.SQLiteStoreReasonBusy {
			return errors.New("busy Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStatePermissionDenied:
		if inspection.Reason != flruntime.SQLiteStoreReasonPermission {
			return errors.New("permission Store inspection is inconsistent")
		}
	case flruntime.SQLiteStoreStateIOError:
		if inspection.Reason != flruntime.SQLiteStoreReasonIO {
			return errors.New("I/O Store inspection is inconsistent")
		}
	default:
		return errors.New("Store inspection has an unknown state")
	}
	return nil
}

func floretStoreKindUnavailable(kind flruntime.SQLiteStoreKind) bool {
	return kind == "" || kind == flruntime.SQLiteStoreKindUnknown
}

func validateFloretVerification(verification flruntime.SQLiteStoreVerification) error {
	inspection := verification.Inspection
	if err := validateFloretInspection(inspection); err != nil {
		return fmt.Errorf("verification inspection: %w", err)
	}
	if strings.TrimSpace(inspection.Observed.Version) == "" || strings.TrimSpace(inspection.Observed.Fingerprint) == "" {
		return errors.New("verification schema identity is incomplete")
	}
	if len(verification.Checks) == 0 {
		return errors.New("verification returned no checks")
	}
	for _, check := range verification.Checks {
		if strings.TrimSpace(check.Code) == "" || !check.Passed {
			return errors.New("verification check failed")
		}
	}
	return nil
}

func validateFloretMigrationResult(operationID string, before flruntime.SQLiteStoreInspection, result flruntime.SQLiteStoreMigrationResult) error {
	if err := validateFloretInspection(result.Before); err != nil {
		return fmt.Errorf("migration source inspection: %w", err)
	}
	if err := validateFloretInspection(result.After); err != nil {
		return fmt.Errorf("migration destination inspection: %w", err)
	}
	switch {
	case result.OperationID != operationID:
		return errors.New("migration operation identity changed")
	case result.Mode != flruntime.SQLiteStoreMigrationApply:
		return errors.New("migration result mode is not apply")
	case result.Status != flruntime.SQLiteStoreMaintenanceReady:
		return errors.New("migration did not finish ready")
	case !result.Changed || !result.Committed || result.RolledBack:
		return errors.New("migration did not report one committed change")
	case result.Before.State != flruntime.SQLiteStoreStateUpgradeable || result.Before.Observed != before.Observed:
		return errors.New("migration result does not match the inspected source")
	case result.After.State != flruntime.SQLiteStoreStateCurrent:
		return errors.New("migration result did not reach current")
	default:
		return nil
	}
}

func validateFloretFailedMigrationResult(operationID string, result flruntime.SQLiteStoreMigrationResult, migrateErr error) error {
	if result.OperationID != operationID {
		return errors.New("failed migration operation identity changed")
	}
	if result.Mode != flruntime.SQLiteStoreMigrationApply {
		return errors.New("failed migration result has an invalid mode")
	}
	if result.Status != flruntime.SQLiteStoreMaintenanceFailed && result.Status != flruntime.SQLiteStoreMaintenanceCancelled {
		return errors.New("failed migration result has an invalid status")
	}
	if result.Committed && result.RolledBack {
		return errors.New("failed migration result is both committed and rolled back")
	}
	if result.Changed && !result.Committed && !result.RolledBack {
		return errors.New("failed migration reports an unsettled change")
	}
	if !knownFloretStoreReason(result.Reason) {
		return errors.New("failed migration result has an unknown reason")
	}
	var maintenanceErr *flruntime.SQLiteStoreMaintenanceError
	if !errors.As(migrateErr, &maintenanceErr) {
		return errors.New("failed migration did not return a typed maintenance error")
	}
	if maintenanceErr.Operation != flruntime.SQLiteStoreOperationMigrate {
		return errors.New("failed migration error has an invalid operation")
	}
	if maintenanceErr.Reason != result.Reason || maintenanceErr.Retryable != result.Retryable || maintenanceErr.SafeToRetry != result.SafeToRetry {
		return errors.New("failed migration result and error facts disagree")
	}
	if (result.Status == flruntime.SQLiteStoreMaintenanceCancelled) != (result.Reason == flruntime.SQLiteStoreReasonCancelled) {
		return errors.New("failed migration cancellation facts disagree")
	}
	return nil
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

func floretStoreErrorAfterOpenFailure(ctx context.Context, path string, api floretStoreMaintenanceAPI, afterMigration bool, operationID string, openErr error, options ...flruntime.SQLiteStoreOption) error {
	latest, inspectErr := api.Inspect(ctx, path, options...)
	if afterMigration {
		return floretPostCommitError(flruntime.SQLiteStoreOperationOpen, operationID, openErr)
	}
	if inspectErr != nil {
		return floretStoreErrorFromMaintenance(inspectErr)
	}
	if err := validateFloretInspection(latest); err != nil {
		return newFloretStoreContractError(flruntime.SQLiteStoreOperationInspect, err.Error())
	}
	return floretStoreErrorFromMaintenance(openErr)
}

func floretStoreErrorFromInspection(inspection flruntime.SQLiteStoreInspection) error {
	class := FloretStoreStartupContractError
	safeToRetry := false
	switch {
	case inspection.LeasePolicyState == flruntime.SQLiteStoreLeasePolicyMismatch:
		class = FloretStoreStartupConfigurationError
	case inspection.State == flruntime.SQLiteStoreStateBusy:
		class = FloretStoreStartupTemporarilyBlocked
		safeToRetry = inspection.SafeToRetry
	case inspection.State == flruntime.SQLiteStoreStateFuture:
		class = FloretStoreStartupUpdateRequired
	case inspection.State == flruntime.SQLiteStoreStateUnsupportedOlder:
		class = FloretStoreStartupUnsupportedStore
	case inspection.State == flruntime.SQLiteStoreStateDrifted || inspection.State == flruntime.SQLiteStoreStateCorrupt:
		class = FloretStoreStartupIntegrityError
	case inspection.State == flruntime.SQLiteStoreStatePermissionDenied:
		class = FloretStoreStartupEnvironmentPermissionError
	case inspection.State == flruntime.SQLiteStoreStateIOError:
		class = FloretStoreStartupIOError
		safeToRetry = inspection.SafeToRetry
	}
	return &FloretStoreStartupError{
		Class: class, Operation: flruntime.SQLiteStoreOperationInspect,
		State: inspection.State, Reason: inspection.Reason,
		Retryable: inspection.Retryable, SafeToRetry: safeToRetry,
	}
}

func floretStoreErrorFromMaintenance(err error) error {
	return floretStoreErrorFromMaintenanceWithOperationID(err, "")
}

func floretStoreErrorFromMaintenanceWithOperationID(err error, operationID string) error {
	var maintenanceErr *flruntime.SQLiteStoreMaintenanceError
	if !errors.As(err, &maintenanceErr) {
		return &FloretStoreStartupError{Class: FloretStoreStartupContractError, OperationID: operationID, cause: err}
	}
	if !knownFloretStoreOperation(maintenanceErr.Operation) || !knownFloretStoreReason(maintenanceErr.Reason) {
		return &FloretStoreStartupError{
			Class: FloretStoreStartupContractError, Operation: maintenanceErr.Operation,
			Reason: maintenanceErr.Reason, OperationID: operationID, cause: err,
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
		OperationID: operationID, Retryable: maintenanceErr.Retryable,
		SafeToRetry: safeToRetry, cause: err,
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

func floretPostCommitError(operation flruntime.SQLiteStoreMaintenanceOperation, operationID string, err error) error {
	result := &FloretStoreStartupError{
		Class: FloretStoreStartupPostCommitVerification, Operation: operation,
		OperationID: operationID, Committed: true, cause: err,
	}
	var maintenanceErr *flruntime.SQLiteStoreMaintenanceError
	if errors.As(err, &maintenanceErr) {
		result.Reason = maintenanceErr.Reason
		result.Retryable = maintenanceErr.Retryable
	}
	return result
}

func floretPostCommitErrorAfterInspection(ctx context.Context, path string, api floretStoreMaintenanceAPI, operation flruntime.SQLiteStoreMaintenanceOperation, operationID string, err error, options ...flruntime.SQLiteStoreOption) error {
	_, _ = api.Inspect(ctx, path, options...)
	return floretPostCommitError(operation, operationID, err)
}

func floretStoreContractErrorWithResult(operation flruntime.SQLiteStoreMaintenanceOperation, operationID string, result flruntime.SQLiteStoreMigrationResult, err error) error {
	return &FloretStoreStartupError{
		Class: FloretStoreStartupContractError, Operation: operation,
		Reason: result.Reason, OperationID: operationID,
		Committed: result.Committed, RolledBack: result.RolledBack, cause: err,
	}
}

func newFloretStoreContractError(operation flruntime.SQLiteStoreMaintenanceOperation, detail string) error {
	return &FloretStoreStartupError{
		Class:     FloretStoreStartupContractError,
		Operation: operation,
		cause:     errors.New(detail),
	}
}

func newFloretStoreOperationID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "floret_store_" + hex.EncodeToString(raw[:]), nil
}
