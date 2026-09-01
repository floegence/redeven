package ai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type deepSeekContextObservation struct {
	Index                  int
	Model                  string
	MessageHashes          []string
	MessageRoles           []string
	MessageToolCallNames   []string
	MessageToolResultNames []string
	DefinitionToolNames    []string
	SystemHash             string
	ToolsHash              string
	MarkerPresence         []bool
	MarkerMessageIndexes   []int
	HasPreviousResponseID  bool
	ProviderMetadataFields int
	HasLegacyInteraction   bool
	ResponseToolNames      []string
	ResponseFinishReasons  []string
}

type deepSeekContextRecorder struct {
	mu           sync.Mutex
	markers      []string
	observations []deepSeekContextObservation
	err          error
}

func (r *deepSeekContextRecorder) record(body []byte) *deepSeekContextObservation {
	var envelope struct {
		Model              string            `json:"model"`
		Messages           []json.RawMessage `json:"messages"`
		Tools              []json.RawMessage `json:"tools"`
		PreviousResponseID json.RawMessage   `json:"previous_response_id"`
		ResponseID         json.RawMessage   `json:"response_id"`
		ProviderState      json.RawMessage   `json:"provider_state"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		r.mu.Lock()
		if r.err == nil {
			r.err = fmt.Errorf("decode proxied request: %w", err)
		}
		r.mu.Unlock()
		return nil
	}
	if len(envelope.Tools) == 0 {
		return nil
	}
	observation := deepSeekContextObservation{
		Index:                 -1,
		Model:                 strings.TrimSpace(envelope.Model),
		MessageHashes:         make([]string, 0, len(envelope.Messages)),
		MessageRoles:          make([]string, 0, len(envelope.Messages)),
		MarkerPresence:        make([]bool, len(r.markers)),
		MarkerMessageIndexes:  make([]int, len(r.markers)),
		HasPreviousResponseID: len(envelope.PreviousResponseID) > 0 && string(envelope.PreviousResponseID) != "null",
		HasLegacyInteraction:  bytes.Contains(body, []byte("Agent requested user input")) || bytes.Contains(body, []byte(`"interaction_response"`)),
	}
	if len(envelope.ResponseID) > 0 && string(envelope.ResponseID) != "null" {
		observation.ProviderMetadataFields++
	}
	if len(envelope.ProviderState) > 0 && string(envelope.ProviderState) != "null" {
		observation.ProviderMetadataFields++
	}
	for i := range observation.MarkerMessageIndexes {
		observation.MarkerMessageIndexes[i] = -1
	}
	toolNamesByCallID := make(map[string]string)
	toolResultCallIDs := make([]string, 0, 2)
	for messageIndex, message := range envelope.Messages {
		observation.MessageHashes = append(observation.MessageHashes, sha256Hex(message))
		var header struct {
			Role       string `json:"role"`
			ToolCallID string `json:"tool_call_id"`
			ToolCalls  []struct {
				ID       string `json:"id"`
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tool_calls"`
		}
		_ = json.Unmarshal(message, &header)
		if observation.SystemHash == "" && strings.TrimSpace(header.Role) == "system" {
			observation.SystemHash = sha256Hex(message)
		}
		observation.MessageRoles = append(observation.MessageRoles, strings.TrimSpace(header.Role))
		for _, call := range header.ToolCalls {
			name := strings.TrimSpace(call.Function.Name)
			if name == "" {
				continue
			}
			observation.MessageToolCallNames = append(observation.MessageToolCallNames, name)
			if callID := strings.TrimSpace(call.ID); callID != "" {
				toolNamesByCallID[callID] = name
			}
		}
		if strings.TrimSpace(header.Role) == "tool" {
			toolResultCallIDs = append(toolResultCallIDs, strings.TrimSpace(header.ToolCallID))
		}
		for markerIndex, marker := range r.markers {
			if observation.MarkerMessageIndexes[markerIndex] < 0 && bytes.Contains(message, []byte(marker)) {
				observation.MarkerMessageIndexes[markerIndex] = messageIndex
			}
		}
	}
	for _, callID := range toolResultCallIDs {
		if name := toolNamesByCallID[callID]; name != "" {
			observation.MessageToolResultNames = append(observation.MessageToolResultNames, name)
		}
	}
	for _, rawTool := range envelope.Tools {
		var tool struct {
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		}
		if json.Unmarshal(rawTool, &tool) == nil {
			if name := strings.TrimSpace(tool.Function.Name); name != "" {
				observation.DefinitionToolNames = append(observation.DefinitionToolNames, name)
			}
		}
	}
	toolsJSON, _ := json.Marshal(envelope.Tools)
	observation.ToolsHash = sha256Hex(toolsJSON)
	for i, marker := range r.markers {
		observation.MarkerPresence[i] = bytes.Contains(body, []byte(marker))
	}
	r.mu.Lock()
	observation.Index = len(r.observations)
	r.observations = append(r.observations, observation)
	r.mu.Unlock()
	return &observation
}

func (r *deepSeekContextRecorder) recordResponse(index int, toolNames []string, finishReasons []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if index < 0 || index >= len(r.observations) {
		return
	}
	r.observations[index].ResponseToolNames = append([]string(nil), toolNames...)
	r.observations[index].ResponseFinishReasons = append([]string(nil), finishReasons...)
}

func sha256Hex(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func TestE2E_FlowerDeepSeekV4ContextPrefixAndModelSwitch(t *testing.T) {
	if strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E")) != "1" {
		t.Skip("set REDEVEN_FLOWER_CONTEXT_E2E=1 to enable the real DeepSeek context qualification")
	}
	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	if apiKey == "" {
		t.Fatal("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY is required")
	}

	markers := []string{
		"FLOWER_CONTEXT_FLASH_ONE_9F2C",
		"FLOWER_CONTEXT_PRO_TWO_6D81",
		"FLOWER_CONTEXT_FLASH_THREE_4A73",
	}
	recorder := &deepSeekContextRecorder{markers: markers}
	proxyURL := newDeepSeekRecordingProxy(t, baseURL, recorder)
	providerID := "deepseek-context-e2e"
	flashModelID := providerID + "/deepseek-v4-flash"
	proModelID := providerID + "/deepseek-v4-pro"
	cfg := &config.AIConfig{
		CurrentModelID: flashModelID,
		PermissionType: config.AIPermissionFullAccess,
		Providers: []config.AIProvider{{
			ID: providerID, Name: "DeepSeek context E2E", Type: "deepseek", BaseURL: proxyURL,
			Models: []config.AIProviderModel{
				{ModelName: "deepseek-v4-flash", ContextWindow: 128_000, MaxOutputTokens: 28_000, EffectiveContextWindowPercent: 100},
				{ModelName: "deepseek-v4-pro", ContextWindow: 128_000, MaxOutputTokens: 28_000, EffectiveContextWindowPercent: 100},
			},
		}},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("validate isolated DeepSeek profile: %v", err)
	}

	stateDir := t.TempDir()
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "bash", Config: cfg,
		RunMaxWallTime: 8 * time.Minute, RunIdleTimeout: 3 * time.Minute, ToolApprovalTimeout: time.Minute,
		ResolveProviderAPIKey: func(candidate string) (string, bool, error) {
			if strings.TrimSpace(candidate) != providerID {
				return "", false, nil
			}
			return apiKey, true, nil
		},
	})
	if err != nil {
		t.Fatalf("create isolated Flower service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := session.Meta{
		EndpointID: "env_deepseek_context_e2e", NamespacePublicID: "ns_deepseek_context_e2e",
		ChannelID: "ch_deepseek_context_e2e", UserPublicID: "user_deepseek_context_e2e",
		UserEmail: "deepseek-context-e2e@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	threadID := createDeepSeekCompactionThread(t, ctx, svc, &meta, flashModelID, "Context prefix and model switching")

	first := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, "context-flash-one", threadID, flashModelID,
		"Remember "+markers[0]+". Do not ask questions or call tools. Reply briefly with "+markers[0]+" and finish normally.")
	assertNoDeepSeekContextCompaction(t, first, "first Flash turn")
	if err := svc.SetThreadModel(ctx, &meta, threadID, proModelID); err != nil {
		t.Fatalf("switch to Pro: %v", err)
	}
	if err := svc.SetThreadPermissionType(ctx, &meta, threadID, string(FlowerPermissionReadonly)); err != nil {
		t.Fatalf("switch to readonly surface: %v", err)
	}
	second := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, "context-pro-two", threadID, "",
		"Remember "+markers[1]+" and the earlier marker. Do not ask questions or call tools. Reply briefly with "+markers[1]+" and finish normally.")
	assertNoDeepSeekContextCompaction(t, second, "Pro turn")
	if err := svc.SetThreadModel(ctx, &meta, threadID, flashModelID); err != nil {
		t.Fatalf("switch back to Flash: %v", err)
	}
	if err := svc.SetThreadPermissionType(ctx, &meta, threadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatalf("restore full-access surface: %v", err)
	}
	third := sendDeepSeekCompactionTurn(t, ctx, svc, &meta, "context-flash-three", threadID, "",
		"Remember "+markers[2]+" and both earlier markers. Do not ask questions or call tools. Reply briefly with "+markers[2]+" and finish normally.")
	assertNoDeepSeekContextCompaction(t, third, "second Flash turn")

	assertDeepSeekContextObservations(t, recorder)
}

func TestE2E_FlowerDeepSeekV4AskUserStructuredContinuation(t *testing.T) {
	if strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E")) != "1" {
		t.Skip("set REDEVEN_FLOWER_CONTEXT_E2E=1 to enable the real DeepSeek context qualification")
	}
	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	if apiKey == "" {
		t.Fatal("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY is required")
	}

	const marker = "FLOWER_ASK_USER_STRUCTURED_73C1"
	recorder := &deepSeekContextRecorder{markers: []string{marker}}
	proxyURL := newDeepSeekRecordingProxy(t, baseURL, recorder)
	providerID := "deepseek-ask-user-e2e"
	modelID := providerID + "/deepseek-v4-flash"
	cfg := &config.AIConfig{
		CurrentModelID: modelID,
		PermissionType: config.AIPermissionFullAccess,
		Providers: []config.AIProvider{{
			ID: providerID, Name: "DeepSeek Ask User E2E", Type: "deepseek", BaseURL: proxyURL,
			Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash", ContextWindow: 128_000, MaxOutputTokens: 28_000, EffectiveContextWindowPercent: 100}},
		}},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("validate isolated DeepSeek profile: %v", err)
	}

	stateDir := t.TempDir()
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "bash", Config: cfg,
		RunMaxWallTime: 8 * time.Minute, RunIdleTimeout: 3 * time.Minute, ToolApprovalTimeout: time.Minute,
		ResolveProviderAPIKey: func(candidate string) (string, bool, error) {
			if strings.TrimSpace(candidate) != providerID {
				return "", false, nil
			}
			return apiKey, true, nil
		},
	})
	if err != nil {
		t.Fatalf("create isolated Flower service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := session.Meta{
		EndpointID: "env_deepseek_ask_user_e2e", NamespacePublicID: "ns_deepseek_ask_user_e2e",
		ChannelID: "ch_deepseek_ask_user_e2e", UserPublicID: "user_deepseek_ask_user_e2e",
		UserEmail: "deepseek-ask-user-e2e@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	threadID := createDeepSeekCompactionThread(t, ctx, svc, &meta, modelID, "Structured Ask User continuation")
	response, err := svc.SendUserTurn(ctx, &meta, SendUserTurnRequest{
		ClientRequestID: "deepseek-ask-user", ThreadID: threadID, Model: modelID,
		Input:   RunInput{Text: "Qualification marker " + marker + ". Another user answer is required before you can continue. Call ask_user exactly once now with one non-secret write question whose id is target and asks for the deployment target. Do not end with a prose question. After the answer, acknowledge it briefly and stop naturally without another tool call."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}},
	})
	if err != nil || response.Kind == "" {
		t.Fatalf("send Ask User qualification turn: response=%#v err=%v", response, err)
	}
	waiting := waitForDeepSeekAskUserDetail(t, ctx, svc, &meta, threadID, func(detail *FlowerThreadDetail) bool {
		return detail.Thread.WaitingPrompt != nil && detail.Thread.RunStatus == "waiting_user"
	})
	prompt := waiting.Thread.WaitingPrompt
	if prompt == nil || len(prompt.Questions) != 1 || prompt.Questions[0].ID != "target" {
		t.Fatalf("DeepSeek waiting prompt=%#v, want one target question", prompt)
	}
	accepted, err := svc.SubmitRequestUserInputResponse(ctx, &meta, SubmitRequestUserInputResponseRequest{
		ThreadID: threadID, Model: modelID,
		Response: RequestUserInputResponse{PromptID: prompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "staging"}}},
		Input:    RunInput{Text: "staging"},
		Options:  RunOptions{PermissionType: config.AIPermissionFullAccess, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}},
	})
	if err != nil || accepted.Kind != "accepted" {
		t.Fatalf("submit DeepSeek Ask User answer: response=%#v err=%v", accepted, err)
	}
	completed := waitForDeepSeekAskUserDetail(t, ctx, svc, &meta, threadID, func(detail *FlowerThreadDetail) bool {
		return detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil
	})
	if completed.Current.LastOutcome == nil || *completed.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
		t.Fatalf("DeepSeek Ask User outcome=%v failure=%#v", completed.Current.LastOutcome, completed.Current.Failure)
	}
	assertNoDeepSeekContextCompaction(t, completed, "Ask User continuation")
	assertDeepSeekAskUserObservations(t, recorder)
}

func waitForDeepSeekAskUserDetail(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string, ready func(*FlowerThreadDetail) bool) *FlowerThreadDetail {
	t.Helper()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		detail, err := svc.GetFlowerThreadDetail(ctx, meta, threadID)
		if err != nil {
			t.Fatalf("read DeepSeek Ask User thread: %v", err)
		}
		if detail != nil && ready(detail) {
			return detail
		}
		select {
		case <-ctx.Done():
			t.Fatalf("wait for DeepSeek Ask User state: %v", ctx.Err())
		case <-ticker.C:
		}
	}
}

func assertDeepSeekAskUserObservations(t *testing.T, recorder *deepSeekContextRecorder) {
	t.Helper()
	recorder.mu.Lock()
	observations := append([]deepSeekContextObservation(nil), recorder.observations...)
	recordErr := recorder.err
	recorder.mu.Unlock()
	if recordErr != nil {
		t.Fatal(recordErr)
	}
	var initial, resumed *deepSeekContextObservation
	for i := range observations {
		observation := &observations[i]
		if containsString(observation.ResponseToolNames, "ask_user") {
			initial = observation
		}
		if containsString(observation.MessageToolCallNames, "ask_user") && containsString(observation.MessageToolResultNames, "ask_user") {
			resumed = observation
		}
	}
	if initial == nil || resumed == nil {
		t.Fatalf("DeepSeek Ask User observations missing structured pair: %#v", observations)
	}
	if initial.Model != "deepseek-v4-flash" || resumed.Model != initial.Model {
		t.Fatalf("Ask User model drifted: initial=%q resumed=%q", initial.Model, resumed.Model)
	}
	if !containsString(initial.DefinitionToolNames, "ask_user") || !containsString(resumed.DefinitionToolNames, "ask_user") {
		t.Fatal("current Ask User definition was omitted from the frozen Turn surface")
	}
	if initial.SystemHash == "" || initial.SystemHash != resumed.SystemHash || initial.ToolsHash == "" || initial.ToolsHash != resumed.ToolsHash {
		t.Fatalf("Ask User Turn surface drifted: system=(%s,%s) tools=(%s,%s)", initial.SystemHash, resumed.SystemHash, initial.ToolsHash, resumed.ToolsHash)
	}
	initialMarker := initial.MarkerMessageIndexes[0]
	resumedMarker := resumed.MarkerMessageIndexes[0]
	if initialMarker < 0 || resumedMarker < 0 || initial.MessageHashes[initialMarker] != resumed.MessageHashes[resumedMarker] {
		t.Fatal("Ask User durable canonical user message changed across the ephemeral resume boundary")
	}
	if initial.HasLegacyInteraction || resumed.HasLegacyInteraction {
		t.Fatal("Ask User request contained the removed text interaction projection")
	}
	if !containsString(initial.ResponseFinishReasons, "tool_calls") {
		t.Fatalf("initial Ask User finish reasons=%v, want tool_calls", initial.ResponseFinishReasons)
	}
	if len(resumed.ResponseToolNames) != 0 || !containsString(resumed.ResponseFinishReasons, "stop") {
		t.Fatalf("resumed Ask User response tools=%v finishes=%v, want natural stop", resumed.ResponseToolNames, resumed.ResponseFinishReasons)
	}
}

func newDeepSeekRecordingProxy(t *testing.T, sourceBaseURL string, recorder *deepSeekContextRecorder) string {
	t.Helper()
	upstream, err := url.Parse(sourceBaseURL)
	if err != nil {
		t.Fatalf("parse DeepSeek base URL: %v", err)
	}
	transport := http.DefaultTransport
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, incoming *http.Request) {
		body, readErr := io.ReadAll(incoming.Body)
		if readErr != nil {
			http.Error(w, "request body unavailable", http.StatusBadRequest)
			return
		}
		observation := recorder.record(body)
		if observation != nil {
			t.Logf("recorded request model=%s messages=%d system=%s tools=%s markers=%v",
				observation.Model, len(observation.MessageHashes), shortHash(observation.SystemHash), shortHash(observation.ToolsHash), observation.MarkerPresence)
		}
		target := *upstream
		target.Path = incoming.URL.Path
		target.RawPath = incoming.URL.RawPath
		target.RawQuery = incoming.URL.RawQuery
		request, requestErr := http.NewRequestWithContext(incoming.Context(), incoming.Method, target.String(), bytes.NewReader(body))
		if requestErr != nil {
			http.Error(w, "upstream request unavailable", http.StatusBadGateway)
			return
		}
		request.Header = incoming.Header.Clone()
		request.Header.Del("Accept-Encoding")
		response, roundTripErr := transport.RoundTrip(request)
		if roundTripErr != nil {
			http.Error(w, "DeepSeek upstream unavailable", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		if observation != nil {
			t.Logf("forwarded request model=%s status=%d", observation.Model, response.StatusCode)
		}
		for key, values := range response.Header {
			if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Transfer-Encoding") {
				continue
			}
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		flusher, _ := w.(http.Flusher)
		responseToolNames := make([]string, 0, 2)
		responseFinishReasons := make([]string, 0, 2)
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 32*1024), 4*1024*1024)
		for scanner.Scan() {
			line := append([]byte(nil), scanner.Bytes()...)
			observeDeepSeekResponseLine(line, &responseToolNames, &responseFinishReasons)
			_, _ = w.Write(append(line, '\n'))
			if flusher != nil {
				flusher.Flush()
			}
		}
		if observation != nil {
			recorder.recordResponse(observation.Index, responseToolNames, responseFinishReasons)
			t.Logf("observed response model=%s tools=%v finishes=%v", observation.Model, responseToolNames, responseFinishReasons)
		}
	}))
	t.Cleanup(proxy.Close)
	return proxy.URL + strings.TrimSuffix(upstream.EscapedPath(), "/")
}

func observeDeepSeekResponseLine(line []byte, toolNames *[]string, finishReasons *[]string) {
	line = bytes.TrimSpace(line)
	if !bytes.HasPrefix(line, []byte("data:")) {
		return
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
	if bytes.Equal(payload, []byte("[DONE]")) {
		return
	}
	var event struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Delta        struct {
				ToolCalls []struct {
					Function struct {
						Name string `json:"name"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal(payload, &event) != nil {
		return
	}
	for _, choice := range event.Choices {
		if reason := strings.TrimSpace(choice.FinishReason); reason != "" {
			*finishReasons = append(*finishReasons, reason)
		}
		for _, call := range choice.Delta.ToolCalls {
			if name := strings.TrimSpace(call.Function.Name); name != "" {
				*toolNames = append(*toolNames, name)
			}
		}
	}
}

func shortHash(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}

func assertNoDeepSeekContextCompaction(t *testing.T, detail *FlowerThreadDetail, label string) {
	t.Helper()
	if detail == nil {
		t.Fatalf("%s returned no detail", label)
	}
	if len(detail.Thread.ContextCompactions) != 0 {
		t.Fatalf("%s unexpectedly compacted canonical history: count=%d", label, len(detail.Thread.ContextCompactions))
	}
}

func assertDeepSeekContextObservations(t *testing.T, recorder *deepSeekContextRecorder) {
	t.Helper()
	recorder.mu.Lock()
	observations := append([]deepSeekContextObservation(nil), recorder.observations...)
	recordErr := recorder.err
	recorder.mu.Unlock()
	if recordErr != nil {
		t.Fatal(recordErr)
	}
	selected := make([]deepSeekContextObservation, 3)
	for markerIndex := range selected {
		found := false
		for _, observation := range observations {
			if observation.MarkerPresence[markerIndex] && (markerIndex == 2 || !observation.MarkerPresence[markerIndex+1]) {
				selected[markerIndex] = observation
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("recording proxy did not observe the first request for turn %d", markerIndex+1)
		}
	}
	wantModels := []string{"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash"}
	for i, observation := range selected {
		if observation.Model != wantModels[i] {
			t.Fatalf("turn %d model=%q, want %q", i+1, observation.Model, wantModels[i])
		}
		for markerIndex := 0; markerIndex <= i; markerIndex++ {
			if !observation.MarkerPresence[markerIndex] {
				t.Fatalf("turn %d omitted canonical marker %d", i+1, markerIndex+1)
			}
		}
		if observation.HasPreviousResponseID || observation.ProviderMetadataFields != 0 {
			t.Fatalf("turn %d carried provider continuation metadata across the model boundary", i+1)
		}
		if len(observation.ResponseToolNames) != 0 {
			t.Fatalf("turn %d did not finish naturally; response tools=%v", i+1, observation.ResponseToolNames)
		}
		if !containsString(observation.ResponseFinishReasons, "stop") {
			t.Fatalf("turn %d finish reasons=%v, want stop", i+1, observation.ResponseFinishReasons)
		}
	}
	if selected[0].SystemHash == selected[1].SystemHash || selected[0].ToolsHash == selected[1].ToolsHash {
		t.Fatal("Pro turn did not receive the changed readonly System Prompt and tool surface")
	}
	if selected[0].SystemHash == "" || selected[0].SystemHash != selected[2].SystemHash {
		t.Fatalf("Flash System Prompt hash drifted: first=%s second=%s", selected[0].SystemHash, selected[2].SystemHash)
	}
	if selected[0].ToolsHash == "" || selected[0].ToolsHash != selected[2].ToolsHash {
		t.Fatalf("Flash tool hash drifted: first=%s second=%s", selected[0].ToolsHash, selected[2].ToolsHash)
	}
	firstUserEnd := selected[0].MarkerMessageIndexes[0] + 1
	if firstUserEnd <= 0 || !stringPrefix(selected[0].MessageHashes[:firstUserEnd], selected[2].MessageHashes) {
		t.Fatalf("Flash canonical render prefix drifted at digest index %d", firstStringDifference(selected[0].MessageHashes[:firstUserEnd], selected[2].MessageHashes))
	}
	for markerIndex := 0; markerIndex < 2; markerIndex++ {
		earlierIndex := selected[markerIndex].MarkerMessageIndexes[markerIndex]
		latestIndex := selected[2].MarkerMessageIndexes[markerIndex]
		if earlierIndex < 0 || latestIndex < 0 || selected[markerIndex].MessageHashes[earlierIndex] != selected[2].MessageHashes[latestIndex] {
			t.Fatalf("canonical user message %d changed across model turns", markerIndex+1)
		}
	}
	if !roleBetween(selected[2], "assistant", selected[2].MarkerMessageIndexes[0], selected[2].MarkerMessageIndexes[1]) ||
		!roleBetween(selected[2], "assistant", selected[2].MarkerMessageIndexes[1], selected[2].MarkerMessageIndexes[2]) {
		t.Fatal("latest Flash request omitted canonical assistant history between user turns")
	}
}

func roleBetween(observation deepSeekContextObservation, role string, after int, before int) bool {
	if after < -1 || before > len(observation.MessageRoles) || after >= before {
		return false
	}
	for index := after + 1; index < before; index++ {
		if observation.MessageRoles[index] == role {
			return true
		}
	}
	return false
}

func stringPrefix(prefix []string, values []string) bool {
	if len(prefix) > len(values) {
		return false
	}
	for i := range prefix {
		if prefix[i] != values[i] {
			return false
		}
	}
	return true
}

func firstStringDifference(left []string, right []string) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		if left[i] != right[i] {
			return i
		}
	}
	return limit
}
