package gatewayflow

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// Observe emits one aggregation-ready event per completed operation. Errors are
// classified locally; their text may contain URLs or credentials and is never logged.
func Observe(ctx context.Context, operation string, start time.Time, err error) {
	outcome := "success"
	if err != nil {
		outcome = "failed"
		if errors.Is(err, context.Canceled) {
			outcome = "canceled"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			outcome = "timeout"
		}
		if errors.Is(err, ErrCapacity) {
			outcome = "capacity"
		}
	}
	slog.InfoContext(ctx, "Gateway operation", "operation", operation, "outcome", outcome, "duration_ms", time.Since(start).Milliseconds())
}
