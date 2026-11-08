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

	flconfig "github.com/floegence/floret/v7/config"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestDesktopDeepSeekRetryRetainsInterruptedReasoning(t *testing.T) {
	const retained = "Retained reasoning before provider failure."
	var requests, effects atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Input json.RawMessage }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		n := requests.Add(1)
		if n > 1 && !strings.Contains(string(body.Input), retained) {
			t.Error("Retry lost the admitted partial reasoning")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if n == 1 {
			fmt.Fprintf(w, "data: {\"type\":\"response.reasoning_text.delta\",\"delta\":%q}\n\n", retained)
			fmt.Fprint(w, "data: {\"type\":\"response.failed\",\"response\":{\"id\":\"failed\",\"error\":{\"code\":\"invalid_request_error\",\"message\":\"fixture failure\"}}}\n\n")
			return
		}
		if n == 2 {
			fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"call-response\",\"status\":\"completed\",\"output\":[{\"type\":\"function_call\",\"id\":\"write-item\",\"call_id\":\"write-call\",\"name\":\"file_write\",\"arguments\":\"{}\"}]}}\n\n")
			return
		}
		if strings.Count(string(body.Input), `"call_id":"write-call"`) != 2 || !strings.Contains(string(body.Input), "write confirmed once") {
			t.Error("continuation lost or duplicated the completed tool exchange")
		}
		writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "done-response", "Completed.")
	}))
	defer server.Close()
	gateway := desktopContinuationGateway(t, "deepseek", "deepseek-flash", server.URL, false)
	tool := fltools.Define[struct{}](fltools.Definition{Name: "file_write", InputSchema: fltools.StrictObject(map[string]any{}, []string{}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
		effects.Add(1)
		return fltools.Result{Text: "write confirmed once"}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "fixture", Name: "Fixture"}, SystemPrompt: "Write once.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path)})
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
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Write the report once."}}); err != nil {
		t.Fatal(err)
	}
	failed := waitDesktopContinuation(t, service, created.ThreadID)
	if failed.Failure == nil || requests.Load() != 1 {
		t.Fatal("expected one failed attempt")
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	if _, err := service.Retry(t.Context(), flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: failed.TurnID, RequestKey: "retry"}); err != nil {
		t.Fatal(err)
	}
	settled := waitDesktopContinuation(t, service, created.ThreadID)
	if settled.Failure != nil || settled.LastOutcome == nil || *settled.LastOutcome != flruntime.TurnOutcomeCompleted || requests.Load() != 3 || effects.Load() != 1 {
		t.Fatalf("retry did not continue after the confirmed write: failure=%+v requests=%d effects=%d", settled.Failure, requests.Load(), effects.Load())
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	fork, err := service.Fork(t.Context(), flruntime.ForkThreadInput{SourceThreadID: created.ThreadID, RequestKey: "fork"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: fork.ThreadID, RequestKey: "next", Input: flruntime.UserInput{Text: "Continue after restart."}}); err != nil {
		t.Fatal(err)
	}
	continued := waitDesktopContinuation(t, service, fork.ThreadID)
	if continued.Failure != nil || requests.Load() != 4 || effects.Load() != 1 {
		t.Fatalf("fork/restart changed confirmed work: failure=%+v requests=%d effects=%d", continued.Failure, requests.Load(), effects.Load())
	}
}
