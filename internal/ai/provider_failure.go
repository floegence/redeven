package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

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
	Provider    string `json:"provider"`
	Status      int    `json:"http_status,omitempty"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message,omitempty"`
	Param       string `json:"param,omitempty"`
	RequestID   string `json:"request_id,omitempty"`
	Shape       string `json:"response_shape"`
	LimitSource string `json:"limit_source,omitempty"`
}

type providerFailure struct {
	diagnostic providerFailureDiagnostic
	cause      error
}

func (e *providerFailure) Error() string {
	raw, _ := json.Marshal(e.diagnostic.sanitized())
	return providerFailurePrefix + string(raw)
}
func (e *providerFailure) Unwrap() error { return e.cause }

var diagnosticCodePattern = regexp.MustCompile(`^([a-z][a-z0-9_]{0,79}|[45][0-9]{2})$`)
var diagnosticParamPattern = regexp.MustCompile(`^(tools|input|messages|model|instructions|reasoning|text|temperature|top_p|max_output_tokens|stream|store|include)(\.[a-z_]+|\[[0-9]{1,4}\])*$`)
var diagnosticRequestIDPattern = regexp.MustCompile(`^req[_-][A-Za-z0-9_-]{1,120}$`)

func (d providerFailureDiagnostic) sanitized() providerFailureDiagnostic {
	switch d.Provider {
	case "openai", "chatgpt", "openai_compatible", "openrouter", "xai", "groq", "ollama", "google", "chatglm", "qwen", "moonshot", "deepseek", "anthropic":
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
	case "standard_error", "detail", "json_object", "json_array", "json_value", "empty", "non_json", "stream_error", "truncated":
	default:
		d.Shape = "empty"
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
	var d providerFailureDiagnostic
	if !strings.HasPrefix(message, providerFailurePrefix) || len(message) > 8192 {
		return d, false
	}
	decoder := json.NewDecoder(strings.NewReader(strings.TrimPrefix(message, providerFailurePrefix)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&d) != nil {
		return d, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return d, false
	}
	return d.sanitized(), true
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
	var streamError *ssestream.StreamError
	if errors.As(err, &streamError) {
		return providerStreamFailure(string(streamError.Event.Data), response, providerType)
	}
	d := providerFailureDiagnostic{Provider: providerType}
	var upstream *openai.Error
	if errors.As(err, &upstream) {
		d.Status, d.Code, d.Message, d.Param = upstream.StatusCode, upstream.Code, upstream.Message, upstream.Param
		if response == nil {
			response = upstream.Response
		}
	}
	if response == nil || response.StatusCode < 400 {
		return err
	}
	d.Status, d.RequestID = response.StatusCode, response.Header.Get("x-request-id")
	var raw []byte
	if response.Body != nil {
		raw, _ = io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	}
	d = diagnosticFromBody(d, raw)
	if providerType == "chatgpt" {
		err = &chatgpt.RequestError{Status: d.Status, Code: d.Code, RequestID: d.RequestID, Body: raw}
	}
	return &providerFailure{diagnostic: d, cause: err}
}

func providerStreamFailure(raw string, response *http.Response, providerType string) error {
	d := diagnosticFromBody(providerFailureDiagnostic{Provider: providerType, Shape: "stream_error"}, []byte(raw))
	d.Shape = "stream_error"
	if response != nil {
		d.Status = response.StatusCode
		d.RequestID = response.Header.Get("x-request-id")
	}
	var cause error = errors.New("provider response failed")
	if providerType == "chatgpt" {
		cause = &chatgpt.RequestError{Status: d.Status, Code: d.Code, RequestID: d.RequestID}
	}
	return &providerFailure{diagnostic: d.sanitized(), cause: cause}
}

func canonicalProviderFailure(err error) error {
	var failure *providerFailure
	if errors.As(err, &failure) {
		return failure
	}
	var account *chatgpt.RequestError
	if errors.As(err, &account) {
		d := diagnosticFromBody(providerFailureDiagnostic{Provider: "chatgpt", Status: account.Status, Code: account.Code, RequestID: account.RequestID}, account.Body)
		return &providerFailure{diagnostic: d, cause: err}
	}
	var accountFailure *chatgpt.Error
	if errors.As(err, &accountFailure) {
		return &providerFailure{diagnostic: providerFailureDiagnostic{Provider: "chatgpt", Code: accountFailure.Code, Shape: "empty"}.sanitized(), cause: err}
	}
	var floretHTTP *flprovider.ProviderHTTPError
	if errors.As(err, &floretHTTP) && floretHTTP != nil {
		d := providerFailureDiagnostic{
			Provider: strings.ToLower(strings.TrimSpace(floretHTTP.Provider)), Status: floretHTTP.StatusCode,
			Code: floretHTTP.Code, Message: floretHTTP.Message, Shape: "standard_error",
		}
		return &providerFailure{diagnostic: d.sanitized(), cause: err}
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
	if d.Code == "invalid_request_error" || d.Code == "invalid_function_parameters" {
		return runErrorCodeProviderRequestInvalid
	}
	return runErrorCodeProviderRequestRejected
}

func strictSchemaError(format string, args ...any) error {
	return &providerFailure{diagnostic: providerFailureDiagnostic{Provider: "openai", Code: "invalid_function_parameters", Param: "tools", Shape: "empty"}, cause: fmt.Errorf(format, args...)}
}
