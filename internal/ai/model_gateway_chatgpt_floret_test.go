package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
)

func TestChatGPTFloretToolHistoryRestartAndCompaction(t *testing.T) {
	var requests, effects atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		n := requests.Add(1)
		if _, ok := body["previous_response_id"]; ok {
			t.Error("ChatGPT relied on server continuation")
		}
		if n == 2 && (!strings.Contains(string(body["input"]), "opaque-history") || !strings.Contains(string(body["input"]), "Observed once.")) {
			t.Error("tool continuation lost native state or canonical result")
		}
		if n == 3 && (!strings.Contains(string(body["input"]), "opaque-history") || !strings.Contains(string(body["input"]), "Inspect the available target.")) {
			t.Error("restart lost canonical or native history")
		}
		output := `[{"type":"message","id":"answer","role":"assistant","status":"completed","content":[{"type":"output_text","text":"The target was inspected once. The conversation then continued with complete historical context.","annotations":[]}]}]`
		if n == 1 {
			output = `[{"type":"reasoning","id":"reasoning","summary":[],"encrypted_content":"opaque-history"},{"type":"function_call","id":"inspect-item","call_id":"inspect-call","name":"inspect","namespace":"redeven","arguments":"{\"hint\":null}","status":"completed"}]`
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response-%d\",\"model\":\"gpt-6.1-sol\",\"status\":\"completed\",\"output\":%s}}\n\n", n, output)
	}))
	defer server.Close()
	raw, err := newProviderAdapter("openai", server.URL, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	provider := raw.(*openAIProvider)
	provider.chatGPT = true
	provider.strictToolSchema = true
	provider.chatGPTToken = func(context.Context) (string, error) { return "fixture", nil }
	gateway := newFloretProviderAdapter(provider, "openai", "gpt-6.1-sol", ProviderControls{}, TurnBudgets{}, "")
	gateway.identity, err = redevenFloretGatewayIdentity("openai", "openai", server.URL, "gpt-6.1-sol", "responses", "chatgpt", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "inspect", InputSchema: fltools.StrictObject(map[string]any{"hint": map[string]any{"type": "string"}}, []string{}), ReadOnly: true, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(_ context.Context, invocation fltools.Invocation[map[string]any]) (fltools.Result, error) {
		if _, exists := invocation.Args["hint"]; exists {
			t.Error("synthetic null reached canonical tool execution")
		}
		effects.Add(1)
		return fltools.Result{Text: "Observed once."}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Inspect once.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(path)})
		if err != nil {
			t.Fatal(err)
		}
		service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
		if err != nil {
			t.Fatal(err)
		}
		return host, service
	}
	host, service := open()
	defer func() { _ = host.Shutdown(context.Background()) }()
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Inspect the available target."}}); err != nil {
		t.Fatal(err)
	}
	first := waitDesktopContinuation(t, service, created.ThreadID)
	if first.Failure != nil {
		t.Fatalf("tool continuation: %+v", first.Failure)
	}
	if requests.Load() != 2 || effects.Load() != 1 {
		t.Fatalf("requests=%d effects=%d", requests.Load(), effects.Load())
	}
	if err := host.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	for index := 0; index < 3; index++ {
		if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("next-%d", index)), Input: flruntime.UserInput{Text: strings.Repeat("Complete historical context after restart. ", 500)}}); err != nil {
			t.Fatal(err)
		}
		if view := waitDesktopContinuation(t, service, created.ThreadID); view.Failure != nil {
			t.Fatalf("restart: %+v", view.Failure)
		}
	}
	if _, err := service.(flruntime.ThreadContextCompactor).CompactContext(t.Context(), flruntime.CompactContextInput{ThreadID: created.ThreadID, RequestKey: "compact"}); err != nil {
		t.Fatal(err)
	}
	if view := waitDesktopContinuation(t, service, created.ThreadID); view.Failure != nil {
		t.Fatalf("compaction: %+v", view.Failure)
	}
	history, err := service.(flruntime.ThreadContextReader).Context(t.Context(), created.ThreadID)
	if err != nil || len(history.Compactions) != 1 || history.Compactions[0].Status != "compacted" {
		t.Fatalf("compaction: %+v %v", history.Compactions, err)
	}
	if effects.Load() != 1 {
		t.Fatal("history replay ran an effect again")
	}
}

func TestChatGPTCompatibilityIdentityIncludesAuthentication(t *testing.T) {
	api, err := redevenFloretGatewayIdentity("openai", "openai", "", "gpt-6.1-sol", "responses")
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := redevenFloretGatewayIdentity("openai", "openai", "", "gpt-6.1-sol", "responses", "api_key", "")
	if err != nil {
		t.Fatal(err)
	}
	one, _ := redevenFloretGatewayIdentity("openai", "openai", "", "gpt-6.1-sol", "responses", "chatgpt", "one")
	two, _ := redevenFloretGatewayIdentity("openai", "openai", "", "gpt-6.1-sol", "responses", "chatgpt", "two")
	if api.StateCompatibilityKey != explicit.StateCompatibilityKey || api.StateCompatibilityKey == one.StateCompatibilityKey || one.StateCompatibilityKey == two.StateCompatibilityKey {
		t.Fatal("authentication identity reused incompatible state or changed API-key history")
	}
}

func TestFloretProviderFailureDiagnosticsSurviveRestart(t *testing.T) {
	for _, tc := range []struct {
		name, providerType, model, protocol, body, want, detail string
		status                                                  int
		chatGPT                                                 bool
	}{
		{"server_stream", "openai", "gpt-6.1-sol", "responses", "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"500\",\"message\":\"The model is overloaded. Please retry shortly.\"}}}\n\n", runErrorCodeProviderServerError, "The model is overloaded. Please retry shortly.", 200, false},
		{"server_responses", "openai", "gpt-6.1-sol", "responses", `{"error":{"message":"The model is overloaded. Please retry shortly.","code":"server_error"}}`, runErrorCodeProviderServerError, "The model is overloaded. Please retry shortly.", 500, false},
		{"server_chat", "openai", "gpt-6.1-sol", "chat_completions", `{"error":{"message":"The model is overloaded. Please retry shortly.","code":"server_error"}}`, runErrorCodeProviderServerError, "The model is overloaded. Please retry shortly.", 500, false},
		{"chatgpt", "openai", "gpt-6.1-sol", "responses", `{"error":{"message":"Invalid credentials: Bearer sk-secret","code":null,"param":"tools[0].parameters"}}`, runErrorCodeProviderRequestInvalid, "tools[0].parameters", 400, true},
		{"openrouter", "openrouter", "google/gemma-4-31b-it:free", "chat_completions", openRouterSharedPoolFailure, runErrorCodeProviderUpstreamRateLimited, "upstream_provider_shared_pool", 429, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				sends.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if tc.status == 200 {
					w.Header().Set("Content-Type", "text/event-stream")
				}
				w.Header().Set("x-request-id", "req-restart-fixture")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			raw, _ := newProviderAdapter(tc.providerType, server.URL, "fixture", nil)
			provider := raw.(*openAIProvider)
			provider.chatGPT = tc.chatGPT
			provider.client = openai.NewClient(ooption.WithBaseURL(server.URL), ooption.WithMaxRetries(0))
			gateway := newFloretProviderAdapter(provider, tc.providerType, tc.model, ProviderControls{}, TurnBudgets{}, "")
			authIdentity := "api_key"
			if tc.chatGPT {
				authIdentity = "chatgpt"
			}
			gateway.identity, _ = redevenFloretGatewayIdentity(tc.providerType, tc.providerType, server.URL, tc.model, tc.protocol, authIdentity, "fixture")
			policy := flruntime.DefaultProviderRetryPolicy()
			policy.BaseDelay, policy.MaxDelay, policy.Jitter = time.Microsecond, time.Microsecond, 0
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Reply briefly.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentProviderRetryPolicy(policy))
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			open := func() (*flruntime.Host, flruntime.ThreadService) {
				host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(path)})
				if err != nil {
					t.Fatal(err)
				}
				service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
				if err != nil {
					t.Fatal(err)
				}
				return host, service
			}
			host, service := open()
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "hi"}})
			if err != nil {
				t.Fatal(err)
			}
			first := waitDesktopContinuation(t, service, created.ThreadID)
			if first.Failure == nil {
				t.Fatal("provider failure missing")
			}
			wantSends := int32(5)
			if tc.status == http.StatusBadRequest {
				wantSends = 1
			}
			if sends.Load() != wantSends {
				t.Fatalf("physical sends=%d, want %d", sends.Load(), wantSends)
			}
			code, message := projectFloretTurnFailure(first.Failure, runErrorCodeFloretEngineFailed)
			detail := canonicalFailureDetail(first.Failure)
			if code != tc.want || !strings.Contains(detail, "req-restart-fixture") || !strings.Contains(detail, tc.detail) {
				t.Fatalf("failure=%+v code=%s detail=%s", first.Failure, code, detail)
			}
			if strings.Contains(first.Failure.Message+message+detail, "sk-secret") || strings.Contains(first.Failure.Message, "private prompt") {
				t.Fatal("canonical failure leaked credentials")
			}
			if err := host.Shutdown(t.Context()); err != nil {
				t.Fatal(err)
			}
			host, service = open()
			defer host.Shutdown(context.Background())
			restored, err := service.View(t.Context(), created.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			restoredCode, restoredMessage := projectFloretTurnFailure(restored.Failure, runErrorCodeFloretEngineFailed)
			if restored.Failure == nil || restored.Failure.Message != first.Failure.Message || canonicalFailureDetail(restored.Failure) != detail || restoredCode != code || restoredMessage != message {
				t.Fatal("restart lost failure diagnostic")
			}
		})
	}
}
