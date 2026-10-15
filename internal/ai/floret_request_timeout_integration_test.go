package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestFloretRequestDeadlineStopsHeartbeatAndArgumentStalls(t *testing.T) {
	for _, arguments := range []bool{false, true} {
		t.Run(fmt.Sprint(arguments), func(t *testing.T) {
			closed := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if arguments {
					writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "inspect", "arguments": ""}})
					writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": "response.function_call_arguments.delta", "item_id": "item", "delta": `{"path":`})
				}
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				defer close(closed)
				for {
					select {
					case <-r.Context().Done():
						return
					case <-ticker.C:
						fmt.Fprint(w, ": heartbeat\n\n")
						w.(http.Flusher).Flush()
					}
				}
			}))
			defer server.Close()
			base, err := newProviderAdapter("openai", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			var admitted, released, executed atomic.Int32
			gateway := newFloretProviderAdapter(base, "openai", "gpt-5-mini", ProviderControls{}, TurnBudgets{}, "", withFloretRequestAdmission(func(ctx context.Context, _ flprovider.Request) (context.Context, func(), error) {
				admitted.Add(1)
				return ctx, func() { released.Add(1) }, nil
			}))
			gateway.identity, _ = redevenFloretGatewayIdentity("fixture", "openai", server.URL, "gpt-5-mini", "responses")
			tool := fltools.Define[map[string]any](fltools.Definition{Name: "inspect", ReadOnly: true, InputSchema: fltools.StrictObject(map[string]any{"path": map[string]any{"type": "string"}}, []string{"path"})}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
				executed.Add(1)
				return fltools.Result{}, nil
			})
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Inspect.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentProviderRetryPolicy(flruntime.ProviderRetryPolicy{Disabled: true}), flruntime.WithAgentProviderRequestTimeoutPolicy(flruntime.ProviderRequestTimeoutPolicy{FirstOutputTimeout: 100 * time.Millisecond, IdleTimeout: 100 * time.Millisecond}))
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
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Inspect"}}); err != nil {
				t.Fatal(err)
			}
			failed := waitDesktopContinuation(t, service, created.ThreadID)
			if failed.Failure == nil || failed.Failure.Code != flruntime.ThreadTurnFailureProvider || failed.Failure.ProviderTimeout == nil || failed.Cancellation != nil || len(failed.ToolCallPreviews) != 0 {
				t.Fatalf("failure=%+v", failed.Failure)
			}
			want := "first_output"
			if arguments {
				want = "output_idle"
			}
			if failed.Failure.ProviderTimeout.Stage != want || executed.Load() != 0 {
				t.Fatalf("timeout=%+v tools=%d", failed.Failure.ProviderTimeout, executed.Load())
			}
			code, _ := projectFloretTurnFailure(failed.Failure, runErrorCodeFloretEngineFailed)
			if code != runErrorCodeProviderRequestTimeout {
				t.Fatalf("product code=%s", code)
			}
			detail := canonicalFailureDetail(failed.Failure)
			if !strings.Contains(detail, `"stage": "`+want+`"`) || strings.Contains(detail, "heartbeat") {
				t.Fatalf("unsafe or missing detail=%s", detail)
			}
			select {
			case <-closed:
			case <-time.After(time.Second):
				t.Fatal("HTTP stream retained after timeout")
			}
			until := time.Now().Add(time.Second)
			for released.Load() != admitted.Load() && time.Now().Before(until) {
				time.Sleep(time.Millisecond)
			}
			if admitted.Load() != 1 || released.Load() != 1 {
				t.Fatalf("admission leaked %d/%d", admitted.Load(), released.Load())
			}
		})
	}
}

func TestServiceRejectsRequestTimeoutPolicyBeforeOpeningState(t *testing.T) {
	for _, startup := range []struct {
		name string
		open func(Options) (*Service, error)
	}{
		{"default", NewService},
		{"context", func(opts Options) (*Service, error) { return NewServiceContext(t.Context(), opts) }},
	} {
		t.Run(startup.name, func(t *testing.T) {
			stateDir := filepath.Join(t.TempDir(), "state")
			svc, err := startup.open(Options{StateDir: stateDir, AgentHomeDir: t.TempDir(), ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{IdleTimeout: -time.Second}})
			if svc != nil || err == nil || !strings.Contains(err.Error(), "provider request timeout policy") {
				t.Fatalf("startup accepted invalid policy: service=%v error=%v", svc, err)
			}
			if _, err := os.Stat(stateDir); !os.IsNotExist(err) {
				t.Fatalf("invalid policy opened state: %v", err)
			}
		})
	}
}
