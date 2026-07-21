package ai

import (
	"fmt"
	"testing"
)

func TestToAIRPCErrorMapsStopOutcome(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		code uint32
	}{
		{name: "pending", err: fmt.Errorf("%w: waiting for terminal proof", ErrThreadStopPending), code: 409},
		{name: "unavailable", err: fmt.Errorf("%w: canonical owner missing", ErrThreadStopUnavailable), code: 503},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := toAIRPCError(tc.err)
			if got == nil || got.Code != tc.code {
				t.Fatalf("toAIRPCError(%v)=%#v, want code %d", tc.err, got, tc.code)
			}
		})
	}
}
