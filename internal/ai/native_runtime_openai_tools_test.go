package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go"
	oresponses "github.com/openai/openai-go/responses"
	oshared "github.com/openai/openai-go/shared"
)

func boolPtr(v bool) *bool { return &v }

func TestBuildOpenAITools_RespectsStrictFlag(t *testing.T) {
	t.Parallel()

	defs := []ToolDef{
		{
			Name:        "ask_user",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"question":{"type":"string"}},"required":["question"],"additionalProperties":false}`),
		},
	}

	toolsStrict, _ := buildOpenAITools(defs, true)
	if len(toolsStrict) != 1 || toolsStrict[0].OfFunction == nil {
		t.Fatalf("expected one function tool in strict mode")
	}
	if !toolsStrict[0].OfFunction.Strict.Valid() || !toolsStrict[0].OfFunction.Strict.Value {
		t.Fatalf("expected strict=true for strict mode")
	}

	toolsCompat, _ := buildOpenAITools(defs, false)
	if len(toolsCompat) != 1 || toolsCompat[0].OfFunction == nil {
		t.Fatalf("expected one function tool in compatible mode")
	}
	if !toolsCompat[0].OfFunction.Strict.Valid() || toolsCompat[0].OfFunction.Strict.Value {
		t.Fatalf("expected strict=false for compatible mode")
	}
}

func TestResolveProviderWebSearchCapability_CuratedNativeProviders(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		provider   config.AIProvider
		modelName  string
		wantMode   string
		wantReason string
		wantTool   bool
	}{
		{
			name:       "official_openai",
			provider:   config.AIProvider{Type: "openai", BaseURL: "https://api.openai.com/v1"},
			modelName:  "gpt-5.5",
			wantMode:   providerWebSearchModeOpenAIResponsesBuiltin,
			wantReason: "official_openai",
		},
		{
			name:       "moonshot_kimi",
			provider:   config.AIProvider{Type: "moonshot"},
			modelName:  "kimi-k2.6",
			wantMode:   providerWebSearchModeKimiBuiltin,
			wantReason: "curated_moonshot_model",
		},
		{
			name:       "glm_5_1",
			provider:   config.AIProvider{Type: "chatglm"},
			modelName:  "glm-5.1",
			wantMode:   providerWebSearchModeGLMWebSearchTool,
			wantReason: "curated_glm_model",
		},
		{
			name:       "deepseek_v4_pro",
			provider:   config.AIProvider{Type: "deepseek"},
			modelName:  "deepseek-v4-pro",
			wantMode:   providerWebSearchModeDeepSeekNative,
			wantReason: "curated_deepseek_model",
		},
		{
			name:       "deepseek_v4_flash",
			provider:   config.AIProvider{Type: "deepseek"},
			modelName:  "deepseek-v4-flash",
			wantMode:   providerWebSearchModeDeepSeekNative,
			wantReason: "curated_deepseek_model",
		},
		{
			name:       "qwen_plus",
			provider:   config.AIProvider{Type: "qwen"},
			modelName:  "qwen3.6-plus",
			wantMode:   providerWebSearchModeQwenResponsesWebSearch,
			wantReason: "curated_qwen_model",
		},
		{
			name:       "qwen_plus_snapshot",
			provider:   config.AIProvider{Type: "qwen"},
			modelName:  "qwen3.6-plus-2026-04-02",
			wantMode:   providerWebSearchModeQwenResponsesWebSearch,
			wantReason: "curated_qwen_model",
		},
		{
			name:       "qwen_flash",
			provider:   config.AIProvider{Type: "qwen"},
			modelName:  "qwen3.6-flash",
			wantMode:   providerWebSearchModeQwenResponsesWebSearch,
			wantReason: "curated_qwen_model",
		},
		{
			name:       "qwen_flash_snapshot",
			provider:   config.AIProvider{Type: "qwen"},
			modelName:  "qwen3.6-flash-2026-04-16",
			wantMode:   providerWebSearchModeQwenResponsesWebSearch,
			wantReason: "curated_qwen_model",
		},
		{
			name:       "qwen_max_preview_excluded",
			provider:   config.AIProvider{Type: "qwen"},
			modelName:  "qwen3.6-max-preview",
			wantMode:   providerWebSearchModeDisabled,
			wantReason: "unsupported_qwen_model",
		},
		{
			name:       "openai_compatible_disabled",
			provider:   config.AIProvider{Type: "openai_compatible", WebSearch: &config.AIProviderWebSearch{Mode: config.AIProviderWebSearchModeDisabled}},
			modelName:  "custom-model",
			wantMode:   providerWebSearchModeDisabled,
			wantReason: "openai_compatible_disabled",
		},
		{
			name:       "openai_compatible_builtin",
			provider:   config.AIProvider{Type: "openai_compatible", WebSearch: &config.AIProviderWebSearch{Mode: config.AIProviderWebSearchModeOpenAIBuiltin}},
			modelName:  "custom-model",
			wantMode:   providerWebSearchModeOpenAIResponsesBuiltin,
			wantReason: "openai_compatible_configured_builtin",
		},
		{
			name:       "openai_compatible_brave",
			provider:   config.AIProvider{Type: "openai_compatible", WebSearch: &config.AIProviderWebSearch{Mode: config.AIProviderWebSearchModeBrave}},
			modelName:  "custom-model",
			wantMode:   providerWebSearchModeExternalBrave,
			wantReason: "openai_compatible_configured_brave",
			wantTool:   true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			capability := resolveProviderWebSearchCapability(tc.provider, tc.modelName)
			if capability.Mode != tc.wantMode {
				t.Fatalf("Mode=%q, want %q", capability.Mode, tc.wantMode)
			}
			if capability.Reason != tc.wantReason {
				t.Fatalf("Reason=%q, want %q", capability.Reason, tc.wantReason)
			}
			if capability.RegisterTool != tc.wantTool {
				t.Fatalf("RegisterTool=%v, want %v", capability.RegisterTool, tc.wantTool)
			}
		})
	}
}

func TestSanitizeProviderToolName_WebSearchAvoidsHostedCollision(t *testing.T) {
	t.Parallel()

	if got := sanitizeProviderToolName("web.search"); got != "web_search_tool" {
		t.Fatalf("sanitizeProviderToolName(web.search)=%q, want web_search_tool", got)
	}
	if got := sanitizeProviderToolName("terminal.exec"); got != "terminal_exec" {
		t.Fatalf("sanitizeProviderToolName(terminal.exec)=%q, want terminal_exec", got)
	}
}

func TestOpenAICompatibleResponses_WebSearchToolAliasRoundTrip(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
			http.Error(w, "not found", http.StatusNotFound)
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
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_web_search_alias",
				"created_at": time.Now().Unix(),
				"model":      "gpt-5-mini",
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_web_search_alias",
				"call_id":   "call_web_search_alias",
				"name":      "web_search_tool",
				"arguments": `{"query":"hello","provider":"dummy","count":1}`,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_web_search_alias",
				"call_id":   "call_web_search_alias",
				"name":      "web_search_tool",
				"arguments": `{"query":"hello","provider":"dummy","count":1}`,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_web_search_alias",
				"model":  "gpt-5-mini",
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
	}))
	t.Cleanup(srv.Close)

	adapter, err := newProviderAdapter("openai_compatible", strings.TrimSuffix(srv.URL, "/")+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	res, err := adapter.StreamTurn(context.Background(), TurnRequest{
		Model:    "gpt-5-mini",
		Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "search"}}}},
		Tools: []ToolDef{
			{Name: "web.search", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("tool calls=%d, want 1", len(res.ToolCalls))
	}
	if got := strings.TrimSpace(res.ToolCalls[0].Name); got != "web.search" {
		t.Fatalf("tool name=%q, want web.search", got)
	}
}

func TestOpenAICompatibleBuiltinWebSearch_AttachesResponsesHostedTool(t *testing.T) {
	t.Parallel()

	requestBody := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		select {
		case requestBody <- string(body):
		default:
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_builtin_search",
				"created_at": time.Now().Unix(),
				"model":      "compat-model",
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": "ok"})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_builtin_search",
				"model":  "compat-model",
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
	}))
	t.Cleanup(srv.Close)

	adapter, err := newProviderAdapter("openai_compatible", strings.TrimSuffix(srv.URL, "/")+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	res, err := adapter.StreamTurn(context.Background(), TurnRequest{
		Model:         "compat-model",
		Messages:      []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "search"}}}},
		WebSearchMode: providerWebSearchModeOpenAIResponsesBuiltin,
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if strings.TrimSpace(res.Text) != "ok" {
		t.Fatalf("Text=%q, want ok", res.Text)
	}

	var rawBody string
	select {
	case rawBody = <-requestBody:
	default:
		t.Fatalf("missing request body")
	}
	var req map[string]any
	if err := json.Unmarshal([]byte(rawBody), &req); err != nil {
		t.Fatalf("unmarshal request body: %v\n%s", err, rawBody)
	}
	tools, ok := req["tools"].([]any)
	if !ok || len(tools) == 0 {
		t.Fatalf("tools=%v, want hosted web-search tool in request body %s", req["tools"], rawBody)
	}
	for _, rawTool := range tools {
		tool, _ := rawTool.(map[string]any)
		if strings.TrimSpace(anyString(tool["type"])) == "web_search_preview" {
			return
		}
	}
	t.Fatalf("tools=%v, want web_search_preview", tools)
}

func TestDecorateChatCompletionParams_WebSearchPayloads(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		mode       string
		wantSubstr []string
		denySubstr []string
	}{
		{
			name: "kimi_builtin",
			mode: providerWebSearchModeKimiBuiltin,
			wantSubstr: []string{
				`"type":"builtin_function"`,
				`"name":"$web_search"`,
				`"thinking":{"type":"disabled"}`,
			},
		},
		{
			name: "glm_web_search",
			mode: providerWebSearchModeGLMWebSearchTool,
			wantSubstr: []string{
				`"type":"web_search"`,
				`"web_search":{"search_result":true}`,
			},
			denySubstr: []string{`"enable_search":true`},
		},
		{
			name:       "deepseek_native",
			mode:       providerWebSearchModeDeepSeekNative,
			wantSubstr: []string{`"enable_search":true`},
			denySubstr: []string{`"type":"web_search"`},
		},
		{
			name:       "disabled",
			mode:       providerWebSearchModeDisabled,
			denySubstr: []string{`web_search`, `enable_search`, `$web_search`, `thinking`},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			params := openai.ChatCompletionNewParams{
				Model:    oshared.ChatModel("test-model"),
				Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
			}
			tools := []openai.ChatCompletionToolParam{}
			decorateChatCompletionParams(&params, tc.mode, &tools)
			if len(tools) > 0 {
				params.Tools = tools
			}
			raw, err := json.Marshal(params)
			if err != nil {
				t.Fatalf("Marshal params: %v", err)
			}
			payload := string(raw)
			for _, want := range tc.wantSubstr {
				if !strings.Contains(payload, want) {
					t.Fatalf("payload missing %s: %s", want, payload)
				}
			}
			for _, deny := range tc.denySubstr {
				if strings.Contains(payload, deny) {
					t.Fatalf("payload unexpectedly contains %s: %s", deny, payload)
				}
			}
		})
	}
}

func TestDecorateResponsesParams_WebSearchPayloads(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		mode       string
		wantSubstr []string
		denySubstr []string
	}{
		{
			name: "openai_builtin",
			mode: providerWebSearchModeOpenAIResponsesBuiltin,
			wantSubstr: []string{
				`"type":"web_search_preview"`,
			},
		},
		{
			name: "qwen_responses_web_search",
			mode: providerWebSearchModeQwenResponsesWebSearch,
			wantSubstr: []string{
				`"type":"web_search"`,
			},
			denySubstr: []string{`"enable_search":true`},
		},
		{
			name:       "disabled",
			mode:       providerWebSearchModeDisabled,
			denySubstr: []string{`web_search`, `enable_search`, `$web_search`, `thinking`},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			params := oresponses.ResponseNewParams{
				Model: oshared.ResponsesModel("test-model"),
				Input: oresponses.ResponseNewParamsInputUnion{OfInputItemList: oresponses.ResponseInputParam{
					oresponses.ResponseInputItemParamOfMessage("hello", oresponses.EasyInputMessageRoleUser),
				}},
			}
			tools := []oresponses.ToolUnionParam{}
			decorateResponsesParams(&params, tc.mode, &tools)
			if len(tools) > 0 {
				params.Tools = tools
			}
			raw, err := json.Marshal(params)
			if err != nil {
				t.Fatalf("Marshal params: %v", err)
			}
			payload := string(raw)
			for _, want := range tc.wantSubstr {
				if !strings.Contains(payload, want) {
					t.Fatalf("payload missing %s: %s", want, payload)
				}
			}
			for _, deny := range tc.denySubstr {
				if strings.Contains(payload, deny) {
					t.Fatalf("payload unexpectedly contains %s: %s", deny, payload)
				}
			}
		})
	}
}

func TestQwenResponsesBuiltinWebSearch_AttachesResponsesTool(t *testing.T) {
	t.Parallel()

	requestBody := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		select {
		case requestBody <- string(body):
		default:
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_qwen_builtin_search",
				"created_at": time.Now().Unix(),
				"model":      "qwen3.6-plus",
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": "ok"})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_qwen_builtin_search",
				"model":  "qwen3.6-plus",
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
	}))
	t.Cleanup(srv.Close)

	adapter, err := newProviderAdapter("qwen", strings.TrimSuffix(srv.URL, "/")+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	res, err := adapter.StreamTurn(context.Background(), TurnRequest{
		Model:         "qwen3.6-plus",
		Messages:      []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "search"}}}},
		WebSearchMode: providerWebSearchModeQwenResponsesWebSearch,
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if strings.TrimSpace(res.Text) != "ok" {
		t.Fatalf("Text=%q, want ok", res.Text)
	}

	var rawBody string
	select {
	case rawBody = <-requestBody:
	default:
		t.Fatalf("missing request body")
	}
	var req map[string]any
	if err := json.Unmarshal([]byte(rawBody), &req); err != nil {
		t.Fatalf("unmarshal request body: %v\n%s", err, rawBody)
	}
	tools, ok := req["tools"].([]any)
	if !ok || len(tools) == 0 {
		t.Fatalf("tools=%v, want hosted web-search tool in request body %s", req["tools"], rawBody)
	}
	for _, rawTool := range tools {
		tool, _ := rawTool.(map[string]any)
		if strings.TrimSpace(anyString(tool["type"])) == "web_search" {
			return
		}
	}
	t.Fatalf("tools=%v, want web_search", tools)
}

func TestNewProviderAdapter_OpenAIStrictPolicy(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		typ      string
		baseURL  string
		override *bool
		expected bool
	}{
		{name: "openai", typ: "openai", baseURL: "https://api.openai.com/v1", expected: true},
		{name: "openai_official_default_base_url", typ: "openai", baseURL: "", expected: true},
		{name: "openai_custom_gateway", typ: "openai", baseURL: "https://codex-api.packycode.com/v1", expected: false},
		{name: "openai_compatible", typ: "openai_compatible", baseURL: "https://example.com/v1", expected: false},
		{name: "chatglm", typ: "chatglm", baseURL: "https://open.bigmodel.cn/api/paas/v4/", expected: false},
		{name: "deepseek", typ: "deepseek", baseURL: "https://api.deepseek.com", expected: false},
		{name: "qwen", typ: "qwen", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", expected: false},
		{name: "moonshot", typ: "moonshot", baseURL: "https://api.moonshot.cn/v1", expected: false},
		{name: "openai_custom_gateway_override_true", typ: "openai", baseURL: "https://gateway.example/v1", override: boolPtr(true), expected: true},
		{name: "openai_official_override_false", typ: "openai", baseURL: "https://api.openai.com/v1", override: boolPtr(false), expected: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			provider, err := newProviderAdapter(tc.typ, tc.baseURL, "sk-test", tc.override)
			if err != nil {
				t.Fatalf("newProviderAdapter error: %v", err)
			}
			strict := false
			switch p := provider.(type) {
			case *openAIProvider:
				strict = p.strictToolSchema
			case *moonshotProvider:
				strict = p.strictToolSchema
			default:
				t.Fatalf("unexpected provider type %T", provider)
			}
			if strict != tc.expected {
				t.Fatalf("strictToolSchema mismatch, got=%v want=%v", strict, tc.expected)
			}
		})
	}
}
