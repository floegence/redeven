package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestModelGatewayStreamingProvidersCloseRequestOnCancellation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name         string
		providerType string
		model        string
	}{
		{name: "openai responses", providerType: "openai", model: "gpt-5-mini"},
		{name: "openai chat", providerType: "openai_compatible", model: "gpt-5-mini"},
		{name: "moonshot chat", providerType: "moonshot", model: "kimi-k2.6"},
		{name: "anthropic messages", providerType: "anthropic", model: "claude-sonnet-4-5"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			started := make(chan struct{}, 1)
			done := make(chan struct{}, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(http.StatusOK)
				flusher, ok := w.(http.Flusher)
				if !ok {
					t.Error("stream response writer does not support flushing")
					return
				}
				flusher.Flush()
				started <- struct{}{}
				<-r.Context().Done()
				done <- struct{}{}
			}))

			provider, err := newProviderAdapter(testCase.providerType, server.URL+"/v1", "sk-test", nil)
			if err != nil {
				server.Close()
				t.Fatalf("newProviderAdapter: %v", err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			streamDone := make(chan error, 1)
			go func() {
				_, streamErr := provider.StreamTurn(ctx, ModelGatewayRequest{
					Model: testCase.model,
					Messages: []Message{{
						Role:    "user",
						Content: []ContentPart{{Type: "text", Text: "wait for cancellation"}},
					}},
					Budgets: TurnBudgets{MaxOutputToken: 32},
				}, nil)
				streamDone <- streamErr
			}()

			select {
			case <-started:
			case <-time.After(2 * time.Second):
				cancel()
				server.Close()
				t.Fatal("provider request did not establish its stream")
			}
			cancelStartedAt := time.Now()
			cancel()
			select {
			case <-streamDone:
			case <-time.After(2 * time.Second):
				server.Close()
				t.Fatal("StreamTurn did not return after cancellation")
			}
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				server.Close()
				t.Fatal("provider request context did not close after cancellation")
			}
			server.Close()
			if elapsed := time.Since(cancelStartedAt); elapsed > 2*time.Second {
				t.Fatalf("provider stream teardown elapsed=%s, want no more than 2s", elapsed)
			}
		})
	}
}
