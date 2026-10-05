package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/openai/openai-go"
)

func TestE2E_FlowerOllamaReasoningOnlyContinuation(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_OLLAMA_TASK_E2E") != "1" {
		t.Skip("set REDEVEN_FLOWER_OLLAMA_TASK_E2E=1 to qualify selected-model reasoning continuation")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	profile, model, _, key := loadOllamaQualificationProfile(t, ctx)
	gateway, err := newProviderAdapter(profile.Type, profile.BaseURL, key, profile.StrictToolSchema)
	if err != nil {
		t.Fatal(err)
	}
	request := ModelGatewayRequest{
		Model:            model.EffectiveWireModelName(),
		Messages:         []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Compute 17 times 19. Think carefully, then answer with the number only."}}}},
		ProviderControls: ProviderControls{ReasoningCapability: model.ReasoningCapability},
		Budgets:          TurnBudgets{MaxOutputToken: 8},
	}
	first, err := gateway.StreamTurn(ctx, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Reasoning == "" || first.Text != "" || first.FinishReason != "length" {
		t.Fatalf("expected actual reasoning-only truncation: %+v", first)
	}
	request.Messages = append(request.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: first.Reasoning}}})
	request.Messages = append(request.Messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Continue and give the number only."}}})
	request.Budgets.MaxOutputToken = 512
	second, err := gateway.StreamTurn(ctx, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.FinishReason != "stop" || strings.TrimSpace(second.Text) != "323" {
		t.Fatalf("reasoning continuation result=%+v", second)
	}
	t.Logf("model=%s requests=2 first_finish=%s reasoning_chars=%d second_finish=%s answer=%s", request.Model, first.FinishReason, len(first.Reasoning), second.FinishReason, second.Text)
}

func TestOllamaReasoningRequestUsesExactModelControls(t *testing.T) {
	for _, tc := range []struct {
		metadata, level, wire string
		invalid               bool
	}{
		{`{"values":[false,"low","medium","xhigh"]}`, "default", "", false},
		{`{"values":[false,"low","medium","xhigh"]}`, "off", "none", false},
		{`{"values":[false,"low","medium","xhigh"]}`, "xhigh", "xhigh", false},
		{`{"values":[false,"low","medium","xhigh"]}`, "high", "", true},
		{`{"values":[false,true]}`, "on", "medium", false},
		{`{"values":[true]}`, "off", "", true},
		{`null`, "high", "", true},
	} {
		t.Run(tc.metadata+tc.level, func(t *testing.T) {
			cap, err := config.OllamaReasoningCapability(json.RawMessage(tc.metadata), true)
			if err != nil {
				t.Fatal(err)
			}
			var params openai.ChatCompletionNewParams
			err = applyChatReasoning(&params, ProviderControls{ReasoningCapability: cap, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevel(tc.level)}})
			if (err != nil) != tc.invalid {
				t.Fatalf("err=%v", err)
			}
			if tc.invalid {
				return
			}
			raw, _ := json.Marshal(params)
			var payload map[string]any
			_ = json.Unmarshal(raw, &payload)
			got, _ := payload["reasoning_effort"].(string)
			if got != tc.wire {
				t.Fatalf("payload=%s", raw)
			}
			if tc.wire == "" {
				if _, ok := payload["reasoning_effort"]; ok {
					t.Fatal("default must omit control")
				}
			}
		})
	}
}

func TestOllamaReasoningStreamAndToolHistory(t *testing.T) {
	cap, err := config.OllamaReasoningCapability(json.RawMessage(`{"values":[false,true]}`), true)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["reasoning_effort"] != "medium" {
			t.Errorf("effort=%v", request["reasoning_effort"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for _, delta := range []map[string]any{{"reasoning": "Inspect first."}, {"content": "Done."}} {
			writeOpenAISSEJSON(w, flusher, map[string]any{"id": "ollama", "object": "chat.completion.chunk", "model": "local-alias", "choices": []any{map[string]any{"index": 0, "delta": delta}}})
		}
		writeOpenAISSEJSON(w, flusher, map[string]any{"id": "ollama", "object": "chat.completion.chunk", "model": "local-alias", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}})
	}))
	defer server.Close()
	gateway, err := newProviderAdapter("ollama", server.URL+"/v1", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	var thoughts []string
	result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "local-alias", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Check."}}}}, ProviderControls: ProviderControls{ReasoningCapability: cap, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOn}}}, func(e StreamEvent) {
		if e.Type == StreamEventThinkingDelta {
			thoughts = append(thoughts, e.Text)
		}
	})
	if err != nil || result.Reasoning != "Inspect first." || result.Text != "Done." || strings.Join(thoughts, "") != result.Reasoning {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	aliases, err := newOpenAIProviderToolAliases([]ToolDef{{Name: "terminal.exec"}})
	if err != nil {
		t.Fatal(err)
	}
	messages, err := buildOpenAIChatMessagesWithCapability([]Message{{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: result.Reasoning}, {Type: "tool_call", ToolCallID: "call", ToolName: "terminal.exec", ArgsJSON: `{"cmd":"pwd"}`}}}}, cap, aliases)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(messages)
	if !strings.Contains(string(raw), `"reasoning":"Inspect first."`) || strings.Contains(string(raw), "reasoning_content") {
		t.Fatalf("history=%s", raw)
	}
}

func TestLiveOllamaReasoningControls(t *testing.T) {
	endpoint := os.Getenv("REDEVEN_TEST_OLLAMA_URL")
	if endpoint == "" {
		t.Skip("set REDEVEN_TEST_OLLAMA_URL and REDEVEN_TEST_OLLAMA_MODEL for live qualification")
	}
	model := os.Getenv("REDEVEN_TEST_OLLAMA_MODEL")
	if model == "" {
		t.Fatal("missing model")
	}
	models, err := discoverModelCatalog(t.Context(), ModelCatalogRequest{Type: "ollama", BaseURL: endpoint}, http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	var cap config.AIReasoningCapability
	for _, m := range models {
		if m.EffectiveWireModelName() == model {
			cap = m.ReasoningCapability
		}
	}
	if cap.IsZero() || !cap.SupportsLevel(config.AIReasoningLevelOff) {
		t.Fatal("live model must declare off and at least one enabled effort")
	}
	gateway, err := newProviderAdapter("ollama", strings.TrimRight(endpoint, "/")+"/v1", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	levels := []config.AIReasoningLevel{config.AIReasoningLevelDefault, config.AIReasoningLevelOff}
	for _, level := range cap.SupportedLevels {
		if level != "off" {
			levels = append(levels, config.AIReasoningLevel(level))
		}
	}
	for _, level := range levels {
		t.Run(string(level), func(t *testing.T) {
			result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: model, Budgets: TurnBudgets{MaxOutputToken: 128}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "What is 17 times 19? Answer briefly."}}}}, ProviderControls: ProviderControls{ReasoningCapability: cap, ReasoningSelection: config.AIReasoningSelection{Level: level}}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if level == config.AIReasoningLevelOff && result.Reasoning != "" {
				t.Fatal("off produced reasoning")
			}
			if level != config.AIReasoningLevelOff && result.Reasoning == "" {
				t.Fatal("enabled request lost reasoning")
			}
			t.Logf("level=%s reasoning_chars=%d answer_chars=%d", level, len(result.Reasoning), len(result.Text))
		})
	}
}
