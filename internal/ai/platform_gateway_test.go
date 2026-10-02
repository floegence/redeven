package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func platformTestRequest() ModelGatewayRequest {
	return ModelGatewayRequest{RunID: "run-a", ThreadID: "thread-a", TurnID: "turn-a", PromptScopeID: "scope-a", LogicalRequestID: "logical-a", AttemptID: "attempt-a", AttemptEpoch: 1, Model: "test-model", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}, Budgets: TurnBudgets{MaxOutputToken: 32}}
}

func TestPlatformGatewayRejectsUntrustedTransportOrigins(t *testing.T) {
	for _, origin := range []string{"http://ai.example.com", "https://user:secret@ai.example.com", "https://ai.example.com/path", "https://ai.example.com?key=value", "https://ai.example.com#fragment", "file:///tmp/gateway"} {
		if _, err := newPlatformGatewayProvider(origin, "grant", "test-model"); err == nil {
			t.Errorf("unsafe gateway origin accepted: %s", origin)
		}
	}
	for _, origin := range []string{"https://ai.example.com", "http://127.0.0.1:4000", "http://[::1]:4000"} {
		if _, err := newPlatformGatewayProvider(origin, "grant", "test-model"); err != nil {
			t.Errorf("valid gateway origin rejected: %s: %v", origin, err)
		}
	}
}

func TestPlatformGatewayUsesPublicAliasAndTrustedOrigin(t *testing.T) {
	r := &run{
		cfg:         &config.AIConfig{CurrentModelID: "platform/local-name", Providers: []config.AIProvider{{ID: "platform", Type: platformGatewayProviderType, BaseURL: "https://untrusted.invalid", Models: []config.AIProviderModel{{ModelName: "local-name", WireModelName: "public-model"}}}}},
		sessionMeta: &session.Meta{PlatformAIGrant: "grant", PlatformAIGatewayURL: "https://ai.example.com", PlatformAIEntitlementVersion: 1},
	}
	resolved, err := r.resolveModelGatewayForModel("platform/local-name", "platform", true)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := resolved.adapterOverride.(*platformGatewayProvider)
	if !ok || p.modelID != "public-model" || p.baseURL != "https://ai.example.com" || resolved.provider.BaseURL != p.baseURL {
		t.Fatal("public alias or trusted state identity was lost")
	}
	r.sessionMeta.PlatformAIGatewayURL = ""
	if _, err := r.resolveModelGatewayForModel("platform/local-name", "platform", true); err == nil {
		t.Fatal("local configuration supplied a fallback grant destination")
	}
}

func TestPlatformGatewayNativeStreamingAndLease(t *testing.T) {
	for _, protocol := range []string{"", "openai-chat-completions"} {
		t.Run(protocol, func(t *testing.T) {
			calls, renewals := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/ai/v1/catalog" {
					mode := "responses"
					if protocol != "" {
						mode = "chat"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"models": []any{map[string]any{"model_id": "test-model", "available": true, "capabilities": []string{mode}}}})
					return
				}
				if r.URL.Path == "/api/ai/v1/leases/renew" {
					renewals++
					expected := "Bearer grant"
					if renewals > 1 {
						expected = "Bearer renewal"
					}
					if r.Header.Get("Authorization") != expected {
						t.Errorf("unexpected lease authorization")
					}
					_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "new-grant", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
					return
				}
				if r.URL.Path != "/api/ai/v1/requests" {
					t.Errorf("unexpected route %s", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				calls++
				if r.Header.Get("Authorization") != "Bearer new-grant" {
					t.Error("missing renewed lease")
				}
				var request platformGatewayRunRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				if request.LogicalRequestID != "logical-a" || request.AttemptID != "attempt-a" || request.ThreadID != "thread-a" || request.AttemptEpoch != 1 {
					t.Errorf("identity lost: %+v", request)
				}
				var native map[string]any
				_ = json.Unmarshal(request.Payload, &native)
				if native["model"] != "test-model" || native["stream"] != true {
					t.Error("native model request lost")
				}
				if strings.Contains(string(request.Payload), "new-grant") {
					t.Error("lease leaked into model payload")
				}
				if protocol == "" {
					writeOpenAIResponsesSSE(w, r, "test-model", "resp-a", "hello")
				} else {
					w.Header().Set("Content-Type", "text/event-stream")
					flusher := w.(http.Flusher)
					writeOpenAISSEJSON(w, flusher, map[string]any{"id": "chat-a", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "hel"}}}})
					writeOpenAISSEJSON(w, flusher, map[string]any{"id": "chat-a", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "lo"}, "finish_reason": "stop"}}})
				}
			}))
			defer server.Close()
			gateway, err := newPlatformGatewayProvider(server.URL, "grant", "test-model", 1)
			if err != nil {
				t.Fatal(err)
			}
			req := platformTestRequest()
			req.Protocol = protocol
			var events []StreamEvent
			result, err := gateway.StreamTurn(context.Background(), req, func(ev StreamEvent) { events = append(events, ev) })
			if err != nil {
				t.Fatal(err)
			}
			if result.Text != "hello" || len(streamEventTexts(events, StreamEventTextDelta)) == 0 {
				t.Fatalf("missing streamed content: %+v", result)
			}
			if calls != 1 || renewals != 1 {
				t.Fatalf("calls=%d renewals=%d", calls, renewals)
			}
			if protocol == "" && (result.ProviderState == nil || result.ProviderState.ID != "resp-a") {
				t.Fatalf("continuation state lost: %+v", result.ProviderState)
			}
		})
	}
}

func TestPlatformGatewayNoAutomaticRetryOrSecretError(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/ai/v1/catalog" {
			_, _ = w.Write([]byte(`{"models":[{"model_id":"test-model","available":true,"capabilities":["responses"]}]}`))
			return
		}
		if r.URL.Path == "/api/ai/v1/leases/renew" {
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "secret-grant", RenewalToken: "secret-renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
			return
		}
		calls++
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`{"error":{"code":"UPSTREAM_UNCERTAIN","message":"Platform AI unavailable"}}`))
	}))
	defer server.Close()
	gateway, err := newPlatformGatewayProvider(server.URL, "grant", "test-model", 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = gateway.StreamTurn(t.Context(), platformTestRequest(), nil)
	if err == nil || calls != 1 || strings.Contains(err.Error(), "secret-") {
		t.Fatalf("invalid retry/error boundary: calls=%d err=%v", calls, err)
	}
}

func TestPlatformGatewayRequiresStableAdmittedIdentity(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer server.Close()
	gateway, err := newPlatformGatewayProvider(server.URL, "grant", "test-model", 1)
	if err != nil {
		t.Fatal(err)
	}
	req := platformTestRequest()
	req.AttemptID = ""
	if _, err = gateway.StreamTurn(t.Context(), req, nil); err == nil || calls != 0 {
		t.Fatalf("missing identity must fail before dispatch: %v", err)
	}
}
