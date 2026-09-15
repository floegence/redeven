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
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestComputerTakeoverStopsProductionProviderLoop(t *testing.T) {
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
			item := map[string]any{"type": "function_call", "id": "fc_observe", "call_id": "observe-login", "name": "computer_screenshot", "arguments": `{}`}
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
	state := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: registry, TargetToolExecutor: failingComputerExecutor{code: "TAKEOVER_REQUIRED"},
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
		t.Fatalf("takeover was not a canonical input wait: status=%s prompt=%+v requests=%d", view.RunStatus, view.WaitingPrompt, providerCalls.Load())
	}
	for _, question := range view.WaitingPrompt.Questions {
		if question.IsSecret {
			t.Fatal("takeover asks for a secret")
		}
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: view.WaitingPrompt.PromptID,
			Answers: map[string]RequestUserInputAnswer{"computer_control": {ChoiceID: "Return control to Flower"}}},
	}); err == nil {
		t.Fatal("return control resumed without a host observation boundary")
	}
	if providerCalls.Load() != 1 {
		t.Fatal("invalid return continued provider")
	}
	if _, err := svc.threadRuntime.Cancel(t.Context(), flruntime.CancelInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: "cancel"}); err != nil {
		t.Fatal(err)
	}
}

// This fixture models an external user changing the page. Only its observation
// changes; returning control must never replay the navigation that caused pause.
type takeoverObservationExecutor struct {
	body         []byte
	attachment   TargetToolAttachment
	safe         atomic.Bool
	effects      atomic.Int32
	observations atomic.Int32
	userInputs   atomic.Int32
}

func (e *takeoverObservationExecutor) ExecuteComputerUserInput(context.Context, TargetToolCall) ([]byte, error) {
	e.userInputs.Add(1)
	return e.body, nil
}

func (e *takeoverObservationExecutor) EnsureTargetReady(context.Context, string) error { return nil }
func (e *takeoverObservationExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	actionExecuted := false
	switch call.ToolName {
	case "browser.navigate":
		e.effects.Add(1)
		actionExecuted = true
	case "computer.screenshot":
		e.observations.Add(1)
	default:
		return TargetToolResult{}, errors.New("unexpected action")
	}
	result := TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "fixture", Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"login"}}, Result: map[string]any{"action_executed": actionExecuted}}
	if e.safe.Load() {
		result.Safety = &InteractionSafetyDecision{Level: "routine", SafeToCapture: true, SafeToSendToModel: true}
		result.Attachments = []TargetToolAttachment{e.attachment}
		result.frameBytes = e.body
	}
	return result, nil
}

func TestComputerTakeoverReturnReobservesWithoutReplayingAction(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(fmt.Sprintf("restart=%t", restart), func(t *testing.T) {
			var requests atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil {
					http.Error(w, "invalid request", 400)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
					writeDeepSeekIntegrationNaturalResponse(w, flusher, "title", "Sign-in")
					return
				}
				requestNumber := requests.Add(1)
				if requestNumber == 1 {
					item := map[string]any{"type": "function_call", "id": "fc_nav", "call_id": "nav-login", "name": "browser_navigate", "arguments": `{"url":"https://example.test/"}`}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "pause", "status": "completed", "output": []any{item}}})
					return
				}
				if requestNumber == 2 {
					item := map[string]any{"type": "function_call", "id": "fc_resumed", "call_id": "resumed-observation", "name": "computer_screenshot", "arguments": `{}`}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "resumed-observation", "status": "completed", "output": []any{item}}})
					return
				}
				writeDeepSeekIntegrationNaturalResponse(w, flusher, "continued", "Control returned.")
			}))
			defer provider.Close()
			body, attachment := computerFrameFixture(t)
			executor := &takeoverObservationExecutor{body: body, attachment: attachment}
			state := t.TempDir()
			model, ok := config.AIModelCatalogEntry("deepseek", "deepseek-v4-flash-vision-exp")
			if !ok {
				t.Fatal("vision model missing from production catalog")
			}
			var svc *Service
			open := func() {
				registry := NewTargetRegistry()
				if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", DisplayName: "Managed Browser", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
					t.Fatal(err)
				}
				host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor}, filepath.Join(state, "media"))
				t.Cleanup(func() { _ = host.Close() })
				var err error
				svc, err = NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
					Config:                &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash-vision-exp", Providers: []config.AIProvider{{ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: provider.URL, Models: []config.AIProviderModel{model}}}},
					ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil }, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second})
				if err != nil {
					t.Fatal(err)
				}
			}
			open()
			t.Cleanup(func() { _ = svc.Close() })
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Takeover", "deepseek/deepseek-v4-flash-vision-exp", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "start", Model: "deepseek/deepseek-v4-flash-vision-exp", Input: RunInput{Text: "Open the page."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
				t.Fatal(err)
			}
			waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.WaitingPrompt != nil })
			if restart {
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
				open()
			}
			userInput := ComputerUserInput{ThreadID: thread.ThreadID, InteractionID: waiting.WaitingPrompt.PromptID, Action: "type", Text: "fixture-secret-never-in-history"}
			for _, missing := range []string{"read", "write", "execute", "thread authority"} {
				unauthorized := *meta
				switch missing {
				case "read":
					unauthorized.CanRead = false
				case "write":
					unauthorized.CanWrite = false
				case "execute":
					unauthorized.CanExecute = false
				case "thread authority":
					unauthorized.EndpointID = "other-endpoint"
				}
				if _, err := svc.InputComputerControl(t.Context(), &unauthorized, userInput); err == nil {
					t.Fatalf("user input accepted without %s", missing)
				}
			}
			if executor.userInputs.Load() != 0 {
				t.Fatal("unauthorized private input reached adapter")
			}
			staleInput := userInput
			staleInput.InteractionID = "unknown"
			if _, err := svc.InputComputerControl(t.Context(), meta, staleInput); err == nil {
				t.Fatal("unknown interaction accepted user input")
			}
			if body, err := svc.InputComputerControl(t.Context(), meta, userInput); err != nil || len(body) == 0 {
				t.Fatalf("user control frame: %v", err)
			}
			if executor.userInputs.Load() != 1 {
				t.Fatal("user input dispatch count changed")
			}
			current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			public, err := json.Marshal(current)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(public), userInput.Text) {
				t.Fatal("user input leaked into canonical current view")
			}
			response := SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"computer_control": {ChoiceID: "Return control to Flower"}}}}
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err == nil {
				t.Fatal("sensitive page resumed")
			}
			if requests.Load() != 1 || executor.effects.Load() != 1 || executor.observations.Load() != 1 {
				t.Fatal("failed observation replayed or continued action")
			}
			// The actual user finishes outside model history, then explicitly returns.
			executor.safe.Store(true)
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
			if _, err := svc.InputComputerControl(t.Context(), meta, userInput); err == nil {
				t.Fatal("resolved interaction retained user control")
			}
			if requests.Load() != 3 || executor.effects.Load() != 1 || executor.observations.Load() != 3 {
				t.Fatalf("requests=%d effects=%d observations=%d", requests.Load(), executor.effects.Load(), executor.observations.Load())
			}
		})
	}
}
