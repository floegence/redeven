package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	openai "github.com/openai/openai-go"
)

const (
	runErrorCodeProviderAuthFailed          = "provider_auth_failed"
	runErrorCodeProviderMissingKey          = "provider_missing_key"
	runErrorCodeProviderRateLimited         = "provider_rate_limited"
	runErrorCodeProviderUnreachable         = "provider_unreachable"
	runErrorCodeProviderStreamInterrupted   = "provider_stream_interrupted"
	runErrorCodeProviderModelUnavailable    = "provider_model_unavailable"
	runErrorCodeFloretEngineFailed          = "floret_engine_failed"
	runErrorCodeFloretAdmissionBlocked      = "floret_thread_admission_blocked"
	runErrorCodeFloretProjectionUnavailable = "floret_projection_unavailable"
)

func userFacingRunError(code string, fallback string) string {
	fallback = strings.TrimSpace(fallback)
	switch strings.TrimSpace(code) {
	case runErrorCodeProviderAuthFailed:
		return "The selected AI provider rejected the saved credentials. Open Settings and update the Local AI Profile key."
	case runErrorCodeProviderMissingKey:
		return "The selected AI provider is missing an API key. Open Settings and complete the Local AI Profile."
	case runErrorCodeProviderRateLimited:
		return "The selected AI provider is rate limiting this request. Try again after the provider limit resets."
	case runErrorCodeProviderUnreachable:
		return "The selected AI provider could not be reached. Check the provider endpoint and network connection."
	case runErrorCodeProviderStreamInterrupted:
		return "The selected AI provider ended the response stream unexpectedly. Try again, or check the provider endpoint if this keeps happening."
	case runErrorCodeProviderModelUnavailable:
		return "The selected model is not available from this provider. Choose another model in the Local AI Profile."
	case runErrorCodeFloretEngineFailed:
		return "Flower could not finish this turn because the orchestration engine failed."
	case runErrorCodeFloretAdmissionBlocked:
		return "Flower could not start the next turn because the runtime still reports an active turn. Restart recovery did not complete, so the turn was not admitted."
	case runErrorCodeFloretProjectionUnavailable:
		return "Flower finished the turn, but the final reply is temporarily unavailable. Refresh this thread to load it. Do not run the task again because it may have already performed changes."
	default:
		if fallback != "" {
			return fallback
		}
		return "Flower could not finish this reply."
	}
}

func classifyRunFailureCode(err error, fallback string) string {
	if err == nil {
		return strings.TrimSpace(fallback)
	}
	if errors.Is(err, flruntime.ErrTurnProjectionUnavailable) {
		return runErrorCodeFloretProjectionUnavailable
	}
	var openAIError *openai.Error
	if errors.As(err, &openAIError) && openAIError != nil {
		switch openAIError.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return runErrorCodeProviderAuthFailed
		case http.StatusTooManyRequests:
			return runErrorCodeProviderRateLimited
		case http.StatusNotFound:
			return runErrorCodeProviderModelUnavailable
		}
		if openAIError.StatusCode >= 500 {
			return runErrorCodeProviderUnreachable
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return runErrorCodeProviderUnreachable
	}
	if errors.Is(err, context.Canceled) {
		return strings.TrimSpace(fallback)
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return runErrorCodeProviderUnreachable
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return runErrorCodeProviderUnreachable
	}
	text := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case text == "":
		return strings.TrimSpace(fallback)
	case strings.Contains(text, "missing api key") || strings.Contains(text, "missing provider key") || strings.Contains(text, "api key resolver"):
		return runErrorCodeProviderMissingKey
	case strings.Contains(text, "unauthorized") || strings.Contains(text, "forbidden") || strings.Contains(text, "invalid api key") || strings.Contains(text, "incorrect api key"):
		return runErrorCodeProviderAuthFailed
	case strings.Contains(text, "rate limit") || strings.Contains(text, "too many requests") || strings.Contains(text, "quota"):
		return runErrorCodeProviderRateLimited
	case strings.Contains(text, "model") && (strings.Contains(text, "not found") || strings.Contains(text, "not available") || strings.Contains(text, "unsupported") || strings.Contains(text, "does not exist")):
		return runErrorCodeProviderModelUnavailable
	case strings.Contains(text, "connection refused") || strings.Contains(text, "no such host") || strings.Contains(text, "timeout") || strings.Contains(text, "deadline exceeded") || strings.Contains(text, "runtime-control returned http 5"):
		return runErrorCodeProviderUnreachable
	case strings.Contains(text, "unexpected eof") || strings.Contains(text, "stream closed") || strings.Contains(text, "response stream"):
		return runErrorCodeProviderStreamInterrupted
	case strings.Contains(text, "thread already has an active turn"):
		return runErrorCodeFloretAdmissionBlocked
	default:
		return strings.TrimSpace(fallback)
	}
}
