package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

type desktopSetupIntegrationExecutor struct {
	ready   atomic.Bool
	checks  atomic.Int32
	effects atomic.Int32
}

func (e *desktopSetupIntegrationExecutor) EnsureTargetReady(context.Context, string) error {
	if !e.ready.Load() {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "window_manager_missing"}
	}
	return nil
}

func (e *desktopSetupIntegrationExecutor) VerifyComputerSetup(context.Context) ComputerCapability {
	e.checks.Add(1)
	e.ready.Store(true)
	return ComputerCapability{State: "ready"}
}

func (e *desktopSetupIntegrationExecutor) ExecuteTargetTool(context.Context, TargetToolCall) (TargetToolResult, error) {
	e.effects.Add(1)
	return TargetToolResult{}, nil
}

func TestDesktopSetupQuestionPreservesCanonicalWaitAndDoesNotReplay(t *testing.T) {
	var requests atomic.Int32
	var modelSawFailure atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if json.NewDecoder(req.Body).Decode(&body) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flush := w.(http.Flusher)
		if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
			writeAskUserIntegrationTextResponse(w, flush, "title", "Prepare desktop")
			return
		}
		switch requests.Add(1) {
		case 1:
			writeEncodingIntegrationCall(w, "computer_exec", "blocked-desktop", `{"description":"Click once on the private desktop","target":"xvfb-main","code":"await ui.click(1,1);"}`)
		case 2:
			for _, raw := range body["input"].([]any) {
				item, _ := raw.(map[string]any)
				if item["type"] != "function_call_output" || item["call_id"] != "blocked-desktop" {
					continue
				}
				var result struct {
					Status string         `json:"status"`
					Data   map[string]any `json:"data"`
					Error  struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				if output, ok := item["output"].(string); ok {
					if json.Unmarshal([]byte(strings.TrimPrefix(output, "ERROR: ")), &result) == nil && result.Status == "error" && result.Error.Code == "TARGET_SETUP_REQUIRED" && result.Data["desktop_setup_required"] == true && result.Data["action_executed"] == false && result.Data["target_id"] == "xvfb-main" {
						modelSawFailure.Store(true)
					} else {
						t.Logf("unexpected model-visible result: %s", output)
					}
				}
			}
			writeComputerEvidenceQuestion(w, flush, "blocked-desktop", "desktop_setup", "Prepare the private desktop, then continue.", "Continue")
		default:
			writeAskUserIntegrationTextResponse(w, flush, "continued", "The user continued.")
		}
	}))
	t.Cleanup(provider.Close)

	executor := &desktopSetupIntegrationExecutor{}
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "xvfb-main", Kind: "xvfb.desktop", State: "stopped", Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"xvfb-main": executor}, filepath.Join(state, "media"))
	t.Cleanup(func() { _ = host.Close() })
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                       &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Desktop setup", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "start", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Click once on the private desktop."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.WaitingPrompt != nil || requests.Load() > 2 })
	if waiting.WaitingPrompt == nil || waiting.RunStatus != "waiting_user" || requests.Load() != 2 || !modelSawFailure.Load() {
		t.Fatalf("missing canonical failure or wait: status=%s prompt=%+v requests=%d modelSawFailure=%t", waiting.RunStatus, waiting.WaitingPrompt, requests.Load(), modelSawFailure.Load())
	}
	assistance := waiting.WaitingPrompt.ComputerAssistance
	if assistance == nil || assistance.Kind != "desktop_setup" || assistance.TargetID != "xvfb-main" || assistance.ToolCallID != "blocked-desktop" {
		t.Fatalf("missing exact setup evidence: %+v", assistance)
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	public, err := flowerCurrentJSON(current)
	if err != nil || !strings.Contains(string(public), `"kind":"desktop_setup"`) || !strings.Contains(string(public), `"tool_call_id":"blocked-desktop"`) {
		t.Fatalf("public current view lost setup evidence: %s %v", public, err)
	}
	verified, err := svc.VerifyComputerDesktop(t.Context(), meta)
	if err != nil || verified.State != "ready" || executor.checks.Load() != 1 {
		t.Fatalf("verification failed: %+v %v", verified, err)
	}
	afterVerify, err := svc.GetThread(t.Context(), meta, thread.ThreadID)
	if err != nil || afterVerify.WaitingPrompt == nil || afterVerify.WaitingPrompt.PromptID != waiting.WaitingPrompt.PromptID || requests.Load() != 2 || executor.effects.Load() != 0 {
		t.Fatalf("verification consumed the question or dispatched an action: view=%+v requests=%d effects=%d err=%v", afterVerify, requests.Load(), executor.effects.Load(), err)
	}
	selected, err := svc.snapshotThreadStore().GetComputerTarget(t.Context(), thread.ThreadID)
	if err != nil || selected != "" {
		t.Fatalf("verification changed target selection: %q %v", selected, err)
	}
	response := SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"desktop_setup": {ChoiceID: "Continue"}}}}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if requests.Load() != 3 || executor.effects.Load() != 0 {
		t.Fatalf("answer replayed an action: requests=%d effects=%d", requests.Load(), executor.effects.Load())
	}
}
