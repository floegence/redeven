package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/chatgpt"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
)

// This fixture preserves the structured error observed from OpenRouter's free
// model endpoint. Private fields exercise the presentation boundary as well.
const openRouterSharedPoolFailure = `{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"private upstream prose Bearer sk-secret","provider_name":"Google AI Studio","is_byok":false,"provider_error_code":"429","limit_source":"upstream_provider_shared_pool","remedy_hint":"https://private.example/remedy"}},"user_id":"private-account-id"}`

const toolArgumentsStalledMessage = "Tool arguments stopped making progress: consecutive whitespace outside JSON strings (output_index=24, whitespace_bytes=8192, limit_bytes=8192)"
const toolArgumentsStalledFailure = `{"type":"response.failed","response":{"error":{"code":"basispoints_tool_arguments_stalled","message":"Tool arguments stopped making progress: consecutive whitespace outside JSON strings (output_index=24, whitespace_bytes=8192, limit_bytes=8192)"}}}`

type failedProviderBody struct {
	data string
}

func (b *failedProviderBody) Read(p []byte) (int, error) {
	n := copy(p, b.data)
	b.data = b.data[n:]
	return n, io.ErrUnexpectedEOF
}

func TestProviderHTTPBodyReadFailurePreservesStatus(t *testing.T) {
	for _, body := range []string{"", `{"error":{"message":"private partial response`} {
		for _, status := range []int{401, 429, 503} {
			t.Run(fmt.Sprintf("status_%d/bytes_%d", status, len(body)), func(t *testing.T) {
				response := &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(&failedProviderBody{data: body})}
				err := providerRequestFailure(errors.New("request failed"), response, "openai")
				d, ok := parseProviderFailure(err.Error())
				if !ok || d.Status != status || d.Shape != "transport_error" || d.Message != "" || !errors.Is(err, io.ErrUnexpectedEOF) {
					t.Fatalf("diagnostic=%+v cause=%v", d, errors.Unwrap(err))
				}
				want := flprovider.HTTPRetryAdvice(status, "", response.Header, time.Now()).Category
				if advice := flprovider.RetryAdviceForError(err); advice.Category != want {
					t.Fatalf("advice=%+v want category=%s", advice, want)
				}
			})
		}
	}
}

func TestToolArgumentsStalledFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		status     int
		forbidden  bool
		category   flprovider.RetryCategory
		want       string
	}{
		{"stream", "basispoints_tool_arguments_stalled", 200, false, flprovider.RetryStreamInterrupted, runErrorCodeProviderStreamInterrupted},
		{"forbidden", "basispoints_tool_arguments_stalled", 200, true, flprovider.RetryStreamInterrupted, runErrorCodeProviderStreamInterrupted},
		{"auth", "basispoints_tool_arguments_stalled", 401, false, flprovider.RetryPermanent, runErrorCodeProviderAuthFailed},
		{"contract", "basispoints_tool_arguments_stalled", 422, false, flprovider.RetryPermanent, runErrorCodeProviderRequestInvalid},
		{"unknown", "basispoints_tool_arguments_stalled_extra", 200, false, "", runErrorCodeProviderRequestFailed},
		{"prose_only", "", 200, false, "", runErrorCodeProviderRequestFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := providerFailureDiagnostic{Provider: "openai", Status: tc.status, Code: tc.code, Message: toolArgumentsStalledMessage, RequestID: "req-stall", Shape: "stream_error"}
			response := &http.Response{StatusCode: tc.status, Header: http.Header{}}
			if tc.forbidden {
				response.Header.Set("x-should-retry", "false")
			}
			advice := responseRetryAdvice(d, response)
			if advice.Category != tc.category || advice.Forbidden != tc.forbidden {
				t.Fatalf("advice=%+v", advice)
			}
			failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: (&providerFailure{diagnostic: d}).Error()}
			code, _ := projectFloretTurnFailure(failure, runErrorCodeFloretEngineFailed)
			detail := canonicalFailureDetail(failure)
			var restored providerFailureDiagnostic
			if code != tc.want || json.Unmarshal([]byte(detail), &restored) != nil || restored != d {
				t.Fatalf("code=%s detail=%s", code, detail)
			}
		})
	}
}

func TestOpenRouterFailurePresentation(t *testing.T) {
	for _, status := range []int{429, 200} {
		t.Run(fmt.Sprintf("http_%d", status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/chat/completions" {
					t.Errorf("unexpected request path: %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				if status == 200 {
					w.Header().Set("Content-Type", "text/event-stream")
				}
				w.WriteHeader(status)
				if status == 200 {
					fmt.Fprintf(w, "data: %s\n\n", openRouterSharedPoolFailure)
				} else {
					fmt.Fprint(w, openRouterSharedPoolFailure)
				}
			}))
			defer server.Close()
			gateway, err := newProviderAdapter("openrouter", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			gateway.(*openAIProvider).client = openai.NewClient(ooption.WithBaseURL(server.URL), ooption.WithMaxRetries(0))
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "google/gemma-4-31b-it:free", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "private prompt"}}}}}, nil)
			if err == nil {
				t.Fatal("provider failure accepted")
			}
			failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: canonicalProviderFailure(err).Error()}
			d, ok := parseProviderFailure(failure.Message)
			if !ok || d.Provider != "openrouter" || d.Status != status || d.Code != "429" {
				t.Fatalf("lost provider or numeric failure evidence: %+v", d)
			}
			code, message := projectFloretTurnFailure(failure, runErrorCodeFloretEngineFailed)
			if code != "provider_upstream_rate_limited" || !strings.Contains(message, "OpenRouter") || !strings.Contains(message, "shared capacity") {
				t.Fatalf("unclear failure: %s %s", code, message)
			}
			detail := canonicalFailureDetail(failure)
			var fields map[string]any
			if json.Unmarshal([]byte(detail), &fields) != nil || fields["limit_source"] != "upstream_provider_shared_pool" {
				t.Fatalf("lost structured limit reason: %s", detail)
			}
			if fields["message"] != "Provider returned error" {
				t.Fatalf("lost safe upstream message: %s", detail)
			}
			for _, private := range []string{"private", "Bearer", "sk-secret", "Google AI Studio", "https://", "quota", "limit resets"} {
				if strings.Contains(failure.Message+message+detail, private) {
					t.Errorf("untrusted or unsupported claim exposed: %s", private)
				}
			}
		})
	}
}

func TestProviderDiagnosticMessageRedactsCredentialsAndBoundsProse(t *testing.T) {
	for _, tc := range []struct {
		name, message string
		want          string
	}{
		{name: "safe", message: "The selected model is temporarily unavailable", want: "The selected model is temporarily unavailable"},
		{name: "credential", message: "Incorrect API key: sk-secret", want: "Incorrect [redacted]"},
		{name: "url", message: "See https://private.example/remedy", want: "See [redacted]"},
		{name: "whitespace", message: "  Model is\n  unavailable. ", want: "Model is unavailable."},
		{name: "too_long", message: strings.Repeat("x", 1025), want: strings.Repeat("x", 1021) + "…"},
		{name: "unicode", message: strings.Repeat("界", 342), want: strings.Repeat("界", 340) + "…"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := (providerFailureDiagnostic{Provider: "openai", Status: 500, Message: tc.message, Shape: "standard_error"}).sanitized()
			if d.Message != tc.want {
				t.Fatalf("message=%q want=%q", d.Message, tc.want)
			}
		})
	}
}

func TestProviderLimitReasonRequiresExplicitEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, provider, body, want string
		status                     int
	}{
		{"unknown_limit", "openrouter", `{"error":{"code":429,"metadata":{"limit_source":"unknown"}}}`, runErrorCodeProviderRateLimited, 429},
		{"no_metadata", "openrouter", `{"error":{"code":429,"message":"quota exhausted"}}`, runErrorCodeProviderRateLimited, 200},
		{"wrong_provider", "openai", openRouterSharedPoolFailure, runErrorCodeProviderRateLimited, 429},
		{"auth_is_authoritative", "openrouter", openRouterSharedPoolFailure, runErrorCodeProviderAuthFailed, 401},
		{"private_metadata", "openrouter", `{"error":{"code":429,"metadata":{"limit_source":"Bearer sk-secret"}}}`, runErrorCodeProviderRateLimited, 429},
		{"invalid_numeric_code", "openrouter", `{"error":{"code":429.5}}`, runErrorCodeProviderRequestFailed, 200},
		{"chatgpt_numeric_auth", "chatgpt", `{"error":{"code":401}}`, runErrorCodeChatGPTReview, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := diagnosticFromBody(providerFailureDiagnostic{Provider: tc.provider, Status: tc.status}, []byte(tc.body))
			if code := providerDiagnosticRunCode(d); code != tc.want {
				t.Fatalf("code=%s want=%s", code, tc.want)
			}
			raw := (&providerFailure{diagnostic: d}).Error()
			if strings.Contains(providerFailureDetail(raw), "limit_source") {
				t.Fatal("unsupported limit evidence retained")
			}
		})
	}
}

func TestCompatibleProviderDiagnosticsKeepAdapterIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":{"code":"invalid_request_error"}}`)
	}))
	defer server.Close()
	for _, providerType := range []string{"openai", "openai_compatible", "openrouter", "xai", "groq", "ollama", "google", "chatglm", "qwen", "moonshot"} {
		t.Run(providerType, func(t *testing.T) {
			gateway, err := newProviderAdapter(providerType, server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "fixture-model", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}, nil)
			if err == nil {
				t.Fatal("provider failure accepted")
			}
			d, ok := parseProviderFailure(err.Error())
			if !ok || d.Provider != providerType || d.Status != 400 {
				t.Fatalf("adapter identity lost: %+v", d)
			}
		})
	}
}

func TestProviderDiagnosticsCaptureHTTPAndStreamFailures(t *testing.T) {
	cases := []struct {
		name                    string
		status                  int
		body, shape, code, want string
	}{
		{"uncoded", 400, `{"error":{"message":"Invalid credentials: Bearer sk-secret","code":null,"param":"tools[0].parameters"}}`, "standard_error", "", runErrorCodeProviderRequestInvalid},
		{"detail", 400, `{"detail":{"message":"Invalid credentials: Bearer sk-secret","code":"invalid_function_parameters","param":"tools"}}`, "detail", "invalid_function_parameters", runErrorCodeProviderRequestInvalid},
		{"empty", 400, "", "empty", "", runErrorCodeProviderRequestInvalid},
		{"html", 400, `<html>Bearer sk-secret</html>`, "non_json", "", runErrorCodeProviderRequestInvalid},
		{"auth", 401, `{"detail":"private credentials"}`, "detail", "", runErrorCodeChatGPTReview},
		{"permission", 403, `{"error":{"code":"chatpass_v2_scope_not_authorized"}}`, "standard_error", "chatpass_v2_scope_not_authorized", runErrorCodeChatGPTPermission},
		{"quota", 429, `{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}`, "standard_error", "subscription_sharing_usage_limit_exceeded", runErrorCodeChatGPTUsage},
		{"temporary", 503, `{"error":{"code":"subscription_sharing_usage_unavailable"}}`, "standard_error", "subscription_sharing_usage_unavailable", runErrorCodeChatGPTTemporary},
		{"stream", 200, "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"Bearer sk-secret\",\"param\":\"tools\"}}}\n\n", "stream_error", "subscription_sharing_usage_limit_exceeded", runErrorCodeChatGPTUsage},
		{"sdk_stream", 200, "data: {\"error\":{\"code\":\"invalid_request_error\",\"message\":\"Bearer sk-secret\",\"param\":\"tools\"}}\n\n", "stream_error", "invalid_request_error", runErrorCodeProviderRequestInvalid},
	}
	for _, tc := range cases {
		for _, protocol := range []string{"openai-responses", "openai-chat-completions"} {
			if tc.name == "stream" && protocol != "openai-responses" {
				continue
			}
			t.Run(tc.name+"/"+protocol, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("x-request-id", "req-fixture")
					w.Header().Set("Content-Type", "application/json")
					if tc.status == 200 {
						w.Header().Set("Content-Type", "text/event-stream")
					}
					w.WriteHeader(tc.status)
					fmt.Fprint(w, tc.body)
				}))
				defer server.Close()
				gateway, _ := newProviderAdapter("openai", server.URL, "fixture", nil)
				p := gateway.(*openAIProvider)
				p.client = openai.NewClient(ooption.WithBaseURL(server.URL), ooption.WithMaxRetries(0))
				p.chatGPT = protocol == "openai-responses"
				p.chatGPTToken = func(context.Context) (string, error) { return "secret-credential", nil }
				_, err := p.StreamTurn(t.Context(), ModelGatewayRequest{Model: "gpt-6.1-sol", Protocol: protocol, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "private prompt"}}}}}, nil)
				if err == nil {
					t.Fatal("failure accepted")
				}
				d, ok := parseProviderFailure(err.Error())
				if !ok || d.Status != tc.status || d.Code != tc.code || d.RequestID != "req-fixture" || d.Shape != tc.shape {
					t.Fatalf("diagnostic=%+v error=%v", d, err)
				}
				want := tc.want
				if !p.chatGPT {
					want = providerDiagnosticRunCode(providerFailureDiagnostic{Provider: "openai", Status: tc.status, Code: tc.code})
				}
				code, message := projectFloretTurnFailure(&flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: err.Error()}, runErrorCodeFloretEngineFailed)
				if code != want || message == "" || strings.HasPrefix(message, providerFailurePrefix) {
					t.Fatalf("code=%s message=%s", code, message)
				}
				detail := canonicalFailureDetail(&flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: err.Error()})
				for _, value := range []string{"private prompt", "Bearer", "sk-secret", "secret-credential"} {
					if strings.Contains(err.Error()+message+detail, value) {
						t.Fatalf("private content leaked: %s", value)
					}
				}
				if p.chatGPT {
					var account *chatgpt.RequestError
					if !errors.As(err, &account) || account.Status != tc.status {
						t.Fatal("credential observation lost typed evidence")
					}
				}
			})
		}
	}
}

func TestProviderDiagnosticProjectionRejectsUntrustedFields(t *testing.T) {
	packet := providerFailurePrefix + `{"provider":"Bearer sk-secret","http_status":400,"code":"Bearer sk-secret","request_id":"Bearer secret-credential","param":"input.secret-credential","response_shape":"private prompt","limit_source":"Bearer sk-secret"}`
	detail := providerFailureDetail(packet)
	if detail == "" {
		t.Fatal("sanitized diagnostic missing")
	}
	for _, value := range []string{"Bearer", "secret-credential", "private prompt", "sk-secret"} {
		if strings.Contains(detail, value) {
			t.Fatal("untrusted diagnostic leaked")
		}
	}
	if providerFailureDetail(packet+` {}`) != "" || providerFailureDetail(providerFailurePrefix+`{"body":"secret"}`) != "" {
		t.Fatal("unsupported envelope accepted")
	}
	code, message := projectRunFailure("ChatGPT:", runErrorCodeFloretEngineFailed)
	if code != runErrorCodeProviderRequestFailed || message == "ChatGPT:" || message == "" {
		t.Fatal("historical empty failure remained blank")
	}
}

func TestProviderDiagnosticPreservesSafeTokenRelatedCodes(t *testing.T) {
	for _, code := range []string{"max_output_tokens_exceeded", "invalid_token", "token_expired"} {
		d := diagnosticFromBody(providerFailureDiagnostic{Provider: "chatgpt", Status: 400}, []byte(fmt.Sprintf(`{"error":{"code":%q}}`, code)))
		if d.Code != code {
			t.Errorf("safe machine code %q was discarded: %+v", code, d)
		}
	}
	for _, code := range []string{"sk_private_credential", "Bearer private_token", "private.token.value"} {
		d := (providerFailureDiagnostic{Code: code}).sanitized()
		if d.Code != "" {
			t.Errorf("credential-shaped code %q was retained", code)
		}
	}
}

func TestHistoricalProviderServerFailureUsesServerGuidance(t *testing.T) {
	failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: providerFailurePrefix + `{"provider":"openai","http_status":500,"response_shape":"standard_error"}`}
	code, message := projectFloretTurnFailure(failure, runErrorCodeFloretEngineFailed)
	if code != runErrorCodeProviderServerError || strings.Contains(message, "network") || !strings.Contains(message, "server error") {
		t.Fatalf("misleading historical failure: %s %s", code, message)
	}
	if strings.Contains(canonicalFailureDetail(failure), `"message"`) {
		t.Fatal("fabricated a lost upstream message")
	}
}

func TestCanonicalProviderHTTPFailurePreservesMessageAndCause(t *testing.T) {
	cause := &flprovider.ProviderHTTPError{Provider: "DeepSeek", StatusCode: 503, Code: "server_error", Message: "The model is overloaded."}
	failure := canonicalProviderFailure(cause)
	diagnostic, ok := parseProviderFailure(failure.Error())
	if !ok || diagnostic.Provider != "deepseek" || diagnostic.Message != cause.Message || !errors.Is(failure, cause) {
		t.Fatalf("lost provider failure: %+v", diagnostic)
	}
}

func TestCanonicalProviderFailurePreservesFloretRetryAdvice(t *testing.T) {
	cause := flprovider.WithRetryAdvice(&flprovider.ProviderHTTPError{Provider: "FlowNode", StatusCode: 500, Code: "upstream_gateway_error"}, flprovider.HTTPRetryAdvice(500, "upstream_gateway_error", nil, time.Now()))
	err := canonicalProviderFailure(cause)
	var adviser flprovider.RetryAdviser
	if !errors.As(err, &adviser) || adviser.ProviderRetryAdvice().Category != flprovider.RetryTransient {
		t.Fatalf("retry advice = %#v, err=%v", adviser, err)
	}
	if !strings.HasPrefix(err.Error(), providerFailurePrefix) {
		t.Fatalf("canonical diagnostic missing: %v", err)
	}
}

func TestResponseRetryAdviceRetainsHeadersAndReceiptTime(t *testing.T) {
	at := time.Now().Add(-30 * time.Second)
	response := &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {"45"}, "Retry-After-Ms": {"46000"}, "X-Should-Retry": {"false"}}, Request: (&http.Request{}).WithContext(context.WithValue(t.Context(), providerResponseReceivedKey{}, at))}
	cause := errors.New("upstream")
	failure := providerRequestFailure(cause, response, "openai")
	var adviser flprovider.RetryAdviser
	if !errors.As(failure, &adviser) {
		t.Fatal("lost response facts")
	}
	advice := adviser.ProviderRetryAdvice()
	if advice.Category != flprovider.RetryRateLimit || !advice.Forbidden || !advice.NotBefore.Equal(at.Add(46*time.Second)) {
		t.Fatalf("advice=%+v", advice)
	}
	wrapped := canonicalProviderFailure(flprovider.WithRetryAdvice(failure, advice))
	if !errors.As(wrapped, &adviser) || adviser.ProviderRetryAdvice() != advice || !errors.Is(wrapped, cause) {
		t.Fatal("canonical wrapper lost advice/cause")
	}
	quota := providerStreamFailure(`{"error":{"type":"insufficient_quota","message":"quota"}}`, response, "anthropic")
	if !errors.As(quota, &adviser) || adviser.ProviderRetryAdvice().Category != flprovider.RetryPermanent {
		t.Fatal("quota treated as temporary rate limit")
	}
}

func TestAnthropicAndCompatibleStreamFailuresCarryStructuredAdvice(t *testing.T) {
	for _, tc := range []struct {
		provider, body string
		status         int
		category       flprovider.RetryCategory
	}{
		{"anthropic", `event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}

`, 200, flprovider.RetryTransient},
		{"anthropic", `{"error":{"type":"authentication_error","message":"invalid"}}`, 401, flprovider.RetryPermanent},
		{"anthropic", `{"error":{"type":"rate_limit_error","message":"busy"}}`, 429, flprovider.RetryRateLimit},
		{"openai_compatible", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n", 200, flprovider.RetryStreamInterrupted},
	} {
		t.Run(tc.provider+fmt.Sprint(tc.status)+string(tc.category), func(t *testing.T) {
			var calls int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if tc.status == 200 {
					w.Header().Set("Content-Type", "text/event-stream")
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			gateway, err := newProviderAdapter(tc.provider, server.URL, "test", nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "test", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "work"}}}}}, nil)
			var adviser flprovider.RetryAdviser
			if !errors.As(err, &adviser) || adviser.ProviderRetryAdvice().Category != tc.category {
				t.Fatalf("err=%v advice=%+v", err, adviser)
			}
			if calls != 1 {
				t.Fatalf("SDK retried %d physical sends", calls)
			}
		})
	}
}

func TestChatGPTRetryFactsRespectAccountAndQuotaBoundaries(t *testing.T) {
	for _, tc := range []struct {
		code     string
		status   int
		category flprovider.RetryCategory
	}{
		{"subscription_sharing_usage_limit_exceeded", 429, flprovider.RetryPermanent},
		{"subscription_sharing_usage_limit_exceeded", 200, flprovider.RetryPermanent},
		{"chatpass_v2_scope_not_authorized", 429, flprovider.RetryPermanent},
		{"subscription_sharing_invalid_user", 500, flprovider.RetryPermanent},
		{"subscription_sharing_usage_unavailable", 200, flprovider.RetryTransient},
		{"temporarily_unavailable", 401, flprovider.RetryPermanent},
		{"rate_limited", 429, flprovider.RetryRateLimit},
	} {
		t.Run(fmt.Sprintf("%s/%d", tc.code, tc.status), func(t *testing.T) {
			response := &http.Response{StatusCode: tc.status, Header: http.Header{"X-Should-Retry": {"true"}}}
			err := providerStreamFailure(fmt.Sprintf(`{"error":{"code":%q}}`, tc.code), response, "chatgpt")
			var adviser flprovider.RetryAdviser
			if !errors.As(err, &adviser) || adviser.ProviderRetryAdvice().Category != tc.category {
				t.Fatalf("advice for %s: %v", tc.code, err)
			}
		})
	}
}

func TestProviderTransportFailurePreservesFacts(t *testing.T) {
	cause := fmt.Errorf("failed to get reader: failed to read frame header: %w", io.EOF)
	err := providerRequestFailure(cause, nil, "chatgpt")
	d, ok := parseProviderFailure(err.Error())
	if !ok || d.Provider != "chatgpt" || d.Shape != "transport_error" || d.Code != "provider_stream_interrupted" || d.Status != 0 || d.Message != "" {
		t.Fatalf("diagnostic=%#v err=%v", d, err)
	}
	if !errors.Is(err, io.EOF) || flprovider.RetryAdviceForError(err).Category != flprovider.RetryStreamInterrupted {
		t.Fatalf("cause/advice lost: %v", err)
	}
	if again := canonicalProviderFailure(err); again.Error() != err.Error() {
		t.Fatal("nested diagnostic")
	}
	for _, advice := range []flprovider.RetryAdvice{{}, {Category: flprovider.RetryPermanent}, {Category: flprovider.RetryStreamInterrupted, Forbidden: true}} {
		got := providerRequestFailure(flprovider.WithRetryAdvice(cause, advice), nil, "openai")
		if flprovider.RetryAdviceForError(got) != advice {
			t.Fatalf("explicit advice lost: %v", got)
		}
	}
}
func TestHistoricalWebSocketEOFFailurePresentation(t *testing.T) {
	f := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: "failed to get reader: failed to read frame header: EOF"}
	code, _ := projectFloretTurnFailure(f, runErrorCodeFloretEngineFailed)
	detail := canonicalFailureDetail(f)
	if code != runErrorCodeProviderStreamInterrupted || strings.Contains(detail, "empty") || strings.Contains(detail, "rejected") || strings.Contains(detail, "chatgpt") {
		t.Fatalf("%s %s", code, detail)
	}
}

func TestProviderNormalizationKeepsOutermostAdviceAndSingleEnvelope(t *testing.T) {
	for _, advice := range []flprovider.RetryAdvice{{}, {Category: flprovider.RetryPermanent}, {Category: flprovider.RetryRateLimit, NotBefore: time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC), Forbidden: true}} {
		for _, cause := range []error{io.EOF, &chatgpt.RequestError{Status: 503}, &chatgpt.Error{Code: "temporarily_unavailable"}, &flprovider.ProviderHTTPError{Provider: "openai", StatusCode: 503}} {
			wrapped := flprovider.WithRetryAdvice(cause, advice)
			for _, err := range []error{providerTransportFailure(wrapped, "openai"), providerRequestFailure(wrapped, &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, "openai")} {
				if got := flprovider.RetryAdviceForError(err); got != advice {
					t.Fatalf("outer advice lost: %#v != %#v", got, advice)
				}
				for n := 0; n < 5; n++ {
					if again := canonicalProviderFailure(err); again != err {
						t.Fatal("normalization added a second envelope")
					}
				}
				if !errors.Is(err, cause) {
					t.Fatal("cause lost")
				}
			}
		}
	}
}
