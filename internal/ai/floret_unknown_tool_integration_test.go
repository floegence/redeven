package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestRedevenDeepSeekUnknownToolReturnsErrorAndContinues(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	var sawUnknownToolResult atomic.Bool
	var sawHistoricalUnknownToolPair atomic.Bool
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)

		toolNames := extractOpenAIToolNames(request)
		if len(toolNames) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "chat_title", "Weather research")
			return
		}
		if slices.Contains(toolNames, "web_search") || slices.Contains(toolNames, "web_search_tool") {
			t.Fatalf("request unexpectedly registered a search tool: %v", toolNames)
		}
		if !slices.Contains(toolNames, "web_fetch") {
			t.Fatalf("request tools=%v, want incident-shaped web_fetch surface", toolNames)
		}

		switch mainCalls.Add(1) {
		case 1:
			writeDeepSeekIntegrationToolCall(w, flusher, "chat_unknown", "call_unknown", "web_search", `{"query":"weather projects"}`)
		case 2:
			messages, _ := request["messages"].([]any)
			rawMessages, _ := json.Marshal(messages)
			if !strings.Contains(string(rawMessages), `"name":"web_search"`) {
				t.Fatalf("continuation omitted unknown assistant tool call: %s", rawMessages)
			}
			if !strings.Contains(string(rawMessages), "unavailable in the current version") || !strings.Contains(string(rawMessages), "web_search") {
				t.Fatalf("continuation omitted Floret unknown-tool result: %s", rawMessages)
			}
			sawUnknownToolResult.Store(true)
			writeDeepSeekIntegrationTextResponse(w, flusher, "chat_recovered", "Recovered with the available tools.")
		case 3:
			if requestContainsPairedToolHistory(request, "web_search") {
				sawHistoricalUnknownToolPair.Store(true)
			}
			writeDeepSeekIntegrationTextResponse(w, flusher, "chat_history", "Historical tool activity remains readable.")
		default:
			t.Fatalf("unexpected main provider request %d", mainCalls.Load())
		}
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_unknown_tool", ChannelID: "channel_unknown_tool",
		NamespacePublicID: "namespace_unknown_tool", UserPublicID: "user_unknown_tool", UserEmail: "unknown-tool@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "deepseek/deepseek-v4-flash",
			Providers: []config.AIProvider{{
				ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}},
			}},
		},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	thread, err := svc.CreateThread(context.Background(), meta, "", "deepseek/deepseek-v4-flash", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	start, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ClientRequestID: "request-unknown-tool-start",
		ThreadID:        thread.ThreadID,
		Model:           "deepseek/deepseek-v4-flash",
		Input:           RunInput{Text: "Find a maintained weather project."},
		Options: RunOptions{
			PermissionType: config.AIPermissionFullAccess,
			ToolAllowlist:  []string{"web_fetch"},
		},
	})
	if err != nil || start.Kind != "start" {
		t.Fatalf("SendUserTurn response=%#v err=%v", start, err)
	}

	completed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "success"
	})
	if strings.TrimSpace(completed.RunErrorCode) != "" || strings.TrimSpace(completed.RunError) != "" {
		t.Fatalf("completed thread retained failure presentation: %#v", completed)
	}
	if !strings.Contains(completed.LastMessagePreview, "Recovered") {
		t.Fatalf("last message preview=%q, want recovered assistant response", completed.LastMessagePreview)
	}
	if mainCalls.Load() != 2 || !sawUnknownToolResult.Load() {
		t.Fatalf("main_calls=%d saw_unknown_result=%t, want one recovery continuation", mainCalls.Load(), sawUnknownToolResult.Load())
	}
	detail, err := svc.GetFlowerThreadDetail(context.Background(), meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadDetail after unavailable tool: %v", err)
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal Flower detail: %v", err)
	}
	if strings.Contains(string(detailJSON), "weather projects") {
		t.Fatalf("neutral unknown-tool activity leaked historical arguments: %s", detailJSON)
	}

	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ClientRequestID: "request-unknown-tool-history",
		ThreadID:        thread.ThreadID,
		Model:           "deepseek/deepseek-v4-flash",
		Input:           RunInput{Text: "Continue using only tools available in this version."},
		Options: RunOptions{
			PermissionType: config.AIPermissionFullAccess,
			ToolAllowlist:  []string{"web_fetch"},
		},
	}); err != nil {
		t.Fatalf("SendUserTurn after unavailable historical tool: %v", err)
	}
	continued := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "failed" ||
			(strings.TrimSpace(view.RunStatus) == "success" && strings.Contains(view.LastMessagePreview, "Historical tool activity"))
	})
	if continued.RunStatus == "failed" {
		failedDetail, detailErr := svc.GetFlowerThreadDetail(context.Background(), meta, thread.ThreadID)
		failedJSON, _ := json.Marshal(failedDetail)
		failure := (*flruntime.ThreadTurnFailure)(nil)
		if failedDetail != nil {
			failure = failedDetail.Current.Failure
		}
		t.Fatalf("new Turn with unavailable tool history failed before/after provider call %d: failure=%#v detail=%s err=%v", mainCalls.Load(), failure, failedJSON, detailErr)
	}
	if mainCalls.Load() != 3 || !sawHistoricalUnknownToolPair.Load() {
		t.Fatalf("main_calls=%d historical_unknown_pair=%t", mainCalls.Load(), sawHistoricalUnknownToolPair.Load())
	}
}

func writeDeepSeekIntegrationToolCall(w http.ResponseWriter, flusher http.Flusher, responseID string, callID string, name string, args string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-flash",
		"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{
			"role": "assistant", "tool_calls": []any{map[string]any{
				"index": 0, "id": callID, "type": "function", "function": map[string]any{"name": name, "arguments": args},
			}},
		}}},
	})
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-flash",
		"choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "delta": map[string]any{}}},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeDeepSeekIntegrationTextResponse(w http.ResponseWriter, flusher http.Flusher, responseID string, text string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-flash",
		"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{"role": "assistant", "content": text}}},
	})
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"id": responseID, "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-flash",
		"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "delta": map[string]any{}}},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}
