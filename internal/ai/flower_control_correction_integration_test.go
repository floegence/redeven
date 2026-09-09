package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestFlowerDeepSeekCorrectsStringArrayBeforeShowingQuestion(t *testing.T) {
	for _, exhaust := range []bool{false, true} {
		t.Run(fmt.Sprintf("exhaust=%t", exhaust), func(t *testing.T) {
			const valid = `{"reason_code":"missing_external_input","required_from_user":["Choose a device."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Device","question":"Which device should I inspect?","response_mode":"write","is_secret":false,"write_label":"Device","write_placeholder":"Type a device"}]}`
			invalid := strings.Replace(valid, `"required_from_user":["Choose a device."]`, `"required_from_user":"[\"Choose a device.\"]"`, 1)
			var calls atomic.Int32
			correctionStarted := make(chan struct{})
			releaseCorrection := make(chan struct{})
			defer close(releaseCorrection)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if len(extractOpenAIToolNames(request)) == 0 {
					writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Device question")
					return
				}
				count := calls.Add(1)
				if count >= 2 {
					raw, _ := json.Marshal(request["input"])
					if !requestContainsPairedToolHistory(request, "ask_user") || !strings.Contains(string(raw), "required_from_user must be an array") {
						t.Errorf("request %d lost rejected call or validation result: %s", count, raw)
					}
				}
				if count == 2 {
					close(correctionStarted)
					select {
					case <-releaseCorrection:
					case <-r.Context().Done():
						return
					}
				}
				if count > 3 || (!exhaust && count >= 3) {
					writeDeepSeekIntegrationTextResponse(w, flusher, "accepted", "Device accepted.")
					return
				}
				args := invalid
				if count == 2 && !exhaust {
					args = valid
				}
				output := []any{}
				if count == 1 {
					output = append(output, map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "I need one device detail."}}})
				}
				callID := fmt.Sprintf("ask-%d", count)
				output = append(output, map[string]any{"type": "function_call", "id": "item-" + callID, "call_id": callID, "name": "ask_user", "arguments": args})
				writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", count), "status": "completed", "output": output}})
			}))
			t.Cleanup(provider.Close)
			stateDir := t.TempDir()
			meta := &session.Meta{EndpointID: "env_question", ChannelID: "channel", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
				Config:         &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: provider.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}},
				RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second, ResolveProviderAPIKey: func(string) (string, bool, error) { return "test-key", true, nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			thread, err := svc.CreateThread(t.Context(), meta, "", "deepseek/deepseek-v4-flash", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "question", ThreadID: thread.ThreadID, Input: RunInput{Text: "Inspect the device."}}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-correctionStarted:
			case <-time.After(5 * time.Second):
				t.Fatal("no correction request")
			}
			during, err := svc.GetThread(t.Context(), meta, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if during.RunStatus != "running" || during.WaitingPrompt != nil || during.RunErrorCode != "" {
				t.Fatalf("invalid question interrupted execution: %#v", during)
			}
			releaseCorrection <- struct{}{}
			settled := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "waiting_user" || view.RunStatus == "failed" })
			detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(detail.Current.Items)
			if strings.Contains(string(raw), "required_from_user must be an array") {
				t.Fatalf("technical correction leaked into UI: %s", raw)
			}
			if !strings.Contains(string(raw), "I need one device detail.") {
				t.Fatalf("generated text was lost: %s", raw)
			}
			if exhaust {
				if calls.Load() != 3 || settled.RunStatus != "failed" || settled.RunErrorCode != runErrorCodeFloretControlContract || settled.WaitingPrompt != nil {
					t.Fatalf("correction budget/result: calls=%d view=%#v", calls.Load(), settled)
				}
				return
			}
			if calls.Load() != 2 || settled.WaitingPrompt == nil || settled.WaitingPrompt.Questions[0].ID != "target" {
				t.Fatalf("corrected question missing: %#v", settled)
			}
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: settled.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "udesk26"}}}}); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "followup", ThreadID: thread.ThreadID, Input: RunInput{Text: "Continue."}}); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" && calls.Load() == 4 })
		})
	}
}
