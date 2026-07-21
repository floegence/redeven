package appserver

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

func TestAIThreadActionHTTPStatusMapsStopOutcome(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "pending", err: fmt.Errorf("%w: waiting for terminal proof", ai.ErrThreadStopPending), want: http.StatusConflict},
		{name: "unavailable", err: fmt.Errorf("%w: canonical owner missing", ai.ErrThreadStopUnavailable), want: http.StatusServiceUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := aiThreadActionHTTPStatus(tc.err); got != tc.want {
				t.Fatalf("aiThreadActionHTTPStatus(%v)=%d, want %d", tc.err, got, tc.want)
			}
		})
	}
}
