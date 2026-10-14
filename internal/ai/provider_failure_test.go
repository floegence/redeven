package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/chatgpt"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
)

// This fixture preserves the structured error observed from OpenRouter's free
// model endpoint. Private fields exercise the presentation boundary as well.
const openRouterSharedPoolFailure = `{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"private upstream prose Bearer sk-secret","provider_name":"Google AI Studio","is_byok":false,"provider_error_code":"429","limit_source":"upstream_provider_shared_pool","remedy_hint":"https://private.example/remedy"}},"user_id":"private-account-id"}`

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
			for _, private := range []string{"private", "Bearer", "sk-secret", "Google AI Studio", "https://", "quota", "limit resets"} {
				if strings.Contains(failure.Message+message+detail, private) {
					t.Errorf("untrusted or unsupported claim exposed: %s", private)
				}
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
		{"invalid_numeric_code", "openrouter", `{"error":{"code":429.5}}`, runErrorCodeProviderRequestRejected, 200},
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
		{"uncoded", 400, `{"error":{"message":"private prompt Bearer sk-secret","code":null,"param":"tools[0].parameters"}}`, "standard_error", "", runErrorCodeProviderRequestInvalid},
		{"detail", 400, `{"detail":{"message":"private prompt","code":"invalid_function_parameters","param":"tools"}}`, "detail", "invalid_function_parameters", runErrorCodeProviderRequestInvalid},
		{"empty", 400, "", "empty", "", runErrorCodeProviderRequestInvalid},
		{"html", 400, `<html>Bearer sk-secret</html>`, "non_json", "", runErrorCodeProviderRequestInvalid},
		{"auth", 401, `{"detail":"private credentials"}`, "detail", "", runErrorCodeChatGPTReview},
		{"permission", 403, `{"error":{"code":"chatpass_v2_scope_not_authorized"}}`, "standard_error", "chatpass_v2_scope_not_authorized", runErrorCodeChatGPTPermission},
		{"quota", 429, `{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}`, "standard_error", "subscription_sharing_usage_limit_exceeded", runErrorCodeChatGPTUsage},
		{"temporary", 503, `{"error":{"code":"subscription_sharing_usage_unavailable"}}`, "standard_error", "subscription_sharing_usage_unavailable", runErrorCodeChatGPTTemporary},
		{"stream", 200, "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"Bearer sk-secret\",\"param\":\"tools\"}}}\n\n", "stream_error", "subscription_sharing_usage_limit_exceeded", runErrorCodeChatGPTUsage},
		{"sdk_stream", 200, "data: {\"error\":{\"code\":\"invalid_request_error\",\"message\":\"private prompt\",\"param\":\"tools\"}}\n\n", "stream_error", "invalid_request_error", runErrorCodeProviderRequestInvalid},
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
	if code != runErrorCodeProviderRequestRejected || message == "ChatGPT:" || message == "" {
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
