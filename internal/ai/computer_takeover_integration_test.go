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
	"github.com/floegence/redeven/internal/browserbridge"
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
	}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" || providerCalls.Load() > 1 })
	if providerCalls.Load() != 2 {
		t.Fatalf("canonical answer did not reach the provider: requests=%d", providerCalls.Load())
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

func (e *takeoverObservationExecutor) ExecuteComputerUserInput(_ context.Context, call TargetToolCall) ([]byte, error) {
	if call.ToolName == "computer.screenshot" {
		return e.body, nil
	}
	e.userInputs.Add(1)
	return nil, nil
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
					item := map[string]any{"type": "function_call", "id": "fc_nav", "call_id": "nav-login", "name": "browser_navigate", "arguments": `{"target":"browser.managed","url":"https://example.test/"}`}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "pause", "status": "completed", "output": []any{item}}})
					return
				}
				if requestNumber == 2 || requestNumber == 3 {
					item := map[string]any{"type": "function_call", "id": fmt.Sprintf("fc_resumed_%d", requestNumber), "call_id": fmt.Sprintf("resumed-observation-%d", requestNumber), "name": "computer_screenshot", "arguments": `{"target":"browser.managed"}`}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("resumed-observation-%d", requestNumber), "status": "completed", "output": []any{item}}})
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
				installBrowserStub(t, host)
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
			subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
			if err != nil {
				t.Fatal(err)
			}
			defer subscription.Close()
			observerID := subscription.subscriber.observerID
			if err := svc.SetComputerViewer(t.Context(), meta, ComputerViewerRequest{ObserverID: observerID, Revision: 1, ThreadID: thread.ThreadID, TargetID: "target", InteractionID: waiting.WaitingPrompt.PromptID}); err != nil {
				t.Fatal(err)
			}
			var privateEnvelope FlowerLiveStreamEnvelope
			select {
			case batch := <-subscription.subscriber.media:
				if err := json.Unmarshal(batch.data, &privateEnvelope); err != nil {
					t.Fatal(err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("private frame missing")
			}
			frameRequest := ComputerPrivateFrameRequest{ObserverID: observerID, ViewerRevision: 1, ThreadID: thread.ThreadID, InteractionID: waiting.WaitingPrompt.PromptID, FrameID: privateEnvelope.ComputerFrame.FrameID}
			if _, err := svc.ReadPrivateComputerFrame(t.Context(), meta, frameRequest); err != nil {
				t.Fatal(err)
			}
			other := *meta
			other.UserPublicID = "other-user"
			if _, err := svc.ReadPrivateComputerFrame(t.Context(), &other, frameRequest); err == nil {
				t.Fatal("another user read private pixels")
			}
			other = *meta
			other.CanExecute = false
			if _, err := svc.ReadPrivateComputerFrame(t.Context(), &other, frameRequest); err == nil {
				t.Fatal("private viewing accepted read-only authority")
			}
			if err := svc.PublishFlowerComputerFrame(meta, *privateEnvelope.ComputerFrame); err == nil {
				t.Fatal("private descriptor entered the broadcast path")
			}
			userInput := ComputerUserInput{ObserverID: observerID, ViewerRevision: 1, ThreadID: thread.ThreadID, InteractionID: waiting.WaitingPrompt.PromptID, Action: "type", Text: "fixture-secret-never-in-history"}
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
				if err := svc.InputComputerControl(t.Context(), &unauthorized, userInput); err == nil {
					t.Fatalf("user input accepted without %s", missing)
				}
			}
			if executor.userInputs.Load() != 0 {
				t.Fatal("unauthorized private input reached adapter")
			}
			staleInput := userInput
			staleInput.InteractionID = "unknown"
			if err := svc.InputComputerControl(t.Context(), meta, staleInput); err == nil {
				t.Fatal("unknown interaction accepted user input")
			}
			if err := svc.InputComputerControl(t.Context(), meta, userInput); err != nil {
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
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
				t.Fatal(err)
			}
			resolvedView, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			resolved := false
			for _, interaction := range resolvedView.Interactions {
				if interaction.ID != waiting.WaitingPrompt.PromptID || !interaction.Resolved {
					continue
				}
				call, computer, err := computerControlCall(resolvedView, interaction)
				if err != nil || !computer || call.TargetID != "target" || call.TurnID != string(interaction.TurnID) || call.RunID != string(interaction.RunID) {
					t.Fatalf("resolved interaction lost canonical target provenance: call=%+v computer=%t error=%v", call, computer, err)
				}
				resolved = true
				break
			}
			if !resolved {
				t.Fatal("submitted interaction was not resolved canonically")
			}
			waitingAgain := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.WaitingPrompt != nil && v.WaitingPrompt.PromptID != waiting.WaitingPrompt.PromptID
			})
			if requests.Load() != 2 || executor.effects.Load() != 1 || executor.observations.Load() != 1 || waitingAgain.WaitingPrompt == nil {
				t.Fatalf("fresh observation did not create a new canonical wait: requests=%d effects=%d observations=%d", requests.Load(), executor.effects.Load(), executor.observations.Load())
			}
			// The actual user finishes outside model history, then explicitly returns.
			executor.safe.Store(true)
			response.Response.PromptID = waitingAgain.WaitingPrompt.PromptID
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
			if err := svc.InputComputerControl(t.Context(), meta, userInput); err == nil {
				t.Fatal("resolved interaction retained user control")
			}
			if requests.Load() != 4 || executor.effects.Load() != 1 || executor.observations.Load() != 2 {
				t.Fatalf("requests=%d effects=%d observations=%d", requests.Load(), executor.effects.Load(), executor.observations.Load())
			}
		})
	}
}

// A real Floret provider loop must stop at the completed tool's canonical
// interaction even when the viewer, rather than the tool, first saw CAPTCHA.
func TestSampledCaptchaStopsProductionProviderLoop(t *testing.T) {
	var calls atomic.Int32
	var host *ComputerUseRuntime
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if json.NewDecoder(req.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flush := w.(http.Flusher)
		if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
			writeAskUserIntegrationTextResponse(w, flush, "title", "Sampled safety")
			return
		}
		n := calls.Add(1)

		if n == 2 {
			control := host.controlForTarget("target")
			control.mu.Lock()
			thread := control.threadID
			control.mu.Unlock()
			stopped := make(chan FlowerComputerFrame, 1)
			stop, err := host.startComputerLiveFrames(req.Context(), computerLiveRequest{ComputerViewerRequest: ComputerViewerRequest{ThreadID: thread, TargetID: "target", ObserverID: "fixture", Revision: 1}}, func(frame FlowerComputerFrame) { stopped <- frame })
			if err != nil {
				t.Error(err)
				http.Error(w, "sampler failed", 500)
				return
			}
			select {
			case frame := <-stopped:
				if frame.AssistanceKind != "captcha" {
					t.Errorf("lost classification: %+v", frame)
				}
			case <-time.After(time.Second):
				t.Error("sampler timeout")
			}
			stop()
		}
		if n > 2 {
			writeAskUserIntegrationTextResponse(w, flush, "unexpected", "Must not continue.")
			return
		}
		item := map[string]any{"type": "function_call", "id": fmt.Sprintf("fc_%d", n), "call_id": fmt.Sprintf("observe-%d", n), "name": "computer_observe", "arguments": `{"target":"browser.managed"}`}
		writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
		writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
		writeAskUserIntegrationCompletedResponse(w, flush, fmt.Sprintf("response-%d", n))
	}))
	defer provider.Close()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", DisplayName: "Flower managed browser", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	effects := atomic.Int32{}
	executor := browserControlReadyExecutor{scriptTestExecutor{fn: func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
		effects.Add(1)
		if call.liveFrame {
			return TargetToolResult{Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"captcha"}}}, nil
		}
		return TargetToolResult{TargetID: call.TargetID, Result: map[string]any{"observed": true}}, nil
	}}}

	state := t.TempDir()
	host = NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor}, filepath.Join(state, "media"))
	installBrowserStub(t, host)
	defer host.Close()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:         &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Safety", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.snapshotThreadStore().SetComputerTarget(t.Context(), thread.ThreadID, "target"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "start", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Inspect the task page."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
	if err != nil {
		t.Fatal(err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.WaitingPrompt != nil || calls.Load() > 2 })
	if view.WaitingPrompt == nil || calls.Load() != 2 || effects.Load() != 2 {
		t.Fatalf("loop escaped canonical pause: requests=%d executions=%d", calls.Load(), effects.Load())
	}
	if len(view.WaitingPrompt.Questions) != 1 || view.WaitingPrompt.Questions[0].ID != "computer_control" || !strings.Contains(view.WaitingPrompt.Questions[0].Question, "verification") {
		t.Fatalf("wrong assistance: %+v", view.WaitingPrompt)
	}
}

func TestSystemBrowserConnectionRequiresLiveProfileBeforeCanonicalRespond(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if json.NewDecoder(req.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flush := w.(http.Flusher)
		if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
			writeAskUserIntegrationTextResponse(w, flush, "title", "Connect browser")
			return
		}
		if calls.Add(1) == 1 {
			item := map[string]any{"type": "function_call", "id": "fc_discover", "call_id": "discover-system", "name": "computer_targets", "arguments": `{"browser_source":"system"}`}
			writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeAskUserIntegrationCompletedResponse(w, flush, "connect")
			return
		}
		writeAskUserIntegrationTextResponse(w, flush, "continued", "Browser connected.")
	}))
	defer provider.Close()
	state := t.TempDir()
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, filepath.Join(state, "media"))
	defer host.Close()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:         &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Connection", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "start", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Use my system browser."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
	if err != nil {
		t.Fatal(err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.WaitingPrompt != nil || calls.Load() > 1 })
	if view.WaitingPrompt == nil || calls.Load() != 1 {
		t.Fatal("connection did not stop the provider")
	}
	request := SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: view.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"browser_connection": {ChoiceID: "Continue with connected browser"}}}}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, request); err == nil {
		t.Fatal("unconnected browser resumed")
	}
	if calls.Load() != 1 || len(host.managedProfiles) != 0 {
		t.Fatal("missing connection launched a substitute")
	}
	hub, _, peer := extensionFixture(t, host)
	host.mu.Lock()
	host.extension = hub
	host.mu.Unlock()
	go func() {
		for {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				return
			}
			var message struct {
				ID      string `json:"id"`
				Command string `json:"command"`
			}
			if json.Unmarshal(raw, &message) != nil {
				return
			}
			if message.Command != "inventory" {
				t.Errorf("connection guide created or selected a tab: %s", message.Command)
				return
			}
			if browserbridge.WriteMessage(peer, map[string]any{"id": message.ID, "result": []any{}}, 1<<20) != nil {
				return
			}
		}
	}()
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, request); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
	if calls.Load() != 2 {
		t.Fatalf("continuation requests=%d", calls.Load())
	}
	selected, _ := svc.snapshotThreadStore().GetComputerTarget(t.Context(), thread.ThreadID)
	if selected != "" {
		t.Fatal("connection guide bound a target")
	}
}

type browserControlReadyExecutor struct{ scriptTestExecutor }

func (browserControlReadyExecutor) EnsureTargetReady(context.Context, string) error { return nil }
