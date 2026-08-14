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
		{name: "continuation retry unavailable", err: fmt.Errorf("%w: latest turn is not retryable", ai.ErrThreadContinuationRetryUnavailable), want: http.StatusConflict},
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
