package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flstorage "github.com/floegence/floret/v2/storage"
)

const floretV2MigrationOperationID = "redeven-floret-v2-cutover-v1"

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

// FloretStoreStartupError is Redeven's readiness-safe projection of a public
// Floret storage or migration error. It intentionally contains no schema rows
// or backend implementation details.
type FloretStoreStartupError struct {
	Class       FloretStoreStartupClass
	OperationID string
	Retryable   bool
	SafeToRetry bool
	Committed   bool
	RolledBack  bool
	cause       error
}

func (e *FloretStoreStartupError) Error() string {
	if e == nil {
		return "Floret storage startup failed"
	}
	return fmt.Sprintf("Floret storage startup failed: class=%s", e.Class)
}

func (e *FloretStoreStartupError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

// IMPORTANT: Redeven treats Floret storage as opaque and performs the v2
// cutover only through Floret's published Source and migration contracts.
func prepareFloretStorage(ctx context.Context, path string, progress func(FloretStoreStartupPhase)) (flstorage.Source, error) {
	if ctx == nil || strings.TrimSpace(path) == "" || path != strings.TrimSpace(path) {
		return nil, floretStoreStartupError(FloretStoreStartupContractError, false, false, false, false, errors.New("Floret storage startup requires a context and canonical path"))
	}
	if err := ctx.Err(); err != nil {
		return nil, floretStoreStartupError(FloretStoreStartupCancelled, true, true, false, false, err)
	}
	source := flstorage.SQLite(path)
	reportFloretStorePhase(progress, FloretStoreStartupInspecting)
	backend, err := source.Open(ctx)
	if err == nil {
		if backend == nil {
			return nil, floretStoreStartupError(FloretStoreStartupContractError, false, false, false, false, errors.New("Floret storage source returned no backend"))
		}
		if closeErr := backend.Close(); closeErr != nil {
			return nil, floretStoreStartupError(FloretStoreStartupIOError, true, true, false, false, closeErr)
		}
		reportFloretStorePhase(progress, FloretStoreStartupVerifying)
		return source, nil
	}
	if !errors.Is(err, flstorage.ErrMigrationRequired) {
		return nil, classifyFloretStorageOpenError(err)
	}

	reportFloretStorePhase(progress, FloretStoreStartupMigrating)
	_, err = flstorage.MigrateV2(ctx, flstorage.MigrateV2Request{
		Path: path, OperationID: floretV2MigrationOperationID,
	})
	if err != nil {
		return nil, classifyFloretMigrationError(err)
	}

	reportFloretStorePhase(progress, FloretStoreStartupVerifying)
	backend, err = source.Open(ctx)
	if err != nil {
		return nil, floretStoreStartupError(FloretStoreStartupPostCommitVerification, false, false, true, false, err)
	}
	if backend == nil {
		return nil, floretStoreStartupError(FloretStoreStartupPostCommitVerification, false, false, true, false, errors.New("migrated Floret storage returned no backend"))
	}
	if err := backend.Close(); err != nil {
		return nil, floretStoreStartupError(FloretStoreStartupPostCommitVerification, false, false, true, false, err)
	}
	return source, nil
}

func reportFloretStorePhase(progress func(FloretStoreStartupPhase), phase FloretStoreStartupPhase) {
	if progress != nil {
		progress(phase)
	}
}

func classifyFloretStorageOpenError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return floretStoreStartupError(FloretStoreStartupCancelled, true, true, false, false, err)
	}
	if errors.Is(err, flstorage.ErrInvalidArgument) {
		return floretStoreStartupError(FloretStoreStartupUnsupportedStore, false, false, false, false, err)
	}
	if errors.Is(err, flstorage.ErrConflict) {
		return floretStoreStartupError(FloretStoreStartupTemporarilyBlocked, true, true, false, false, err)
	}
	return floretStoreStartupError(FloretStoreStartupIOError, true, true, false, false, err)
}

func classifyFloretMigrationError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return floretStoreStartupError(FloretStoreStartupCancelled, true, true, false, true, err)
	}
	var schemaError *flstorage.MigrationSchemaError
	if errors.As(err, &schemaError) {
		return floretStoreStartupError(FloretStoreStartupUnsupportedStore, false, false, false, true, err)
	}
	if errors.Is(err, flstorage.ErrMigrationConflict) {
		return floretStoreStartupError(FloretStoreStartupConfigurationError, false, false, false, true, err)
	}
	if errors.Is(err, flstorage.ErrInvalidArgument) {
		return floretStoreStartupError(FloretStoreStartupContractError, false, false, false, true, err)
	}
	return floretStoreStartupError(FloretStoreStartupMigrationRolledBack, true, true, false, true, err)
}

func floretStoreStartupError(class FloretStoreStartupClass, retryable, safeToRetry, committed, rolledBack bool, cause error) error {
	return &FloretStoreStartupError{
		Class: class, OperationID: floretV2MigrationOperationID,
		Retryable: retryable, SafeToRetry: safeToRetry, Committed: committed, RolledBack: rolledBack, cause: cause,
	}
}
