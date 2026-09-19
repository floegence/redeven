package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/config"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadPermissionCanChangeWhileBusy(t *testing.T) {
	for name, view := range map[string]flruntime.ThreadView{
		"running":  {Activity: flruntime.ThreadActivityActive},
		"queued":   {Activity: flruntime.ThreadActivityIdle, Queue: []flruntime.QueuedInput{{ID: "queued", RequestKey: "queued-request"}}},
		"approval": {Activity: flruntime.ThreadActivityActive, Interactions: []flruntime.ThreadInteraction{{ID: "approval", Kind: flruntime.ThreadInteractionApproval}}},
		"input":    {Activity: flruntime.ThreadActivityActive, Interactions: []flruntime.ThreadInteraction{{ID: "input", Kind: flruntime.ThreadInteractionInput}}},
	} {
		t.Run(name, func(t *testing.T) {
			store := newAuthorityContinuityStore(t)
			meta := &session.Meta{EndpointID: "env", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
			if err := store.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: "thread", EndpointID: "env", PermissionType: "approval_required"}); err != nil {
				t.Fatal(err)
			}
			view.ThreadID = "thread"
			svc := &Service{threadsDB: store, floretEffects: newFloretEffectAdapter(), threadRuntime: &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return view, nil }}}
			if err := svc.SetThreadPermissionType(t.Context(), meta, "thread", "full_access"); err != nil {
				t.Fatalf("change permission while busy: %v", err)
			}
			settings, err := store.GetThreadSettings(t.Context(), "env", "thread")
			if err != nil || settings.PermissionType != "full_access" {
				t.Fatalf("settings=%+v error=%v", settings, err)
			}
		})
	}
}

func TestThreadPermissionFreezesActiveAndQueuedAdmissions(t *testing.T) {
	for _, modes := range [][2]string{{"full_access", "readonly"}, {"approval_required", "full_access"}} {
		t.Run(modes[0]+"_to_"+modes[1], func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var unblock sync.Once
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				tools, _ := request["tools"].([]any)
				if len(tools) == 0 {
					writeAskUserIntegrationTextResponse(w, flusher, "title", "Permission admissions")
					return
				}
				n := calls.Add(1)
				mode := modes[0]
				if n >= 4 {
					mode = modes[1]
				}
				assertPermissionProviderSurface(t, request, mode)
				switch n {
				case 1:
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
					item := map[string]any{"type": "function_call", "id": "effect", "call_id": "effect", "name": "terminal_exec", "arguments": `{"command":"printf frozen-permission"}`}
					for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
						writeOpenAISSEJSON(w, flusher, map[string]any{"type": event, "output_index": 0, "item": item})
					}
					writeAskUserIntegrationCompletedResponse(w, flusher, "effect-response")
				case 2:
					outputs := collectOpenAIFunctionOutputs(request["input"])
					if len(outputs) != 1 || !strings.Contains(outputs[0].Output, "frozen-permission") {
						t.Errorf("admitted effect did not execute: %+v", outputs)
					}
					writeAskUserIntegrationTextResponse(w, flusher, "done", "First turn completed.")
				default:
					writeAskUserIntegrationTextResponse(w, flusher, fmt.Sprintf("done-%d", n), "Queued or new turn completed.")
				}
			}))
			defer provider.Close()
			stateDir := t.TempDir()
			svc, err := NewService(Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
				Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "test-key", true, nil },
				RunMaxWallTime:        10 * time.Second, RunIdleTimeout: 10 * time.Second, PersistOpTimeout: 2 * time.Second,
			})
			if err != nil {
				t.Fatal(err)
			}
			defer svc.Close()
			defer unblock.Do(func() { close(release) })
			meta := &session.Meta{EndpointID: "permission-env", NamespacePublicID: "ns", UserPublicID: "user", ChannelID: "channel", CanRead: true, CanWrite: true, CanExecute: true}
			created, err := svc.CreateThread(t.Context(), meta, "Permissions", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, created.ThreadID, modes[0]); err != nil {
				t.Fatal(err)
			}
			send := func(key string) SendUserTurnResponse {
				t.Helper()
				response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: created.ThreadID, ClientRequestID: key, Input: RunInput{Text: key}})
				if err != nil {
					t.Fatal(err)
				}
				return response
			}
			first := send("first")
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("provider did not start")
			}
			if got := send("queued-before"); got.Kind != "queued" {
				t.Fatalf("input was not queued: %+v", got)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, created.ThreadID, modes[1]); err != nil {
				t.Fatal(err)
			}
			if got := send("queued-after"); got.Kind != "queued" {
				t.Fatalf("input was not queued: %+v", got)
			}
			authority, err := svc.snapshotThreadStore().GetExecutionAuthorityByTurn(t.Context(), created.ThreadID, first.TurnID)
			if err != nil || authority == nil || authority.PermissionType != modes[0] {
				t.Fatalf("queued request replaced active authority: %+v %v", authority, err)
			}
			unblock.Do(func() { close(release) })
			if modes[0] == "approval_required" {
				waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool { return view.ApprovalPendingCount == 1 })
				before, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
				if err != nil {
					t.Fatal(err)
				}
				if err := svc.SetThreadPermissionType(t.Context(), meta, created.ThreadID, "readonly"); err != nil {
					t.Fatal(err)
				}
				after, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
				if err != nil || len(after.Interactions) != 1 || after.Interactions[0].Resolved || after.Interactions[0].ID != before.Interactions[0].ID || calls.Load() != 1 {
					t.Fatalf("settings settled pending approval: %+v %v", after, err)
				}
				if err := svc.SetThreadPermissionType(t.Context(), meta, created.ThreadID, "full_access"); err != nil {
					t.Fatal(err)
				}
				if _, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{ThreadID: created.ThreadID, InteractionID: after.Interactions[0].ID, Approved: true}); err != nil {
					t.Fatal(err)
				}
			}
			waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool {
				return view.RunStatus == "success" && view.QueuedTurnCount == 0 && calls.Load() == 4
			})
			send("next-turn")
			waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" && calls.Load() == 5 })
		})
	}
}

func assertPermissionProviderSurface(t *testing.T, request map[string]any, mode string) {
	t.Helper()
	tools, _ := request["tools"].([]any)
	names := map[string]bool{}
	for _, raw := range tools {
		if tool, ok := raw.(map[string]any); ok {
			names[anyToString(tool["name"])] = true
		}
	}
	if names["terminal_exec"] != (mode != "readonly") || names["read_file"] != (mode == "readonly") {
		t.Errorf("provider tool surface does not match %s: %v", mode, names)
	}
}

func TestQueuedPermissionRestoresFromAdmissionAuthority(t *testing.T) {
	for _, admitted := range []string{"readonly", "approval_required", "full_access"} {
		t.Run(admitted, func(t *testing.T) {
			store := newAuthorityContinuityStore(t)
			if err := store.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: "thread", EndpointID: "env", ModelID: "openai/gpt-5-mini", PermissionType: "readonly"}); err != nil {
				t.Fatal(err)
			}
			if err := store.PutExecutionAuthority(t.Context(), threadstore.ExecutionAuthority{RequestKey: "queued", ThreadID: "thread", EndpointID: "env", UserPublicID: "user", PermissionType: admitted}); err != nil {
				t.Fatal(err)
			}
			svc := &Service{threadsDB: store}
			request, err := svc.restoreFloretEffectRequest(t.Context(), flruntime.AgentRequest{ThreadID: "thread", RequestKey: "queued", TurnID: "promoted-turn", CanonicalTurnInput: flruntime.UserInput{Text: "queued work"}})
			if err != nil {
				t.Fatal(err)
			}
			if request.req.Options.PermissionType != admitted {
				t.Fatalf("restore changed queued permission to %s", request.req.Options.PermissionType)
			}
			if err := requireRWX(&request.meta); err != nil {
				t.Fatalf("restore lost admitted session authority: %v", err)
			}
		})
	}
}
