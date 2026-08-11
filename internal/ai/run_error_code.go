package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	openai "github.com/openai/openai-go"
)

const (
	runErrorCodeProviderAuthFailed        = "provider_auth_failed"
	runErrorCodeProviderMissingKey        = "provider_missing_key"
	runErrorCodeProviderRateLimited       = "provider_rate_limited"
	runErrorCodeProviderUnreachable       = "provider_unreachable"
	runErrorCodeProviderStreamInterrupted = "provider_stream_interrupted"
	runErrorCodeProviderModelUnavailable  = "provider_model_unavailable"
	runErrorCodeFloretEngineFailed        = "floret_engine_failed"
	runErrorCodeFloretAdmissionBlocked    = "floret_thread_admission_blocked"
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
	var openAIError *openai.Error
	if errors.As(err, &openAIError) && openAIError != nil {
		if code := providerHTTPStatusRunErrorCode(openAIError.StatusCode); code != "" {
			return code
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
	if status, ok := providerHTTPStatusFromSDKError(text); ok {
		if code := providerHTTPStatusRunErrorCode(status); code != "" {
			return code
		}
	}
	switch {
	case text == "":
		return strings.TrimSpace(fallback)
	case strings.Contains(text, "missing api key") || strings.Contains(text, "missing provider key") || strings.Contains(text, "api key resolver"):
		return runErrorCodeProviderMissingKey
	case strings.Contains(text, "invalid api key") || strings.Contains(text, "incorrect api key") ||
		(strings.Contains(text, "provider") && (strings.Contains(text, "unauthorized") || strings.Contains(text, "forbidden"))) ||
		(strings.Contains(text, "provider") && strings.Contains(text, "credential")) ||
		(strings.Contains(text, "provider") && strings.Contains(text, "authentication")):
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

func providerHTTPStatusRunErrorCode(status int) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return runErrorCodeProviderAuthFailed
	case http.StatusTooManyRequests:
		return runErrorCodeProviderRateLimited
	case http.StatusNotFound:
		return runErrorCodeProviderModelUnavailable
	default:
		if status >= 500 && status <= 599 {
			return runErrorCodeProviderUnreachable
		}
		return ""
	}
}

func providerHTTPStatusFromSDKError(text string) (int, bool) {
	text = strings.TrimSpace(text)
	methodEnd := strings.IndexByte(text, ' ')
	if methodEnd <= 0 {
		return 0, false
	}
	switch text[:methodEnd] {
	case "get", "post", "put", "patch", "delete":
	default:
		return 0, false
	}
	rest := strings.TrimSpace(text[methodEnd+1:])
	if !strings.HasPrefix(rest, `"`) {
		return 0, false
	}
	quoteEnd := strings.Index(rest[1:], `"`)
	if quoteEnd < 0 {
		return 0, false
	}
	rawURL := rest[1 : quoteEnd+1]
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || strings.TrimSpace(parsed.Host) == "" {
		return 0, false
	}
	statusText := strings.TrimSpace(rest[quoteEnd+2:])
	if !strings.HasPrefix(statusText, ":") {
		return 0, false
	}
	fields := strings.Fields(strings.TrimSpace(statusText[1:]))
	if len(fields) == 0 {
		return 0, false
	}
	status, err := strconv.Atoi(fields[0])
	if err != nil || status < 400 || status > 599 {
		return 0, false
	}
	return status, true
}
