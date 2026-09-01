package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	openai "github.com/openai/openai-go"
)

const (
	runErrorCodeProviderAuthFailed         = "provider_auth_failed"
	runErrorCodeProviderMissingKey         = "provider_missing_key"
	runErrorCodeProviderRateLimited        = "provider_rate_limited"
	runErrorCodeProviderUnreachable        = "provider_unreachable"
	runErrorCodeProviderStreamInterrupted  = "provider_stream_interrupted"
	runErrorCodeProviderModelUnavailable   = "provider_model_unavailable"
	runErrorCodeModelGatewayContract       = "model_gateway_contract_failed"
	runErrorCodeFloretEngineFailed         = "floret_engine_failed"
	runErrorCodeFloretControlContract      = "floret_control_contract_failed"
	runErrorCodeFloretAdmissionBlocked     = "floret_thread_admission_blocked"
	runErrorCodeFloretAuthorityConsistency = "floret_authority_consistency_failed"
	runErrorCodeFloretEffectOutcomeUnknown = "floret_effect_outcome_unknown"
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
	case runErrorCodeModelGatewayContract:
		return "The model source returned an incomplete tool call. No tool was run. Try again or choose another model."
	case runErrorCodeFloretEngineFailed:
		return "Flower could not finish this turn because the orchestration engine failed."
	case runErrorCodeFloretControlContract:
		return "Flower could not finish this turn because the model returned an invalid interaction control signal."
	case runErrorCodeFloretAdmissionBlocked:
		return "Flower could not start the next turn because the runtime still reports an active turn. Restart recovery did not complete, so the turn was not admitted."
	case runErrorCodeFloretAuthorityConsistency:
		return "Flower could not finish this turn because the committed tool result could not be verified. The tool was not run again; start a new reply to continue."
	case runErrorCodeFloretEffectOutcomeUnknown:
		return "Some operations may have completed, but their results could not be confirmed. The task was stopped to avoid duplicate execution."
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
	var gatewayContractError *modelGatewayContractError
	if errors.As(err, &gatewayContractError) {
		return runErrorCodeModelGatewayContract
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
	case strings.Contains(text, "flower tool call requires id, name, and args") || strings.Contains(text, "model gateway result tool call"):
		return runErrorCodeModelGatewayContract
	case strings.Contains(text, "thread already has an active turn"):
		return runErrorCodeFloretAdmissionBlocked
	case strings.Contains(text, "floret authority state is corrupt") || strings.Contains(text, "session tree authority state is corrupt"):
		return runErrorCodeFloretAuthorityConsistency
	default:
		return strings.TrimSpace(fallback)
	}
}

func projectRunFailure(raw string, fallbackCode string) (string, string) {
	raw = strings.TrimSpace(raw)
	code := classifyRunFailureCode(errors.New(raw), fallbackCode)
	return code, userFacingRunError(code, raw)
}

// projectFloretTurnFailure is the only product presentation boundary for
// canonical Floret turn failures. Floret v6 always supplies typed failures.
func projectFloretTurnFailure(failure *flruntime.ThreadTurnFailure, fallbackCode string) (string, string) {
	if failure == nil {
		return fallbackCode, userFacingRunError(fallbackCode, "")
	}
	message := strings.TrimSpace(failure.Message)
	switch failure.Code {
	case flruntime.ThreadTurnFailureProvider:
		return projectRunFailure(message, fallbackCode)
	case flruntime.ThreadTurnFailureControlError:
		return runErrorCodeFloretControlContract, userFacingRunError(runErrorCodeFloretControlContract, message)
	case flruntime.ThreadTurnFailureEffectOutcomeUnknown:
		return runErrorCodeFloretEffectOutcomeUnknown, userFacingRunError(runErrorCodeFloretEffectOutcomeUnknown, message)
	case flruntime.ThreadTurnFailureInterrupted:
		return "floret_turn_interrupted", "Flower's runtime stopped before this reply finished. Start a new reply to continue."
	case flruntime.ThreadTurnFailureCancelled:
		return "", ""
	case flruntime.ThreadTurnFailureToolDispatch,
		flruntime.ThreadTurnFailureAuthorizationUnavailable,
		flruntime.ThreadTurnFailureAuthorizationContract,
		flruntime.ThreadTurnFailureStorage,
		flruntime.ThreadTurnFailureEngineContract:
		return runErrorCodeFloretEngineFailed, userFacingRunError(runErrorCodeFloretEngineFailed, message)
	case flruntime.ThreadTurnFailureLegacyUnclassified:
		return projectRunFailure(message, fallbackCode)
	default:
		return runErrorCodeFloretEngineFailed, userFacingRunError(runErrorCodeFloretEngineFailed, message)
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
