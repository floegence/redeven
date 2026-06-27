package ai

import (
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

func TestIdleCompactThreadResultStatus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		result flruntime.CompactThreadResult
		want   string
	}{
		{
			name:   "floret completed without compaction is noop",
			result: flruntime.CompactThreadResult{Status: "completed"},
			want:   "noop",
		},
		{
			name:   "floret completed with compaction is compacted",
			result: flruntime.CompactThreadResult{Status: "completed", Metrics: flruntime.RunMetrics{Compactions: 1}},
			want:   "compacted",
		},
		{
			name:   "explicit noop is noop",
			result: flruntime.CompactThreadResult{Status: "noop"},
			want:   "noop",
		},
		{
			name:   "explicit compacted is compacted",
			result: flruntime.CompactThreadResult{Status: "compacted"},
			want:   "compacted",
		},
		{
			name:   "unknown status is not terminal success",
			result: flruntime.CompactThreadResult{Status: "failed"},
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := idleCompactThreadResultStatus(tt.result); got != tt.want {
				t.Fatalf("idleCompactThreadResultStatus()=%q, want %q", got, tt.want)
			}
		})
	}
}
