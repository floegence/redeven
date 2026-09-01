package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestRedevenHostedRunAskUserWaitsAndResumesWithoutAuthorityCorruption(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	var sawStructuredContinuation atomic.Bool
	var sawHistoricalAskUserPair atomic.Bool
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)

		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_title", "Clarify deployment")
			return
		}
		switch mainCalls.Add(1) {
		case 1:
			args := `{"reason_code":"missing_external_input","required_from_user":["Choose a deployment target."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Target","question":"Which target should I deploy?","response_mode":"write","is_secret":false,"write_label":"Target","write_placeholder":"Type a target"}]}`
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"type": "response.output_item.added", "output_index": 0,
				"item": map[string]any{"type": "function_call", "id": "fc_ask_user", "call_id": "call_ask_user", "name": "ask_user", "arguments": args},
			})
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"type": "response.output_item.done", "output_index": 0,
				"item": map[string]any{"type": "function_call", "id": "fc_ask_user", "call_id": "call_ask_user", "name": "ask_user", "arguments": args},
			})
			writeAskUserIntegrationCompletedResponse(w, flusher, "resp_waiting")
			return
		case 2:
			if requestContainsPairedToolHistory(request, "ask_user") && !requestContainsLegacyInteractionText(request) {
				sawStructuredContinuation.Store(true)
			}
			writeAskUserIntegrationTextResponse(w, flusher, "resp_resumed", "Deployment target accepted.")
			return
		case 3:
			pair := requestContainsPairedToolHistory(request, "ask_user")
			sawHistoricalAskUserPair.Store(pair)
			writeAskUserIntegrationTextResponse(w, flusher, "resp_history", "Historical interaction remains available.")
			return
		default:
			t.Fatalf("unexpected main provider request %d", mainCalls.Load())
		}
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_ask_user_integration", ChannelID: "channel_ask_user_integration",
		NamespacePublicID: "namespace_ask_user", UserPublicID: "user_ask_user", UserEmail: "ask-user@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-5-nano"}},
			}},
		},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	start, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini",
		Input:   RunInput{Text: "Deploy the application."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil {
		t.Fatalf("SendUserTurn response=%#v err=%v", start, err)
	}
	if start.Kind != "start" {
		t.Fatalf("SendUserTurn response=%#v err=%v", start, err)
	}

	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "waiting_user" && view.WaitingPrompt != nil
	})
	prompt := waiting.WaitingPrompt
	if prompt == nil || len(prompt.Questions) != 1 || prompt.Questions[0].ID != "target" {
		t.Fatalf("waiting prompt=%#v, want canonical target question", prompt)
	}
	if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, "openai/gpt-5-nano"); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("SetThreadModel while waiting error=%v, want ErrThreadBusy", err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionReadonly)); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("SetThreadPermissionType while waiting error=%v, want ErrThreadBusy", err)
	}
	if _, err := svc.SubmitRequestUserInputResponse(context.Background(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-nano",
		Response: RequestUserInputResponse{
			PromptID: prompt.PromptID,
			Answers:  map[string]RequestUserInputAnswer{"target": {Text: "must not resume"}},
		},
	}); !errors.Is(err, ErrThreadModelConflict) {
		t.Fatalf("SubmitRequestUserInputResponse mismatched model error=%v, want ErrThreadModelConflict", err)
	}
	if mainCalls.Load() != 1 {
		t.Fatalf("mismatched continuation dispatched provider call; calls=%d", mainCalls.Load())
	}
	response, err := svc.SubmitRequestUserInputResponse(context.Background(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini",
		Response: RequestUserInputResponse{
			PromptID: prompt.PromptID,
			Answers:  map[string]RequestUserInputAnswer{"target": {Text: "production"}},
		},
		Input:   RunInput{Text: "production"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil || response.Kind != "accepted" || response.ConsumedWaitingPromptID != prompt.PromptID {
		t.Fatalf("SubmitRequestUserInputResponse response=%#v err=%v", response, err)
	}

	completed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "success"
	})
	if completed.WaitingPrompt != nil || strings.TrimSpace(completed.RunError) != "" {
		t.Fatalf("completed thread retained waiting/error state: %#v", completed)
	}
	bootstrap, err := svc.GetFlowerThreadDetail(context.Background(), meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadDetail: %v", err)
	}
	if len(bootstrap.Current.Items) == 0 || !strings.Contains(strings.ToLower(bootstrap.Thread.LastMessagePreview), "accepted") {
		t.Fatalf("canonical bootstrap=%#v, want resumed timeline", bootstrap)
	}
	if mainCalls.Load() != 2 {
		t.Fatalf("main provider calls=%d, want waiting and resumed calls", mainCalls.Load())
	}
	if !sawStructuredContinuation.Load() {
		t.Fatal("Ask User continuation did not preserve a paired tool call/result history")
	}

	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini",
		Input:   RunInput{Text: "Confirm that the earlier answer remains available."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}); err != nil {
		t.Fatalf("SendUserTurn after Ask User continuation: %v", err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "success" && strings.Contains(view.LastMessagePreview, "Historical interaction")
	})
	if mainCalls.Load() != 3 || !sawHistoricalAskUserPair.Load() {
		t.Fatalf("main_calls=%d historical_pair=%t", mainCalls.Load(), sawHistoricalAskUserPair.Load())
	}
}

func requestContainsPairedToolHistory(request map[string]any, toolName string) bool {
	calls := make(map[string]struct{})
	results := make(map[string]struct{})
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			typeName := strings.TrimSpace(anyToString(typed["type"]))
			role := strings.TrimSpace(anyToString(typed["role"]))
			if typeName == "function_call" && strings.TrimSpace(anyToString(typed["name"])) == toolName {
				calls[strings.TrimSpace(anyToString(typed["call_id"]))] = struct{}{}
			}
			if typeName == "function_call_output" {
				results[strings.TrimSpace(anyToString(typed["call_id"]))] = struct{}{}
			}
			if role == "assistant" {
				if toolCalls, ok := typed["tool_calls"].([]any); ok {
					for _, rawCall := range toolCalls {
						call, _ := rawCall.(map[string]any)
						function, _ := call["function"].(map[string]any)
						if strings.TrimSpace(anyToString(function["name"])) == toolName {
							calls[strings.TrimSpace(anyToString(call["id"]))] = struct{}{}
						}
					}
				}
			}
			if role == "tool" && (strings.TrimSpace(anyToString(typed["name"])) == toolName || strings.TrimSpace(anyToString(typed["name"])) == "") {
				results[strings.TrimSpace(anyToString(typed["tool_call_id"]))] = struct{}{}
			}
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(request)
	for callID := range calls {
		if callID != "" {
			if _, ok := results[callID]; ok {
				return true
			}
		}
	}
	return false
}

func requestContainsLegacyInteractionText(request map[string]any) bool {
	raw, _ := json.Marshal(request)
	return bytes.Contains(raw, []byte("Agent requested user input")) || bytes.Contains(raw, []byte(`"interaction_response"`))
}

func TestRedevenHostedRunNaturalStopCompletesTurn(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_title_natural", "Natural completion")
			return
		}
		if mainCalls.Add(1) != 1 {
			t.Fatalf("unexpected main provider request %d", mainCalls.Load())
		}
		writeAskUserIntegrationTextResponse(w, flusher, "resp_natural_stop", "Finished naturally.")
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_natural_completion", ChannelID: "channel_natural_completion",
		NamespacePublicID: "namespace_natural", UserPublicID: "user_natural", UserEmail: "natural@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			}},
		},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Finish with a normal response."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}); err != nil {
		t.Fatal(err)
	}
	completed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "success"
	})
	if mainCalls.Load() != 1 {
		t.Fatalf("main calls=%d, want one natural-stop request", mainCalls.Load())
	}
	if !strings.Contains(completed.LastMessagePreview, "Finished naturally") {
		t.Fatalf("last message=%q, want natural completion output", completed.LastMessagePreview)
	}
	requireAssistantTimelineTextContains(t, context.Background(), svc, meta, thread.ThreadID, "Finished naturally.")
}

func TestSubmitRequestUserInputResponseRPCReturnsAdmissionReceiptBeforeProviderCompletes(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	var sawStableContinuationSystemPrompt atomic.Bool
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{}, 1)
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)

		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "chat_title_receipt", "Receipt boundary")
			return
		}
		if mainCalls.Add(1) == 1 {
			args := `{"reason_code":"missing_external_input","required_from_user":["Provide a receipt value."],"evidence_refs":[],"questions":[{"id":"receipt","header":"Receipt","question":"What value should continue the run?","response_mode":"write","is_secret":false,"write_label":"Value","write_placeholder":"Type a value"}]}`
			writeDeepSeekIntegrationToolCall(w, flusher, "chat_waiting_receipt", "call_receipt", "ask_user", args)
			return
		}
		if deepSeekRequestHasStableSystemPrompt(request, "Ask for a receipt value.", "accepted") {
			sawStableContinuationSystemPrompt.Store(true)
		}
		close(providerStarted)
		writeDeepSeekIntegrationReasoningDelta(w, flusher, "chat_resumed_receipt", "Check")
		writeDeepSeekIntegrationReasoningDelta(w, flusher, "chat_resumed_receipt", " receipt")
		select {
		case <-releaseProvider:
			writeDeepSeekIntegrationNaturalResponse(w, flusher, "chat_resumed_receipt", "Receipt accepted.")
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		select {
		case releaseProvider <- struct{}{}:
		default:
		}
		providerServer.Close()
	})

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_receipt_boundary", ChannelID: "channel_receipt_boundary",
		NamespacePublicID: "namespace_receipt", UserPublicID: "user_receipt", UserEmail: "receipt@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "deepseek/deepseek-v4-pro",
			Providers: []config.AIProvider{{
				ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "deepseek-v4-pro"}},
			}},
		},
		RunMaxWallTime: 30 * time.Second, RunIdleTimeout: 30 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "", "deepseek/deepseek-v4-pro", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, Model: "deepseek/deepseek-v4-pro",
		Input: RunInput{Text: "Ask for a receipt value."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}); err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "waiting_user" && view.WaitingPrompt != nil
	})
	prompt := waiting.WaitingPrompt
	live, err := svc.SubscribeFlowerLiveStream(context.Background(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatalf("subscribe Flower live stream: %v", err)
	}
	defer live.Close()
	_ = nextFlowerLiveStreamFrame(t, live)
	baseline := nextFlowerLiveStreamFrame(t, live)
	var baselineEnvelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(baseline.Data, &baselineEnvelope); err != nil {
		t.Fatalf("decode waiting baseline: %v", err)
	}
	if baselineEnvelope.Current == nil || baselineEnvelope.Current.RunID == "" {
		t.Fatalf("waiting baseline=%s, want active run identity", baseline.Data)
	}
	waitingRunID := baselineEnvelope.Current.RunID

	router := sessionrpc.NewRouter()
	rpcClient := newTestRPCPeer(router)
	svc.RegisterRPC(router, meta, rpcClient)

	type submitResult struct {
		response aiSubmitRequestUserInputResponseResp
		err      error
	}
	submitted := make(chan submitResult, 1)
	go func() {
		payload, marshalErr := json.Marshal(aiSubmitRequestUserInputResponseReq{
			ThreadID: thread.ThreadID, Model: "deepseek/deepseek-v4-pro",
			Response: RequestUserInputResponse{
				PromptID: prompt.PromptID,
				Answers:  map[string]RequestUserInputAnswer{"receipt": {Text: "accepted"}},
			},
			Input: RunInput{Text: "accepted"}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
		})
		if marshalErr != nil {
			submitted <- submitResult{err: marshalErr}
			return
		}
		callCtx, cancelCall := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelCall()
		raw, rpcErr, callErr := callTestRPC(callCtx, rpcClient, TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, payload)
		if callErr != nil {
			submitted <- submitResult{err: callErr}
			return
		}
		if rpcErr != nil {
			message := "rpc error"
			if strings.TrimSpace(rpcErr.Message) != "" {
				message = strings.TrimSpace(rpcErr.Message)
			}
			submitted <- submitResult{err: errors.New(message)}
			return
		}
		var response aiSubmitRequestUserInputResponseResp
		if unmarshalErr := json.Unmarshal(raw, &response); unmarshalErr != nil {
			submitted <- submitResult{err: unmarshalErr}
			return
		}
		submitted <- submitResult{response: response}
	}()

	select {
	case <-providerStarted:
		if !sawStableContinuationSystemPrompt.Load() {
			t.Fatal("Ask User continuation rewrote the stable System Prompt with Turn input or answer")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("resumed provider request did not start")
	}
	assertAskUserContinuationLiveThinking(t, live, thread.ThreadID, waitingRunID, "Check receipt")
	select {
	case result := <-submitted:
		if result.err != nil || result.response.Kind != "accepted" ||
			result.response.ConsumedWaitingPromptID != prompt.PromptID ||
			result.response.Current.ThreadID.String() != thread.ThreadID || result.response.Current.ViewVersion <= 0 {
			t.Fatalf("command result=%#v err=%v", result.response, result.err)
		}
		var responseBlock *persistedInputResponseBlock
		for _, item := range result.response.Current.Items {
			if item.Kind != flruntime.ThreadItemInteraction {
				continue
			}
			raw, ok, projectionErr := typedThreadItemMessage(thread.ThreadID, item)
			if projectionErr != nil {
				t.Fatalf("project accepted input: %v", projectionErr)
			}
			if !ok {
				continue
			}
			var message struct {
				Blocks []persistedInputResponseBlock `json:"blocks"`
			}
			if err := json.Unmarshal(raw, &message); err != nil {
				t.Fatalf("decode accepted input projection: %v", err)
			}
			if len(message.Blocks) == 1 {
				responseBlock = &message.Blocks[0]
			}
		}
		if responseBlock == nil || len(responseBlock.Questions) != 1 ||
			responseBlock.Questions[0].Question != "What value should continue the run?" ||
			responseBlock.Questions[0].Answer != "accepted" {
			t.Fatalf("accepted input projection=%#v", responseBlock)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("structured response waited for provider execution after canonical admission")
	}
	releaseProvider <- struct{}{}
}

func deepSeekRequestHasStableSystemPrompt(request map[string]any, forbidden ...string) bool {
	messages, _ := request["messages"].([]any)
	for _, raw := range messages {
		message, _ := raw.(map[string]any)
		if strings.TrimSpace(anyToString(message["role"])) != "system" {
			continue
		}
		content := anyToString(message["content"])
		if strings.Contains(content, "- Objective:") {
			return false
		}
		for _, value := range forbidden {
			if value = strings.TrimSpace(value); value != "" && strings.Contains(content, value) {
				return false
			}
		}
		return true
	}
	return false
}

func assertAskUserContinuationLiveThinking(t *testing.T, live *FlowerLiveStreamSubscription, threadID string, waitingRunID identity.RunID, wantThinking string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	sawPreparing := false
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		frame, err := live.Next(ctx)
		cancel()
		if err != nil {
			t.Fatalf("read continuation live frame: %v", err)
		}
		if frame.Kind != FlowerLiveStreamThreadBatch {
			continue
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatalf("decode continuation live frame: %v", err)
		}
		current := envelope.Current
		if envelope.ThreadID != threadID || current == nil || current.RunID == "" || current.RunID == waitingRunID {
			continue
		}
		if current.RunProgress != nil && current.RunProgress.Phase == flruntime.ThreadRunPhasePreparing {
			sawPreparing = true
		}
		for _, item := range current.Items {
			if item.Kind == flruntime.ThreadItemThinking && item.RunID == current.RunID && item.Live && item.Text == wantThinking {
				if !sawPreparing {
					t.Fatal("live thinking arrived before the new Run published preparing")
				}
				return
			}
		}
	}
	t.Fatalf("continuation did not publish new-run progress and live thinking %q before terminal", wantThinking)
}

func writeAskUserIntegrationCompletedResponse(w http.ResponseWriter, flusher http.Flusher, responseID string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": responseID, "model": "gpt-5-mini", "status": "completed",
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeAskUserIntegrationTextResponse(w http.ResponseWriter, flusher http.Flusher, responseID string, text string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": text})
	writeAskUserIntegrationCompletedResponse(w, flusher, responseID)
}

func writeDeepSeekIntegrationReasoningDelta(w http.ResponseWriter, flusher http.Flusher, responseID string, text string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-pro",
		"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{"reasoning_content": text}}},
	})
}

func writeDeepSeekIntegrationNaturalResponse(w http.ResponseWriter, flusher http.Flusher, responseID string, text string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-pro",
		"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{"role": "assistant", "content": text}}},
	})
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-pro",
		"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "delta": map[string]any{}}},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func waitForAskUserIntegrationThread(t *testing.T, svc *Service, meta *session.Meta, threadID string, ready func(*ThreadView) bool) *ThreadView {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		view, err := svc.GetThread(context.Background(), meta, threadID)
		if err == nil && view != nil && ready(view) {
			return view
		}
		time.Sleep(10 * time.Millisecond)
	}
	view, err := svc.GetThread(context.Background(), meta, threadID)
	t.Fatalf("thread did not reach expected state: view=%#v err=%v", view, err)
	return nil
}
