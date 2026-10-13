package ai

import (
	"context"
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
	packet := providerFailurePrefix + `{"provider":"chatgpt","http_status":400,"code":"Bearer sk-secret","request_id":"Bearer secret-credential","param":"input.secret-credential","response_shape":"private prompt"}`
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
