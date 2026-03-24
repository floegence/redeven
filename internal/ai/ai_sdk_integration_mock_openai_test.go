package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type openAIMock struct {
	token string

	mu           sync.Mutex
	sawResponses bool
	sawChat      bool

	requestToolNames    []string
	requestInvalidTools []string
}

func isValidOpenAIToolName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

func extractOpenAIToolNames(req map[string]any) []string {
	if req == nil {
		return nil
	}

	// Chat Completions: tools: [{ type: "function", function: { name } }]
	if raw, ok := req["tools"]; ok {
		list, ok := raw.([]any)
		if !ok {
			return nil
		}
		out := make([]string, 0, len(list))
		for _, it := range list {
			m, ok := it.(map[string]any)
			if !ok || m == nil {
				continue
			}
			if n, ok := m["name"].(string); ok && strings.TrimSpace(n) != "" {
				out = append(out, strings.TrimSpace(n))
				continue
			}
			fn, ok := m["function"].(map[string]any)
			if !ok || fn == nil {
				continue
			}
			n, _ := fn["name"].(string)
			n = strings.TrimSpace(n)
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}

	// Legacy: functions: [{ name }]
	if raw, ok := req["functions"]; ok {
		list, ok := raw.([]any)
		if !ok {
			return nil
		}
		out := make([]string, 0, len(list))
		for _, it := range list {
			m, ok := it.(map[string]any)
			if !ok || m == nil {
				continue
			}
			n, _ := m["name"].(string)
			n = strings.TrimSpace(n)
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}

	return nil
}

func isIntentClassifierRequest(req map[string]any) bool {
	if req == nil {
		return false
	}
	instructions := extractClassifierInstructions(req)
	return strings.Contains(instructions, runPolicyClassifierMarker) || strings.Contains(instructions, askUserPolicyClassifierMarker) || strings.Contains(instructions, interactionContractClassifierMarker)
}

func classifyIntentResponseToken(req map[string]any) string {
	instructions := extractClassifierInstructions(req)
	if strings.Contains(strings.TrimSpace(instructions), askUserPolicyClassifierMarker) {
		return classifyAskUserPolicyResponseToken(req)
	}
	if strings.Contains(strings.TrimSpace(instructions), interactionContractClassifierMarker) {
		return classifyInteractionContractResponseToken(req)
	}
	userText := strings.ToLower(strings.TrimSpace(extractResponsesUserText(req)))
	openGoalText, userMessage := extractIntentClassifierContext(userText)
	guidedAgeGuess := strings.Contains(userMessage, "猜我的岁数") || strings.Contains(userMessage, "每个问题") || strings.Contains(userMessage, "几个选项")
	guidedAgeGuess = guidedAgeGuess || strings.Contains(openGoalText, "猜我的岁数") || strings.Contains(openGoalText, "每个问题") || strings.Contains(openGoalText, "几个选项")
	if userText == "" {
		return `{"intent":"task","reason":"empty_input","objective_mode":"replace","complexity":"simple","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.42}`
	}
	if guidedAgeGuess {
		instructionsLower := strings.ToLower(strings.TrimSpace(instructions))
		if strings.Contains(instructionsLower, "guided structured interaction") && strings.Contains(instructionsLower, "option-driven conversations") {
			objectiveMode := "replace"
			reason := "guided_structured_interaction_requested"
			if strings.TrimSpace(openGoalText) != "" && !strings.Contains(userMessage, "猜我的岁数") {
				objectiveMode = "continue"
				reason = "guided_structured_interaction_continuation"
			}
			return fmt.Sprintf(`{"intent":"task","reason":"%s","objective_mode":"%s","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.89,"interaction_contract":{"enabled":true,"reason":"guided_option_interaction","single_question_per_turn":true,"fixed_choices_required":true,"open_text_fallback_required":true,"indirect_questions_only":true,"confidence":0.93}}`, reason, objectiveMode)
		}
		return `{"intent":"social","reason":"guided_interaction_misclassified_without_prompt","objective_mode":"replace","complexity":"simple","todo_policy":"none","minimum_todo_items":0,"confidence":0.61}`
	}
	if strings.TrimSpace(openGoalText) != "" {
		continuationSignals := []string{"continue", "go on", "keep going", "proceed"}
		for _, signal := range continuationSignals {
			if strings.Contains(userMessage, signal) {
				return `{"intent":"task","reason":"follow_up_to_open_goal","objective_mode":"continue","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.91}`
			}
		}
	}
	creativeSignals := []string{"write a story", "fairy tale", "poem", "creative writing", "童话", "故事", "小说", "诗歌", "文案"}
	for _, signal := range creativeSignals {
		if strings.Contains(userText, signal) {
			return `{"intent":"creative","reason":"creative_generation_requested","objective_mode":"replace","complexity":"simple","todo_policy":"none","minimum_todo_items":0,"confidence":0.93}`
		}
	}
	taskSignals := []string{
		"say ", "analyze", "analysis", "implement", "fix", "edit", "change", "review",
		"debug", "test", "build", "run", "list", "summarize", "check", "inspect",
	}
	for _, signal := range taskSignals {
		if strings.Contains(userText, signal) {
			return `{"intent":"task","reason":"actionable_request_detected","objective_mode":"replace","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.86}`
		}
	}
	socialSignals := []string{"hello", "hi", "hey", "thanks", "thank you", "你好", "谢谢"}
	for _, signal := range socialSignals {
		if strings.Contains(userText, signal) {
			return `{"intent":"social","reason":"small_talk_detected","objective_mode":"replace","complexity":"simple","todo_policy":"none","minimum_todo_items":0,"confidence":0.95}`
		}
	}
	return `{"intent":"task","reason":"actionable_request_detected","objective_mode":"replace","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.78}`
}

func classifyInteractionContractResponseToken(req map[string]any) string {
	userText := strings.ToLower(strings.TrimSpace(extractResponsesUserText(req)))
	if strings.Contains(userText, "猜我的岁数") || strings.Contains(userText, "每个问题") || strings.Contains(userText, "几个选项") || strings.Contains(userText, "active objective:\n请你和我一问一答猜我的岁数") {
		return `{"enabled":true,"reason":"guided_option_interaction","single_question_per_turn":true,"fixed_choices_required":true,"open_text_fallback_required":true,"indirect_questions_only":true,"confidence":0.94}`
	}
	return `{"enabled":false,"reason":"no_guided_interaction_contract","single_question_per_turn":false,"fixed_choices_required":false,"open_text_fallback_required":false,"indirect_questions_only":false,"confidence":0}`
}

func extractClassifierInstructions(req map[string]any) string {
	if req == nil {
		return ""
	}
	if instructions, _ := req["instructions"].(string); strings.TrimSpace(instructions) != "" {
		return strings.TrimSpace(instructions)
	}
	rawSystem, ok := req["system"]
	if !ok {
		return ""
	}
	switch v := rawSystem.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			block, ok := item.(map[string]any)
			if !ok || block == nil {
				continue
			}
			if strings.ToLower(strings.TrimSpace(fmt.Sprint(block["type"]))) != "text" {
				continue
			}
			txt := strings.TrimSpace(fmt.Sprint(block["text"]))
			if txt != "" {
				parts = append(parts, txt)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

func classifyAskUserPolicyResponseToken(req map[string]any) string {
	userText := strings.ToLower(strings.TrimSpace(extractResponsesUserText(req)))
	if strings.Contains(userText, `"reason_code":""`) || strings.Contains(userText, `"required_from_user":[]`) {
		return `{"allow":false,"reason":"contract_incomplete","confidence":0.72}`
	}
	return `{"allow":true,"reason":"policy_allowed_by_model","confidence":0.88}`
}

func extractIntentClassifierContext(text string) (string, string) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", ""
	}
	const goalPrefix = "current open goal:"
	const userPrefix = "user message:"
	goalIdx := strings.Index(trimmed, goalPrefix)
	userIdx := strings.Index(trimmed, userPrefix)
	if goalIdx < 0 || userIdx < 0 || userIdx <= goalIdx {
		return "", trimmed
	}
	openGoal := strings.TrimSpace(trimmed[goalIdx+len(goalPrefix) : userIdx])
	userMessage := strings.TrimSpace(trimmed[userIdx+len(userPrefix):])
	if openGoal == "(none)" {
		openGoal = ""
	}
	return openGoal, userMessage
}

func extractResponsesUserText(req map[string]any) string {
	rawInput, ok := req["input"]
	if ok {
		items, ok := rawInput.([]any)
		if !ok {
			return ""
		}
		for i := len(items) - 1; i >= 0; i-- {
			msg, ok := items[i].(map[string]any)
			if !ok || msg == nil {
				continue
			}
			role := strings.ToLower(strings.TrimSpace(fmt.Sprint(msg["role"])))
			if role != "user" {
				continue
			}
			content, ok := msg["content"].([]any)
			if !ok {
				continue
			}
			parts := make([]string, 0, len(content))
			for _, item := range content {
				part, ok := item.(map[string]any)
				if !ok || part == nil {
					continue
				}
				if strings.ToLower(strings.TrimSpace(fmt.Sprint(part["type"]))) != "input_text" {
					continue
				}
				txt := strings.TrimSpace(fmt.Sprint(part["text"]))
				if txt != "" {
					parts = append(parts, txt)
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, "\n")
			}
		}
	}

	rawMessages, ok := req["messages"]
	if !ok {
		return ""
	}
	items, ok := rawMessages.([]any)
	if !ok {
		return ""
	}
	for i := len(items) - 1; i >= 0; i-- {
		msg, ok := items[i].(map[string]any)
		if !ok || msg == nil {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(fmt.Sprint(msg["role"])))
		if role != "user" {
			continue
		}
		content, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		parts := make([]string, 0, len(content))
		for _, item := range content {
			part, ok := item.(map[string]any)
			if !ok || part == nil {
				continue
			}
			if strings.ToLower(strings.TrimSpace(fmt.Sprint(part["type"]))) != "text" {
				continue
			}
			txt := strings.TrimSpace(fmt.Sprint(part["text"]))
			if txt != "" {
				parts = append(parts, txt)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

func (m *openAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	var req map[string]any
	_ = json.Unmarshal(body, &req) // best-effort; used only for request sanity checks

	path := strings.TrimSpace(r.URL.Path)
	switch {
	case strings.HasSuffix(path, "/responses"):
		isClassifier := isIntentClassifierRequest(req)
		respToken := m.token
		if isClassifier {
			respToken = classifyIntentResponseToken(req)
		}
		m.mu.Lock()
		m.sawResponses = true
		if !isClassifier {
			m.requestToolNames = extractOpenAIToolNames(req)
			m.requestInvalidTools = m.requestInvalidTools[:0]
			for _, n := range m.requestToolNames {
				if !isValidOpenAIToolName(n) {
					m.requestInvalidTools = append(m.requestInvalidTools, n)
				}
			}
		}
		m.mu.Unlock()

		if strings.TrimSpace(fmt.Sprint(req["model"])) == "" {
			http.Error(w, "missing model", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		itemID := "msg_test_1"
		created := map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_test_1",
				"created_at": time.Now().Unix(),
				"model":      strings.TrimSpace(fmt.Sprint(req["model"])),
			},
		}
		writeSSEJSON(w, f, created)
		writeSSEJSON(w, f, map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"type":    "response.output_text.delta",
			"item_id": itemID,
			"delta":   respToken,
		})
		writeSSEJSON(w, f, map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return

	case strings.HasSuffix(path, "/chat/completions"):
		m.mu.Lock()
		m.sawChat = true
		m.requestToolNames = extractOpenAIToolNames(req)
		m.requestInvalidTools = m.requestInvalidTools[:0]
		for _, n := range m.requestToolNames {
			if !isValidOpenAIToolName(n) {
				m.requestInvalidTools = append(m.requestInvalidTools, n)
			}
		}
		m.mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		model := strings.TrimSpace(fmt.Sprint(req["model"]))
		if model == "" {
			model = "gpt-4o-mini"
		}

		writeSSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []any{
				map[string]any{
					"index": 0,
					"delta": map[string]any{"role": "assistant", "content": m.token},
				},
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []any{
				map[string]any{
					"index":         0,
					"delta":         map[string]any{},
					"finish_reason": "stop",
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return

	default:
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
}

func (m *openAIMock) didSeeChat() bool {
	m.mu.Lock()
	v := m.sawChat
	m.mu.Unlock()
	return v
}

func (m *openAIMock) didSeeResponses() bool {
	m.mu.Lock()
	v := m.sawResponses
	m.mu.Unlock()
	return v
}

func (m *openAIMock) toolNamesSnapshot() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.requestToolNames))
	out = append(out, m.requestToolNames...)
	return out
}

func writeSSEJSON(w io.Writer, f http.Flusher, v any) {
	b, _ := json.Marshal(v)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func TestIntegration_NativeSDK_OpenAI_ResponsesStream_GPT5_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_RESPONSES"
	mock := &openAIMock{token: token}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	channelID := "ch_test_native_sdk_1"
	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         channelID,
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            stateDir,
		AgentHomeDir:        agentHomeDir,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_native_sdk_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), token) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", token, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"type":"message-end"`) {
		t.Fatalf("NDJSON stream missing message-end, body=%q", rr.Body.String())
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) == "" {
		t.Fatalf("last_message_preview should not be empty")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want it to include %q", view.LastMessagePreview, token)
	}

	if !mock.didSeeResponses() {
		t.Fatalf("expected OpenAI Responses API call (/responses)")
	}
	if mock.didSeeChat() {
		t.Fatalf("unexpected OpenAI Chat Completions API call (/chat/completions)")
	}
}

func TestIntegration_NativeSDK_OpenAI_ResponsesStream_GPT4o_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_CHAT"
	mock := &openAIMock{token: token}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-4o-mini"}},
			},
		},
	}

	channelID := "ch_test_native_sdk_2"
	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         channelID,
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            stateDir,
		AgentHomeDir:        agentHomeDir,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_native_sdk_2", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-4o-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), token) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", token, rr.Body.String())
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) == "" {
		t.Fatalf("last_message_preview should not be empty")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want it to include %q", view.LastMessagePreview, token)
	}

	if !mock.didSeeResponses() {
		t.Fatalf("expected OpenAI Responses API call (/responses)")
	}
	if mock.didSeeChat() {
		t.Fatalf("unexpected OpenAI Chat Completions API call (/chat/completions)")
	}
}
