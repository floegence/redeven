package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	openai "github.com/openai/openai-go"
	oresponses "github.com/openai/openai-go/responses"
)

func TestParallelToolCallsWireModeReachesProviderHTTPBody(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		provider string
		mode     parallelToolCallsWireMode
		path     string
	}{
		{name: "responses_enable", provider: "openai", mode: parallelToolCallsWireEnable, path: "/responses"},
		{name: "responses_omit", provider: "openai", mode: parallelToolCallsWireOmit, path: "/responses"},
		{name: "chat_enable", provider: "openai_compatible", mode: parallelToolCallsWireEnable, path: "/chat/completions"},
		{name: "chat_omit", provider: "openai_compatible", mode: parallelToolCallsWireOmit, path: "/chat/completions"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			bodyCh := make(chan map[string]any, 1)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if !strings.HasSuffix(req.URL.Path, test.path) {
					http.Error(w, "not found", http.StatusNotFound)
					return
				}
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				bodyCh <- body
				w.Header().Set("Content-Type", "text/event-stream")
				flusher, ok := w.(http.Flusher)
				if !ok {
					http.Error(w, "streaming unsupported", http.StatusInternalServerError)
					return
				}
				if test.path == "/responses" {
					writeOpenAISSEJSON(w, flusher, map[string]any{
						"type":     "response.completed",
						"response": map[string]any{"id": "resp_wire", "model": "test-model", "status": "completed"},
					})
				} else {
					writeOpenAISSEJSON(w, flusher, map[string]any{
						"id": "chat_wire", "object": "chat.completion.chunk", "created": 1, "model": "test-model",
						"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{"role": "assistant", "content": "ok"}}},
					})
					writeOpenAISSEJSON(w, flusher, map[string]any{
						"id": "chat_wire", "object": "chat.completion.chunk", "created": 1, "model": "test-model",
						"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "delta": map[string]any{}}},
					})
				}
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
				flusher.Flush()
			}))
			t.Cleanup(srv.Close)

			adapter, err := newProviderAdapter(test.provider, srv.URL+"/v1", "sk-test", nil, test.mode)
			if err != nil {
				t.Fatalf("newProviderAdapter: %v", err)
			}
			if _, err := adapter.StreamTurn(context.Background(), ModelGatewayRequest{
				Model:    "test-model",
				Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}},
			}, nil); err != nil {
				t.Fatalf("StreamTurn: %v", err)
			}
			body := <-bodyCh
			value, exists := body["parallel_tool_calls"]
			if test.mode == parallelToolCallsWireEnable {
				if !exists || value != true {
					t.Fatalf("enabled wire value=%v exists=%v, want true", value, exists)
				}
			} else if exists {
				t.Fatalf("omitted wire field was serialized with value %v", value)
			}
		})
	}
}

func TestToolConcurrencyDependencyRuleAppearsInMainAndSubagentPrompts(t *testing.T) {
	t.Parallel()
	mainPrompt := strings.Join(buildPromptToolUsageSection(promptRuntimeSnapshot{}).Lines, "\n")
	r := newRun(runOptions{AgentHomeDir: t.TempDir()})
	subagentPrompt := r.buildSubagentHostSystemPrompt([]ToolDef{{Name: "terminal.exec"}}, resolveSubagentCapabilityContract(r, nil, flruntime.SubAgentForkNone))
	for name, prompt := range map[string]string{"main": mainPrompt, "subagent": subagentPrompt} {
		for _, required := range []string{
			"arguments are fully known",
			"do not depend on one another",
			"same response",
			"depends on a previous result",
			"later response",
			"runtime does not infer dependencies or conflicts",
		} {
			if !strings.Contains(prompt, required) {
				t.Fatalf("%s prompt missing %q: %s", name, required, prompt)
			}
		}
	}
}

func TestParallelToolCallsWireModeOfficialEndpointMatrix(t *testing.T) {
	t.Parallel()
	tests := []struct {
		provider string
		baseURL  string
		want     parallelToolCallsWireMode
	}{
		{provider: "openai", want: parallelToolCallsWireEnable},
		{provider: "openai", baseURL: "https://api.openai.com/v1", want: parallelToolCallsWireEnable},
		{provider: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", want: parallelToolCallsWireEnable},
		{provider: "qwen", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", want: parallelToolCallsWireEnable},
		{provider: "qwen", baseURL: "https://dashscope-us.aliyuncs.com/compatible-mode/v1", want: parallelToolCallsWireEnable},
		{provider: "openrouter", baseURL: "https://openrouter.ai/api/v1", want: parallelToolCallsWireEnable},
		{provider: "xai", baseURL: "https://api.x.ai/v1", want: parallelToolCallsWireEnable},
		{provider: "groq", baseURL: "https://api.groq.com/openai/v1", want: parallelToolCallsWireEnable},
		{provider: "openai", baseURL: "https://proxy.example/v1", want: parallelToolCallsWireOmit},
		{provider: "openai", baseURL: "http://api.openai.com/v1", want: parallelToolCallsWireOmit},
		{provider: "qwen", baseURL: "https://dashscope-intl.aliyuncs.com.proxy.example/v1", want: parallelToolCallsWireOmit},
		{provider: "anthropic", baseURL: "https://api.anthropic.com", want: parallelToolCallsWireOmit},
		{provider: "deepseek", baseURL: "https://api.deepseek.com", want: parallelToolCallsWireOmit},
		{provider: "moonshot", baseURL: "https://api.moonshot.cn/v1", want: parallelToolCallsWireOmit},
		{provider: "chatglm", baseURL: "https://open.bigmodel.cn/api/paas/v4", want: parallelToolCallsWireOmit},
		{provider: "ollama", baseURL: "http://localhost:11434/v1", want: parallelToolCallsWireOmit},
		{provider: "openai_compatible", baseURL: "https://api.openai.com/v1", want: parallelToolCallsWireOmit},
		{provider: DesktopModelSourceProviderType, baseURL: "https://api.openai.com/v1", want: parallelToolCallsWireOmit},
	}
	for _, test := range tests {
		test := test
		t.Run(test.provider+"_"+test.baseURL, func(t *testing.T) {
			t.Parallel()
			if got := resolveParallelToolCallsWireMode(test.provider, test.baseURL); got != test.want {
				t.Fatalf("mode=%q, want %q", got, test.want)
			}
		})
	}
}

func TestParallelToolCallsWireSerializationNeverSendsFalse(t *testing.T) {
	t.Parallel()
	for _, mode := range []parallelToolCallsWireMode{parallelToolCallsWireOmit, parallelToolCallsWireEnable} {
		responsesParams := oresponses.ResponseNewParams{Model: "gpt-5"}
		applyResponsesParallelToolCalls(&responsesParams, mode)
		chatParams := openai.ChatCompletionNewParams{Model: "gpt-5"}
		applyChatParallelToolCalls(&chatParams, mode)
		for name, params := range map[string]any{"responses": responsesParams, "chat": chatParams} {
			raw, err := json.Marshal(params)
			if err != nil {
				t.Fatalf("marshal %s: %v", name, err)
			}
			body := string(raw)
			if strings.Contains(body, `"parallel_tool_calls":`+`false`) {
				t.Fatalf("%s serialized false: %s", name, body)
			}
			if mode == parallelToolCallsWireEnable && !strings.Contains(body, `"parallel_tool_calls":true`) {
				t.Fatalf("%s omitted enabled field: %s", name, body)
			}
			if mode == parallelToolCallsWireOmit && strings.Contains(body, `"parallel_tool_calls"`) {
				t.Fatalf("%s serialized omitted field: %s", name, body)
			}
		}
	}
}

func TestPermissionSnapshotV2RejectsLegacyV1(t *testing.T) {
	t.Parallel()
	snapshot := PermissionSnapshot{
		Version:          permissionSnapshotVersionCurrent,
		PermissionType:   FlowerPermissionApprovalRequired,
		VisibleToolNames: []string{"terminal.exec"},
		FloretToolNames:  []string{"terminal.exec"},
		ToolPolicies: map[string]ToolPermissionPolicy{
			"terminal.exec": {Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityShell}, ApprovalDecision: ApprovalDecisionAsk},
		},
	}
	rawV2, err := marshalPermissionSnapshot(snapshot)
	if err != nil {
		t.Fatalf("marshal v2: %v", err)
	}
	if !strings.Contains(string(rawV2), `"version":2`) || strings.Contains(string(rawV2), "parallel"+"_"+"safe") {
		t.Fatalf("unexpected v2 JSON: %s", rawV2)
	}
	missingVersion := snapshot
	missingVersion.Version = 0
	if _, err := marshalPermissionSnapshot(missingVersion); err == nil {
		t.Fatal("permission snapshot without an explicit version was serialized")
	}
	if permissionSnapshotHash(missingVersion) != "" || permissionSurfaceEpoch(missingVersion) != "" {
		t.Fatal("permission snapshot without an explicit version produced authorization identity")
	}

	legacyJSON := `{"SnapshotID":"legacy","PermissionType":"approval_required","VisibleToolNames":["terminal.exec"],"FloretToolNames":["terminal.exec"],"ToolPolicies":{}}`
	if _, err := decodePermissionSnapshot(legacyJSON); err == nil {
		t.Fatal("legacy v1 snapshot was accepted")
	}
	if _, err := decodePermissionSnapshot(`{"version":99}`); err == nil {
		t.Fatal("unknown snapshot version was accepted")
	}
	valid := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil), "env", "thread", "run")
	validJSON, err := marshalPermissionSnapshot(valid)
	if err != nil {
		t.Fatal(err)
	}
	withLegacyField := strings.Replace(string(validJSON), "{", `{"parallel_safe":true,`, 1)
	if _, err := decodePermissionSnapshot(withLegacyField); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("legacy v2 field error=%v, want unknown field rejection", err)
	}
	withoutID := valid
	withoutID.SnapshotID = ""
	withoutIDJSON, err := json.Marshal(withoutID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodePermissionSnapshot(string(withoutIDJSON)); err == nil {
		t.Fatal("permission snapshot without id was accepted")
	}
	withoutHash := valid
	withoutHash.SnapshotHash = ""
	withoutHashJSON, err := json.Marshal(withoutHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodePermissionSnapshot(string(withoutHashJSON)); err == nil {
		t.Fatal("permission snapshot without hash was accepted")
	}
}
