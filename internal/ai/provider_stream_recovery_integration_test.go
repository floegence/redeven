package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	"github.com/gorilla/websocket"
)

// The physical socket closes without a close frame, reproducing the original
// EOF. Only the Engine may replay the frozen request on a new connection.
func TestProviderWebSocketEOFRecovery(t *testing.T) {
	for _, tc := range []struct {
		name     string
		failures int32
		stop     bool
	}{
		{"before_output", 1, false}, {"partial_text", 1, false}, {"partial_arguments", 1, false},
		{"exhaustion_manual_retry", 5, false}, {"stop_during_recovery", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests, connections atomic.Int32
			var mu sync.Mutex
			var frozen json.RawMessage
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("unexpected HTTP fallback")
					w.WriteHeader(500)
					return
				}
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				connections.Add(1)
				for {
					var body map[string]json.RawMessage
					if conn.ReadJSON(&body) != nil {
						return
					}
					n := requests.Add(1)
					mu.Lock()
					if n == 1 {
						frozen = append(json.RawMessage(nil), body["input"]...)
					}
					if n <= tc.failures+1 && n <= 5 && string(frozen) != string(body["input"]) {
						t.Error("automatic retry changed frozen input")
					}
					mu.Unlock()
					if n <= tc.failures {
						if tc.name != "before_output" {
							_ = conn.WriteJSON(map[string]any{"type": "response.output_text.delta", "delta": "abandoned draft"})
						}
						if tc.name == "partial_arguments" {
							_ = conn.WriteJSON(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "unfinished", "call_id": "unfinished", "name": "never_execute", "namespace": "redeven", "arguments": ""}})
							_ = conn.WriteJSON(map[string]any{"type": "response.function_call_arguments.delta", "item_id": "unfinished", "delta": "{"})
						}
						return
					}
					if conn.WriteJSON(testOpenAICompleted(fmt.Sprintf("response_%d", n))) != nil {
						return
					}
				}
			}))
			defer server.Close()
			pool := newOpenAIResponsesPool()
			defer pool.Close()
			raw := testOpenAISocketProvider(t, server, pool)
			gateway := newFloretProviderAdapter(raw, "openai", "gpt-5.5", ProviderControls{}, TurnBudgets{}, "")
			gateway.identity, _ = redevenFloretGatewayIdentity("openai", "fixture", server.URL, "gpt-5.5", "responses", "chatgpt", "fixture")
			policy := flruntime.DefaultProviderRetryPolicy()
			policy.BaseDelay = time.Millisecond
			policy.MaxDelay = time.Millisecond
			policy.Jitter = 0
			if tc.stop {
				policy.BaseDelay = 10 * time.Second
				policy.MaxDelay = 10 * time.Second
			}
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
				svc, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
				if err != nil {
					t.Fatal(err)
				}
				return host, svc
			}
			host, svc := open()
			defer func() { _ = host.Shutdown(context.Background()) }()
			created, err := svc.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			sent, err := svc.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Recover this exact request."}})
			if err != nil {
				t.Fatal(err)
			}
			if tc.stop {
				deadline := time.Now().Add(5 * time.Second)
				for {
					view, err := svc.View(t.Context(), created.ThreadID)
					if err != nil {
						t.Fatal(err)
					}
					if view.RunProgress != nil && view.RunProgress.Retry != nil {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("missing canonical recovery progress")
					}
					time.Sleep(time.Millisecond)
				}
				if _, err := svc.Cancel(t.Context(), flruntime.CancelInput{ThreadID: created.ThreadID, RequestKey: "stop"}); err != nil {
					t.Fatal(err)
				}
				view := waitDesktopContinuation(t, svc, created.ThreadID)
				if view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCancelled || requests.Load() != 1 {
					t.Fatalf("stop=%+v requests=%d", view, requests.Load())
				}
				return
			}
			view := waitDesktopContinuation(t, svc, created.ThreadID)
			if tc.failures == 5 {
				if view.Failure == nil || requests.Load() != 5 {
					t.Fatalf("exhaustion=%+v calls=%d", view.Failure, requests.Load())
				}
				code, _ := projectFloretTurnFailure(view.Failure, runErrorCodeFloretEngineFailed)
				if code != runErrorCodeProviderStreamInterrupted {
					t.Fatal(code)
				}
				if err := host.Shutdown(t.Context()); err != nil {
					t.Fatal(err)
				}
				host, svc = open()
				restored, err := svc.View(t.Context(), created.ThreadID)
				if err != nil || restored.Failure == nil {
					t.Fatalf("restart=%+v err=%v", restored, err)
				}
				if _, err := svc.Retry(t.Context(), flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: restored.TurnID, RequestKey: "manual"}); err != nil {
					t.Fatal(err)
				}
				view = waitDesktopContinuation(t, svc, created.ThreadID)
			} else if view.TurnID != sent.TurnID {
				t.Fatal("automatic recovery changed TurnID")
			}
			if view.Failure != nil || view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted || requests.Load() != tc.failures+1 || connections.Load() != tc.failures+1 {
				t.Fatalf("result=%+v requests=%d connections=%d", view.Failure, requests.Load(), connections.Load())
			}
			for _, item := range view.Items {
				if item.TurnID == view.TurnID && (strings.Contains(item.Text, "abandoned draft") || strings.Contains(item.Text, "unfinished")) {
					t.Fatal("failed attempt survived recovery")
				}
			}
		})
	}
}
