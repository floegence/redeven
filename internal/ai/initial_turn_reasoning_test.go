package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// Default asks for the model's own behavior. A model without verified
// reasoning controls has no reasoning wire field, so Default is omitted.
func TestInitialTurnAcceptsDefaultReasoningForModelWithoutReasoningControls(t *testing.T) {
	var agentCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var tools []json.RawMessage
		_ = json.Unmarshal(body["tools"], &tools)
		if len(tools) > 0 {
			agentCalls.Add(1)
			for key := range body {
				if strings.Contains(key, "reasoning") || strings.Contains(key, "thinking") {
					t.Errorf("provider request carries reasoning field %s=%s", key, body[key])
				}
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		writeOpenAISSEJSON(w, flusher, map[string]any{"id": "compat", "object": "chat.completion.chunk", "model": "orbit-pilot", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "Done."}}}})
		writeOpenAISSEJSON(w, flusher, map[string]any{"id": "compat", "object": "chat.completion.chunk", "model": "orbit-pilot", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}})
	}))
	defer provider.Close()
	state := t.TempDir()
	meta := &session.Meta{EndpointID: "compat-default-reasoning", ChannelID: "channel", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	supportsTools := true
	const modelID = "compat/orbit-pilot"
	svc, err := NewService(Options{
		StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{{
			ID: "compat", Name: "Compat", Type: "openai_compatible", BaseURL: provider.URL + "/v1",
			Models: []config.AIProviderModel{{ModelName: "orbit-pilot", ContextWindow: 200000, MaxOutputTokens: 32000, SupportsTools: &supportsTools}},
		}}},
		ResolveProviderAPIKey:        func(string) (string, bool, error) { return "test-key", true, nil },
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	explicitDefault := config.AIReasoningSelection{Level: config.AIReasoningLevelDefault}
	response, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		Create: &CreateThreadRequest{ClientRequestID: "compat-default", ModelID: modelID, PermissionType: string(config.AIPermissionFullAccess), ReasoningSelection: explicitDefault},
		Model:  modelID, Input: RunInput{Text: "Say done."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess, ReasoningSelection: explicitDefault},
	})
	if err != nil {
		t.Fatalf("initial turn with Default reasoning: %v", err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, response.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if !view.ReasoningSelection.IsZero() {
		t.Fatalf("thread reasoning=%+v, want omitted", view.ReasoningSelection)
	}
	if agentCalls.Load() != 1 {
		t.Fatalf("agent provider calls=%d, want 1", agentCalls.Load())
	}
	budget := config.AIReasoningSelection{Level: config.AIReasoningLevelDefault, BudgetTokens: 4096}
	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		Create: &CreateThreadRequest{ClientRequestID: "compat-budget", ModelID: modelID, ReasoningSelection: budget},
		Model:  modelID, Input: RunInput{Text: "Say done."}, Options: RunOptions{ReasoningSelection: budget},
	}); err == nil || !strings.Contains(err.Error(), "does not support reasoning selection") {
		t.Fatalf("Default with budget error=%v, want unsupported reasoning rejection", err)
	}
}
