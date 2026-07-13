package ai

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	openai "github.com/openai/openai-go"
)

type timeoutNetError struct{}

func (timeoutNetError) Error() string   { return "dial timeout" }
func (timeoutNetError) Timeout() bool   { return true }
func (timeoutNetError) Temporary() bool { return true }

var _ net.Error = timeoutNetError{}

func TestClassifyRunFailureCodeProviderErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "openai unauthorized", err: &openai.Error{StatusCode: http.StatusUnauthorized}, want: runErrorCodeProviderAuthFailed},
		{name: "openai forbidden", err: &openai.Error{StatusCode: http.StatusForbidden}, want: runErrorCodeProviderAuthFailed},
		{name: "openai rate limit", err: &openai.Error{StatusCode: http.StatusTooManyRequests}, want: runErrorCodeProviderRateLimited},
		{name: "openai model unavailable", err: &openai.Error{StatusCode: http.StatusNotFound}, want: runErrorCodeProviderModelUnavailable},
		{name: "openai server unavailable", err: &openai.Error{StatusCode: http.StatusBadGateway}, want: runErrorCodeProviderUnreachable},
		{name: "missing key", err: errors.New("missing api key for provider"), want: runErrorCodeProviderMissingKey},
		{name: "network timeout", err: timeoutNetError{}, want: runErrorCodeProviderUnreachable},
		{name: "context timeout", err: context.DeadlineExceeded, want: runErrorCodeProviderUnreachable},
		{name: "provider stream eof", err: errors.New("unexpected EOF"), want: runErrorCodeProviderStreamInterrupted},
		{name: "floret active turn admission", err: errors.New("thread already has an active turn"), want: runErrorCodeFloretAdmissionBlocked},
		{name: "floret projection unavailable", err: fmt.Errorf("%w: detail read failed", flruntime.ErrTurnProjectionUnavailable), want: runErrorCodeFloretProjectionUnavailable},
		{name: "unknown preserves fallback", err: errors.New("other failure"), want: runErrorCodeFloretEngineFailed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyRunFailureCode(tt.err, runErrorCodeFloretEngineFailed); got != tt.want {
				t.Fatalf("classifyRunFailureCode() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestUserFacingRunErrorPresentsFloretProjectionRecovery(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeFloretProjectionUnavailable, "projection failed")
	lower := strings.ToLower(msg)
	if !strings.Contains(lower, "refresh this thread") || !strings.Contains(lower, "do not run the task again") {
		t.Fatalf("msg=%q, want refresh without rerun guidance", msg)
	}
}

func TestUserFacingRunErrorHidesFloretWrapperWhenProviderCodeExists(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeProviderAuthFailed, "Floret hosted turn failed")
	if msg == "" {
		t.Fatalf("userFacingRunError returned empty message")
	}
	if msg == "Floret hosted turn failed" {
		t.Fatalf("userFacingRunError exposed internal Floret wrapper")
	}
}

func TestUserFacingRunErrorPresentsProviderStreamInterruption(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeProviderStreamInterrupted, "unexpected EOF")
	if msg == "" {
		t.Fatalf("userFacingRunError returned empty message")
	}
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "floret") || strings.Contains(lower, "orchestration") {
		t.Fatalf("msg=%q should not blame Floret orchestration", msg)
	}
	if !strings.Contains(lower, "provider") || !strings.Contains(lower, "stream") {
		t.Fatalf("msg=%q, want provider stream-oriented presentation", msg)
	}
}

func TestUserFacingRunErrorPresentsFloretAdmissionBlocked(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeFloretAdmissionBlocked, "thread already has an active turn")
	if msg == "" {
		t.Fatalf("userFacingRunError returned empty message")
	}
	lower := strings.ToLower(msg)
	if !strings.Contains(lower, "active turn") || !strings.Contains(lower, "recovery") {
		t.Fatalf("msg=%q, want active turn recovery presentation", msg)
	}
}
