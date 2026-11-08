package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

// Exercise the published engine, final HTTP definitions/results, product policy,
// canonical Activity and restart without launching a shell or requesting approval.
func TestFileReadServiceProviderActivityAndRestart(t *testing.T) {
	for _, mode := range []string{config.AIPermissionReadonly, config.AIPermissionApprovalRequired, config.AIPermissionFullAccess} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "note.txt")
			body := strings.Repeat("content <>& 中文\r\n", 1200)
			if err := os.WriteFile(path, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			calls := []struct{ name, id, args string }{
				{"find", "discover", `{"root":".","name":"*.txt","type":"file"}`},
				{"read_file", "page", `{"path":"note.txt","offset":2,"limit":400}`},
				{"read_files", "batch", `{"paths":["note.txt","missing.txt"],"limit":2}`},
				{"read_file", "tail", `{"path":"note.txt","offset":1200,"limit":400}`},
			}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if defs, _ := request["tools"].([]any); len(defs) > 0 {
					n := int(requests.Add(1))
					seen := map[string]bool{}
					for _, raw := range defs {
						def, _ := raw.(map[string]any)
						seen[anyToString(def["name"])] = true
					}
					for _, name := range []string{"read_file", "read_files", "find"} {
						if !seen[name] {
							t.Errorf("final provider definitions omit %s", name)
						}
					}
					if seen["glob"] {
						t.Error("unexpected duplicate discovery tool")
					}
					if n > 1 {
						call := calls[n-2]
						payload := localFeedbackWireResult(t, request, call.id)
						if payload["status"] != "success" {
							t.Errorf("scoped read failed: %+v", payload)
						}
						data, _ := payload["data"].(map[string]any)
						switch call.id {
						case "discover":
							items, _ := data["results"].([]any)
							if len(items) != 1 {
								t.Errorf("discovery=%+v", data)
							}
						case "page":
							count := int(data["line_count"].(float64))
							if count <= 0 || data["content"] != strings.Repeat("content <>& 中文\r\n", count) || data["next_offset"] != float64(2+count) || data["truncated"] != true || data["eof"] != false {
								t.Errorf("provider page lost content/cursor: %+v", data)
							}
							if _, known := data["total_lines"]; known {
								t.Error("unscanned total asserted as known")
							}
						case "batch":
							files, _ := data["files"].([]any)
							if len(files) != 2 {
								t.Errorf("batch=%+v", data)
								break
							}
							if files[0].(map[string]any)["result"].(map[string]any)["content"] != strings.Repeat("content <>& 中文\r\n", 2) || files[1].(map[string]any)["error"] == nil {
								t.Errorf("batch facts lost: %+v", data)
							}
						case "tail":
							if data["content"] != "content <>& 中文\r\n" || data["total_lines"] != float64(1200) || data["eof"] != true || data["truncated"] != false {
								t.Errorf("tail facts=%+v", data)
							}
						}
					}
					if n <= len(calls) {
						call := calls[n-1]
						writeEncodingIntegrationCall(w, call.name, call.id, call.args)
						return
					}
					if n != len(calls)+1 {
						t.Errorf("unexpected provider request %d", n)
					}
				}
				writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Scoped files inspected.")
			}))
			defer provider.Close()
			opts := encodingIntegrationOptions(t, provider.URL, nil)
			opts.AgentHomeDir = root
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "File inspection", "openai/gpt-5-mini", mode, root)
			if err != nil {
				t.Fatal(err)
			}
			_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "inspect", Input: RunInput{Text: "Read the scoped text files."}})
			if err != nil {
				t.Fatal(err)
			}
			final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.RunStatus == "success" || v.RunStatus == "failed" || v.ApprovalPendingCount > 0
			})
			if final.RunStatus != "success" || final.ApprovalPendingCount != 0 || requests.Load() != 5 {
				t.Fatalf("read required approval or execution: status=%s approvals=%d requests=%d", final.RunStatus, final.ApprovalPendingCount, requests.Load())
			}
			for _, restart := range []bool{false, true} {
				if restart {
					if err := svc.Close(); err != nil {
						t.Fatal(err)
					}
					svc, err = NewService(opts)
					if err != nil {
						t.Fatal(err)
					}
				}
				view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, item := range view.Items {
					if item.Activity == nil || item.Activity.ToolID != "page" {
						continue
					}
					found = true
					if item.Activity.Presentation == nil {
						t.Fatal("missing file Activity")
					}
					payload, ok := item.Activity.Presentation.Payload.(fltools.FileActivityPayload)
					if !ok || payload.LineOffset != 2 || payload.LineCount <= 0 || strings.TrimSpace(payload.Content) != strings.TrimSpace(strings.Repeat("content <>& 中文\r\n", payload.LineCount)) || !payload.Truncated {
						t.Fatalf("Activity page facts lost after restart=%v: %+v", restart, payload)
					}
				}
				canonical, foundResult, err := svc.threadRuntime.(flruntime.ThreadToolResultReader).LookupToolResult(t.Context(), flruntime.LookupToolResultInput{ThreadID: view.ThreadID, TurnID: view.TurnID, RunID: view.RunID, ToolCallID: "page"})
				if err != nil || !foundResult || !strings.Contains(canonical.Content, `"next_offset"`) {
					t.Fatalf("canonical continuation lost: %+v %v", canonical, err)
				}
				if !found || requests.Load() != 5 {
					t.Fatal("Activity missing or restart dispatched provider")
				}
			}
			if current, err := os.ReadFile(path); err != nil || string(current) != body {
				t.Fatal("read changed source bytes")
			}
		})
	}
}
