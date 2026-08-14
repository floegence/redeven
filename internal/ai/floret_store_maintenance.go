package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
	flstorage "github.com/floegence/floret/v4/storage"
	flstoragespi "github.com/floegence/floret/v4/storage/spi"
)

type FloretStoreStartupClass string

type FloretStoreStartupPhase string

const (
	FloretStoreStartupInspecting FloretStoreStartupPhase = "inspecting"
	FloretStoreStartupVerifying  FloretStoreStartupPhase = "verifying"
)

const (
	FloretStoreStartupTemporarilyBlocked         FloretStoreStartupClass = "temporarily_blocked"
	FloretStoreStartupUpdateRequired             FloretStoreStartupClass = "update_required"
	FloretStoreStartupUnsupportedStore           FloretStoreStartupClass = "unsupported_store"
	FloretStoreStartupIntegrityError             FloretStoreStartupClass = "store_integrity_error"
	FloretStoreStartupEnvironmentPermissionError FloretStoreStartupClass = "environment_permission_error"
	FloretStoreStartupIOError                    FloretStoreStartupClass = "store_io_error"
	FloretStoreStartupCancelled                  FloretStoreStartupClass = "cancelled"
	FloretStoreStartupContractError              FloretStoreStartupClass = "contract_error"
)

// FloretStoreStartupError is Redeven's readiness-safe projection of a public
// Floret storage or migration error. It intentionally contains no schema rows
// or backend implementation details.
type FloretStoreStartupError struct {
	Class       FloretStoreStartupClass
	Retryable   bool
	SafeToRetry bool
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

// IMPORTANT: Redeven treats Floret storage as opaque and opens only the
// current published Floret storage contract. Unsupported stores fail closed.
type floretRuntimeOpener func(context.Context, flruntime.Options) (*flruntime.Host, error)

func openFloretHost(ctx context.Context, path string, progress func(FloretStoreStartupPhase), open floretRuntimeOpener) (*flruntime.Host, error) {
	if ctx == nil || strings.TrimSpace(path) == "" || path != strings.TrimSpace(path) || open == nil {
		return nil, floretStoreStartupError(FloretStoreStartupContractError, false, false, errors.New("Floret storage startup requires a context, canonical path, and runtime opener"))
	}
	if err := ctx.Err(); err != nil {
		return nil, floretStoreStartupError(FloretStoreStartupCancelled, true, true, err)
	}
	source := flstorage.SQLite(path)
	reportFloretStorePhase(progress, FloretStoreStartupInspecting)
	host, err := open(ctx, flruntime.Options{Storage: source})
	if err != nil {
		return nil, classifyFloretStorageOpenError(err)
	}
	if host == nil {
		return nil, floretStoreStartupError(FloretStoreStartupContractError, false, false, errors.New("Floret storage source returned no runtime host"))
	}
	reportFloretStorePhase(progress, FloretStoreStartupVerifying)
	return host, nil
}

func reportFloretStorePhase(progress func(FloretStoreStartupPhase), phase FloretStoreStartupPhase) {
	if progress != nil {
		progress(phase)
	}
}

func classifyFloretStorageOpenError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return floretStoreStartupError(FloretStoreStartupCancelled, true, true, err)
	}
	if errors.Is(err, flstoragespi.ErrInvalidArgument) {
		return floretStoreStartupError(FloretStoreStartupUnsupportedStore, false, false, err)
	}
	if errors.Is(err, flstoragespi.ErrConflict) {
		return floretStoreStartupError(FloretStoreStartupTemporarilyBlocked, true, true, err)
	}
	return floretStoreStartupError(FloretStoreStartupIOError, true, true, err)
}

func floretStoreStartupError(class FloretStoreStartupClass, retryable, safeToRetry bool, cause error) error {
	return &FloretStoreStartupError{
		Class: class, Retryable: retryable, SafeToRetry: safeToRetry, cause: cause,
	}
}
