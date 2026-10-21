package ai

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestModelContextRefreshAfterConfirmedToolAndSafeRetry(t *testing.T) {
	for _, name := range []string{"refresh", "recover_catalog", "recover_rule_scope"} {
		failCollection := name != "refresh"
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writeContextTestSkill(t, root, "INITIAL_RUNTIME_CATALOG")
			effectPath := filepath.Join(root, "confirmed-effect.txt")
			var mainCalls atomic.Int32
			var requestMu sync.Mutex
			var requests []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				flusher := w.(http.Flusher)
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(200)
				tools, _ := body["tools"].([]any)
				if len(tools) == 0 {
					writeAskUserIntegrationTextResponse(w, flusher, "resp_context_title", "Runtime context")
					return
				}
				instructions, _ := body["instructions"].(string)
				assertPromptContains(t, instructions, flowerIdentityIntroduction)
				for _, catalog := range []string{"INITIAL_RUNTIME_CATALOG", "UPDATED_RUNTIME_CATALOG", "REPAIRED_RUNTIME_CATALOG"} {
					assertPromptNotContains(t, instructions, catalog)
				}
				raw, _ := json.Marshal(body)
				requestMu.Lock()
				requests = append(requests, string(raw))
				requestMu.Unlock()
				switch mainCalls.Add(1) {
				case 1:
					description := "UPDATED_RUNTIME_CATALOG"
					if name == "recover_catalog" {
						description = strings.Repeat("x", 65000)
					}
					writeContextTestSkill(t, root, description)
					if name == "recover_rule_scope" {
						if err := os.WriteFile(filepath.Join(root, ".git"), []byte("corrupt git file"), 0o600); err != nil {
							t.Error(err)
						}
					}
					args, _ := json.Marshal(map[string]any{"command": "printf 'once\n' >> '" + effectPath + "'"})
					item := map[string]any{"type": "function_call", "id": "fc_context_effect", "call_id": "call_context_effect", "name": "terminal_exec", "arguments": string(args)}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeAskUserIntegrationCompletedResponse(w, flusher, "resp_context_effect")
				case 2:
					writeAskUserIntegrationTextResponse(w, flusher, "resp_context_finished", "Confirmed effect and current facts.")
				default:
					http.Error(w, "unexpected logical request", 500)
				}
			}))
			t.Cleanup(server.Close)
			svc, err := NewService(Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: root, AgentHomeDir: root, Shell: "/bin/sh",
				Config:                       &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
				ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Second, FirstOutputTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second}, PersistOpTimeout: 2 * time.Second,
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			svc.skillManager.userHome = root
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Runtime context", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), root)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			terminal, runErr := runTypedTurnForTest(t, t.Context(), svc, meta, "request-context-"+name, RunStartRequest{
				ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Run one effect and inspect current facts."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
			})
			if failCollection {
				if runErr == nil || terminal.Failure == nil || terminal.Failure.Code != runErrorCodeModelContextUnavailable {
					t.Fatalf("failure=%+v err=%v", terminal.Failure, runErr)
				}
				if mainCalls.Load() != 1 {
					t.Fatalf("unadmitted facts reached provider: calls=%d", mainCalls.Load())
				}
				writeContextTestSkill(t, root, "REPAIRED_RUNTIME_CATALOG")
				if name == "recover_rule_scope" {
					if err := os.Remove(filepath.Join(root, ".git")); err != nil {
						t.Fatal(err)
					}
				}
				if _, err := svc.RetryThreadContinuation(t.Context(), meta, thread.ThreadID); err != nil {
					t.Fatal(err)
				}
				waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
			} else if runErr != nil {
				t.Fatalf("failure=%+v err=%v", terminal.Failure, runErr)
			}
			raw, err := os.ReadFile(effectPath)
			if err != nil || string(raw) != "once\n" {
				t.Fatalf("confirmed effect replayed: %q %v", raw, err)
			}
			requestMu.Lock()
			defer requestMu.Unlock()
			if len(requests) != 2 || !strings.Contains(requests[0], "INITIAL_RUNTIME_CATALOG") {
				t.Fatalf("initial requests=%v", requests)
			}
			want := "UPDATED_RUNTIME_CATALOG"
			if failCollection {
				want = "REPAIRED_RUNTIME_CATALOG"
			}
			if !strings.Contains(requests[1], want) {
				t.Fatalf("next logical request did not receive current facts: %s", requests[1])
			}
			view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			projection, err := flowerCurrentContextProjection(view)
			if err != nil || projection.ModelContext == nil || !strings.Contains(modelContextSnapshotText(&projection.ModelContext.Snapshot), want) || projection.ModelContext.UsedByRequestID == "" {
				t.Fatalf("canonical current facts=%+v err=%v", projection.ModelContext, err)
			}
		})
	}
}
