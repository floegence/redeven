package ai

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
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
		{name: "openai", provider: "openai", model: "gpt-5.5", toolType: "web_search_preview", path: "/responses"},
		{name: "vision", provider: "deepseek", model: "deepseek-v4-flash-vision-exp", toolType: "web_search", path: "/responses"},
		{name: "fetch_only", provider: "deepseek", model: "deepseek-v4-flash", path: "/responses"},
		{name: "flash", provider: "deepseek", model: "deepseek-v4-flash", toolType: "web_search", path: "/responses"},
		{name: "pro_alias", provider: "deepseek", model: "my-pro", wire: "deepseek-v4-pro", toolType: "web_search", path: "/responses"},
		{name: "kimi", provider: "moonshot", model: "kimi-k2.6", toolType: "builtin_function", path: "/chat/completions"},
		{name: "glm", provider: "chatglm", model: "glm-5.1", toolType: "web_search", path: "/chat/completions"},
		{name: "qwen", provider: "qwen", model: "qwen3.6-plus", toolType: "web_search", path: "/responses"},
		{name: "responses_builtin", provider: "openai_compatible", model: "custom", searchMode: "openai_builtin", toolType: "web_search_preview", path: "/responses"},
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
			if tc.provider == "openai" {
				provider.BaseURL = "https://api.openai.com"
				target, _ := url.Parse(server.URL)
				original := http.DefaultTransport
				http.DefaultTransport = searchTestTransport(func(request *http.Request) (*http.Response, error) {
					copy := request.Clone(request.Context())
					copy.URL.Scheme, copy.URL.Host = target.Scheme, target.Host
					return original.RoundTrip(copy)
				})
				t.Cleanup(func() { http.DefaultTransport = original })
			}
			if tc.searchMode != "" {
				provider.WebSearch = &config.AIProviderWebSearch{Mode: tc.searchMode}
			}
			stateDir := t.TempDir()
			svc, err := NewService(Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
				Config:         &config.AIConfig{CurrentModelID: "provider/" + tc.model, Providers: []config.AIProvider{provider}},
				RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
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
			hosted, local := 0, 0
			for _, value := range body["tools"].([]any) {
				tool := value.(map[string]any)
				if tool["type"] == tc.toolType && tc.toolType != "" {
					hosted++
				}
				if tool["name"] == "web_search_tool" {
					local++
				}
				if function, ok := tool["function"].(map[string]any); ok && function["name"] == "web_search_tool" {
					local++
				}
			}
			if (hosted == 1) != (tc.toolType != "") || (local == 1) != (tc.functionName != "") {
				t.Fatalf("search tools hosted=%d local=%d", hosted, local)
			}
			raw, _ := json.Marshal(body)
			if tc.name == "vision" && !strings.Contains(string(raw), `"type":"input_image"`) {
				t.Fatal("Vision search lost its image")
			}
			if strings.Contains(string(raw), "URL discovery is unavailable") == wantSearch {
				t.Fatalf("prompt/search mismatch: search=%v", wantSearch)
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

type searchTestTransport func(*http.Request) (*http.Response, error)

func (transport searchTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
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
				map[string]any{"type": "web_search_call", "id": "native-search", "status": "completed", "opaque_results": "canonical-search-receipt", "action": map[string]any{"type": "search", "query": "Go release", "sources": []any{map[string]any{"type": "url", "url": "https://go.dev/dl/", "title": "Go downloads"}}}},
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
		Config:         &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL, Models: config.AIProviderCatalog("deepseek")}}},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test-key", true, nil }}
	if failure == "settings_changed" {
		opts.Config.Providers[0].Type = "openai_compatible"
		for i := range opts.Config.Providers[0].Models {
			opts.Config.Providers[0].Models[i].ReasoningCapability = config.AIReasoningCapability{}
			opts.Config.Providers[0].Models[i].DefaultReasoningSelection = config.AIReasoningSelection{}
		}
		opts.Config.Providers[0].WebSearch = &config.AIProviderWebSearch{Mode: config.AIProviderWebSearchModeOpenAIBuiltin}
	}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Search lifecycle", "deepseek/deepseek-v4-flash", "", "")
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
		opts.Config.Providers[0].WebSearch.Mode = config.AIProviderWebSearchModeDisabled
	}
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "staging"}}}}); err != nil {
		t.Fatal(err)
	}
	failed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "failed" })
	wantFailure := "DeepSeek provider status 400"
	if failure == "settings_changed" {
		wantFailure = "400"
	}
	if failure == "misrouted" {
		wantFailure = "provider returned a local function call for hosted tool"
	}
	if !strings.Contains(failed.RunError, wantFailure) {
		t.Fatalf("upstream failure was replaced: %s", failed.RunError)
	}
	if _, err := svc.RetryThreadContinuation(t.Context(), meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, "deepseek/deepseek-v4-flash-vision-exp"); err != nil {
		t.Fatal(err)
	}
	sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "New turn after model switch.", "")
	detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	searches := 0
	for _, item := range detail.Current.Items {
		if item.Activity != nil && item.Activity.ToolName == "web_search" && item.Activity.Status == "success" {
			searches++
		}
	}
	if failure != "settings_changed" && searches != 1 {
		t.Fatalf("canonical hosted searches=%d", searches)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 4 {
		t.Fatalf("main requests=%d", len(bodies))
	}
	for index, body := range bodies {
		hosted := 0
		for _, value := range body["tools"].([]any) {
			tool := value.(map[string]any)
			if tool["type"] == "web_search" || tool["type"] == "web_search_preview" {
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
	if bodies[3]["model"] != "deepseek-v4-flash-vision-exp" {
		t.Fatal("new turn did not adopt model switch")
	}
}
