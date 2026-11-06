package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestLocalToolFeedbackThroughProviderAndRestart(t *testing.T) {
	for _, scenario := range []string{"missing", "ambiguous", "directory conflict"} {
		t.Run(scenario, func(t *testing.T) {
			workspace := t.TempDir()
			sub := filepath.Join(workspace, "sub")
			if err := os.Mkdir(sub, 0o755); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(workspace, "edit.txt")
			const original = "alpha\nbeta\nalpha\n"
			if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
				t.Fatal(err)
			}
			tool, code := "file.edit", "INVALID_ARGUMENTS"
			failed := map[string]any{"file_path": "edit.txt", "old_string": "missing", "new_string": "omega"}
			corrected := map[string]any{"file_path": "edit.txt", "old_string": "alpha\nbeta", "new_string": "omega\nbeta"}
			wantMeta := map[string]any{"reason": "old_string_not_found", "match_count": float64(0), "file_modified": false}
			if scenario == "ambiguous" {
				failed["old_string"] = "alpha"
				wantMeta["reason"], wantMeta["match_count"] = "old_string_ambiguous", float64(2)
			} else if scenario == "directory conflict" {
				tool, code = "terminal.exec", "INVALID_PATH"
				command := "printf accepted >> marker.txt; pwd -P"
				failed = map[string]any{"command": command, "cwd": ".", "workdir": "sub"}
				corrected = map[string]any{"command": command, "cwd": "./sub", "workdir": sub}
				wantMeta = map[string]any{"reason": "conflicting_working_directories", "process_started": false}
			}
			assertFailure := func(payload map[string]any) {
				t.Helper()
				diagnostic, _ := payload["error"].(map[string]any)
				if payload["status"] != "error" || diagnostic["code"] != code || diagnostic["retryable"] != false || !reflect.DeepEqual(diagnostic["meta"], wantMeta) {
					t.Errorf("failure facts lost: %+v", payload)
				}
			}
			var requests atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if defs, _ := body["tools"].([]any); len(defs) > 0 {
					switch requests.Add(1) {
					case 1:
						args, _ := json.Marshal(failed)
						writeEncodingIntegrationCall(w, openAIWireToolName(tool), "rejected", string(args))
						return
					case 2:
						assertFailure(localFeedbackWireResult(t, body, "rejected"))
						if data, err := os.ReadFile(path); err != nil || string(data) != original {
							t.Errorf("failure modified file: %q, %v", data, err)
						}
						for _, dir := range []string{workspace, sub} {
							if _, err := os.Stat(filepath.Join(dir, "marker.txt")); !os.IsNotExist(err) {
								t.Errorf("rejected command created a marker: %v", err)
							}
						}
						args, _ := json.Marshal(corrected)
						writeEncodingIntegrationCall(w, openAIWireToolName(tool), "corrected", string(args))
						return
					case 3:
						output := localFeedbackWireResult(t, body, "corrected")
						if output["status"] != "success" {
							t.Errorf("explicit correction failed: %+v", output)
						}
						if tool == "terminal.exec" {
							data, _ := output["data"].(map[string]any)
							want, _ := filepath.EvalSymlinks(sub)
							if data["completed"] != true || data["exit_code"] != float64(0) || strings.TrimSpace(anyToString(data["output"])) != want {
								t.Errorf("PTY ran outside the selected directory: %+v", data)
							}
						}
					default:
						t.Error("unexpected dispatch after explicit correction")
					}
				}
				writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Correction verified.")
			}))
			defer provider.Close()
			opts := encodingIntegrationOptions(t, provider.URL, nil)
			opts.AgentHomeDir = workspace
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "local tool feedback", "openai/gpt-5-mini", config.AIPermissionFullAccess, workspace)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "feedback", Input: RunInput{Text: "Make the requested change and verify it."}, Options: RunOptions{ToolAllowlist: []string{tool}, PermissionType: config.AIPermissionFullAccess}}); err != nil {
				t.Fatal(err)
			}
			final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool {
				return v.RunStatus == "success" || v.RunStatus == "failed" || v.RunStatus == "waiting_user"
			})
			if final.RunStatus != "success" || final.WaitingPrompt != nil || requests.Load() != 3 {
				t.Fatalf("correction did not finish: status=%s requests=%d", final.RunStatus, requests.Load())
			}
			for _, restarted := range []bool{false, true} {
				if restarted {
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
				canonical, found, err := svc.threadRuntime.(flruntime.ThreadToolResultReader).LookupToolResult(t.Context(), flruntime.LookupToolResultInput{ThreadID: view.ThreadID, TurnID: view.TurnID, RunID: view.RunID, ToolCallID: "rejected"})
				if err != nil || !found {
					t.Fatalf("canonical failure missing: %v", err)
				}
				var payload map[string]any
				if err := json.Unmarshal([]byte(strings.TrimPrefix(canonical.Content, "ERROR: ")), &payload); err != nil {
					t.Fatal(err)
				}
				assertFailure(payload)
				foundActivity := false
				for _, item := range view.Items {
					if item.Activity != nil && item.Activity.ToolID == "rejected" {
						raw, err := json.Marshal(item.Activity)
						message, _ := json.Marshal(payload["error"].(map[string]any)["message"])
						if err != nil || !strings.Contains(string(raw), string(message)) || !strings.Contains(string(raw), code) {
							t.Fatalf("Activity diagnostic lost after restart=%t: %s, %v", restarted, raw, err)
						}
						foundActivity = true
					}
				}
				if !foundActivity || requests.Load() != 3 {
					t.Fatal("restart lost Activity or dispatched the provider")
				}
			}
			if tool == "file.edit" {
				if got, err := os.ReadFile(path); err != nil || string(got) != "omega\nbeta\nalpha\n" {
					t.Fatalf("correction widened replacement scope: %q, %v", got, err)
				}
			} else if got, err := os.ReadFile(filepath.Join(sub, "marker.txt")); err != nil || string(got) != "accepted" {
				t.Fatalf("corrected command did not run: %q, %v", got, err)
			}
		})
	}
}

func localFeedbackWireResult(t *testing.T, request map[string]any, callID string) map[string]any {
	t.Helper()
	input, _ := request["input"].([]any)
	for _, raw := range input {
		item, _ := raw.(map[string]any)
		if item["type"] != "function_call_output" || item["call_id"] != callID {
			continue
		}
		output, _ := item["output"].(string)
		// Published Floret prefixes failed tool text before canonical persistence
		// and provider rendering; the host JSON envelope follows unchanged.
		output = strings.TrimPrefix(output, "ERROR: ")
		var payload map[string]any
		if err := json.Unmarshal([]byte(output), &payload); err != nil {
			t.Errorf("invalid tool output: %q, %v", output, err)
		}
		return payload
	}
	t.Errorf("provider request omitted result for %s", callID)
	return nil
}
