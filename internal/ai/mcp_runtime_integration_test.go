package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPRuntimeExecutionAndUnknownOutcome(t *testing.T) {
	for _, outcome := range []string{"success", "tool_error", "transport_error"} {
		t.Run(outcome, func(t *testing.T) {
			var calls, providerCalls atomic.Int32
			server := mcp.NewServer(&mcp.Implementation{Name: "runtime-fixture", Version: "1"}, nil)
			mcp.AddTool(server, &mcp.Tool{Name: "lookup", Description: "Look up a record by its target ID"}, func(_ context.Context, _ *mcp.CallToolRequest, input struct {
				TargetID string `json:"target_id"`
			}) (*mcp.CallToolResult, any, error) {
				calls.Add(1)
				return &mcp.CallToolResult{IsError: outcome == "tool_error", Content: []mcp.Content{&mcp.TextContent{Text: "fixture:" + input.TargetID}}}, nil, nil
			})
			handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
			mcpHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				raw, _ := io.ReadAll(req.Body)
				req.Body = io.NopCloser(bytes.NewReader(raw))
				var message struct {
					Method string `json:"method"`
				}
				_ = json.Unmarshal(raw, &message)
				if outcome == "transport_error" && message.Method == "tools/call" {
					calls.Add(1)
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					_ = conn.Close()
					return
				}
				handler.ServeHTTP(w, req)
			}))
			defer mcpHTTP.Close()
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil {
					t.Error("invalid provider request")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flush := w.(http.Flusher)
				var mcpName string
				for _, raw := range toAnySlice(body["tools"]) {
					tool, _ := raw.(map[string]any)
					name := anyToString(tool["name"])
					if strings.HasPrefix(name, "mcp_") {
						mcpName = name
					}
				}
				if mcpName == "" {
					writeAskUserIntegrationTextResponse(w, flush, "title", "MCP fixture")
					return
				}
				if providerCalls.Add(1) == 1 {
					item := map[string]any{"type": "function_call", "id": "mcp-fixture", "call_id": "mcp-fixture", "name": mcpName, "arguments": `{"target_id":"record-42"}`}
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeAskUserIntegrationCompletedResponse(w, flush, "invoke")
					return
				}
				outputs := collectOpenAIFunctionOutputs(body["input"])
				if len(outputs) != 1 || !strings.Contains(outputs[0].Output, "fixture:record-42") {
					t.Errorf("MCP output lost: %+v", outputs)
				}
				writeAskUserIntegrationTextResponse(w, flush, "done", "The tool result is available.")
			}))
			defer provider.Close()
			dir := t.TempDir()
			svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			if _, err = svc.SaveMCPServer(t.Context(), MCPServerInput{ID: "fixture", Name: "Fixture tools", Transport: "http", URL: mcpHTTP.URL, Enabled: true}); err != nil {
				t.Fatal(err)
			}
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "MCP fixture", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err = svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			terminal, err := runTypedTurnForTest(t, t.Context(), svc, meta, "mcp-fixture", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Look up record-42 once."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
			if calls.Load() != 1 {
				t.Fatalf("MCP effect calls=%d, error=%v failure=%+v", calls.Load(), err, terminal.Failure)
			}
			if outcome == "transport_error" {
				if err == nil || terminal.Failure == nil || terminal.Failure.Code != flruntime.ThreadTurnFailureEffectOutcomeUnknown || providerCalls.Load() != 1 {
					t.Fatalf("unknown result escaped terminal boundary: %+v err=%v calls=%d", terminal.Failure, err, providerCalls.Load())
				}
				if _, err := svc.threadRuntime.Retry(t.Context(), flruntime.RetryInput{ThreadID: terminal.ThreadID, SourceTurnID: terminal.TurnID, RequestKey: "no-retry"}); !errors.Is(err, flruntime.ErrEffectOutcomeUnknown) {
					t.Fatalf("unknown effect retry accepted: %v", err)
				}
			} else if err != nil || providerCalls.Load() != 2 {
				t.Fatalf("MCP execution: %v failure=%+v calls=%d", err, terminal.Failure, providerCalls.Load())
			}
		})
	}
}
