package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	flprovider "github.com/floegence/floret/v4/provider"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type testFloretGatewayFunc func(context.Context, flprovider.Request) (<-chan flprovider.Event, error)

func (gateway testFloretGatewayFunc) Identity() flprovider.Identity {
	return flprovider.Identity{Provider: "test", Model: "final-architecture", StateCompatibilityKey: "test:final-architecture:v1"}
}

func (testFloretGatewayFunc) Capabilities() flprovider.Capabilities {
	return flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}
}

func (gateway testFloretGatewayFunc) Stream(ctx context.Context, request flprovider.Request) (<-chan flprovider.Event, error) {
	return gateway(ctx, request)
}

func containsAnyString(values []any, target string) bool {
	for _, value := range values {
		if fmt.Sprint(value) == target {
			return true
		}
	}
	return false
}

func testBoolPtr(value bool) *bool { return &value }

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func timelineTestMeta(endpointID string) *session.Meta {
	return &session.Meta{
		EndpointID: endpointID, NamespacePublicID: "ns", ChannelID: "ch",
		UserPublicID: "user", UserEmail: "user@example.com",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
}

func newFlowerLiveMemoryTestService() *Service {
	return &Service{
		flowerLiveSubscribersByEndpoint: make(map[string]int),
		flowerLiveSubscribers:           make(map[uint64]*flowerLiveSubscriber),
	}
}

func flowerLiveMemoryTestMeta(endpointID string) session.Meta {
	return session.Meta{EndpointID: endpointID, UserPublicID: "user_" + endpointID, CanRead: true, CanWrite: true, CanExecute: true}
}

func runTypedTurnForTest(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, requestID string, req RunStartRequest) (flruntime.ThreadView, error) {
	t.Helper()
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ClientRequestID: requestID, ThreadID: req.ThreadID, Model: req.Model,
		Input: req.Input, Options: req.Options,
	})
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	if response.Current.Activity != flruntime.ThreadActivityActive {
		return response.Current, fmt.Errorf("typed send activity=%q, want active", response.Current.Activity)
	}
	turnID := response.Current.TurnID
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		view, viewErr := svc.threadRuntime.View(ctx, identity.ThreadID(req.ThreadID))
		if viewErr != nil {
			return flruntime.ThreadView{}, viewErr
		}
		if view.TurnID == turnID && view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
			if *view.LastOutcome == flruntime.TurnOutcomeFailed {
				thread, threadErr := svc.GetThread(ctx, meta, req.ThreadID)
				if threadErr == nil && thread != nil && strings.TrimSpace(thread.RunError) != "" {
					return view, errors.New(strings.TrimSpace(thread.RunError))
				}
				return view, errors.New("typed turn failed")
			}
			return view, nil
		}
		select {
		case <-ctx.Done():
			return view, ctx.Err()
		case <-deadline.C:
			return view, errors.New("timed out waiting for typed turn")
		case <-ticker.C:
		}
	}
}

type slowOpenAIMock struct{ delay time.Duration }

func (m slowOpenAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.Method != http.MethodPost || strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer sk-test" || !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	_, _ = io.ReadAll(r.Body)
	_ = r.Body.Close()
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	flusher := w.(http.Flusher)
	writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.created", "response": map[string]any{"id": "resp_realtime_test_1", "created_at": time.Now().Unix(), "model": "gpt-5-mini"}})
	time.Sleep(m.delay)
	writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": "working"})
	writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_realtime_test_1", "model": "gpt-5-mini", "status": "completed", "usage": map[string]any{"input_tokens": 1, "output_tokens": 1, "output_tokens_details": map[string]any{"reasoning_tokens": 0}}}})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeTestRealtimeSSE(w io.Writer, flusher http.Flusher, payload any) {
	data, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(data)
	_, _ = io.WriteString(w, "\n\n")
	flusher.Flush()
}

func newRealtimeTestService(t *testing.T, delay time.Duration) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(slowOpenAIMock{delay: delay}.handle))
	t.Cleanup(server.Close)
	cfg := &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: strings.TrimSuffix(server.URL, "/") + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "bash", Config: cfg,
		RunMaxWallTime: 30 * time.Second, RunIdleTimeout: 10 * time.Second, ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			return "sk-test", strings.TrimSpace(providerID) == "openai", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func newSendTurnTestService(t *testing.T) *Service {
	t.Helper()
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-4o-mini"}},
		}},
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/bash", Config: cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func newTestService(t *testing.T, cfg *config.AIConfig) *Service {
	t.Helper()
	if cfg == nil {
		cfg = &config.AIConfig{}
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/bash", Config: cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}
