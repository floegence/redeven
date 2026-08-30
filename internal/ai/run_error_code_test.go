package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v6/runtime"
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
		{
			name: "openai compatible wrapped server unavailable",
			err:  errors.New(`POST "https://api.deepseek.com/chat/completions": 502 Bad Gateway {"error":{"message":"unavailable"}}`),
			want: runErrorCodeProviderUnreachable,
		},
		{name: "missing key", err: errors.New("missing api key for provider"), want: runErrorCodeProviderMissingKey},
		{name: "network timeout", err: timeoutNetError{}, want: runErrorCodeProviderUnreachable},
		{name: "context timeout", err: context.DeadlineExceeded, want: runErrorCodeProviderUnreachable},
		{name: "provider stream eof", err: errors.New("unexpected EOF"), want: runErrorCodeProviderStreamInterrupted},
		{name: "typed model gateway contract", err: &modelGatewayContractError{ToolCallIndex: 0, MissingFields: []string{"args"}}, want: runErrorCodeModelGatewayContract},
		{name: "historical model gateway contract", err: errors.New("Flower tool call requires id, name, and args"), want: runErrorCodeModelGatewayContract},
		{name: "unknown tool text preserves fallback", err: errors.New(`provider returned unregistered tool name "web_search"`), want: runErrorCodeFloretEngineFailed},
		{name: "floret effect authorization rejection", err: errors.New("effect is unauthorized"), want: runErrorCodeFloretEngineFailed},
		{name: "floret wrapped effect authorization rejection", err: errors.New("floret effect is unauthorized: effect is unauthorized"), want: runErrorCodeFloretEngineFailed},
		{name: "floret active turn admission", err: errors.New("thread already has an active turn"), want: runErrorCodeFloretAdmissionBlocked},
		{name: "floret authority consistency", err: errors.New("floret authority state is corrupt: session tree authority state is corrupt"), want: runErrorCodeFloretAuthorityConsistency},
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

func TestUserFacingRunErrorPresentsFloretControlContractFailure(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeFloretControlContract, "invalid control signal shape")
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "shape") {
		t.Fatalf("msg=%q exposed provider contract details", msg)
	}
	if !strings.Contains(lower, "invalid") || !strings.Contains(lower, "control signal") {
		t.Fatalf("msg=%q, want interaction-control presentation", msg)
	}
}

func TestUserFacingRunErrorPresentsModelGatewayContractFailure(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeModelGatewayContract, "Flower tool call requires id, name, and args")
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "requires id") || strings.Contains(lower, "flower tool call") {
		t.Fatalf("msg=%q exposed internal model gateway contract details", msg)
	}
	if !strings.Contains(lower, "model source") || !strings.Contains(lower, "no tool was run") {
		t.Fatalf("msg=%q, want model-source integrity presentation", msg)
	}
}

func TestUserFacingRunErrorHidesAuthorityFailureDetails(t *testing.T) {
	t.Parallel()

	msg := userFacingRunError(runErrorCodeFloretAuthorityConsistency, "floret authority state is corrupt")
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "authority state is corrupt") || strings.Contains(lower, "session tree") {
		t.Fatalf("msg=%q exposed authority internals", msg)
	}
	if !strings.Contains(lower, "tool result") || !strings.Contains(lower, "not run again") {
		t.Fatalf("msg=%q, want safe result-consistency guidance", msg)
	}
}

func TestProjectFloretTurnFailureUsesTypedCanonicalCode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		failure    *flruntime.ThreadTurnFailure
		wantCode   string
		hiddenText string
	}{
		{
			name: "engine contract",
			failure: &flruntime.ThreadTurnFailure{
				Code:    flruntime.ThreadTurnFailureEngineContract,
				Message: "provider attempt superseded with pending canonical tool batch",
			},
			wantCode: runErrorCodeFloretEngineFailed, hiddenText: "pending canonical tool batch",
		},
		{
			name: "storage",
			failure: &flruntime.ThreadTurnFailure{
				Code:    flruntime.ThreadTurnFailureStorage,
				Message: "private repository write failed",
			},
			wantCode: runErrorCodeFloretEngineFailed, hiddenText: "repository write",
		},
		{
			name: "control contract",
			failure: &flruntime.ThreadTurnFailure{
				Code:    flruntime.ThreadTurnFailureControlError,
				Message: "invalid control signal shape",
			},
			wantCode: runErrorCodeFloretControlContract, hiddenText: "shape",
		},
		{
			name: "legacy authority failure",
			failure: &flruntime.ThreadTurnFailure{
				Code:    flruntime.ThreadTurnFailureLegacyUnclassified,
				Message: "floret authority state is corrupt",
			},
			wantCode: runErrorCodeFloretAuthorityConsistency, hiddenText: "authority state is corrupt",
		},
		{
			name: "unknown effect outcome",
			failure: &flruntime.ThreadTurnFailure{
				Code:    flruntime.ThreadTurnFailureEffectOutcomeUnknown,
				Message: "Tool side effects could not be confirmed.",
			},
			wantCode: runErrorCodeFloretEffectOutcomeUnknown, hiddenText: "tool side effects",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			code, message := projectFloretTurnFailure(testCase.failure, "floret_turn_failed")
			if code != testCase.wantCode {
				t.Fatalf("code=%q, want %q", code, testCase.wantCode)
			}
			if message == "" || strings.Contains(strings.ToLower(message), strings.ToLower(testCase.hiddenText)) {
				t.Fatalf("message=%q exposed internal failure text %q", message, testCase.hiddenText)
			}
		})
	}
}
