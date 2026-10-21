package ai

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	flruntime "github.com/floegence/floret/v7/runtime"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// Exercise admission and the real wire adapters, rather than supplying a search
// mode or hosted tool directly to a gateway fixture.
func TestWebSearchTurnSurfaceReachesProvider(t *testing.T) {
	for _, tc := range []struct {
		name, provider, model, wire, searchMode, toolType, functionName, path string
		braveKey                                                              bool
	}{
		{name: "openai", provider: "openai", model: "gpt-5.5", toolType: "web_search", path: "/responses"},
		{name: "vision", provider: "deepseek", model: "deepseek-v4-flash-vision-exp", functionName: "web_search_tool", path: "/responses"},
		{name: "fetch_only", provider: "openai_compatible", model: "custom", searchMode: "openai_builtin", path: "/responses"},
		{name: "flash", provider: "deepseek", model: "deepseek-v4-flash", functionName: "web_search_tool", path: "/responses"},
		{name: "pro_alias", provider: "deepseek", model: "my-pro", wire: "deepseek-v4-pro", toolType: "web_search", path: "/responses"},
		{name: "kimi", provider: "moonshot", model: "kimi-k2.6", toolType: "builtin_function", path: "/chat/completions"},
		{name: "glm", provider: "chatglm", model: "glm-5.1", toolType: "web_search", path: "/chat/completions"},
		{name: "qwen", provider: "qwen", model: "qwen3.6-plus", toolType: "web_search", path: "/responses"},
		{name: "responses_builtin", provider: "openai_compatible", model: "custom", searchMode: "openai_builtin", toolType: "web_search", path: "/responses"},
		{name: "brave", provider: "openai_compatible", model: "custom", searchMode: "brave", functionName: "web_search_tool", braveKey: true, path: "/responses"},
		{name: "brave_missing_key", provider: "openai_compatible", model: "custom", searchMode: "brave", path: "/responses"},
		{name: "disabled", provider: "openai_compatible", model: "custom", searchMode: "disabled", path: "/chat/completions"},
		{name: "not_integrated", provider: "qwen", model: "qwen3.6-max-preview", path: "/chat/completions"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var mainBodies []map[string]any
			var titleBodies []map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != tc.path {
					t.Errorf("protocol changed: %s, want %s", r.URL.Path, tc.path)
				}
				mu.Lock()
				if tools, _ := body["tools"].([]any); len(tools) > 0 {
					mainBodies = append(mainBodies, body)
				} else {
					titleBodies = append(titleBodies, body)
				}
				mu.Unlock()
				w.Header().Set("Content-Type", "text/event-stream")
				if strings.HasSuffix(r.URL.Path, "/responses") {
					fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-search-test\",\"object\":\"response\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"id\":\"msg-search-test\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Completed\",\"annotations\":[]}]}],\"usage\":{\"input_tokens\":10,\"output_tokens\":2,\"total_tokens\":12}}}\n\n")
				} else {
					fmt.Fprint(w, "data: {\"id\":\"chat-search-test\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Completed\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\ndata: [DONE]\n\n")
				}
			}))
			defer server.Close()
			selected := config.AIProviderModel{ModelName: tc.model, WireModelName: tc.wire, ContextWindow: 128000, MaxOutputTokens: 4096}
			for _, entry := range config.AIProviderCatalog(tc.provider) {
				if entry.ModelName == tc.model || entry.EffectiveWireModelName() == tc.wire {
					selected.InputModalities = entry.InputModalities
				}
			}
			provider := config.AIProvider{ID: "provider", Type: tc.provider, BaseURL: server.URL, Models: []config.AIProviderModel{selected}}
			if tc.searchMode != "" {
				provider.WebSearch = &config.AIProviderWebSearch{Enabled: tc.searchMode != "disabled", Source: map[bool]string{true: "brave", false: "native"}[tc.searchMode == "brave"]}
			}
			stateDir := t.TempDir()
			svc, err := NewService(Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
				Config:                       &config.AIConfig{CurrentModelID: "provider/" + tc.model, Providers: []config.AIProvider{provider}},
				ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}, PersistOpTimeout: 2 * time.Second,
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "test-key", true, nil },
				ResolveWebSearchProviderAPIKey: func(string) (string, bool, error) {
					if tc.braveKey {
						return "test-search-key", true, nil
					}
					return "", false, nil
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			defer svc.Close()
			meta := &session.Meta{EndpointID: "env_search", ChannelID: "channel_search", NamespacePublicID: "ns_search", UserPublicID: "user_search", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			thread, err := svc.CreateThread(t.Context(), meta, "", "provider/"+tc.model, "", "")
			if err != nil {
				t.Fatal(err)
			}
			switch tc.name {
			case "vision":
				request := SendUserTurnRequest{ClientRequestID: "vision-search", ThreadID: thread.ThreadID, Input: RunInput{Text: "search admission"}}
				attachSearchTestImage(t, svc, meta, &request)
				if _, err := svc.SendUserTurn(t.Context(), meta, request); err != nil {
					t.Fatal(err)
				}
				waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
			case "fetch_only":
				if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "fetch-only", ThreadID: thread.ThreadID, Input: RunInput{Text: "Fetch a known URL."}, Options: RunOptions{ToolAllowlist: []string{"web_fetch"}}}); err != nil {
					t.Fatal(err)
				}
				waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
			default:
				sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "search admission", "")
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.TitleStatus == "ready" })
			models, err := svc.ListModels()
			if err != nil {
				t.Fatal(err)
			}
			wantSearch := tc.toolType != "" || tc.functionName != ""
			if (models.Models[0].WebSearch.Status == "available") != (wantSearch || tc.name == "fetch_only") {
				t.Fatalf("model projection=%+v", models.Models[0].WebSearch)
			}
			if tc.provider == "deepseek" && models.Models[0].WebSearch.Reason != "catalog_supported" {
				t.Fatalf("DeepSeek projection=%+v", models.Models[0].WebSearch)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(mainBodies) != 1 {
				t.Fatalf("main requests=%d", len(mainBodies))
			}
			body := mainBodies[0]
			wire := tc.wire
			if wire == "" {
				wire = tc.model
			}
			if body["model"] != wire {
				t.Fatalf("wire model=%v", body["model"])
			}
			hosted, local, fetch := 0, 0, 0
			for _, value := range body["tools"].([]any) {
				tool := value.(map[string]any)
				if tool["type"] == "web_search" || tool["type"] == "builtin_function" {
					hosted++
				}
				if tool["name"] == "web_search_tool" {
					local++
				}
				if tool["name"] == "web_fetch" {
					fetch++
				}
				if function, ok := tool["function"].(map[string]any); ok {
					if function["name"] == "web_search_tool" {
						local++
					}
					if function["name"] == "web_fetch" {
						fetch++
					}
				}
			}
			wantHosted, wantLocal := 0, 0
			if tc.toolType != "" {
				wantHosted = 1
			}
			if tc.functionName != "" {
				wantLocal = 1
			}
			if hosted != wantHosted || local != wantLocal {
				t.Fatalf("search tools hosted=%d local=%d", hosted, local)
			}
			if tc.name == "fetch_only" && fetch == 0 {
				t.Fatal("fetch-only allowlist omitted web_fetch")
			}
			raw, _ := json.Marshal(body)
			if tc.name == "vision" && !strings.Contains(string(raw), `"type":"input_image"`) {
				t.Fatal("unsupported search disabled Vision image input")
			}
			if len(titleBodies) == 0 {
				t.Fatal("automatic title was not exercised")
			}
			for _, title := range titleBodies {
				if tools, _ := title["tools"].([]any); len(tools) != 0 {
					t.Fatal("title enabled tools")
				}
			}
		})
	}
}

// Stage a synthetic image through the same upload admission path used by hosts.
func attachSearchTestImage(t *testing.T, svc *Service, meta *session.Meta, request *SendUserTurnRequest) {
	t.Helper()
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, request.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 32, 32))); err != nil {
		t.Fatal(err)
	}
	name := "search-test.png"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: bytes.NewReader(data.Bytes()), DisplayName: name, UploadRequestID: "search-image", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256(data.Bytes())), ExpectedSizeBytes: int64(data.Len()), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	request.StagingScopeID, request.StagingCapability = scope.StagingScopeID, scope.Capability
	request.Input.Attachments = []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}
}

func TestNativeSearchSurvivesWaitingRetryAndRestart(t *testing.T) {
	for _, failure := range []string{"rejected", "misrouted", "settings_changed"} {
		t.Run(failure, func(t *testing.T) { testNativeSearchLifecycle(t, failure) })
	}
}

func testNativeSearchLifecycle(t *testing.T, failure string) {
	var mu sync.Mutex
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		tools, _ := body["tools"].([]any)
		if len(tools) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Search lifecycle")
			return
		}
		mu.Lock()
		bodies = append(bodies, body)
		call := len(bodies)
		mu.Unlock()
		if call == 2 {
			if failure == "misrouted" {
				writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "invalid-search", "status": "completed", "output": []any{map[string]any{"type": "function_call", "id": "wrong", "call_id": "wrong", "name": "web_search", "arguments": `{"query":"Go release"}`}}}})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"native search unavailable","type":"invalid_request_error","code":"search_unavailable"}}`)
			return
		}
		if call == 1 {
			args := `{"reason_code":"missing_external_input","required_from_user":["Choose a target."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Target","question":"Which target?","response_mode":"write","is_secret":false,"write_label":"Target","write_placeholder":"Type a target"}]}`
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "search-first", "status": "completed", "output": []any{
				map[string]any{"type": "function_call", "id": "ask", "call_id": "ask", "name": "ask_user", "arguments": args},
			}}})
			return
		}
		if r.URL.Path == "/chat/completions" {
			fmt.Fprint(w, "data: {\"id\":\"new-turn\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Completed\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		writeDeepSeekIntegrationTextResponse(w, flusher, fmt.Sprintf("done-%d", call), "Search completed.")
	}))
	defer server.Close()
	stateDir := t.TempDir()
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{CurrentModelID: "search/model-a", Providers: []config.AIProvider{{ID: "search", Type: "openai_compatible", BaseURL: server.URL,
			// This fixture tests search continuation and model switching, not compaction.
			Models: []config.AIProviderModel{{ModelName: "model-a", ContextWindow: 128000}, {ModelName: "model-b", ContextWindow: 128000}}, WebSearch: &config.AIProviderWebSearch{Enabled: true, Source: config.AIWebSearchSourceNative}}}},
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second},
		ResolveProviderAPIKey:        func(string) (string, bool, error) { return "test-key", true, nil }}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Search lifecycle", "search/model-a", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "search-start", ThreadID: thread.ThreadID, Input: RunInput{Text: "Search, then ask for a target."}}); err != nil {
		t.Fatal(err)
	}
	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "waiting_user" && view.WaitingPrompt != nil })
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	if failure == "settings_changed" {
		opts.Config.Providers[0].WebSearch.Enabled = false
	}
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "staging"}}}}); err != nil {
		t.Fatal(err)
	}
	failed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "failed" })
	if failure == "misrouted" {
		if failed.RunErrorCode != runErrorCodeProviderRequestFailed {
			t.Fatalf("hosted tool contract failure was replaced: %s", failed.RunError)
		}
	} else if failed.RunErrorCode != runErrorCodeProviderRequestInvalid || !strings.Contains(failed.RunErrorDetail, `"http_status": 400`) || !strings.Contains(failed.RunErrorDetail, `"code": "search_unavailable"`) {
		t.Fatalf("upstream failure lost safe evidence: code=%s detail=%s", failed.RunErrorCode, failed.RunErrorDetail)
	}
	if _, err := svc.RetryThreadContinuation(t.Context(), meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, "search/model-b"); err != nil {
		t.Fatal(err)
	}
	sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "New turn after model switch.", "")
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 4 {
		t.Fatalf("main requests=%d", len(bodies))
	}
	for index, body := range bodies {
		hosted := 0
		for _, value := range body["tools"].([]any) {
			tool := value.(map[string]any)
			if tool["type"] == "web_search" {
				hosted++
			}
			if tool["name"] == "web_search" {
				t.Fatal("native search entered local tool schema")
			}
		}
		wantHosted := 1
		if failure == "settings_changed" && index >= 2 {
			wantHosted = 0
		}
		if hosted != wantHosted {
			t.Fatalf("request %d hosted=%d, want %d", index, hosted, wantHosted)
		}
		frozenRequests := 3
		if failure == "settings_changed" {
			// Canonical user retry admits a new Turn in Floret. The resumed
			// waiting Turn retains search; the new Turn adopts disabled search.
			frozenRequests = 2
		}
		if index < frozenRequests && !reflect.DeepEqual(body["tools"], bodies[0]["tools"]) {
			t.Fatalf("request %d changed the frozen tool surface", index)
		}
	}
	if bodies[3]["model"] != "model-b" {
		t.Fatal("new turn did not adopt model switch")
	}
}
