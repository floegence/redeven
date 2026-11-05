package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

func TestOpenAICacheKeyCompletesFloretThreadTurns(t *testing.T) {
	var calls atomic.Int32
	keys := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Key string `json:"prompt_cache_key"`
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" || json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		keys <- body.Key
		if body.Key == "" || len(body.Key) > 64 {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"invalid prompt_cache_key","type":"invalid_request_error","param":"prompt_cache_key"}}`)
			return
		}
		writeOpenAIResponsesSSE(w, r, "gpt-4o", fmt.Sprintf("response_%d", calls.Add(1)), "cache accepted")
	}))
	defer server.Close()
	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := newProviderAdapter("openai", "https://api.openai.com/v1", "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	p := adapter.(*openAIProvider)
	configureOpenAIConnections(p, "profile", "https://api.openai.com/v1", "api_key:account", nil)
	p.client = openai.NewClient(option.WithAPIKey("fixture"), option.WithBaseURL("https://api.openai.com/v1/"), option.WithMaxRetries(0), option.WithHTTPClient(&http.Client{Transport: transportDeadlineRoundTripper(func(r *http.Request) (*http.Response, error) {
		r = r.Clone(r.Context())
		r.URL.Scheme, r.URL.Host, r.Host = target.Scheme, target.Host, target.Host
		return http.DefaultTransport.RoundTrip(r)
	})}))
	gateway := newFloretProviderAdapter(p, "openai", "gpt-4o", ProviderControls{}, TurnBudgets{}, "")
	gateway.identity, err = redevenFloretGatewayIdentity("profile", "openai", "https://api.openai.com/v1", "gpt-4o", "responses")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Reply briefly.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentProviderRetryPolicy(flruntime.ProviderRetryPolicy{Disabled: true}))
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	defer host.Shutdown(context.Background())
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
	if err != nil {
		t.Fatal(err)
	}
	thread, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		sent, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("send-%d", i)), Input: flruntime.UserInput{Text: "Reply briefly."}})
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(10 * time.Second)
		for {
			view, err := service.View(t.Context(), thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if view.TurnID == sent.TurnID && view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
				if *view.LastOutcome != flruntime.TurnOutcomeCompleted || view.Failure != nil {
					t.Fatalf("turn %d failed: %+v", i, view.Failure)
				}
				found := false
				for _, item := range view.Items {
					if item.TurnID == sent.TurnID && strings.Contains(item.Text, "cache accepted") {
						found = true
					}
				}
				if !found {
					t.Fatalf("turn %d did not publish the assistant response", i)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("turn %d did not settle", i)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("provider calls = %d, want 2", calls.Load())
	}
	first, second := <-keys, <-keys
	if first == "" || len(first) > 64 || first != second {
		t.Fatalf("invalid or unstable thread cache keys: %q, %q", first, second)
	}
}
