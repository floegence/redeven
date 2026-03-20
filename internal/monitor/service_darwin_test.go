//go:build darwin

package monitor

import (
	"context"
	"math"
	"testing"
	"time"
)

func Test_readCPUUsage_reportsFiniteDarwinSample(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	usage, err := readCPUUsage(ctx)
	if err != nil {
		t.Fatalf("readCPUUsage() error = %v", err)
	}
	if math.IsNaN(usage) || math.IsInf(usage, 0) {
		t.Fatalf("readCPUUsage() = %v, want finite number", usage)
	}
	if usage < 0 || usage > 100 {
		t.Fatalf("readCPUUsage() = %v, want within [0, 100]", usage)
	}
}
