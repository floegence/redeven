package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/chatgpt"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/ssestream"
)

const providerFailurePrefix = "redeven_provider_failure_v1:"

// This bounded product-owned envelope survives Floret's canonical failure
// message. Only structured error messages and reviewed diagnostic fields enter
// it; raw bodies, metadata, endpoints and credentials stay private.
type providerFailureDiagnostic struct {
	MediaKind string `json:"media_kind,omitempty"`
	Actual    int64  `json:"actual,omitempty"`
	Limit     int64  `json:"limit,omitempty"`
	Stage     string `json:"stage,omitempty"`

	ActualBytes int64                      `json:"actual_bytes,omitempty"`
	LimitBytes  int64                      `json:"limit_bytes,omitempty"`
	Attempt     *providerAttemptDiagnostic `json:"attempt,omitempty"`
	Provider    string                     `json:"provider"`
	Status      int                        `json:"http_status,omitempty"`
	Code        string                     `json:"code,omitempty"`
	Message     string                     `json:"message,omitempty"`
	Param       string                     `json:"param,omitempty"`
	RequestID   string                     `json:"request_id,omitempty"`
	Shape       string                     `json:"response_shape"`
	LimitSource string                     `json:"limit_source,omitempty"`
}

type providerFailure struct {
	diagnostic providerFailureDiagnostic
	cause      error
	advice     flprovider.RetryAdvice
	adviceSet  bool
}

func (e *providerFailure) Error() string {
	raw, _ := json.Marshal(e.diagnostic.sanitized())
	return providerFailurePrefix + string(raw)
}
func (e *providerFailure) ProviderRetryAdvice() flprovider.RetryAdvice {
	if e == nil {
		return flprovider.RetryAdvice{}
	}
	if e.adviceSet || e.advice.Category != "" || !e.advice.NotBefore.IsZero() || e.advice.Forbidden {
		return e.advice
	}
	return responseRetryAdvice(e.diagnostic, nil)
}

func (e *providerFailure) Unwrap() error { return e.cause }

var diagnosticCodePattern = regexp.MustCompile(`^([a-z][a-z0-9_]{0,79}|[45][0-9]{2})$`)
var diagnosticParamPattern = regexp.MustCompile(`^(tools|input|messages|model|instructions|reasoning|text|temperature|top_p|max_output_tokens|stream|store|include)(\.[a-z_]+|\[[0-9]{1,4}\])*$`)
var diagnosticRequestIDPattern = regexp.MustCompile(`^req[_-][A-Za-z0-9_-]{1,120}$`)

func (d providerFailureDiagnostic) sanitized() providerFailureDiagnostic {
	switch d.MediaKind {
	case "dimension", "animated_dimension", "count", "bytes", "total_bytes":
		if d.Code != "image_limit_exceeded" || d.Actual <= d.Limit || d.Limit <= 0 {
			d.MediaKind = ""
		}
	default:
		d.MediaKind = ""
	}
	if d.MediaKind == "" {
		d.Actual = 0
		d.Limit = 0
	}
	if d.Stage != "image_preparation" {
		d.Stage = ""
	}

	if d.Code != "request_bytes_exceeded" || d.ActualBytes <= d.LimitBytes || d.LimitBytes <= 0 {
		d.ActualBytes = 0
		d.LimitBytes = 0
	}
	d.Attempt = d.Attempt.sanitized()
	switch d.Provider {
	case "openai", "chatgpt", "openai_compatible", "openrouter", "xai", "groq", "ollama", "google", "chatglm", "qwen", "moonshot", "kimi_code", "deepseek", "anthropic":
	default:
		d.Provider = "unknown"
	}
	if d.Status < 100 || d.Status > 599 {
		d.Status = 0
	}
	if !diagnosticCodePattern.MatchString(d.Code) || strings.HasPrefix(d.Code, "sk_") {
		d.Code = ""
	}
	if !diagnosticParamPattern.MatchString(d.Param) {
		d.Param = ""
	}
	if !diagnosticRequestIDPattern.MatchString(d.RequestID) || strings.Contains(strings.ToLower(d.RequestID), "bearer") || strings.Contains(d.RequestID, "sk-") {
		d.RequestID = ""
	}
	d.Message = sanitizeProviderDiagnosticMessage(d.Message)
	if d.Provider != "openrouter" || d.failureStatus() != http.StatusTooManyRequests || d.LimitSource != "upstream_provider_shared_pool" {
		d.LimitSource = ""
	}
	switch d.Shape {
	case "local_validation", "standard_error", "detail", "json_object", "json_array", "json_value", "empty", "non_json", "stream_error", "truncated", "transport_error", "unknown":
	default:
		d.Shape = "unknown"
	}
	return d
}

var diagnosticSecretPattern = regexp.MustCompile(`(?i)\b(?:bearer\s+[^\s,;]+|sk-[a-z0-9_-]+|(?:api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+)`)
var diagnosticURLPattern = regexp.MustCompile(`(?i)https?://[^\s<>"']+`)

// Only explicit error-message fields cross the product presentation boundary.
// Bound their size, normalize whitespace and redact credential-shaped values
// and URLs. Raw response bodies and metadata are never presentation sources.
func sanitizeProviderDiagnosticMessage(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	value = diagnosticSecretPattern.ReplaceAllString(value, "[redacted]")
	value = diagnosticURLPattern.ReplaceAllString(value, "[redacted]")
	if len(value) > 1024 {
		for len(value) > 1021 {
			_, size := utf8.DecodeLastRuneInString(value)
			value = value[:len(value)-size]
		}
		value += "…"
	}
	return value
}

// Stream errors may carry an HTTP-style numeric code inside an HTTP 200
// response. Preserve the transport status while classifying the explicit code.
func (d providerFailureDiagnostic) failureStatus() int {
	if d.Status >= 400 {
		return d.Status
	}
	if status, err := strconv.Atoi(d.Code); err == nil && status >= 400 && status <= 599 {
		return status
	}
	return d.Status
}

func parseProviderFailure(message string) (providerFailureDiagnostic, bool) {
	if len(message) > 16384 {
		return providerFailureDiagnostic{}, false
	}
	for _, line := range strings.Split(message, "\n") {
		// The Engine wraps the first cause with this fixed context.
		line = strings.TrimPrefix(line, "provider context overflow retry exhausted: ")
		if !strings.HasPrefix(line, providerFailurePrefix) || len(line) > 8192 {
			continue
		}
		var d providerFailureDiagnostic
		decoder := json.NewDecoder(strings.NewReader(strings.TrimPrefix(line, providerFailurePrefix)))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&d) != nil {
			continue
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			continue
		}
		return d.sanitized(), true
	}
	return providerFailureDiagnostic{}, false
}

func diagnosticFromBody(d providerFailureDiagnostic, raw []byte) providerFailureDiagnostic {
	if len(raw) > 64<<10 {
		d.Shape = "truncated"
		return d.sanitized()
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		d.Shape = "empty"
		return d.sanitized()
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		d.Shape = "non_json"
		return d.sanitized()
	}
	switch body := value.(type) {
	case map[string]any:
		d.Shape = "json_object"
		fields := body
		if response, ok := body["response"].(map[string]any); ok {
			fields = response
		}
		if nested, ok := fields["error"].(map[string]any); ok {
			d.Shape = "standard_error"
			fields = nested
		} else if detail, ok := fields["detail"]; ok {
			d.Shape = "detail"
			if nested, ok := detail.(map[string]any); ok {
				fields = nested
			} else if message, ok := detail.(string); ok {
				d.Message = message
			}
		}
		if kind, ok := fields["type"].(string); ok {
			d.Code = kind
		}
		if code, ok := fields["code"].(string); ok {
			d.Code = code
		} else if code, ok := fields["code"].(float64); ok && code >= 400 && code <= 599 && code == float64(int(code)) {
			d.Code = strconv.Itoa(int(code))
		}
		if message, ok := fields["message"].(string); ok {
			d.Message = message
		}
		if param, ok := fields["param"].(string); ok {
			d.Param = param
		}
		if metadata, ok := fields["metadata"].(map[string]any); ok {
			d.LimitSource, _ = metadata["limit_source"].(string)
		}
	case []any:
		d.Shape = "json_array"
	default:
		d.Shape = "json_value"
	}
	return d.sanitized()
}

func providerRequestFailure(err error, response *http.Response, providerType string) error {
	if err == nil {
		return nil
	}
	var existing *providerFailure
	if errors.As(err, &existing) {
		return canonicalProviderFailure(err)
	}
	var streamError *ssestream.StreamError
	if errors.As(err, &streamError) {
		failure := providerStreamFailure(string(streamError.Event.Data), response, providerType)
		return newProviderFailure(failure.diagnostic, errors.Join(err, failure.cause), failure.ProviderRetryAdvice())
	}
	d := providerFailureDiagnostic{Provider: providerType}
	var anthropicHTTP *anthropic.Error
	if errors.As(err, &anthropicHTTP) {
		d = diagnosticFromBody(d, []byte(anthropicHTTP.RawJSON()))
		d.Status = anthropicHTTP.StatusCode
		if response == nil {
			response = anthropicHTTP.Response
		}
	}
	var upstream *openai.Error
	if errors.As(err, &upstream) {
		d.Status, d.Code, d.Message, d.Param = upstream.StatusCode, upstream.Code, upstream.Message, upstream.Param
		if response == nil {
			response = upstream.Response
		}
	}
	if response == nil {
		if d.Status >= 400 {
			if d.Shape == "" {
				d.Shape = "standard_error"
			}
			return newProviderFailure(d, err, responseRetryAdvice(d, nil))
		}
		return providerTransportFailure(err, providerType)
	}
	if response.StatusCode < 400 {
		return providerTransportFailure(err, providerType)
	}
	d.Status, d.RequestID = response.StatusCode, response.Header.Get("x-request-id")
	var raw []byte
	var readErr error
	if response.Body != nil {
		raw, readErr = io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	}
	if readErr != nil {
		d.Shape = "transport_error"
		err = errors.Join(err, readErr)
		raw = nil
	} else if response.Body != nil {
		d = diagnosticFromBody(d, raw)
	} else {
		d.Shape = "unknown"
	}
	if providerType == "chatgpt" {
		err = errors.Join(err, &chatgpt.RequestError{Status: d.Status, Code: d.Code, RequestID: d.RequestID, Body: raw})
	}
	return newProviderFailure(d, err, responseRetryAdvice(d, response))
}

// Transport classification is shared with the Engine; protocol facts remain in
// responseRetryAdvice. Raw error prose never enters the diagnostic envelope.
func providerTransportFailure(err error, providerType string) error {
	if err == nil {
		return nil
	}

	var media *flprovider.MediaLimitError
	if errors.As(err, &media) {
		return newProviderFailure(providerFailureDiagnostic{Provider: providerType, Code: "image_limit_exceeded", Shape: "local_validation", MediaKind: media.Kind, Actual: media.Actual, Limit: media.Limit, Stage: "image_preparation"}, err, flprovider.RetryAdvice{Category: flprovider.RetryPermanent})
	}
	var imageFailure *modelImagePreparationError
	if errors.As(err, &imageFailure) {
		return newProviderFailure(providerFailureDiagnostic{Provider: providerType, Code: "image_preparation_failed", Shape: "local_validation", Stage: "image_preparation", Message: imageFailure.Error()}, err, flprovider.RetryAdvice{Category: flprovider.RetryPermanent})
	}
	var byteLimit *flprovider.RequestByteLimitError
	if errors.As(err, &byteLimit) {
		return newProviderFailure(providerFailureDiagnostic{Provider: providerType, Code: "request_bytes_exceeded", Shape: "unknown", ActualBytes: byteLimit.ActualBytes, LimitBytes: byteLimit.LimitBytes}, err, flprovider.RetryAdvice{Category: flprovider.RetryPermanent})
	}
	var failure *providerFailure
	var rpc *DesktopModelSourceRPCError
	var httpError *flprovider.ProviderHTTPError
	var account *chatgpt.RequestError
	var accountError *chatgpt.Error
	if errors.As(err, &failure) || errors.As(err, &httpError) || errors.As(err, &account) || errors.As(err, &accountError) {
		return canonicalProviderFailure(err)
	}
	var contract *modelGatewayContractError
	if errors.As(err, &contract) {
		return err
	}
	if errors.As(err, &rpc) {
		if rpc.Code == "MODEL_RESULT_INVALID" {
			return &modelGatewayContractError{Cause: err}
		}
		if d, ok := parseProviderFailure(rpc.Message); ok {
			return newProviderFailure(d, err, rpc.ProviderRetryAdvice())
		}
	}
	advice := flprovider.RetryAdviceForError(err)
	d := providerFailureDiagnostic{Provider: providerType, Code: runErrorCodeProviderRequestFailed, Shape: "unknown"}
	switch advice.Category {
	case flprovider.RetryStreamInterrupted:
		d.Code, d.Shape = runErrorCodeProviderStreamInterrupted, "transport_error"
	case flprovider.RetryTimeout:
		d.Code, d.Shape = runErrorCodeProviderRequestTimeout, "transport_error"
	case flprovider.RetryTransient:
		d.Code, d.Shape = runErrorCodeProviderUnreachable, "transport_error"
	}
	return &providerFailure{diagnostic: d.sanitized(), cause: err, advice: advice, adviceSet: true}
}

func providerStreamFailure(raw string, response *http.Response, providerType string) *providerFailure {
	d := diagnosticFromBody(providerFailureDiagnostic{Provider: providerType, Shape: "stream_error"}, []byte(raw))
	d.Shape = "stream_error"
	if response != nil {
		d.Status = response.StatusCode
		d.RequestID = response.Header.Get("x-request-id")
	} else {
		// WebSocket request errors carry status in the event envelope instead
		// of an HTTP response. Preserve it for recovery and account observation.
		var envelope struct {
			Status int `json:"status"`
		}
		if len(raw) <= 64<<10 && json.Unmarshal([]byte(raw), &envelope) == nil && envelope.Status >= 400 && envelope.Status <= 599 {
			d.Status = envelope.Status
		}
	}
	var cause error = errors.New("provider response failed")
	if providerType == "chatgpt" {
		cause = &chatgpt.RequestError{Status: d.Status, Code: d.Code, RequestID: d.RequestID}
	}
	return &providerFailure{diagnostic: d.sanitized(), cause: cause, advice: responseRetryAdvice(d, response)}
}

// One envelope owns presentation; the original chain retains private causes and
// the outermost explicit advice remains authoritative, including empty advice.
func newProviderFailure(d providerFailureDiagnostic, cause error, advice flprovider.RetryAdvice) *providerFailure {
	var adviser flprovider.RetryAdviser
	if errors.As(cause, &adviser) {
		advice = adviser.ProviderRetryAdvice()
	}
	return &providerFailure{diagnostic: d.sanitized(), cause: cause, advice: advice, adviceSet: true}
}

func canonicalProviderFailure(err error) error {
	var failure *providerFailure
	if errors.As(err, &failure) {
		if err == failure {
			return failure
		}
		var adviser flprovider.RetryAdviser
		if errors.As(err, &adviser) {
			copy := *failure
			copy.cause = err
			copy.advice = adviser.ProviderRetryAdvice()
			copy.adviceSet = true
			return &copy
		}
		return failure
	}
	var account *chatgpt.RequestError
	if errors.As(err, &account) {
		d := providerFailureDiagnostic{Provider: "chatgpt", Status: account.Status, Code: account.Code, RequestID: account.RequestID, Shape: "unknown"}
		if account.Body != nil {
			d = diagnosticFromBody(d, account.Body)
		}
		return newProviderFailure(d, err, responseRetryAdvice(d, nil))
	}
	var accountFailure *chatgpt.Error
	if errors.As(err, &accountFailure) {
		d := providerFailureDiagnostic{Provider: "chatgpt", Code: accountFailure.Code, Shape: "unknown"}.sanitized()
		advice := responseRetryAdvice(d, nil)
		advice.NotBefore = accountFailure.RetryAt
		return newProviderFailure(d, err, advice)
	}
	var floretHTTP *flprovider.ProviderHTTPError
	if errors.As(err, &floretHTTP) && floretHTTP != nil {
		d := providerFailureDiagnostic{
			Provider: strings.ToLower(strings.TrimSpace(floretHTTP.Provider)), Status: floretHTTP.StatusCode,
			Code: floretHTTP.Code, Message: floretHTTP.Message, Shape: "standard_error",
		}
		advice := floretHTTP.ProviderRetryAdvice()
		var adviser flprovider.RetryAdviser
		if errors.As(err, &adviser) {
			advice = adviser.ProviderRetryAdvice()
		}
		return newProviderFailure(d, err, advice)
	}
	return err
}

func providerFailureDetail(message string) string {
	d, ok := parseProviderFailure(message)
	if !ok {
		return ""
	}
	raw, _ := json.MarshalIndent(d, "", "  ")
	return string(raw)
}

func providerDiagnosticRunCode(d providerFailureDiagnostic) string {
	d = d.sanitized()
	if d.Code == "image_preparation_failed" {
		return runErrorCodeProviderRequestRejected
	}
	if d.Code == "request_bytes_exceeded" || d.Code == "image_limit_exceeded" {
		return runErrorCodeProviderRequestTooLarge
	}
	status := d.failureStatus()

	if d.Provider == "chatgpt" {
		if code := chatGPTRunFailureCode(d.Code); code != "" {
			return code
		}
		if status == 401 || status == 403 {
			return runErrorCodeChatGPTReview
		}
		if status >= 500 {
			return runErrorCodeChatGPTTemporary
		}
	}
	if d.LimitSource == "upstream_provider_shared_pool" {
		return runErrorCodeProviderUpstreamRateLimited
	}
	if code := providerHTTPStatusRunErrorCode(status); code != "" {
		return code
	}
	if d.Shape == "transport_error" || d.Shape == "unknown" {
		switch d.Code {
		case runErrorCodeProviderStreamInterrupted, runErrorCodeProviderRequestTimeout, runErrorCodeProviderUnreachable, runErrorCodeProviderRequestFailed, runErrorCodeProviderMissingKey:
			return d.Code
		}
	}
	if d.Code == "invalid_request_error" || d.Code == "invalid_function_parameters" {
		return runErrorCodeProviderRequestInvalid
	}
	if responseRetryAdvice(d, nil).Category == flprovider.RetryStreamInterrupted {
		return runErrorCodeProviderStreamInterrupted
	}
	return runErrorCodeProviderRequestFailed
}

func strictSchemaError(format string, args ...any) error {
	return &providerFailure{diagnostic: providerFailureDiagnostic{Provider: "openai", Code: "invalid_function_parameters", Param: "tools", Shape: "unknown"}, cause: fmt.Errorf(format, args...)}
}

// Capture response receipt once, before consuming a potentially long stream.
// The timestamp stays on the response's request context; it is never serialized.
type providerResponseReceivedKey struct{}

func markProviderResponseReceived(response *http.Response) {
	if response == nil {
		return
	}
	req := response.Request
	if req == nil {
		req = &http.Request{}
	}
	if _, ok := req.Context().Value(providerResponseReceivedKey{}).(time.Time); ok {
		return
	}
	response.Request = req.WithContext(context.WithValue(req.Context(), providerResponseReceivedKey{}, time.Now()))
}
func responseRetryAdvice(d providerFailureDiagnostic, response *http.Response) flprovider.RetryAdvice {
	var headers http.Header
	received := time.Now()
	if response != nil {
		headers = response.Header
		if response.Request != nil {
			if at, ok := response.Request.Context().Value(providerResponseReceivedKey{}).(time.Time); ok {
				received = at
			}
		}
	}
	advice := flprovider.HTTPRetryAdvice(d.failureStatus(), d.Code, headers, received)
	// Kimi uses 429 for exhausted subscription quotas and policy restrictions,
	// as well as transient load. Only documented account-limit messages stop retries.
	if d.Provider == "kimi_code" && d.failureStatus() == http.StatusTooManyRequests {
		message := strings.ToLower(d.Message)
		for _, prefix := range []string{
			"you've reached your 5-hour usage limit", "you've reached your weekly (7-day) usage limit",
			"you've reached your monthly usage limit", "you've reached your concurrent request limit",
			"your credit balance is insufficient", "your organization's extra usage balance has run out",
			"you've reached the extra usage limit",
		} {
			if strings.HasPrefix(message, prefix) {
				advice.Category = flprovider.RetryPermanent
				break
			}
		}
	}
	if d.Provider == "chatgpt" {
		code := strings.ToLower(strings.TrimSpace(d.Code))
		switch {
		case chatgpt.Failure(code).Action != "retry", code == "storage_unavailable", code == "logout_cleanup_failed":
			advice.Category = flprovider.RetryPermanent
		case advice.Category == flprovider.RetryPermanent:
			// Authentication and contract failures outrank temporary protocol codes.
		case code == "subscription_sharing_usage_unavailable", code == "temporarily_unavailable":
			advice.Category = flprovider.RetryTransient
		case code == "rate_limited":
			advice.Category = flprovider.RetryRateLimit
		}
	}
	return advice
}
