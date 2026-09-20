package ai

import (
	"encoding/json"
	"github.com/floegence/redeven/internal/config"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestComputerBrowserInstallationUsesCanonicalInputAndValidatesContinuation(t *testing.T) {
	var providerCalls atomic.Int32
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "External sign-in")
			return
		}
		if providerCalls.Add(1) == 1 {
			item := map[string]any{"type": "function_call", "id": "fc_observe", "call_id": "observe-login", "name": "computer_screenshot", "arguments": `{"target":"browser.managed"}`}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeAskUserIntegrationCompletedResponse(w, flusher, "requires-input")
			return
		}
		writeAskUserIntegrationTextResponse(w, flusher, "unexpected-continuation", "Continued without user control.")
	}))
	t.Cleanup(providerServer.Close)
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Redeven Managed Browser", State: "ready", Ready: true, Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": &bindingTestExecutor{}}, t.TempDir())
	host.ConfigureManagedBrowser(t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	state := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:         &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: providerServer.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second, ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Takeover", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "start", ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Observe the browser and continue after I complete sign-in."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.WaitingPrompt != nil || providerCalls.Load() > 1 })
	if view.WaitingPrompt == nil || view.RunStatus != "waiting_user" || providerCalls.Load() != 1 {
		t.Fatalf("installation was not a canonical input wait: status=%s prompt=%+v requests=%d", view.RunStatus, view.WaitingPrompt, providerCalls.Load())
	}
	for _, question := range view.WaitingPrompt.Questions {
		if question.IsSecret {
			t.Fatal("takeover asks for a secret")
		}
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: view.WaitingPrompt.PromptID,
			Answers: map[string]RequestUserInputAnswer{"browser_install": {ChoiceID: "Continue with installed browser"}}},
	}); err == nil {
		t.Fatal("uninstalled browser acknowledged as installed")
	}
	if providerCalls.Load() != 1 {
		t.Fatal("invalid return continued provider")
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: view.WaitingPrompt.PromptID,
			Answers: map[string]RequestUserInputAnswer{"browser_install": {ChoiceID: "Continue without built-in browser"}}},
	}); err == nil {
		t.Fatal("enabled browser accepted disabled acknowledgement")
	}
	if _, err := svc.SetComputerBrowserEnabled(t.Context(), meta, false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: view.WaitingPrompt.PromptID,
			Answers: map[string]RequestUserInputAnswer{"browser_install": {ChoiceID: "Continue without built-in browser"}}},
	}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.WaitingPrompt == nil && providerCalls.Load() == 2 })
	if state := host.browserInstallation.Snapshot(); state.Enabled || state.OperationID != "" {
		t.Fatalf("disable/consent boundary: %+v", state)
	}
}
