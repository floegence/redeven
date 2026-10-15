package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/chatgpt"
	openai "github.com/openai/openai-go/v3"
)

const (
	runErrorCodeChatGPTReview               = "chatgpt_review_required"
	runErrorCodeChatGPTTemporary            = "chatgpt_temporarily_unavailable"
	runErrorCodeChatGPTStorage              = "chatgpt_storage_unavailable"
	runErrorCodeChatGPTUsage                = "chatgpt_usage_unavailable"
	runErrorCodeChatGPTAuthorization        = "chatgpt_authorization_required"
	runErrorCodeChatGPTPermission           = "chatgpt_plan_permission_required"
	runErrorCodeProviderAuthFailed          = "provider_auth_failed"
	runErrorCodeProviderMissingKey          = "provider_missing_key"
	runErrorCodeProviderRateLimited         = "provider_rate_limited"
	runErrorCodeProviderUpstreamRateLimited = "provider_upstream_rate_limited"
	runErrorCodeProviderServerError         = "provider_server_error"
	runErrorCodeProviderUnreachable         = "provider_unreachable"
	runErrorCodeProviderStreamInterrupted   = "provider_stream_interrupted"
	runErrorCodeProviderModelUnavailable    = "provider_model_unavailable"
	runErrorCodeProviderRequestInvalid      = "provider_request_invalid"
	runErrorCodeProviderRequestRejected     = "provider_request_rejected"
	runErrorCodeModelGatewayContract        = "model_gateway_contract_failed"
	runErrorCodeContextBudgetInvalid        = "context_budget_invalid"
	runErrorCodeContextFixedOverhead        = "context_fixed_overhead"
	runErrorCodeContextCompactionLimit      = "context_compaction_limit"
	runErrorCodeFloretEngineFailed          = "floret_engine_failed"
	runErrorCodeFloretControlContract       = "floret_control_contract_failed"
	runErrorCodeFloretAdmissionBlocked      = "floret_thread_admission_blocked"
	runErrorCodeFloretAuthorityConsistency  = "floret_authority_consistency_failed"
	runErrorCodeFloretEffectOutcomeUnknown  = "floret_effect_outcome_unknown"
)

func userFacingRunError(code string, fallback string) string {
	fallback = strings.TrimSpace(fallback)
	switch strings.TrimSpace(code) {
	case runErrorCodeChatGPTReview:
		return "ChatGPT rejected this connection. Review the connection or authorize it again in provider settings."
	case runErrorCodeChatGPTTemporary:
		return "The ChatGPT connection is temporarily unavailable. It will recover automatically when the service is reachable."
	case runErrorCodeChatGPTStorage:
		return "ChatGPT credentials could not be saved safely. Repair local account storage and retry in provider settings."
	case runErrorCodeChatGPTUsage:
		return "ChatGPT plan usage is unavailable for this request. Manage your usage or try again later."
	case runErrorCodeChatGPTAuthorization:
		return "Your ChatGPT connection needs authorization. Open provider settings and sign in again."
	case runErrorCodeChatGPTPermission:
		return "Allow access to your ChatGPT plan in provider settings before using this model."
	case runErrorCodeProviderAuthFailed:
		return "The selected AI provider rejected the saved credentials. Open Settings and update the Local AI Profile key."
	case runErrorCodeProviderMissingKey:
		return "The selected AI provider is missing an API key. Open Settings and complete the Local AI Profile."
	case runErrorCodeProviderRateLimited:
		return "The selected AI provider is rate limiting this request. Try again later or choose another model."
	case runErrorCodeProviderUpstreamRateLimited:
		return "The model's upstream provider is temporarily rate limiting OpenRouter's shared capacity. Try again shortly, choose another model, or connect your own provider API key in OpenRouter."
	case runErrorCodeProviderServerError:
		return "The model provider returned a server error. Try again shortly."
	case runErrorCodeProviderUnreachable:
		return "The selected AI provider could not be reached. Check the provider endpoint and network connection."
	case runErrorCodeProviderStreamInterrupted:
		return "The selected AI provider ended the response stream unexpectedly. Try again, or check the provider endpoint if this keeps happening."
	case runErrorCodeProviderModelUnavailable:
		return "The selected model is not available from this provider. Choose another model in the Local AI Profile."
	case runErrorCodeProviderRequestInvalid:
		return "The selected AI provider rejected Flower's request format. Update Redeven and retry."
	case runErrorCodeProviderRequestRejected:
		return "The selected AI provider rejected Flower's request. Check the diagnostic details and try again later."
	case runErrorCodeModelGatewayContract:
		return "The model source returned an incomplete tool call. No tool was run. Try again or choose another model."
	case runErrorCodeContextBudgetInvalid:
		return "The output allowance leaves no room for input. Increase the model's configured context window or lower its output limit, then retry. For Ollama, set num_ctx in the Modelfile and reload the model."
	case runErrorCodeContextFixedOverhead:
		return "The system instructions and tool definitions exceed the model's available context. Increase the serving context window or choose a model with more context, then retry. Compressing chat history cannot resolve this."
	case runErrorCodeContextCompactionLimit:
		return "The conversation still exceeds the model's context limit after compression. Shorten the input or choose a model with more context, then retry."
	case runErrorCodeFloretEngineFailed:
		return "Flower could not finish this turn because the orchestration engine failed."
	case runErrorCodeFloretControlContract:
		return "Flower could not generate a valid question. The reply so far has been preserved. Retry to continue."
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
	if diagnostic, ok := parseProviderFailure(err.Error()); ok {
		return providerDiagnosticRunCode(diagnostic)
	}
	var accountError *chatgpt.Error
	if errors.As(err, &accountError) {
		if code := chatGPTRunFailureCode(accountError.Code); code != "" {
			return code
		}
	}
	var accountRequest *chatgpt.RequestError
	if errors.As(err, &accountRequest) {
		if code := chatGPTRunFailureCode(accountRequest.Code); code != "" {
			return code
		}
		if accountRequest.Status == http.StatusUnauthorized {
			return runErrorCodeChatGPTReview
		}
		if accountRequest.Status == http.StatusForbidden {
			return runErrorCodeChatGPTReview
		}
		if code := providerHTTPStatusRunErrorCode(accountRequest.Status); code != "" {
			return code
		}
	}
	var openAIError *openai.Error
	if errors.As(err, &openAIError) && openAIError != nil {
		if code := providerHTTPStatusRunErrorCode(openAIError.StatusCode); code != "" {
			return code
		}
	}
	var providerHTTPError *flprovider.ProviderHTTPError
	if errors.As(err, &providerHTTPError) && providerHTTPError != nil {
		if providerHTTPError.StatusCode >= 400 && providerHTTPError.StatusCode < 500 {
			if strings.EqualFold(strings.TrimSpace(providerHTTPError.Code), "invalid_request_error") || providerHTTPError.StatusCode == http.StatusBadRequest {
				return runErrorCodeProviderRequestInvalid
			}
			return runErrorCodeProviderRequestRejected
		}
		if code := providerHTTPStatusRunErrorCode(providerHTTPError.StatusCode); code != "" {
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
	if _, code, ok := strings.Cut(text, "chatgpt: "); ok {
		if result := chatGPTRunFailureCode(strings.TrimSpace(code)); result != "" {
			return result
		}
	}
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
	if _, ok := parseProviderFailure(raw); ok || strings.EqualFold(raw, "ChatGPT:") {
		if code == fallbackCode {
			code = runErrorCodeProviderRequestRejected
		}
		return code, userFacingRunError(code, "")
	}
	return code, userFacingRunError(code, raw)
}

// projectFloretTurnFailure is the only product presentation boundary for
// canonical Floret turn failures. Floret v7 always supplies typed failures.
func projectFloretTurnFailure(failure *flruntime.ThreadTurnFailure, fallbackCode string) (string, string) {
	if failure == nil {
		return fallbackCode, userFacingRunError(fallbackCode, "")
	}
	message := strings.TrimSpace(failure.Message)
	switch failure.Code {
	case flruntime.ThreadTurnFailureProvider:
		return projectRunFailure(message, fallbackCode)
	case flruntime.ThreadTurnFailureContextBudgetInvalid:
		return runErrorCodeContextBudgetInvalid, userFacingRunError(runErrorCodeContextBudgetInvalid, "")
	case flruntime.ThreadTurnFailureContextFixedOverhead:
		return runErrorCodeContextFixedOverhead, userFacingRunError(runErrorCodeContextFixedOverhead, "")
	case flruntime.ThreadTurnFailureContextCompactionLimit:
		return runErrorCodeContextCompactionLimit, userFacingRunError(runErrorCodeContextCompactionLimit, "")
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
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return runErrorCodeProviderRequestInvalid
	case http.StatusUnauthorized, http.StatusForbidden:
		return runErrorCodeProviderAuthFailed
	case http.StatusTooManyRequests:
		return runErrorCodeProviderRateLimited
	case http.StatusNotFound:
		return runErrorCodeProviderModelUnavailable
	default:
		if status >= 500 && status <= 599 {
			return runErrorCodeProviderServerError
		}
		if status >= 400 && status <= 499 {
			return runErrorCodeProviderRequestRejected
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

// Only validated provider envelopes and typed numeric budget failures cross
// the diagnostic presentation boundary. Raw upstream bodies stay private.
func canonicalFailureDetail(failure *flruntime.ThreadTurnFailure) string {
	if failure == nil {
		return ""
	}
	switch failure.Code {
	case flruntime.ThreadTurnFailureProvider:
		return providerFailureDetail(failure.Message)
	case flruntime.ThreadTurnFailureContextBudgetInvalid,
		flruntime.ThreadTurnFailureContextFixedOverhead,
		flruntime.ThreadTurnFailureContextCompactionLimit:
		// Only allow numeric budget fields through the product boundary, even
		// if a cleanup error was joined to the typed failure upstream.
		allowed := map[string]bool{
			"context_window_tokens": true, "reserved_output_tokens": true,
			"projected_input_tokens": true, "request_safe_limit": true,
			"fixed_input_tokens": true, "compacted_context_target_tokens": true,
		}
		var fields []string
		for _, field := range strings.Fields(failure.Message) {
			key, value, ok := strings.Cut(field, "=")
			if !ok || !allowed[key] {
				continue
			}
			number, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				continue
			}
			fields = append(fields, key+"="+strconv.FormatInt(number, 10))
			delete(allowed, key)
		}
		return strings.Join(fields, "\n")
	default:
		return ""
	}
}

func chatGPTRunFailureCode(code string) string {
	switch code {
	case "subscription_sharing_usage_unavailable":
		return runErrorCodeChatGPTTemporary
	case "subscription_sharing_usage_limit_exceeded":
		return runErrorCodeChatGPTUsage
	case "plan_permission_required", "chatpass_v2_scope_not_authorized":
		return runErrorCodeChatGPTPermission
	}
	if code == "temporarily_unavailable" {
		return runErrorCodeChatGPTTemporary
	}
	if code == "storage_unavailable" || code == "logout_cleanup_failed" {
		return runErrorCodeChatGPTStorage
	}
	if code == "subscription_sharing_invalid_user" || chatgpt.Failure(code).Action == "review_connection" {
		return runErrorCodeChatGPTReview
	}
	if chatgpt.Failure(code).Action == "sign_in" {
		return runErrorCodeChatGPTAuthorization
	}
	return ""
}
