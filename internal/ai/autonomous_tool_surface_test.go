package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestBuiltinCapabilitiesRespectFinalRunPolicy(t *testing.T) {
	for _, tc := range []struct {
		name      string
		options   RunOptions
		ask, goal bool
	}{
		{name: "interactive", ask: true, goal: true},
		{name: "no_user_input", options: RunOptions{NoUserInteraction: true}, goal: true},
		{name: "bounded_tools", options: RunOptions{ToolAllowlist: []string{"file_read"}}},
		{name: "explicit_controls", options: RunOptions{ToolAllowlist: []string{"user_ask", "goal_manage"}}, ask: true, goal: true},
		{name: "disabled_input_overrides_allowlist", options: RunOptions{NoUserInteraction: true, ToolAllowlist: []string{"user_ask", "goal_manage"}}, goal: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var requests [][]string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if raw, ok := body["tools"].([]any); ok {
					names := []string{}
					for _, item := range raw {
						tool := item.(map[string]any)
						name, _ := tool["name"].(string)
						if f, ok := tool["function"].(map[string]any); ok {
							name, _ = f["name"].(string)
						}
						names = append(names, name)
					}
					mu.Lock()
					requests = append(requests, names)
					mu.Unlock()
				}
				w.Header().Set("Content-Type", "text/event-stream")
				writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Complete.")
			}))
			defer server.Close()
			opts := encodingIntegrationOptions(t, server.URL, nil)
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer svc.Close()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Tool policy", "openai/gpt-5-mini", config.AIPermissionFullAccess, opts.AgentHomeDir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "policy", Input: RunInput{Text: "Reply Complete."}, Options: tc.options}); err != nil {
				t.Fatal(err)
			}
			final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.RunStatus == "success" || v.RunStatus == "failed" || v.RunStatus == "waiting_user"
			})
			if final.RunStatus != "success" {
				t.Fatalf("run status=%s", final.RunStatus)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(requests) == 0 {
				t.Fatal("missing final provider request")
			}
			for _, names := range requests {
				if slices.Contains(names, "user_ask") != tc.ask || slices.Contains(names, "goal_manage") != tc.goal {
					t.Fatalf("controls=%v want ask=%v goal=%v", names, tc.ask, tc.goal)
				}
				if len(tc.options.ToolAllowlist) > 0 {
					for _, name := range names {
						if !slices.Contains(tc.options.ToolAllowlist, name) {
							t.Fatalf("ungranted tool %s", name)
						}
					}
				}
			}
		})
	}
}
