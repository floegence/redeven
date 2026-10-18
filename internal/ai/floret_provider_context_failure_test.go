package ai

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"

	flconfig "github.com/floegence/floret/v7/config"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
)

type contextFailureGateway struct {
	failure error
	calls   atomic.Int32
}

func (g *contextFailureGateway) StreamTurn(_ context.Context, _ ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if g.calls.Add(1) == 1 {
		return ModelGatewayResult{}, g.failure
	}
	if onEvent != nil {
		onEvent(StreamEvent{Type: StreamEventTextDelta, Text: "Recovered."})
	}
	return ModelGatewayResult{FinishReason: "stop", Text: "Recovered."}, nil
}

func TestFloretProviderContextFailureSurvivesRestartAndRetry(t *testing.T) {
	for _, failure := range []error{context.DeadlineExceeded, context.Canceled} {
		t.Run(failure.Error(), func(t *testing.T) {
			gateway := &contextFailureGateway{failure: failure}
			provider := newFloretProviderAdapter(gateway, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "")
			provider.identity, _ = redevenFloretGatewayIdentity("openai", "fixture", "https://fixture.invalid/v1", "gpt-test", "chat_completions", "api_key", "fixture")
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Reply briefly.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, provider, flruntime.WithAgentProviderRetryPolicy(flruntime.ProviderRetryPolicy{Disabled: true}))
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
			if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Preserve this request."}}); err != nil {
				t.Fatal(err)
			}
			failed := waitDesktopContinuation(t, service, created.ThreadID)
			if failed.LastOutcome == nil || *failed.LastOutcome != flruntime.TurnOutcomeFailed || failed.Failure == nil || failed.Failure.Code != flruntime.ThreadTurnFailureProvider || failed.Cancellation != nil {
				t.Fatalf("failure=%+v cancellation=%+v", failed.Failure, failed.Cancellation)
			}
			code, message := projectFloretTurnFailure(failed.Failure, runErrorCodeFloretEngineFailed)
			wantCode := runErrorCodeProviderRequestTimeout
			if failure == context.Canceled {
				wantCode = runErrorCodeProviderRequestFailed
			}
			if code != wantCode {
				t.Fatalf("code=%s message=%s", code, message)
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
			if restoredCode != code || restoredMessage != message || restored.Cancellation != nil {
				t.Fatalf("restored=%+v", restored)
			}
			if _, err := service.Retry(t.Context(), flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: restored.TurnID, RequestKey: "retry"}); err != nil {
				t.Fatal(err)
			}
			recovered := waitDesktopContinuation(t, service, created.ThreadID)
			if recovered.LastOutcome == nil || *recovered.LastOutcome != flruntime.TurnOutcomeCompleted || recovered.Failure != nil || gateway.calls.Load() != 2 {
				t.Fatalf("recovered=%+v calls=%d", recovered, gateway.calls.Load())
			}
		})
	}
}
