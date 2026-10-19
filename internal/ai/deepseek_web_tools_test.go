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
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func dispatchNativeWeb(t *testing.T, r *run, name, args string) fltools.Result {
	t.Helper()
	binding := r.webToolBindings[name]
	tool, err := r.buildBoundNativeTool(nativeWebToolDefinition(name, binding), PermissionSnapshot{PermissionType: FlowerPermissionFullAccess}, r.webToolBindings)
	if err != nil {
		t.Fatal(err)
	}
	return fltools.NewRegistry(tool).Dispatch(t.Context(), fltools.ToolCall{ID: "call", Name: name, Args: args}, fltools.DispatchOptions{EffectDispatcher: func(ctx context.Context, req fltools.EffectDispatchRequest, execute func(context.Context) fltools.Result) fltools.Result {
		if req.Permission.Mode != fltools.PermissionAllow {
			t.Fatalf("permission=%s", req.Permission.Mode)
		}
		return execute(ctx)
	}})
}

func TestDeepSeekNativeWebToolsExecuteAndKeepErrorsRecoverable(t *testing.T) {
	key := "first"
	status := 200
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		calls++
		if request.Header.Get("Authorization") != "Bearer "+key {
			t.Error("credential rotation lost")
		}
		if status != 200 {
			w.WriteHeader(status)
			fmt.Fprint(w, `{"error":{"message":"service unavailable"}}`)
			return
		}
		switch request.URL.Path {
		case "/proxy/v1/tools/search":
			fmt.Fprint(w, `{"results":[{"title":"Source","url":"https://example.com","snippet":"Short UI text","summary":"Detailed model text"}]}`)
		case "/proxy/v1/tools/fetch":
			fmt.Fprint(w, `{"title":"Page","content":"# Real Markdown"}`)
		default:
			t.Errorf("unexpected endpoint %s", request.URL.Path)
		}
	}))
	defer server.Close()
	p := config.AIProvider{ID: "ds", Type: "deepseek", BaseURL: server.URL + "/proxy/v1"}
	r := &run{cfg: &config.AIConfig{Providers: []config.AIProvider{p}}, resolveProviderKey: func(id string) (string, bool, error) {
		if id != "ds" {
			t.Error("wrong connection")
		}
		return key, true, nil
	}, webSearch: config.ResolveAIWebSearch(p, "deepseek-flash", true)}
	r.bindWebTools(p)
	result := dispatchNativeWeb(t, r, "web.search", `{"query":"news"}`)
	if result.IsError || !strings.Contains(result.Text, "Detailed model text") || strings.Contains(result.Text, "Short UI text") {
		t.Fatalf("search=%+v", result)
	}
	if payload := result.Activity.Payload.(fltools.WebSearchActivityPayload); payload.Results[0].Snippet != "Short UI text" {
		t.Fatal("UI snippet lost")
	}
	key = "rotated"
	result = dispatchNativeWeb(t, r, "web_fetch", `{"url":"https://8.8.8.8/page","format":"markdown"}`)
	if result.IsError || !strings.Contains(result.Text, "# Real Markdown") {
		t.Fatalf("fetch=%+v", result)
	}
	payload := result.Activity.Payload.(fltools.WebFetchActivityPayload)
	if payload.StatusCode != 0 || payload.FinalURL != "" || payload.ContentType != "" {
		t.Fatalf("invented page metadata=%+v", payload)
	}
	for _, code := range []int{401, 402, 403, 429, 500} {
		status = code
		result = dispatchNativeWeb(t, r, "web.search", `{"query":"news"}`)
		if !result.IsError {
			t.Fatalf("status %d accepted", code)
		}
	}
	before := calls
	for _, url := range []string{"http://127.0.0.1/private", "https://10.0.0.1/private", "file:///etc/passwd"} {
		result = dispatchNativeWeb(t, r, "web_fetch", fmt.Sprintf(`{"url":%q,"format":"markdown"}`, url))
		if !result.IsError || calls != before {
			t.Fatalf("blocked URL reached service: %s %+v", url, result)
		}
	}
	for _, change := range []string{"endpoint", "disabled", "type"} {
		changed := p
		switch change {
		case "endpoint":
			changed.BaseURL += "/changed"
		case "disabled":
			enabled := false
			changed.Enabled = &enabled
		case "type":
			changed.Type = "openai_compatible"
		}
		r.host.webProvider = func(string) (config.AIProvider, bool) { return changed, true }
		result = dispatchNativeWeb(t, r, "web.search", `{"query":"news"}`)
		if !result.IsError || calls != before {
			t.Fatalf("changed %s dispatched: %+v", change, result)
		}
	}
	r.host.webProvider = nil
	tool, err := r.buildBoundNativeTool(nativeWebToolDefinition("web.search", r.webToolBindings["web.search"]), PermissionSnapshot{}, r.webToolBindings)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result = fltools.NewRegistry(tool).Dispatch(ctx, fltools.ToolCall{ID: "cancel", Name: "web.search", Args: `{"query":"news"}`}, fltools.DispatchOptions{EffectDispatcher: func(ctx context.Context, _ fltools.EffectDispatchRequest, execute func(context.Context) fltools.Result) fltools.Result {
		return execute(ctx)
	}})
	if !result.IsError || calls != before {
		t.Fatalf("canceled search dispatched: %+v", result)
	}
	r.resolveProviderKey = func(string) (string, bool, error) { return "", false, nil }
	result = dispatchNativeWeb(t, r, "web.search", `{"query":"news"}`)
	if !result.IsError || calls != before || !strings.Contains(result.Text, "Settings") {
		t.Fatalf("revocation=%+v calls=%d", result, calls)
	}
	// Deletion is checked at execution and settles as an ordinary tool error.
	r.host.webProvider = func(string) (config.AIProvider, bool) { return config.AIProvider{}, false }
	result = dispatchNativeWeb(t, r, "web.search", `{"query":"news"}`)
	if !result.IsError || calls != before {
		t.Fatalf("deleted connection=%+v", result)
	}
}

func TestDeepSeekWebBindingsFollowSearchDefaultsAndExplicitReader(t *testing.T) {
	for _, tc := range []struct {
		name       string
		search     *config.AIProviderWebSearch
		fetch      *config.AIProviderWebFetch
		wantSearch bool
		wantFetch  string
	}{
		{name: "omitted", wantSearch: true, wantFetch: "deepseek"},
		{name: "search_on", search: &config.AIProviderWebSearch{Enabled: true, Source: "native"}, wantSearch: true, wantFetch: "deepseek"},
		{name: "search_off", search: &config.AIProviderWebSearch{Enabled: false, Source: "native"}, wantFetch: "direct"},
		{name: "explicit_direct", fetch: &config.AIProviderWebFetch{Source: "direct"}, wantSearch: true, wantFetch: "direct"},
		{name: "explicit_deepseek_search_off", search: &config.AIProviderWebSearch{Enabled: false, Source: "native"}, fetch: &config.AIProviderWebFetch{Source: "deepseek"}, wantFetch: "deepseek"},
	} {
		for _, model := range []string{"deepseek-flash", "deepseek-v4-pro"} {
			t.Run(tc.name+"/"+model, func(t *testing.T) {
				p := config.AIProvider{ID: "ds", Type: "deepseek", BaseURL: "https://api.deepseek.com", WebSearch: tc.search, WebFetch: tc.fetch}
				r := &run{webSearch: config.ResolveAIWebSearch(p, model, true)}
				r.bindWebTools(p)
				if got := r.webToolBindings["web_fetch"]; got.Source != tc.wantFetch || got.Source == "deepseek" && (got.ProviderID != p.ID || got.EndpointFingerprint != webEndpointFingerprint(p.BaseURL)) {
					t.Fatalf("fetch binding=%+v, want %s", got, tc.wantFetch)
				}
				_, localSearch := r.webToolBindings["web.search"]
				if localSearch != (tc.wantSearch && model == "deepseek-flash") || r.webSearch.HostedTool() != (tc.wantSearch && model == "deepseek-v4-pro") {
					t.Fatalf("search binding=%+v, resolution=%+v", r.webToolBindings, r.webSearch)
				}
			})
		}
	}
}

func TestDeepSeekWebBindingsSurviveCheckpointAndRespectAbsence(t *testing.T) {
	p := config.AIProvider{ID: "ds", Type: "deepseek", BaseURL: "https://api.deepseek.com", WebFetch: &config.AIProviderWebFetch{Source: "deepseek"}}
	r := &run{cfg: &config.AIConfig{Providers: []config.AIProvider{p}}, webSearch: config.ResolveAIWebSearch(p, "deepseek-flash", true)}
	r.bindWebTools(p)
	saved := flruntime.ProviderToolSurface{}
	for name, binding := range r.webToolBindings {
		tool, err := r.buildBoundNativeTool(nativeWebToolDefinition(name, binding), PermissionSnapshot{}, r.webToolBindings)
		if err != nil {
			t.Fatal(err)
		}
		saved.ToolDefinitions = append(saved.ToolDefinitions, fltools.ToolDefinition{Name: name, InputSchema: tool.Definition.InputSchema, Annotations: tool.Definition.Annotations})
	}
	raw, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	var restored flruntime.ProviderToolSurface
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	p.WebFetch = nil
	p.WebSearch = &config.AIProviderWebSearch{Source: "native", Enabled: false}
	r.bindWebTools(p)
	bindings, err := r.frozenWebToolBindings(&restored)
	if err != nil {
		t.Fatal(err)
	}
	if bindings["web_fetch"].Source != "deepseek" || bindings["web.search"].Source != "deepseek" {
		t.Fatalf("changed frozen sources=%+v", bindings)
	}
	empty, err := r.frozenWebToolBindings(&flruntime.ProviderToolSurface{})
	if err != nil || len(empty) != 0 {
		t.Fatalf("absent tools reenabled=%+v %v", empty, err)
	}
	r.webSearch = config.ResolveAIWebSearch(p, "deepseek-flash", true)
	r.bindWebTools(p)
	if r.webToolBindings["web_fetch"].Source != "direct" {
		t.Fatal("new Turn failed to adopt Direct")
	}
	if _, ok := r.webToolBindings["web.search"]; ok {
		t.Fatal("new Turn ignored search off")
	}
	malformed := flruntime.ProviderToolSurface{ToolDefinitions: []fltools.ToolDefinition{{Name: "web.search", Annotations: map[string]any{webToolBindingAnnotation: map[string]any{"source": "unknown"}}}}}
	if _, err := r.frozenWebToolBindings(&malformed); err == nil {
		t.Fatal("unknown source accepted")
	}
}

func TestDeepSeekWebToolAnnotationsKeepCanonicalBytesAfterRestart(t *testing.T) {
	p := config.AIProvider{ID: "ds", Type: "deepseek", BaseURL: "https://api.deepseek.com"}
	r := &run{cfg: &config.AIConfig{Providers: []config.AIProvider{p}}, webSearch: config.ResolveAIWebSearch(p, "deepseek-flash", true)}
	r.bindWebTools(p)
	binding := r.webToolBindings["web.search"]
	tool, err := r.buildBoundNativeTool(nativeWebToolDefinition("web.search", binding), PermissionSnapshot{}, r.webToolBindings)
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(fltools.NewRegistry(tool).ExposedDefinitions())
	if err != nil {
		t.Fatal(err)
	}
	var restored []fltools.ToolDefinition
	if err := json.Unmarshal(before, &restored); err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(restored)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("tool annotations change canonical checkpoint bytes after JSON roundtrip: before=%s after=%s", before, after)
	}
}

func TestDeepSeekWebServicesKeepSourceAcrossWaitingRestart(t *testing.T) {
	var calls, searches, fetches atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/tools/search":
			searches.Add(1)
			fmt.Fprint(w, `{"results":[{"title":"Source","url":"https://example.com","summary":"Verified source"}]}`)
			return
		case "/v1/tools/fetch":
			fetches.Add(1)
			fmt.Fprint(w, `{"title":"Page","content":"# Verified content"}`)
			return
		case "/responses":
		default:
			t.Errorf("unexpected path %s", request.URL.Path)
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		definitions, _ := body["tools"].([]any)
		if len(definitions) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Frozen web services")
			return
		}
		n := calls.Add(1)
		localSearch := false
		for _, raw := range definitions {
			def := raw.(map[string]any)
			if def["type"] != "function" {
				t.Error("local search also exposed hosted search")
			}
			if def["name"] == "web_search_tool" {
				localSearch = true
			}
		}
		if localSearch != (n <= 3) {
			t.Errorf("request %d local search=%v", n, localSearch)
		}
		switch n {
		case 1:
			args := `{"reason_code":"missing_external_input","required_from_user":["Choose a target."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Target","question":"Which target?","response_mode":"write","is_secret":false,"write_label":"Target","write_placeholder":"Type a target"}]}`
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "waiting", "status": "completed", "output": []any{map[string]any{"type": "function_call", "id": "ask", "call_id": "ask", "name": "ask_user", "arguments": args}}}})
		case 2:
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "web", "status": "completed", "output": []any{
				map[string]any{"type": "function_call", "id": "search", "call_id": "search", "name": "web_search_tool", "arguments": `{"query":"docs"}`},
				map[string]any{"type": "function_call", "id": "fetch", "call_id": "fetch", "name": "web_fetch", "arguments": `{"url":"https://8.8.8.8/docs","format":"markdown"}`},
			}}})
		default:
			writeDeepSeekIntegrationTextResponse(w, flusher, fmt.Sprintf("done-%d", n), "Web services complete.")
		}
	}))
	defer server.Close()
	stateDir := t.TempDir()
	provider := config.AIProvider{ID: "ds", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-flash"}}, WebFetch: &config.AIProviderWebFetch{Source: "deepseek"}}
	open := func(p config.AIProvider) *Service {
		svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "ds/deepseek-flash", Providers: []config.AIProvider{p}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "key", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open(provider)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Frozen web services", "ds/deepseek-flash", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "first", ThreadID: thread.ThreadID, Input: RunInput{Text: "Ask, then search and fetch."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "waiting_user" && view.WaitingPrompt != nil })
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	provider.WebSearch = &config.AIProviderWebSearch{Enabled: false, Source: config.AIWebSearchSourceNative}
	provider.WebFetch = nil
	svc = open(provider)
	if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "staging"}}}}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if searches.Load() != 1 || fetches.Load() != 1 {
		t.Fatalf("frozen services not dispatched: search=%d fetch=%d", searches.Load(), fetches.Load())
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "next", ThreadID: thread.ThreadID, Input: RunInput{Text: "New settings."}}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" && calls.Load() == 4 })
}

func TestReleasedBravePendingCallRetainsSchemaAndBoundProvider(t *testing.T) {
	p := config.AIProvider{ID: "proxy", Type: "openai_compatible"}
	r := &run{webSearch: config.ResolveAIWebSearch(config.AIProvider{Type: "openai_compatible", WebSearch: &config.AIProviderWebSearch{Enabled: true, Source: "brave"}}, "custom", true)}
	r.bindWebTools(p)
	schema := map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "provider": map[string]any{"type": "string"}, "count": map[string]any{"type": "integer", "minimum": 1, "maximum": 10}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 60000}}, "required": []any{"query"}, "additionalProperties": false}
	saved := flruntime.ProviderToolSurface{ToolDefinitions: []fltools.ToolDefinition{{Name: "web.search", InputSchema: schema}}}
	bindings, err := r.frozenWebToolBindings(&saved)
	if err != nil {
		t.Fatal(err)
	}
	if bindings["web.search"].ProviderID != "proxy" || bindings["web.search"].Source != "brave" {
		t.Fatalf("binding=%+v", bindings)
	}
	def := nativeWebToolDefinition("web.search", bindings["web.search"])
	def.InputSchema = toolSchemaRaw(schema)
	tool, err := r.buildBoundNativeTool(def, PermissionSnapshot{PermissionType: FlowerPermissionFullAccess}, bindings)
	if err != nil {
		t.Fatal(err)
	}
	for _, provider := range []string{"brave", "deepseek"} {
		dispatched := false
		result := fltools.NewRegistry(tool).Dispatch(t.Context(), fltools.ToolCall{ID: "saved", Name: "web.search", Args: fmt.Sprintf(`{"query":"docs","provider":%q,"count":5,"timeout_ms":15000}`, provider)}, fltools.DispatchOptions{EffectDispatcher: func(context.Context, fltools.EffectDispatchRequest, func(context.Context) fltools.Result) fltools.Result {
			dispatched = true
			return fltools.Result{Text: "authorized"}
		}})
		if provider == "brave" && (!dispatched || result.IsError) {
			t.Fatalf("released invocation rejected: %+v", result)
		}
		if provider != "brave" && (!result.IsError || dispatched) {
			t.Fatalf("saved invocation rerouted: %+v", result)
		}
	}
}
