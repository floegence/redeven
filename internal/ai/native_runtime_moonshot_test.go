package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMoonshotProvider_StreamTurn_TextResponse(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method=%s, want POST", r.Method)
		}
		if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
			t.Fatalf("path=%s, want /chat/completions", r.URL.Path)
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "Bearer sk-test" {
			t.Fatalf("authorization=%q, want Bearer sk-test", got)
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if strings.TrimSpace(reqString(req, "model")) != "kimi-k2.5" {
			t.Fatalf("model=%q, want kimi-k2.5", reqString(req, "model"))
		}
		if !anyBool(req["stream"]) {
			t.Fatalf("stream=%v, want true", req["stream"])
		}

		f, ok := w.(http.Flusher)
		if !ok {
			t.Fatalf("response writer does not support flushing")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.5",
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
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"content": "MOON",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"content": "SHOT_OK",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": "stop",
					"delta":         map[string]any{},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.5",
			"choices": []any{},
			"usage": map[string]any{
				"prompt_tokens":     10,
				"completion_tokens": 3,
				"total_tokens":      13,
				"completion_tokens_details": map[string]any{
					"reasoning_tokens": 2,
				},
			},
		})
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("moonshot", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	events := make([]StreamEvent, 0, 4)
	result, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: "kimi-k2.5",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}},
		},
		Budgets: TurnBudgets{MaxOutputToken: 128},
	}, func(event StreamEvent) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if result.Text != "MOONSHOT_OK" {
		t.Fatalf("text=%q, want MOONSHOT_OK", result.Text)
	}
	if result.FinishReason != "stop" {
		t.Fatalf("finish_reason=%q, want stop", result.FinishReason)
	}
	if len(result.ToolCalls) != 0 {
		t.Fatalf("tool_calls=%d, want 0", len(result.ToolCalls))
	}
	if result.Usage.InputTokens != 10 || result.Usage.OutputTokens != 3 || result.Usage.ReasoningTokens != 2 {
		t.Fatalf("usage=%+v, want prompt=10 completion=3 reasoning=2", result.Usage)
	}

	if countStreamEvent(events, StreamEventTextDelta) != 2 {
		t.Fatalf("text delta count=%d, want 2", countStreamEvent(events, StreamEventTextDelta))
	}
	if !containsStreamEvent(events, StreamEventFinishReason) {
		t.Fatalf("missing finish reason event")
	}
	if got := strings.Join(streamEventTexts(events, StreamEventTextDelta), ""); got != "MOONSHOT_OK" {
		t.Fatalf("text deltas=%q, want MOONSHOT_OK", got)
	}
}

func TestMoonshotProvider_Turn_ToolCallResponse(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
			t.Fatalf("path=%s, want /chat/completions", r.URL.Path)
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "Bearer sk-test" {
			t.Fatalf("authorization=%q, want Bearer sk-test", got)
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if strings.TrimSpace(reqString(req, "model")) != "kimi-k2.5" {
			t.Fatalf("model=%q, want kimi-k2.5", reqString(req, "model"))
		}
		if got := extractOpenAIToolNames(req); len(got) != 1 || got[0] != structuredClassifierInteractionContractToolName {
			t.Fatalf("tool_names=%v, want [%s]", got, structuredClassifierInteractionContractToolName)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "chatcmpl_turn_tool_1",
			"object":  "chat.completion",
			"created": 125,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": "tool_calls",
					"message": map[string]any{
						"role":              "assistant",
						"content":           "",
						"reasoning_content": "Use the tool payload as the classifier result.",
						"tool_calls": []any{
							map[string]any{
								"id":   "emit_interaction_contract:0",
								"type": "function",
								"function": map[string]any{
									"name":      structuredClassifierInteractionContractToolName,
									"arguments": `{"enabled":true,"reason":"guided_option_interaction","single_question_per_turn":true,"fixed_choices_required":true,"open_text_fallback_required":true,"indirect_questions_only":true,"confidence":0.95}`,
								},
							},
						},
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     20,
				"completion_tokens": 12,
				"total_tokens":      32,
				"completion_tokens_details": map[string]any{
					"reasoning_tokens": 4,
				},
			},
		})
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("moonshot", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	direct, ok := provider.(directTurnProvider)
	if !ok {
		t.Fatalf("provider does not implement directTurnProvider")
	}

	result, err := direct.Turn(context.Background(), TurnRequest{
		Model: "kimi-k2.5",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "classify this objective"}}},
		},
		Tools: []ToolDef{interactionContractClassifierToolDef()},
	})
	if err != nil {
		t.Fatalf("Turn: %v", err)
	}
	if result.FinishReason != "tool_calls" {
		t.Fatalf("finish_reason=%q, want tool_calls", result.FinishReason)
	}
	if strings.TrimSpace(result.Reasoning) != "Use the tool payload as the classifier result." {
		t.Fatalf("reasoning=%q", result.Reasoning)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("tool_calls=%d, want 1", len(result.ToolCalls))
	}
	if result.ToolCalls[0].Name != structuredClassifierInteractionContractToolName {
		t.Fatalf("tool_name=%q, want %q", result.ToolCalls[0].Name, structuredClassifierInteractionContractToolName)
	}
	if got := anyBool(result.ToolCalls[0].Args["enabled"]); !got {
		t.Fatalf("tool_args=%v, want enabled=true", result.ToolCalls[0].Args)
	}
}

func TestMoonshotProvider_StreamTurn_PreservesReasoningFragmentWhitespace(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
			t.Fatalf("path=%s, want /chat/completions", r.URL.Path)
		}

		f, ok := w.(http.Flusher)
		if !ok {
			t.Fatalf("response writer does not support flushing")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_reasoning_spacing_1",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"role":              "assistant",
						"reasoning_content": "Let",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_reasoning_spacing_1",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"reasoning_content": " me",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_reasoning_spacing_1",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"reasoning_content": " think clearly.",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_reasoning_spacing_1",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": "stop",
					"delta":         map[string]any{},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_reasoning_spacing_1",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{},
			"usage": map[string]any{
				"prompt_tokens":     14,
				"completion_tokens": 4,
				"total_tokens":      18,
				"completion_tokens_details": map[string]any{
					"reasoning_tokens": 3,
				},
			},
		})
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("moonshot", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	events := make([]StreamEvent, 0, 5)
	result, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: "kimi-k2.5",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "think out loud"}}},
		},
	}, func(event StreamEvent) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}

	if result.Reasoning != "Let me think clearly." {
		t.Fatalf("reasoning=%q, want %q", result.Reasoning, "Let me think clearly.")
	}
	if got := strings.Join(streamEventTexts(events, StreamEventThinkingDelta), ""); got != "Let me think clearly." {
		t.Fatalf("thinking deltas=%q, want %q", got, "Let me think clearly.")
	}
	if countStreamEvent(events, StreamEventThinkingDelta) != 3 {
		t.Fatalf("thinking delta count=%d, want 3", countStreamEvent(events, StreamEventThinkingDelta))
	}
}

func TestMoonshotProvider_StreamTurn_ToolCallAliasRoundTrip(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
			t.Fatalf("path=%s, want /chat/completions", r.URL.Path)
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !anyBool(req["stream"]) {
			t.Fatalf("stream=%v, want true", req["stream"])
		}

		tools, _ := req["tools"].([]any)
		if len(tools) != 1 {
			t.Fatalf("tools=%d, want 1", len(tools))
		}
		tool, _ := tools[0].(map[string]any)
		fn, _ := tool["function"].(map[string]any)
		if got := strings.TrimSpace(anyString(fn["name"])); got != "terminal_exec" {
			t.Fatalf("tool function name=%q, want terminal_exec", got)
		}

		f, ok := w.(http.Flusher)
		if !ok {
			t.Fatalf("response writer does not support flushing")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_2",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"role": "assistant",
						"tool_calls": []any{
							map[string]any{
								"index": 0,
								"id":    "call_1",
								"type":  "function",
								"function": map[string]any{
									"name": "terminal_exec",
								},
							},
						},
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_2",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"tool_calls": []any{
							map[string]any{
								"index": 0,
								"function": map[string]any{
									"arguments": `{"cmd":`,
								},
							},
						},
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_2",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"tool_calls": []any{
							map[string]any{
								"index": 0,
								"function": map[string]any{
									"arguments": `"pwd"}`,
								},
							},
						},
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_2",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": "tool_calls",
					"delta":         map[string]any{},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_2",
			"object":  "chat.completion.chunk",
			"created": 124,
			"model":   "kimi-k2.5",
			"choices": []any{},
			"usage": map[string]any{
				"prompt_tokens":     20,
				"completion_tokens": 5,
				"total_tokens":      25,
			},
		})
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("moonshot", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	events := make([]StreamEvent, 0, 8)
	result, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: "kimi-k2.5",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "run pwd"}}},
		},
		Tools: []ToolDef{
			{
				Name:        "terminal.exec",
				Description: "Run shell command",
				InputSchema: json.RawMessage(`{"type":"object","properties":{"cmd":{"type":"string"}},"required":["cmd"]}`),
			},
		},
	}, func(event StreamEvent) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}

	if result.FinishReason != "tool_calls" {
		t.Fatalf("finish_reason=%q, want tool_calls", result.FinishReason)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("tool_calls=%d, want 1", len(result.ToolCalls))
	}
	call := result.ToolCalls[0]
	if call.ID != "call_1" {
		t.Fatalf("tool_call.id=%q, want call_1", call.ID)
	}
	if call.Name != "terminal.exec" {
		t.Fatalf("tool_call.name=%q, want terminal.exec", call.Name)
	}
	if got := strings.TrimSpace(anyString(call.Args["cmd"])); got != "pwd" {
		t.Fatalf("tool_call.args.cmd=%q, want pwd", got)
	}
	if !containsStreamEvent(events, StreamEventToolCallStart) || !containsStreamEvent(events, StreamEventToolCallEnd) {
		t.Fatalf("missing tool call stream events")
	}
	if countStreamEvent(events, StreamEventToolCallDelta) != 2 {
		t.Fatalf("tool call delta count=%d, want 2", countStreamEvent(events, StreamEventToolCallDelta))
	}
}

func TestMoonshotProvider_StreamTurn_ToolCallHistoryKeepsReasoningContent(t *testing.T) {
	t.Parallel()

	var requestCount atomic.Int32
	const reasoningContent = "I should inspect system metrics before summarizing."

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqIndex := requestCount.Add(1)
		if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
			t.Fatalf("path=%s, want /chat/completions", r.URL.Path)
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		switch reqIndex {
		case 1:
			f, ok := w.(http.Flusher)
			if !ok {
				t.Fatalf("response writer does not support flushing")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_1",
				"object":  "chat.completion.chunk",
				"created": 125,
				"model":   "kimi-k2.5",
				"choices": []any{
					map[string]any{
						"index":         0,
						"finish_reason": nil,
						"delta": map[string]any{
							"role":              "assistant",
							"reasoning_content": reasoningContent,
							"tool_calls": []any{
								map[string]any{
									"index": 0,
									"id":    "call_reasoning_1",
									"type":  "function",
									"function": map[string]any{
										"name":      "terminal_exec",
										"arguments": `{"cmd":"uptime"}`,
									},
								},
							},
						},
					},
				},
			})
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_1",
				"object":  "chat.completion.chunk",
				"created": 125,
				"model":   "kimi-k2.5",
				"choices": []any{
					map[string]any{
						"index":         0,
						"finish_reason": "tool_calls",
						"delta":         map[string]any{},
					},
				},
			})
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_1",
				"object":  "chat.completion.chunk",
				"created": 125,
				"model":   "kimi-k2.5",
				"choices": []any{},
				"usage": map[string]any{
					"prompt_tokens":     30,
					"completion_tokens": 6,
					"total_tokens":      36,
					"completion_tokens_details": map[string]any{
						"reasoning_tokens": 4,
					},
				},
			})
		case 2:
			messages, _ := req["messages"].([]any)
			var assistantWithTool map[string]any
			for _, item := range messages {
				msg, _ := item.(map[string]any)
				if msg == nil {
					continue
				}
				if strings.TrimSpace(anyString(msg["role"])) != "assistant" {
					continue
				}
				if toolCalls, ok := msg["tool_calls"].([]any); ok && len(toolCalls) > 0 {
					assistantWithTool = msg
					break
				}
			}
			if assistantWithTool == nil {
				t.Fatalf("missing assistant tool_call history message")
			}
			gotReasoning := strings.TrimSpace(anyString(assistantWithTool["reasoning_content"]))
			if gotReasoning != reasoningContent {
				t.Fatalf("reasoning_content=%q, want %q", gotReasoning, reasoningContent)
			}

			f, ok := w.(http.Flusher)
			if !ok {
				t.Fatalf("response writer does not support flushing")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_2",
				"object":  "chat.completion.chunk",
				"created": 126,
				"model":   "kimi-k2.5",
				"choices": []any{
					map[string]any{
						"index":         0,
						"finish_reason": nil,
						"delta": map[string]any{
							"role":    "assistant",
							"content": "done",
						},
					},
				},
			})
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_2",
				"object":  "chat.completion.chunk",
				"created": 126,
				"model":   "kimi-k2.5",
				"choices": []any{
					map[string]any{
						"index":         0,
						"finish_reason": "stop",
						"delta":         map[string]any{},
					},
				},
			})
			writeOpenAISSEJSON(w, f, map[string]any{
				"id":      "chatcmpl_reasoning_2",
				"object":  "chat.completion.chunk",
				"created": 126,
				"model":   "kimi-k2.5",
				"choices": []any{},
				"usage": map[string]any{
					"prompt_tokens":     12,
					"completion_tokens": 2,
					"total_tokens":      14,
				},
			})
		default:
			t.Fatalf("unexpected request count=%d", reqIndex)
		}
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("moonshot", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	firstResult, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: "kimi-k2.5",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "check load"}}},
		},
		Tools: []ToolDef{
			{
				Name:        "terminal.exec",
				Description: "Run shell command",
				InputSchema: json.RawMessage(`{"type":"object","properties":{"cmd":{"type":"string"}},"required":["cmd"]}`),
			},
		},
	}, nil)
	if err != nil {
		t.Fatalf("first StreamTurn: %v", err)
	}
	if strings.TrimSpace(firstResult.Reasoning) != reasoningContent {
		t.Fatalf("first reasoning=%q, want %q", firstResult.Reasoning, reasoningContent)
	}
	if len(firstResult.ToolCalls) != 1 {
		t.Fatalf("first tool_calls=%d, want 1", len(firstResult.ToolCalls))
	}

	history := []Message{
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "check load"}}},
	}
	history = append(history, buildToolCallMessages(firstResult.ToolCalls, firstResult.Reasoning)...)
	history = append(history, buildToolResultMessages([]ToolResult{
		{
			ToolID:   firstResult.ToolCalls[0].ID,
			ToolName: firstResult.ToolCalls[0].Name,
			Status:   toolResultStatusSuccess,
			Summary:  "ok",
		},
	}, firstResult.ToolCalls)...)
	history = append(history, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}})

	secondResult, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model:    "kimi-k2.5",
		Messages: history,
	}, nil)
	if err != nil {
		t.Fatalf("second StreamTurn: %v", err)
	}
	if strings.TrimSpace(secondResult.Text) != "done" {
		t.Fatalf("second text=%q, want done", secondResult.Text)
	}
	if requestCount.Load() != 2 {
		t.Fatalf("request_count=%d, want 2", requestCount.Load())
	}
}

func containsStreamEvent(events []StreamEvent, typ StreamEventType) bool {
	for _, event := range events {
		if event.Type == typ {
			return true
		}
	}
	return false
}

func countStreamEvent(events []StreamEvent, typ StreamEventType) int {
	count := 0
	for _, event := range events {
		if event.Type == typ {
			count += 1
		}
	}
	return count
}

func streamEventTexts(events []StreamEvent, typ StreamEventType) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		if event.Type == typ {
			out = append(out, event.Text)
		}
	}
	return out
}

func reqString(req map[string]any, key string) string {
	if req == nil {
		return ""
	}
	return anyString(req[key])
}

func anyString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	default:
		return ""
	}
}

func anyBool(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case fmt.Stringer:
		return strings.EqualFold(strings.TrimSpace(val.String()), "true")
	default:
		return false
	}
}
