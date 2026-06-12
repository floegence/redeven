package flowerhost

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

type staticSecretResolver struct{}

func (staticSecretResolver) ResolveProviderAPIKey(context.Context, string) (string, bool, error) {
	return "key", true, nil
}

func (staticSecretResolver) ResolveWebSearchProviderAPIKey(context.Context, string) (string, bool, error) {
	return "", false, nil
}

type mutableSecretResolver struct {
	configured bool
}

func (r *mutableSecretResolver) ResolveProviderAPIKey(context.Context, string) (string, bool, error) {
	if r.configured {
		return "key", true, nil
	}
	return "", false, nil
}

func (r *mutableSecretResolver) ResolveWebSearchProviderAPIKey(context.Context, string) (string, bool, error) {
	return "", false, nil
}

type flowerHostOpenAIMock struct {
	mu       sync.Mutex
	requests []map[string]any
}

func (m *flowerHostOpenAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer key" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	var req map[string]any
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	model, _ := req["model"].(string)
	if strings.TrimSpace(model) == "" {
		http.Error(w, "missing model", http.StatusBadRequest)
		return
	}

	m.mu.Lock()
	m.requests = append(m.requests, req)
	m.mu.Unlock()
	token := flowerHostMockResponseToken(req)

	switch strings.TrimSpace(r.URL.Path) {
	case "/v1/responses":
		writeFlowerHostResponsesSSE(w, token, strings.TrimSpace(model))
	case "/v1/chat/completions":
		writeFlowerHostChatCompletionSSE(w, token, strings.TrimSpace(model))
	default:
		http.NotFound(w, r)
	}
}

func writeFlowerHostResponsesSSE(w http.ResponseWriter, token string, model string) {
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}
	itemID := "msg_flower_host_mock"
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         "resp_flower_host_mock",
			"created_at": time.Now().Unix(),
			"model":      strings.TrimSpace(model),
		},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"type":         "response.output_item.added",
		"output_index": 0,
		"item":         map[string]any{"type": "message", "id": itemID},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"type":    "response.output_text.delta",
		"item_id": itemID,
		"delta":   token,
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"type":         "response.output_item.done",
		"output_index": 0,
		"item":         map[string]any{"type": "message", "id": itemID},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeFlowerHostChatCompletionSSE(w http.ResponseWriter, token string, model string) {
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"id":      "chatcmpl_flower_host_mock",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   strings.TrimSpace(model),
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": nil,
				"delta": map[string]any{
					"role": "assistant",
				},
			},
		},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"id":      "chatcmpl_flower_host_mock",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   strings.TrimSpace(model),
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": nil,
				"delta": map[string]any{
					"content": token,
				},
			},
		},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"id":      "chatcmpl_flower_host_mock",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   strings.TrimSpace(model),
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": "stop",
				"delta":         map[string]any{},
			},
		},
	})
	writeFlowerHostSSEJSON(w, flusher, map[string]any{
		"id":      "chatcmpl_flower_host_mock",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   strings.TrimSpace(model),
		"choices": []any{},
		"usage": map[string]any{
			"prompt_tokens":     1,
			"completion_tokens": 1,
			"total_tokens":      2,
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func flowerHostMockResponseToken(req map[string]any) string {
	requestText := flowerHostMockRequestText(req)
	switch {
	case strings.Contains(requestText, "You generate concise thread titles for an interactive AI agent."):
		return "自动标题验收"
	default:
		return "Assistant reply"
	}
}

func flowerHostMockRequestText(req map[string]any) string {
	raw, err := json.Marshal(req)
	if err != nil {
		return ""
	}
	return string(raw)
}

func (m *flowerHostOpenAIMock) requestPayloads() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]map[string]any(nil), m.requests...)
}

func flowerHostObservedProviderRequests(requests []map[string]any) (foundRunRequest bool, foundTitlePrompt bool, foundDisableReasoning bool) {
	for _, payload := range requests {
		payloadText := flowerHostMockRequestText(payload)
		if strings.Contains(payloadText, "You generate concise thread titles for an interactive AI agent.") {
			foundTitlePrompt = true
			if strings.Contains(payloadText, `"enable_thinking":false`) &&
				strings.Contains(payloadText, `"thinking":{"type":"disabled"}`) {
				foundDisableReasoning = true
			}
			continue
		}
		if strings.Contains(payloadText, `"enable_search":true`) ||
			strings.Contains(payloadText, "# Identity & Mandate") {
			foundRunRequest = true
		}
	}
	return foundRunRequest, foundTitlePrompt, foundDisableReasoning
}

func writeFlowerHostSSEJSON(w io.Writer, f http.Flusher, v any) {
	b, _ := json.Marshal(v)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	paths, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths() error = %v", err)
	}
	svc, err := NewService(context.Background(), ServiceOptions{
		Paths:          paths,
		Identity:       testIdentity(),
		SecretResolver: staticSecretResolver{},
		AgentHomeDir:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func newConfiguredTestService(t *testing.T, resolver SecretResolver, baseURL string) *Service {
	t.Helper()
	paths, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths() error = %v", err)
	}
	doc := DefaultConfigDocument()
	doc.Enabled = true
	doc.CurrentModelID = "openai/gpt-5-mini"
	doc.Providers = []config.AIProvider{{
		ID:      "openai",
		Name:    "OpenAI",
		Type:    "openai",
		BaseURL: baseURL,
		Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
	}}
	store := NewConfigStore(paths)
	if _, err := store.SaveConfig(context.Background(), doc); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}
	svc, err := NewService(context.Background(), ServiceOptions{
		Paths:          paths,
		Identity:       testIdentity(),
		SecretResolver: resolver,
		AgentHomeDir:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func newConfiguredDeepSeekTestService(t *testing.T, resolver SecretResolver, baseURL string) *Service {
	t.Helper()
	paths, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths() error = %v", err)
	}
	doc := DefaultConfigDocument()
	doc.Enabled = true
	doc.CurrentModelID = "deepseek/deepseek-v4-pro"
	doc.Providers = []config.AIProvider{{
		ID:      "deepseek",
		Name:    "DeepSeek",
		Type:    "deepseek",
		BaseURL: baseURL,
		Models:  []config.AIProviderModel{{ModelName: "deepseek-v4-pro"}},
	}}
	store := NewConfigStore(paths)
	if _, err := store.SaveConfig(context.Background(), doc); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}
	svc, err := NewService(context.Background(), ServiceOptions{
		Paths:          paths,
		Identity:       testIdentity(),
		SecretResolver: resolver,
		AgentHomeDir:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestNewService_UsesExplicitTargetToolPolicy(t *testing.T) {
	svc := newTestService(t)
	if svc.ai == nil {
		t.Fatalf("ai service is nil")
	}
	if got := svc.ai.ToolTargetPolicy().Mode; got != "explicit_target" {
		t.Fatalf("tool target mode=%q, want explicit_target", got)
	}
}

func TestFlowerHostRunOptionsExposeFloretNativeTools(t *testing.T) {
	opts := flowerHostRunOptions()
	if opts.MaxSteps != 24 {
		t.Fatalf("MaxSteps=%d, want 24", opts.MaxSteps)
	}
	seen := map[string]bool{}
	for _, name := range opts.ToolAllowlist {
		seen[name] = true
	}
	for _, name := range []string{"terminal.exec", "file.read", "file.edit", "file.write", "apply_patch", "write_todos", "ask_user", "exit_plan_mode", "task_complete"} {
		if !seen[name] {
			t.Fatalf("ToolAllowlist missing %q: %#v", name, opts.ToolAllowlist)
		}
	}
}

func TestFlowerThreadToolTargetPolicySeparatesHostAndTargetThreads(t *testing.T) {
	t.Parallel()

	globalPolicy := flowerThreadToolTargetPolicy(nil)
	if globalPolicy.Mode != ai.ToolTargetModeLocalRuntime || globalPolicy.DefaultTargetID != "" {
		t.Fatalf("global policy=%#v, want local runtime without target", globalPolicy)
	}

	targetPolicy := flowerThreadToolTargetPolicy(&threadstore.FlowerThreadMetadata{
		PrimaryTargetID:     " provider:https%3A%2F%2Fredeven.test:env:target_1 ",
		ActiveTargetIDsJSON: `["provider:https%3A%2F%2Fredeven.test:env:target_2","provider:https%3A%2F%2Fredeven.test:env:target_1"," "]`,
	})
	if targetPolicy.Mode != ai.ToolTargetModeExplicitTarget || targetPolicy.DefaultTargetID != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("target policy=%#v, want explicit target", targetPolicy)
	}
	if len(targetPolicy.AllowedTargetIDs) != 2 ||
		targetPolicy.AllowedTargetIDs[0] != "provider:https%3A%2F%2Fredeven.test:env:target_2" ||
		targetPolicy.AllowedTargetIDs[1] != "provider:https%3A%2F%2Fredeven.test:env:target_1" {
		t.Fatalf("allowed target ids=%#v, want active thread targets", targetPolicy.AllowedTargetIDs)
	}
}

func TestAIServiceRejectsExplicitTargetPolicyWithoutExecutor(t *testing.T) {
	t.Parallel()

	_, err := ai.NewService(ai.Options{
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		ToolTargetPolicy: ai.ToolTargetPolicy{Mode: ai.ToolTargetModeExplicitTarget},
	})
	if err == nil || !strings.Contains(err.Error(), "TargetToolExecutor") {
		t.Fatalf("NewService() error=%v, want missing TargetToolExecutor", err)
	}
}

func TestValidateCreateRequestRequiresDecisionFields(t *testing.T) {
	svc := newTestService(t)
	_, failure, err := svc.validateCreateRequest(context.Background(), ThreadCreateRequest{
		ThreadKind:     ThreadKindChat,
		ClientSurface:  ClientSurfaceFlowerSurface,
		InitialMessage: "hello",
	})
	if err != nil {
		t.Fatalf("validateCreateRequest() error = %v", err)
	}
	if failure == nil {
		t.Fatalf("failure=nil, want handler selection failure")
	}
	if failure.Error.Code != ThreadCreateErrorSelectionStale {
		t.Fatalf("code=%q, want %q", failure.Error.Code, ThreadCreateErrorSelectionStale)
	}
	if failure.ThreadID != nil {
		t.Fatalf("thread_id=%v, want nil", *failure.ThreadID)
	}
	if failure.FreshDecision == nil {
		t.Fatalf("fresh decision is required")
	}
}

func TestValidateCreateRequestRejectsRevisionMismatch(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	_, failure, err := svc.validateCreateRequest(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision + 1,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindChat,
		ClientSurface:     ClientSurfaceFlowerSurface,
		InitialMessage:    "hello",
	})
	if err != nil {
		t.Fatalf("validateCreateRequest() error = %v", err)
	}
	if failure == nil || failure.Error.Code != ThreadCreateErrorRevisionExpired {
		t.Fatalf("failure=%#v, want revision expired", failure)
	}
	if failure.ThreadID != nil {
		t.Fatalf("thread_id=%v, want nil", *failure.ThreadID)
	}
}

func TestValidateCreateRequestRejectsScopeMismatch(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	_, failure, err := svc.validateCreateRequest(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceFlowerSurface,
		InitialMessage:    "hello",
	})
	if err != nil {
		t.Fatalf("validateCreateRequest() error = %v", err)
	}
	if failure == nil || failure.Error.Code != ThreadCreateErrorScopeMismatch {
		t.Fatalf("failure=%#v, want scope mismatch", failure)
	}
	if failure.ThreadID != nil {
		t.Fatalf("thread_id=%v, want nil", *failure.ThreadID)
	}
}

func TestValidateCreateRequestAcceptsVisibleHandlerDecision(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	got, failure, err := svc.validateCreateRequest(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindChat,
		ClientSurface:     ClientSurfaceFlowerSurface,
		InitialMessage:    "hello",
	})
	if err != nil {
		t.Fatalf("validateCreateRequest() error = %v", err)
	}
	if failure != nil {
		t.Fatalf("failure=%#v, want nil", failure)
	}
	if got.DecisionID != decision.DecisionID {
		t.Fatalf("decision id=%q, want %q", got.DecisionID, decision.DecisionID)
	}
}

func TestSendChatReturnsStructuredCreateFailureWithoutThread(t *testing.T) {
	svc := newTestService(t)
	result, err := svc.SendChat(context.Background(), ChatSendRequest{
		Prompt:        "hello",
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if result.CreateFailure == nil {
		t.Fatalf("create_failure=nil, want structured failure")
	}
	if result.CreateFailure.Error.Code != ThreadCreateErrorSelectionStale {
		t.Fatalf("code=%q, want %q", result.CreateFailure.Error.Code, ThreadCreateErrorSelectionStale)
	}
	if result.Thread != nil {
		t.Fatalf("thread=%#v, want no thread in failure response", result.Thread)
	}
}

func TestServerSubmitInputRejectsWrongMethodAndMalformedRequests(t *testing.T) {
	svc := newTestService(t)
	srv := &Server{service: svc, token: "test-token"}
	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
		want       string
	}{
		{
			name:       "wrong method",
			method:     http.MethodGet,
			wantStatus: http.StatusMethodNotAllowed,
			want:       "method_not_allowed",
		},
		{
			name:       "invalid json",
			method:     http.MethodPost,
			body:       "{",
			wantStatus: http.StatusBadRequest,
			want:       "invalid_request",
		},
		{
			name:       "empty request",
			method:     http.MethodPost,
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
			want:       "missing thread_id",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/v1/chat/input", strings.NewReader(tt.body))
			req.Header.Set("authorization", "Bearer test-token")
			rr := httptest.NewRecorder()
			srv.handleSubmitInput(rr, req)
			if rr.Code != tt.wantStatus {
				t.Fatalf("status=%d body=%s, want %d", rr.Code, rr.Body.String(), tt.wantStatus)
			}
			if !strings.Contains(rr.Body.String(), tt.want) {
				t.Fatalf("body=%s, want containing %q", rr.Body.String(), tt.want)
			}
		})
	}
}

func TestDecodeRawMessagePreservesStreamingBlocksAndToolActivity(t *testing.T) {
	raw := json.RawMessage(`{
		"id":"msg_streaming",
		"role":"assistant",
		"status":"streaming",
		"timestamp":1700000000000,
		"blocks":[
			{"type":"thinking","content":"Checking the workspace."},
			{"type":"markdown","content":"Partial reply"},
			{"type":"activity-timeline","runId":"run_1","groups":[{"items":[
				{"itemId":"item_read","toolId":"tool_read","toolName":"file.read","status":"running","label":"Read file: README.md","description":"Inspect README.md","startedAtUnixMs":1700000000001},
				{"itemId":"item_terminal","toolId":"tool_terminal","toolName":"terminal.exec","status":"success","label":"Run command: go test ./...","endedAtUnixMs":1700000000002}
			]}]},
			{"type":"tool-call","toolName":"apply_patch","toolId":"tool_patch","args":{"path":"main.go"},"status":"failed","error":"patch rejected"}
		]
	}`)

	msg, activity, ok, err := decodeRawMessage(raw)
	if err != nil {
		t.Fatalf("decodeRawMessage() error = %v", err)
	}
	if !ok {
		t.Fatalf("decodeRawMessage ok=false, want true")
	}
	if msg.Status != "streaming" {
		t.Fatalf("status=%q, want streaming", msg.Status)
	}
	if msg.Content != "Partial reply" {
		t.Fatalf("content=%q, want markdown content", msg.Content)
	}
	if len(msg.Blocks) != 2 || msg.Blocks[0].Type != "thinking" || msg.Blocks[1].Type != "markdown" {
		t.Fatalf("blocks=%#v, want thinking and markdown blocks", msg.Blocks)
	}
	if len(activity) != 3 {
		t.Fatalf("activity len=%d, want 3: %#v", len(activity), activity)
	}
	byTool := map[string]ChatToolActivity{}
	for _, item := range activity {
		byTool[item.ToolName] = item
	}
	if byTool["file.read"].RunID != "run_1" || byTool["file.read"].Status != "running" {
		t.Fatalf("file.read activity=%#v, want run_1 running", byTool["file.read"])
	}
	if byTool["terminal.exec"].Status != "success" {
		t.Fatalf("terminal.exec activity=%#v, want success", byTool["terminal.exec"])
	}
	if byTool["apply_patch"].Status != "error" || byTool["apply_patch"].ErrorMessage != "patch rejected" {
		t.Fatalf("apply_patch activity=%#v, want error with message", byTool["apply_patch"])
	}
}

func TestDecodeMessagesKeepsEmptyStreamingAssistantMessage(t *testing.T) {
	decoded, err := decodeMessages([]any{
		json.RawMessage(`{"id":"msg_streaming_empty","role":"assistant","status":"streaming","timestamp":1700000000100,"blocks":[]}`),
	})
	if err != nil {
		t.Fatalf("decodeMessages() error = %v", err)
	}
	if len(decoded.Messages) != 1 {
		t.Fatalf("messages len=%d, want 1", len(decoded.Messages))
	}
	if decoded.Messages[0].Status != "streaming" || decoded.Messages[0].Content != "" {
		t.Fatalf("message=%#v, want empty streaming message", decoded.Messages[0])
	}
}

func TestDecodeMessagesRejectsCompleteMessageWithoutVisibleContent(t *testing.T) {
	_, err := decodeMessages([]any{
		json.RawMessage(`{"id":"msg_empty_complete","role":"assistant","status":"complete","timestamp":1700000000100,"blocks":[]}`),
	})
	if err == nil || !strings.Contains(err.Error(), "message has no visible content") {
		t.Fatalf("decodeMessages() error=%v, want visible content contract error", err)
	}
}

func TestDecodeMessagesPreservesToolOnlyMessageAsActivity(t *testing.T) {
	decoded, err := decodeMessages([]any{
		json.RawMessage(`{"id":"msg_tool_only","role":"assistant","status":"complete","timestamp":1700000000100,"blocks":[{"type":"tool-call","toolName":"terminal.exec","toolId":"tool_terminal","args":{"command":"go test ./..."},"status":"success"}]}`),
	})
	if err != nil {
		t.Fatalf("decodeMessages() error = %v", err)
	}
	if len(decoded.Messages) != 0 {
		t.Fatalf("messages len=%d, want no visible chat bubble for tool-only message", len(decoded.Messages))
	}
	if len(decoded.ToolActivity) != 1 {
		t.Fatalf("tool activity len=%d, want 1: %#v", len(decoded.ToolActivity), decoded.ToolActivity)
	}
	if decoded.ToolActivity[0].ToolName != "terminal.exec" || decoded.ToolActivity[0].Status != "success" {
		t.Fatalf("tool activity=%#v, want terminal success", decoded.ToolActivity[0])
	}
}

func TestDecodeRawMessageRejectsMalformedPayloads(t *testing.T) {
	tests := []struct {
		name string
		raw  json.RawMessage
		want string
	}{
		{
			name: "invalid json",
			raw:  json.RawMessage(`{`),
			want: "parse message JSON",
		},
		{
			name: "missing id",
			raw:  json.RawMessage(`{"role":"assistant","status":"complete","timestamp":1700000000000,"blocks":[{"type":"markdown","content":"hi"}]}`),
			want: "message id is required",
		},
		{
			name: "unknown role",
			raw:  json.RawMessage(`{"id":"m1","role":"bot","status":"complete","timestamp":1700000000000,"blocks":[{"type":"markdown","content":"hi"}]}`),
			want: "message role",
		},
		{
			name: "missing timestamp",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"complete","blocks":[{"type":"markdown","content":"hi"}]}`),
			want: "timestamp",
		},
		{
			name: "unknown message status",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"almost_done","timestamp":1700000000000,"blocks":[{"type":"markdown","content":"hi"}]}`),
			want: "message status",
		},
		{
			name: "missing message status",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","timestamp":1700000000000,"blocks":[{"type":"markdown","content":"hi"}]}`),
			want: "message status",
		},
		{
			name: "unknown block type",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"complete","timestamp":1700000000000,"blocks":[{"type":"chart","content":"hi"}]}`),
			want: "message block type",
		},
		{
			name: "missing tool id",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"streaming","timestamp":1700000000000,"blocks":[{"type":"tool-call","toolName":"file.read","status":"running"}]}`),
			want: "tool call requires toolId",
		},
		{
			name: "unknown tool status",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"streaming","timestamp":1700000000000,"blocks":[{"type":"tool-call","toolName":"file.read","toolId":"tool_1","status":"almost_done"}]}`),
			want: "tool call status",
		},
		{
			name: "bad activity status",
			raw:  json.RawMessage(`{"id":"m1","role":"assistant","status":"streaming","timestamp":1700000000000,"blocks":[{"type":"activity-timeline","runId":"run_1","groups":[{"items":[{"toolId":"tool_1","toolName":"file.read","status":"almost_done","label":"Read"}]}]}]}`),
			want: "activity item",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, err := decodeRawMessage(tt.raw)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("decodeRawMessage() error=%v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestFlowerHostToolAllowlistHasDisplayAndSummaryCoverage(t *testing.T) {
	for _, toolName := range flowerHostToolAllowlist() {
		displayName := toolDisplayName(toolName)
		if displayName == "" || displayName == toolName {
			t.Fatalf("tool %q display name=%q, want friendly display name", toolName, displayName)
		}
		summary := summarizeToolActivity(toolName, map[string]any{
			"path":    "README.md",
			"command": "go test ./...",
		}, "success", "")
		if !strings.HasPrefix(summary, displayName) {
			t.Fatalf("tool %q summary=%q, want prefix %q", toolName, summary, displayName)
		}
	}
}

func TestSummarizeToolActivityKeepsFailureContext(t *testing.T) {
	got := summarizeToolActivity("file.read", map[string]any{
		"file_path": "redeven-flower-acceptance-smoke/not-found-for-ui-check.txt",
	}, "error", "file not found")
	if !strings.Contains(got, "not-found-for-ui-check.txt") || !strings.Contains(got, "failed") {
		t.Fatalf("summary=%q, want failing path and failure state", got)
	}
}

func TestFlowerHostToolAllowlistDecodesEveryToolCallAsActivity(t *testing.T) {
	blocks := []map[string]any{
		{"type": "markdown", "content": "Using tools."},
	}
	for idx, toolName := range flowerHostToolAllowlist() {
		blocks = append(blocks, map[string]any{
			"type":     "tool-call",
			"toolName": toolName,
			"toolId":   "tool_" + strings.ReplaceAll(toolName, ".", "_"),
			"args": map[string]any{
				"path":    "README.md",
				"command": "go test ./...",
			},
			"status": []string{"running", "success", "waiting"}[idx%3],
		})
	}
	raw, err := json.Marshal(map[string]any{
		"id":        "msg_tools",
		"role":      "assistant",
		"status":    "streaming",
		"timestamp": int64(1700000000200),
		"blocks":    blocks,
	})
	if err != nil {
		t.Fatalf("Marshal tool message: %v", err)
	}

	_, activity, ok, err := decodeRawMessage(json.RawMessage(raw))
	if err != nil {
		t.Fatalf("decodeRawMessage() error = %v", err)
	}
	if !ok {
		t.Fatalf("decodeRawMessage ok=false, want true")
	}
	if len(activity) != len(flowerHostToolAllowlist()) {
		t.Fatalf("activity len=%d, want %d: %#v", len(activity), len(flowerHostToolAllowlist()), activity)
	}
	seen := map[string]ChatToolActivity{}
	for _, item := range activity {
		seen[item.ToolName] = item
	}
	for _, toolName := range flowerHostToolAllowlist() {
		item, ok := seen[toolName]
		if !ok {
			t.Fatalf("missing tool activity for %q in %#v", toolName, activity)
		}
		if item.ToolID == "" || item.Status == "" || item.Summary == "" {
			t.Fatalf("tool %q activity missing display fields: %#v", toolName, item)
		}
	}
}

func TestMapChatInputRequestPreservesWaitingPromptContract(t *testing.T) {
	choicesExhaustive := false
	got, err := mapChatInputRequest(&ai.RequestUserInputPrompt{
		PromptID:         " prompt-ask-user ",
		MessageID:        " message-ask-user ",
		ToolID:           " tool-ask-user ",
		ToolName:         " ask_user ",
		ReasonCode:       " needs_user_choice ",
		RequiredFromUser: []string{" target ", " "},
		EvidenceRefs:     []string{" msg-1 "},
		PublicSummary:    " Choose a target. ",
		ContainsSecret:   true,
		Questions: []ai.RequestUserInputQuestion{{
			ID:                " target ",
			Header:            " Deployment target ",
			Question:          " Where should Flower deploy this change? ",
			IsSecret:          true,
			ResponseMode:      " select_or_write ",
			ChoicesExhaustive: &choicesExhaustive,
			WriteLabel:        " Other target ",
			WritePlaceholder:  " Type another target ",
			Choices: []ai.RequestUserInputChoice{{
				ChoiceID:    " staging ",
				Label:       " Staging ",
				Description: " Use the validation environment. ",
				Kind:        " select ",
				Actions: []ai.RequestUserInputAction{{
					Type: " set_mode ",
					Mode: " act ",
				}},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("mapChatInputRequest() error = %v", err)
	}
	if got == nil {
		t.Fatalf("mapChatInputRequest()=nil, want structured request")
	}
	if got.PromptID != "prompt-ask-user" || got.MessageID != "message-ask-user" || got.ToolID != "tool-ask-user" || got.ToolName != "ask_user" {
		t.Fatalf("identity=%#v, want trimmed prompt/message/tool ids", got)
	}
	if got.ReasonCode != "needs_user_choice" || got.PublicSummary != "Choose a target." || !got.ContainsSecret {
		t.Fatalf("metadata=%#v, want reason, summary, and secret flag", got)
	}
	if len(got.RequiredFromUser) != 1 || got.RequiredFromUser[0] != "target" {
		t.Fatalf("required_from_user=%#v, want trimmed target", got.RequiredFromUser)
	}
	if len(got.EvidenceRefs) != 1 || got.EvidenceRefs[0] != "msg-1" {
		t.Fatalf("evidence_refs=%#v, want msg-1", got.EvidenceRefs)
	}
	if len(got.Questions) != 1 {
		t.Fatalf("questions len=%d, want 1", len(got.Questions))
	}
	question := got.Questions[0]
	if question.ID != "target" || question.Header != "Deployment target" || question.Question != "Where should Flower deploy this change?" {
		t.Fatalf("question=%#v, want trimmed question text", question)
	}
	if !question.IsSecret || question.ResponseMode != "select_or_write" || question.ChoicesExhaustive == nil || *question.ChoicesExhaustive {
		t.Fatalf("question options=%#v, want secret select_or_write non-exhaustive", question)
	}
	if question.WriteLabel != "Other target" || question.WritePlaceholder != "Type another target" {
		t.Fatalf("write copy=(%q,%q), want trimmed labels", question.WriteLabel, question.WritePlaceholder)
	}
	if len(question.Choices) != 1 {
		t.Fatalf("choices len=%d, want 1", len(question.Choices))
	}
	if question.Choices[0].ChoiceID != "staging" || question.Choices[0].Kind != "select" || question.Choices[0].Actions[0].Type != "set_mode" || question.Choices[0].Actions[0].Mode != "act" {
		t.Fatalf("first choice=%#v, want trimmed select choice with action", question.Choices[0])
	}
}

func TestMapChatInputRequestRejectsIncompletePrompt(t *testing.T) {
	got, err := mapChatInputRequest(&ai.RequestUserInputPrompt{
		PromptID:  "prompt-1",
		MessageID: "message-1",
		ToolID:    " ",
		ToolName:  "ask_user",
		Questions: []ai.RequestUserInputQuestion{{
			ID:           "q1",
			Header:       "Question",
			Question:     "Answer?",
			ResponseMode: "write",
		}},
	})
	if got != nil {
		t.Fatalf("mapChatInputRequest()=%#v, want no request for incomplete prompt", got)
	}
	if err == nil {
		t.Fatalf("mapChatInputRequest() error=nil, want contract error")
	}
	var coded codedServiceError
	if !errors.As(err, &coded) || coded.ErrorCode() != "waiting_input_contract_invalid" {
		t.Fatalf("error=%v, want waiting_input_contract_invalid", err)
	}
}

func TestProjectInputRequestToolActivityMarksAskUserWaiting(t *testing.T) {
	request := &ChatInputRequest{
		PromptID:      "prompt-ask-user",
		MessageID:     "message-ask-user",
		ToolID:        "tool-ask-user",
		ToolName:      "ask_user",
		PublicSummary: "Choose a target before Flower continues.",
		Questions: []ChatInputQuestion{{
			ID:       "target",
			Header:   "Deployment target",
			Question: "Where should Flower deploy this change?",
		}},
	}
	got, err := projectInputRequestToolActivity([]ChatToolActivity{{
		RunID:        "run-1",
		ToolID:       "tool-ask-user",
		ToolName:     "ask_user",
		Status:       "success",
		Summary:      "Ask user done",
		ErrorMessage: "old error",
		EndedAtMs:    1700000000100,
	}}, request)
	if err != nil {
		t.Fatalf("projectInputRequestToolActivity() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("activity len=%d, want existing activity updated", len(got))
	}
	if got[0].Status != "waiting" || got[0].Summary != "Choose a target before Flower continues." || got[0].ErrorMessage != "" || got[0].EndedAtMs != 0 {
		t.Fatalf("activity=%#v, want waiting input projection", got[0])
	}
}

func TestProjectInputRequestToolActivityRejectsMismatchedToolName(t *testing.T) {
	got, err := projectInputRequestToolActivity([]ChatToolActivity{{
		ToolID:   "tool-ask-user",
		ToolName: "file.read",
		Status:   "success",
		Summary:  "Read file",
	}}, &ChatInputRequest{
		PromptID:  "prompt-ask-user",
		MessageID: "message-ask-user",
		ToolID:    "tool-ask-user",
		ToolName:  "ask_user",
		Questions: []ChatInputQuestion{{
			ID:       "target",
			Header:   "Deployment target",
			Question: "Where should Flower deploy this change?",
		}},
	})
	if got != nil {
		t.Fatalf("activity=%#v, want nil for mismatched tool identity", got)
	}
	var coded codedServiceError
	if !errors.As(err, &coded) || coded.ErrorCode() != "waiting_input_contract_invalid" {
		t.Fatalf("error=%v, want waiting_input_contract_invalid", err)
	}
}

func TestProjectInputRequestToolActivityRejectsMissingActivity(t *testing.T) {
	got, err := projectInputRequestToolActivity(nil, &ChatInputRequest{
		PromptID:  "prompt-exit-plan",
		MessageID: "message-exit-plan",
		ToolID:    "opaque-tool-call-1",
		ToolName:  "exit_plan_mode",
		Questions: []ChatInputQuestion{{
			ID:       "approve",
			Header:   "Approve plan",
			Question: "Continue?",
		}},
	})
	if got != nil {
		t.Fatalf("activity=%#v, want nil when matching tool activity is missing", got)
	}
	var coded codedServiceError
	if !errors.As(err, &coded) || coded.ErrorCode() != "waiting_input_contract_invalid" {
		t.Fatalf("error=%v, want waiting_input_contract_invalid", err)
	}
}

func TestMergeToolActivityDedupesActiveAndStoredRecordsByToolID(t *testing.T) {
	got := mergeToolActivity(
		[]ChatToolActivity{{
			ToolID:   "tool_read",
			ToolName: "file.read",
			Status:   "running",
			Summary:  "Read file: README.md",
		}},
		[]ChatToolActivity{{
			RunID:       "run_1",
			ToolID:      "tool_read",
			ToolName:    "file.read",
			Status:      "success",
			Summary:     "Read file: README.md",
			StartedAtMs: 1700000000001,
			EndedAtMs:   1700000000100,
		}},
	)
	if len(got) != 1 {
		t.Fatalf("activity len=%d, want one merged record: %#v", len(got), got)
	}
	if got[0].RunID != "run_1" || got[0].Status != "success" || got[0].StartedAtMs == 0 || got[0].EndedAtMs == 0 {
		t.Fatalf("merged activity=%#v, want stored run id and terminal status", got[0])
	}
}

func TestMergeToolActivityPromotesTerminalSummary(t *testing.T) {
	got := mergeToolActivity(
		[]ChatToolActivity{{
			ToolID:   "tool_read",
			ToolName: "file.read",
			Status:   "running",
			Summary:  "Read file",
		}},
		[]ChatToolActivity{{
			RunID:    "run_1",
			ToolID:   "tool_read",
			ToolName: "file.read",
			Status:   "error",
			Summary:  "Read file: redeven-flower-acceptance-smoke/not-found-for-ui-check.txt failed",
		}},
	)
	if len(got) != 1 {
		t.Fatalf("activity len=%d, want one merged record: %#v", len(got), got)
	}
	if !strings.Contains(got[0].Summary, "not-found-for-ui-check.txt") || got[0].Status != "error" {
		t.Fatalf("merged activity=%#v, want terminal summary with failing path", got[0])
	}
}

func TestMergeToolActivityKeepsSameToolIDAcrossDifferentRuns(t *testing.T) {
	got := mergeToolActivity(
		[]ChatToolActivity{{
			RunID:    "run_1",
			ToolID:   "tool_read",
			ToolName: "file.read",
			Status:   "success",
			Summary:  "Read file: first.txt",
		}},
		[]ChatToolActivity{{
			RunID:    "run_2",
			ToolID:   "tool_read",
			ToolName: "file.read",
			Status:   "error",
			Summary:  "Read file failed",
		}},
	)
	if len(got) != 2 {
		t.Fatalf("activity len=%d, want two run-scoped records: %#v", len(got), got)
	}
	if got[0].RunID != "run_1" || got[1].RunID != "run_2" {
		t.Fatalf("activity=%#v, want run-scoped order preserved", got)
	}
}

func TestChatRunErrorMapsFailedRunToStructuredError(t *testing.T) {
	got, err := chatRunError(&ai.ThreadView{
		RunStatus: string(ai.RunStateFailed),
		RunError:  "provider rejected request",
	})
	if err != nil {
		t.Fatalf("chatRunError() error = %v", err)
	}
	if got == nil {
		t.Fatalf("chatRunError=nil, want structured error")
	}
	if got.Message != "provider rejected request" || got.Code != string(ai.RunStateFailed) {
		t.Fatalf("error=%#v, want failed provider error", got)
	}
	idle, err := chatRunError(&ai.ThreadView{RunStatus: string(ai.RunStateSuccess)})
	if err != nil {
		t.Fatalf("chatRunError(success) error = %v", err)
	}
	if idle != nil {
		t.Fatalf("success error=%#v, want nil", idle)
	}
}

func TestRunStatusMappingRejectsUnknownStates(t *testing.T) {
	if _, err := mapRunStatus("unexpected"); err == nil {
		t.Fatalf("mapRunStatus() error=nil, want unsupported state error")
	}
	if _, err := chatRunError(&ai.ThreadView{RunStatus: "unexpected"}); err == nil {
		t.Fatalf("chatRunError() error=nil, want unsupported state error")
	}
}

func TestResolveBlocksWhenHostIsNotConfigured(t *testing.T) {
	svc := newTestService(t)
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if decision.Route != RouteBlocked {
		t.Fatalf("route=%q, want blocked", decision.Route)
	}
	if decision.SelectedHandler != nil {
		t.Fatalf("selected handler=%#v, want nil", decision.SelectedHandler)
	}
	if len(decision.AvailableHandlers) != 0 {
		t.Fatalf("available handlers=%#v, want none", decision.AvailableHandlers)
	}
	if decision.Blocker == nil || decision.Blocker.Code != ReasonHostNotConfigured {
		t.Fatalf("blocker=%#v, want host_not_configured", decision.Blocker)
	}
}

func TestCreateThreadRejectsStaleDecisionWhenSecretBecomesUnavailable(t *testing.T) {
	resolver := &mutableSecretResolver{configured: true}
	svc := newConfiguredTestService(t, resolver, "http://127.0.0.1:1/v1")
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if decision.SelectedHandler == nil {
		t.Fatalf("selected handler is required")
	}

	resolver.configured = false
	snapshot, failure, err := svc.CreateThread(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindChat,
		ClientSurface:     ClientSurfaceFlowerSurface,
		InitialMessage:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if failure == nil || failure.Error.Code != ThreadCreateErrorHandlerUnavailable {
		t.Fatalf("failure=%#v, want handler unavailable", failure)
	}
	if failure.FreshDecision == nil || failure.FreshDecision.Blocker == nil {
		t.Fatalf("fresh decision with blocker is required: %#v", failure)
	}
	if snapshot.ThreadID != "" {
		t.Fatalf("thread_id=%q, want no created thread", snapshot.ThreadID)
	}
	threads, err := svc.ListThreads(context.Background())
	if err != nil {
		t.Fatalf("ListThreads() error = %v", err)
	}
	if len(threads.Threads) != 0 {
		t.Fatalf("threads=%#v, want no created threads", threads.Threads)
	}
}

func TestCreateThreadLeavesTitleAvailableForAutoSummary(t *testing.T) {
	mock := &flowerHostOpenAIMock{}
	server := httptest.NewServer(http.HandlerFunc(mock.handle))
	defer server.Close()

	svc := newConfiguredDeepSeekTestService(t, staticSecretResolver{}, server.URL+"/v1")
	initialMessage := "请用一句中文回复：自动标题 summary 验收，不要把这整句当成标题"
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:    ThreadKindChat,
		ClientSurface: ClientSurfaceFlowerSurface,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if decision.SelectedHandler == nil {
		t.Fatalf("selected handler is required")
	}

	created, failure, err := svc.CreateThread(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindChat,
		ClientSurface:     ClientSurfaceFlowerSurface,
		InitialMessage:    initialMessage,
	})
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if failure != nil {
		t.Fatalf("failure=%#v, want nil", failure)
	}
	if created.ThreadID == "" {
		t.Fatalf("created thread id is required")
	}
	msgs, err := svc.ai.ListThreadMessages(context.Background(), svc.Meta(), created.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages() error = %v", err)
	}
	if msgs.TotalReturned == 0 {
		t.Fatalf("transcript messages are required for title summary input")
	}
	rawFirst, ok := msgs.Messages[0].(json.RawMessage)
	if !ok {
		t.Fatalf("first message=%T, want json.RawMessage", msgs.Messages[0])
	}
	var firstMsg struct {
		ID      string `json:"id"`
		Role    string `json:"role"`
		Content string `json:"content"`
		Blocks  []struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(rawFirst, &firstMsg); err != nil {
		t.Fatalf("decode first transcript message: %v", err)
	}
	firstContent := firstMsg.Content
	for _, block := range firstMsg.Blocks {
		if strings.TrimSpace(firstContent) != "" {
			break
		}
		if block.Type == "text" || block.Type == "markdown" {
			firstContent = block.Content
		}
	}
	if firstMsg.Role != "user" || firstMsg.ID == "" || !strings.Contains(firstContent, initialMessage) {
		t.Fatalf("first transcript message=%#v, want persisted user message from initial prompt", firstMsg)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.ai.GetThread(context.Background(), svc.Meta(), created.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread() error = %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title == initialMessage {
				t.Fatalf("Title=%q, want generated summary instead of raw initial message", th.Title)
			}
			if got := utf8.RuneCountInString(th.Title); got == 0 || got > 16 {
				t.Fatalf("Title=%q length=%d, want short generated Flower Host title", th.Title, got)
			}
			list, err := svc.ListThreads(context.Background())
			if err != nil {
				t.Fatalf("ListThreads() error = %v", err)
			}
			if len(list.Threads) != 1 || list.Threads[0].ThreadID != created.ThreadID || list.Threads[0].Title != th.Title {
				t.Fatalf("list snapshot=%#v, want generated title on created thread", list.Threads)
			}
			requests := mock.requestPayloads()
			foundRunRequest, foundTitlePrompt, foundDisableReasoning := flowerHostObservedProviderRequests(requests)
			if ai.IsActiveRunState(th.RunStatus) || !foundRunRequest || !foundTitlePrompt || !foundDisableReasoning {
				time.Sleep(20 * time.Millisecond)
				continue
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	th, getErr := svc.ai.GetThread(context.Background(), svc.Meta(), created.ThreadID)
	if getErr != nil {
		t.Fatalf("GetThread() after timeout error = %v", getErr)
	}
	if th != nil && th.Title == initialMessage {
		t.Fatalf("thread title=%q; CreateThread must not persist the initial prompt as the visible title", th.Title)
	}
	foundRunRequest, foundTitlePrompt, foundDisableReasoning := flowerHostObservedProviderRequests(mock.requestPayloads())
	t.Fatalf("auto title/run/provider requests were not ready before timeout; thread=%#v found_run_request=%v found_title_prompt=%v found_disable_reasoning=%v requests=%#v", th, foundRunRequest, foundTitlePrompt, foundDisableReasoning, mock.requestPayloads())
}

func TestListThreadsProjectsWaitingInputContractErrorOnThread(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	ctx := context.Background()
	th, err := svc.ai.CreateThread(ctx, svc.Meta(), "broken waiting prompt", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if err := svc.ai.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:      hostEndpointID,
		ThreadID:        th.ThreadID,
		HomeHostID:      svc.identity.HostID,
		HomeHostKind:    svc.identity.HostKind,
		PrimaryTargetID: "",
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata() error = %v", err)
	}
	store, err := threadstore.Open(svc.paths.ThreadstorePath)
	if err != nil {
		t.Fatalf("threadstore.Open() error = %v", err)
	}
	defer func() { _ = store.Close() }()
	if err := store.UpdateThreadRunState(ctx, hostEndpointID, th.ThreadID, string(ai.RunStateWaitingUser), "", `{"prompt_id":"prompt-1"}`, "", ""); err != nil {
		t.Fatalf("UpdateThreadRunState() error = %v", err)
	}

	threads, err := svc.ListThreads(ctx)
	if err != nil {
		t.Fatalf("ListThreads() error = %v", err)
	}
	if len(threads.Threads) != 1 {
		t.Fatalf("threads len=%d, want 1: %#v", len(threads.Threads), threads.Threads)
	}
	got := threads.Threads[0]
	if got.ThreadID != th.ThreadID || got.Status != "failed" {
		t.Fatalf("thread=(%q,%q), want (%q,failed)", got.ThreadID, got.Status, th.ThreadID)
	}
	if got.InputRequest != nil {
		t.Fatalf("input_request=%#v, want nil for invalid prompt", got.InputRequest)
	}
	if got.Error == nil || got.Error.Code != "waiting_input_contract_invalid" || !strings.Contains(got.Error.Message, "input request is incomplete") {
		t.Fatalf("error=%#v, want waiting_input_contract_invalid", got.Error)
	}
}

func TestThreadMutationAndForkHTTPRoutes(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	ctx := context.Background()
	source, err := svc.ai.CreateThread(ctx, svc.Meta(), "Original", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if err := svc.ai.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:     hostEndpointID,
		ThreadID:       source.ThreadID,
		HomeHostID:     svc.identity.HostID,
		HomeHostKind:   svc.identity.HostKind,
		OwnerKind:      "flower_host",
		OwnerID:        svc.identity.HostID,
		ParentThreadID: "",
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata() error = %v", err)
	}

	renamed := "Renamed from service"
	snapshot, err := svc.MutateThread(ctx, source.ThreadID, ThreadMutationRequest{Title: &renamed})
	if err != nil {
		t.Fatalf("MutateThread title error = %v", err)
	}
	if snapshot.Title != renamed || snapshot.WorkingDir == "" {
		t.Fatalf("snapshot=%#v, want renamed thread with working_dir", snapshot)
	}
	pin := true
	snapshot, err = svc.MutateThread(ctx, source.ThreadID, ThreadMutationRequest{Pinned: &pin})
	if err != nil {
		t.Fatalf("MutateThread pinned error = %v", err)
	}
	if snapshot.PinnedAtMs <= 0 {
		t.Fatalf("pinned_at_ms=%d, want > 0", snapshot.PinnedAtMs)
	}

	srv := &Server{service: svc, token: "test-token"}
	req := httptest.NewRequest(http.MethodGet, "/v1/thread/missing-thread", nil)
	req.Header.Set("authorization", "Bearer test-token")
	rr := httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusNotFound || !strings.Contains(rr.Body.String(), "thread_not_found") {
		t.Fatalf("GET missing thread status=%d body=%s, want 404 thread_not_found", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPatch, "/v1/thread/"+source.ThreadID, strings.NewReader(`{"title":"Renamed over HTTP"}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH status=%d body=%s, want 200", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"title":"Renamed over HTTP"`) {
		t.Fatalf("PATCH body=%s, want renamed title", rr.Body.String())
	}
	req = httptest.NewRequest(http.MethodPatch, "/v1/thread/"+source.ThreadID, strings.NewReader(`{"title":"bad","extra":true}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "unknown field") {
		t.Fatalf("PATCH unknown field status=%d body=%s, want 400 unknown field", rr.Code, rr.Body.String())
	}
	req = httptest.NewRequest(http.MethodPatch, "/v1/thread/"+source.ThreadID, strings.NewReader(`{"title":"bad"} {}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "unexpected trailing JSON") {
		t.Fatalf("PATCH trailing JSON status=%d body=%s, want 400 trailing JSON", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/thread/"+source.ThreadID+"/fork", strings.NewReader(`{}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("fork status=%d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var forkResp struct {
		OK   bool `json:"ok"`
		Data struct {
			Thread ThreadSnapshot `json:"thread"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &forkResp); err != nil {
		t.Fatalf("decode fork response: %v body=%s", err, rr.Body.String())
	}
	if !forkResp.OK || forkResp.Data.Thread.ThreadID == "" || forkResp.Data.Thread.ThreadID == source.ThreadID {
		t.Fatalf("fork response=%#v, want new thread", forkResp)
	}
	if forkResp.Data.Thread.Title != "Renamed over HTTP (fork)" || forkResp.Data.Thread.WorkingDir == "" || forkResp.Data.Thread.PinnedAtMs != 0 {
		t.Fatalf("forked thread=%#v, want fork title, working_dir, and unpinned destination", forkResp.Data.Thread)
	}
	meta, err := svc.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, forkResp.Data.Thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata() error = %v", err)
	}
	if meta == nil || meta.ParentThreadID != source.ThreadID {
		t.Fatalf("fork metadata=%#v, want parent_thread_id=%q", meta, source.ThreadID)
	}
	req = httptest.NewRequest(http.MethodPost, "/v1/thread/"+source.ThreadID+"/fork", strings.NewReader(`{"unknown":true}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "unknown field") {
		t.Fatalf("fork unknown field status=%d body=%s, want 400 unknown field", rr.Code, rr.Body.String())
	}

	busy, err := svc.ai.CreateThread(ctx, svc.Meta(), "Busy", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread busy error = %v", err)
	}
	store, err := threadstore.Open(svc.paths.ThreadstorePath)
	if err != nil {
		t.Fatalf("threadstore.Open() error = %v", err)
	}
	defer func() { _ = store.Close() }()
	if err := store.UpdateThreadRunState(ctx, hostEndpointID, busy.ThreadID, string(ai.RunStateRunning), "", "", "", ""); err != nil {
		t.Fatalf("UpdateThreadRunState() error = %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/v1/thread/"+busy.ThreadID+"/fork", strings.NewReader(`{}`))
	req.Header.Set("authorization", "Bearer test-token")
	rr = httptest.NewRecorder()
	srv.handleThreadDetail(rr, req)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "thread_fork_unavailable") {
		t.Fatalf("busy fork status=%d body=%s, want 409 thread_fork_unavailable", rr.Code, rr.Body.String())
	}
}

func TestValidateCreateRequestRejectsMismatchedContextEnvelope(t *testing.T) {
	svc := newConfiguredTestService(t, staticSecretResolver{}, "http://127.0.0.1:1/v1")
	primaryTargetID := "env_a"
	envelope := ContextEnvelopeHeader{
		ID: "ctx_1",
		Raw: json.RawMessage(`{
			"schema_version": 2,
			"target": {"target_id": "env_b"},
			"execution_context": {
				"current_target_id": "env_b",
				"source_env_public_id": "env_a"
			}
		}`),
	}
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		ContextEnvelopeID: &envelope.ID,
		PrimaryTargetID:   &primaryTargetID,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	_, failure, err := svc.validateCreateRequest(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		InitialMessage:    "inspect",
		PrimaryTargetID:   &primaryTargetID,
		ContextEnvelope:   &envelope,
	})
	if err != nil {
		t.Fatalf("validateCreateRequest() error = %v", err)
	}
	if failure == nil || failure.Error.Code != ThreadCreateErrorInvalidContext {
		t.Fatalf("failure=%#v, want invalid context", failure)
	}
}

func TestSendChatRejectsThreadWithoutFlowerOwnership(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	svc := newConfiguredTestService(t, staticSecretResolver{}, server.URL+"/v1")
	thread, err := svc.ai.CreateThread(context.Background(), svc.Meta(), "legacy", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	result, err := svc.SendChat(context.Background(), ChatSendRequest{
		ThreadID:        thread.ThreadID,
		Prompt:          "continue",
		ClientSurface:   ClientSurfaceFlowerSurface,
		PrimaryTargetID: nil,
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if result.CreateFailure == nil || result.CreateFailure.Error.Code != ThreadCreateErrorHandlerUnavailable {
		t.Fatalf("create_failure=%#v, want handler unavailable", result.CreateFailure)
	}
}

func TestSendChatRejectsContextActionForDifferentTarget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	svc := newConfiguredTestService(t, staticSecretResolver{}, server.URL+"/v1")
	envelope := ContextEnvelopeHeader{
		ID: "ctx_1",
		Raw: json.RawMessage(`{
			"schema_version": 2,
			"target": {"target_id": "env_a"},
			"execution_context": {"source_env_public_id": "env_a", "current_target_id": "env_a"}
		}`),
	}
	primaryTargetID := "env_a"
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		ContextEnvelopeID: &envelope.ID,
		PrimaryTargetID:   &primaryTargetID,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	created, failure, err := svc.CreateThread(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		InitialMessage:    "inspect this",
		PrimaryTargetID:   &primaryTargetID,
		ContextEnvelope:   &envelope,
	})
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if failure != nil {
		t.Fatalf("create failure=%#v", failure)
	}

	result, err := svc.SendChat(context.Background(), ChatSendRequest{
		ThreadID:      created.ThreadID,
		Prompt:        "continue elsewhere",
		ClientSurface: ClientSurfaceFlowerSurface,
		ContextAction: json.RawMessage(`{
			"schema_version": 2,
			"target": {"target_id": "env_b"},
			"execution_context": {"source_env_public_id": "env_a", "current_target_id": "env_b"}
		}`),
	})
	if err != nil {
		t.Fatalf("SendChat() error = %v", err)
	}
	if result.CreateFailure == nil || result.CreateFailure.Error.Code != ThreadCreateErrorInvalidContext {
		t.Fatalf("create_failure=%#v, want invalid context", result.CreateFailure)
	}
}

func TestCreateThreadPreservesContextActionInThreadTranscript(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		writeFlowerHostTestSSE(w, flusher, map[string]any{
			"type":         "response.output_text.delta",
			"output_index": 0,
			"delta":        "ack",
		})
		writeFlowerHostTestSSE(w, flusher, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id": "resp_test",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer server.Close()

	svc := newConfiguredTestService(t, staticSecretResolver{}, server.URL+"/v1")
	envelope := ContextEnvelopeHeader{
		ID: "ctx_1",
		Raw: json.RawMessage(`{
			"schema_version": 2,
			"action_id": "assistant.ask.flower",
			"target": {"target_id": "env_a", "locality": "auto"},
			"source": {"surface": "welcome"},
			"execution_context": {"source_env_public_id": "env_a", "current_target_id": "env_a"},
			"context": [{"kind": "filesystem", "path": "/repo", "is_directory": true}],
			"presentation": {"label": "Ask Flower", "priority": 100}
		}`),
	}
	primaryTargetID := "env_a"
	decision, err := svc.Resolve(context.Background(), ResolveRequest{
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		ContextEnvelopeID: &envelope.ID,
		PrimaryTargetID:   &primaryTargetID,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	result, failure, err := svc.CreateThread(context.Background(), ThreadCreateRequest{
		DecisionID:        decision.DecisionID,
		DecisionRevision:  decision.DecisionRevision,
		SelectedHandlerID: decision.SelectedHandler.HandlerID,
		ThreadKind:        ThreadKindTask,
		ClientSurface:     ClientSurfaceWelcomeAskFlower,
		InitialMessage:    "inspect this",
		PrimaryTargetID:   &primaryTargetID,
		ContextEnvelope:   &envelope,
	})
	if err != nil {
		t.Fatalf("CreateThread() error = %v", err)
	}
	if failure != nil {
		t.Fatalf("failure=%#v, want nil", failure)
	}
	if result.ThreadID == "" {
		t.Fatalf("thread id is required")
	}
	if result.HomeHostID != "flower-host:test" || result.HomeHostKind != HostKindGlobal {
		t.Fatalf("home host=(%q,%q), want visible handler", result.HomeHostID, result.HomeHostKind)
	}
	meta, err := svc.ai.GetFlowerThreadMetadata(context.Background(), hostEndpointID, result.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata() error = %v", err)
	}
	if meta == nil {
		t.Fatalf("flower thread metadata missing")
	}
	if meta.HomeHostID != "flower-host:test" || meta.HomeHostKind != HostKindGlobal {
		t.Fatalf("metadata home host=(%q,%q), want visible handler", meta.HomeHostID, meta.HomeHostKind)
	}
	if meta.OriginEnvPublicID != "env_a" {
		t.Fatalf("origin env=%q, want env_a", meta.OriginEnvPublicID)
	}
	if got := svc.ai.ToolTargetPolicy().DefaultTargetID; got != "" {
		t.Fatalf("service-level default target=%q, want empty", got)
	}
	if got := svc.primaryTargetIDForThread(context.Background(), result.ThreadID); got != "env_a" {
		t.Fatalf("thread default target=%q, want env_a", got)
	}
	messages, err := svc.ai.ListThreadMessages(context.Background(), svc.Meta(), result.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages() error = %v", err)
	}
	raw, _ := json.Marshal(messages.Messages)
	for _, needle := range []string{"assistant.ask.flower", "env_a", "/repo"} {
		if !strings.Contains(string(raw), needle) {
			t.Fatalf("messages missing %q: %s", needle, raw)
		}
	}
}

func writeFlowerHostTestSSE(w io.Writer, flusher http.Flusher, payload any) {
	body, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(body)
	_, _ = io.WriteString(w, "\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}
