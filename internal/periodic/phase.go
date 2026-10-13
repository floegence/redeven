package periodic

import (
	"math/rand/v2"
	"time"
)

// InitialDelay spreads periodic work after the immediate startup operation.
func InitialDelay(interval time.Duration) time.Duration {
	if interval <= time.Nanosecond {
		return time.Nanosecond
	}
	return time.Duration(rand.Int64N(int64(interval))) + time.Nanosecond
}
