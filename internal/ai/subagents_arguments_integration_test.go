package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestFlowerSubagentArgumentsCorrectBeforeActivityAndSurviveRestart(t *testing.T) {
	for _, tc := range []struct{ action, field, extra string }{
		{"spawn", "task_name", ""}, {"send_input", "target", ""}, {"close", "target", ""},
		{"status", "target or ids", ""}, {"inspect", "target or ids", ""}, {"wait", "ids", ""},
		{"close_all", "ids", `,"ids":["only-this-child"],"limit":1`},
		{"close_all", "current_thread", `,"scope":"current_run"`},
	} {
		t.Run(tc.action, func(t *testing.T) {
			var calls atomic.Int32
			var corrected, history atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if len(extractOpenAIToolNames(request)) == 0 {
					writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Argument correction")
					return
				}
				switch calls.Add(1) {
				case 1:
					args := []byte(`{"action":"` + tc.action + `"` + tc.extra + `}`)
					writeDeepSeekIntegrationToolCall(w, flusher, "invalid-response", "invalid-input", "subagents", string(args))
				case 2:
					raw, _ := json.Marshal(request["input"])
					corrected.Store(requestContainsPairedToolHistory(request, "subagents") && strings.Contains(string(raw), "not executed") && strings.Contains(string(raw), tc.field))
					writeDeepSeekIntegrationToolCall(w, flusher, "valid-response", "valid-list", "subagents", `{"action":"list"}`)
				case 3:
					raw, _ := json.Marshal(request["input"])
					if !strings.Contains(string(raw), "valid-list") || !strings.Contains(string(raw), "total") {
						t.Errorf("valid list result missing: %s", raw)
					}
					writeDeepSeekIntegrationTextResponse(w, flusher, "complete", "Arguments corrected; inventory inspected.")
				case 4:
					raw, _ := json.Marshal(request["input"])
					history.Store(requestContainsPairedToolHistory(request, "subagents") && strings.Contains(string(raw), "invalid-input") && strings.Contains(string(raw), "not executed"))
					writeDeepSeekIntegrationTextResponse(w, flusher, "history", "History remains usable.")
				default:
					t.Errorf("unexpected provider call %d", calls.Load())
					writeDeepSeekIntegrationTextResponse(w, flusher, "unexpected", "Unexpected request.")
				}
			}))
			defer server.Close()
			opts := encodingIntegrationOptions(t, server.URL, nil)
			opts.Config = &config.AIConfig{CurrentModelID: "openai/deepseek-flash", Providers: []config.AIProvider{{ID: "openai", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-flash"}}}}}
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Argument correction", "openai/deepseek-flash", config.AIPermissionFullAccess, opts.AgentHomeDir)
			if err != nil {
				t.Fatal(err)
			}
			send := func(key, text string) {
				t.Helper()
				_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: key, Input: RunInput{Text: text}, Options: RunOptions{ToolAllowlist: []string{"subagents"}}})
				if err != nil {
					t.Fatal(err)
				}
			}
			send("correct", "Inspect the child inventory.")
			final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.RunStatus == "success" || v.RunStatus == "failed" || v.RunStatus == "waiting_user"
			})
			if final.RunStatus != "success" || calls.Load() != 3 || !corrected.Load() {
				t.Fatalf("status=%s calls=%d correction=%v error=%s", final.RunStatus, calls.Load(), corrected.Load(), final.RunError)
			}
			check := func() {
				t.Helper()
				detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				valid, final := false, false
				for _, item := range detail.Current.Items {
					if item.Activity != nil {
						if item.Activity.ToolID == "invalid-input" {
							t.Fatal("rejected input became actionable Activity")
						}
						valid = valid || item.Activity.ToolID == "valid-list"
					}
					final = final || item.Text == "Arguments corrected; inventory inspected."
				}
				parentID := identity.ThreadID(thread.ThreadID)
				children, err := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{ParentID: &parentID})
				if err != nil || len(children) != 0 || !valid || !final {
					t.Fatalf("children=%d valid=%v final=%v err=%v", len(children), valid, final, err)
				}
			}
			check()
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			check()
			if calls.Load() != 3 {
				t.Fatal("restart executed provider")
			}
			send("history", "Continue from the saved result.")
			continued := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.RunStatus == "failed" || v.RunStatus == "success" && strings.Contains(v.LastMessagePreview, "History remains usable")
			})
			if continued.RunStatus != "success" || calls.Load() != 4 || !history.Load() {
				t.Fatalf("continued=%s calls=%d history=%v", continued.RunStatus, calls.Load(), history.Load())
			}
		})
	}
}
