package ai

import (
	"context"
)

// floretPendingToolRecoveryCoordinator is the only capability allowed to mint
// and use a provider-free settlement host after exact RunTurn authority has
// been released by the caller's lifecycle barrier.
type floretPendingToolRecoveryCoordinator interface {
	Settle(
		ctx context.Context,
		executionThreadID string,
		authorityThreadID string,
		settle func(context.Context, floretPendingToolSettler) error,
	) error
}
