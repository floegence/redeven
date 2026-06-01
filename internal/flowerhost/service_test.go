package flowerhost

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
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

func TestNewService_UsesExplicitTargetToolPolicy(t *testing.T) {
	svc := newTestService(t)
	if svc.ai == nil {
		t.Fatalf("ai service is nil")
	}
	if got := svc.ai.ToolTargetPolicy().Mode; got != "explicit_target" {
		t.Fatalf("tool target mode=%q, want explicit_target", got)
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
	if result.Thread.ThreadID != "" {
		t.Fatalf("thread_id=%q, want empty thread snapshot", result.Thread.ThreadID)
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
