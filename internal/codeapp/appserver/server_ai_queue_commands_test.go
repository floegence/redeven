package appserver

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServerQueueCommandsPreserveCanonicalInputAndPublicProjection(t *testing.T) {
	for _, action := range []string{"edit", "edit-content", "promote", "send-now"} {
		t.Run(action, func(t *testing.T) {
			started := make(chan struct{}, 4)
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				started <- struct{}{}
				<-r.Context().Done()
			}))
			defer provider.Close()
			dir := t.TempDir()
			svc, err := ai.NewService(ai.Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh",
				Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: provider.URL,
					Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
				ResolveProviderAPIKey:        func(string) (string, bool, error) { return "fixture", true, nil },
				ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute},
			})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := session.Meta{ChannelID: "queue-command", EndpointID: "env_local", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
			srv, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), meta)
			thread, err := svc.CreateThread(t.Context(), &meta, "Queue command", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			active, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "active", Input: ai.RunInput{Text: "Active work"}})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("active provider did not start")
			}
			first, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "first", Input: ai.RunInput{Text: "Earlier queued input"}})
			if err != nil {
				t.Fatal(err)
			}
			chosen, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "chosen", Input: ai.RunInput{Text: "Chosen queued input", ContextAction: &ai.ContextActionEnvelope{
				SchemaVersion: ai.ContextActionSchemaVersion, ActionID: "assistant.ask.flower", Provider: "flower", Target: ai.ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:           ai.ContextActionSource{Surface: "file_browser"},
				ExecutionContext: &ai.ContextActionExecutionHint{CurrentTargetID: meta.EndpointID, SourceEnvPublicID: meta.EndpointID, SessionSource: "local_runtime", RuntimeHint: "auto"},
				Context:          []ai.ContextActionContextItem{{Kind: "file_path", Path: "/workspace/private-note.txt"}},
				Presentation:     ai.ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			}}})
			if err != nil || chosen.Kind != "queued" || first.Kind != "queued" {
				t.Fatalf("queued=%+v err=%v", chosen, err)
			}
			path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/queue/" + chosen.QueueID
			// The retained promote API stays idle-only and reports a typed conflict.
			busy := serveAIReadinessTestRequest(srv, origin, http.MethodPost, path+"/promote", nil)
			if busy.Code != http.StatusConflict {
				t.Fatalf("active promote status=%d body=%s", busy.Code, busy.Body.String())
			}
			if action == "promote" {
				if err := svc.CancelThread(&meta, thread.ThreadID); err != nil {
					t.Fatal(err)
				}
				deadline := time.Now().Add(5 * time.Second)
				for {
					detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
					if err != nil {
						t.Fatal(err)
					}
					if detail.Current.Activity == flruntime.ThreadActivityIdle {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("cancel did not reach idle")
					}
					time.Sleep(5 * time.Millisecond)
				}
			}
			method, body, commandPath, wantStatus := http.MethodPost, []byte(nil), path+"/"+action, http.StatusAccepted
			if action == "edit" || action == "edit-content" {
				method, commandPath, wantStatus = http.MethodPatch, path, http.StatusOK
				body = []byte(`{"client_request_id":"edit","expected_text":"Chosen queued input","text":"Edited chosen input"}`)
				if action == "edit-content" {
					current, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
					if err != nil {
						t.Fatal(err)
					}
					raw, _ := json.Marshal(current.Current.Queue[1].Input)
					body = []byte(fmt.Sprintf(`{"client_request_id":"edit-content","content":{"expected_input_fingerprint":"%x","text":"Edited complete content","retained_attachment_ids":[],"retained_reference_ids":[],"context_action":{"schema_version":2,"action_id":"assistant.ask.flower","provider":"flower","target":{"target_id":"current","locality":"auto"},"source":{"surface":"flower_composer"},"context":[{"kind":"text_snapshot","title":"New context","content":"NEW_CONTEXT"}]}}}`, sha256.Sum256(raw)))
				}
			}
			response := serveAIReadinessTestRequest(srv, origin, method, commandPath, body)
			if response.Code != wantStatus {
				t.Fatalf("%s status=%d body=%s", action, response.Code, response.Body.String())
			}
			for _, private := range []string{"resource_ref", "flower-resource:", "/workspace/private-note.txt", "supplemental_context"} {
				if strings.Contains(response.Body.String(), private) {
					t.Fatalf("%s response exposed %q: %s", action, private, response.Body.String())
				}
			}
			var payload struct {
				OK   bool                 `json:"ok"`
				Data flruntime.ThreadView `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || !payload.OK || payload.Data.ThreadID.String() != thread.ThreadID {
				t.Fatalf("response=%+v error=%v", payload, err)
			}
			if action == "edit" || action == "edit-content" {
				if payload.Data.TurnID.String() != active.TurnID || len(payload.Data.Queue) != 2 || len(payload.Data.Queue[1].Input.References) != 1 || payload.Data.Queue[1].Input.References[0].ResourceRef != "" {
					t.Fatalf("edited public queue=%+v", payload.Data.Queue)
				}
				stale := serveAIReadinessTestRequest(srv, origin, method, commandPath, []byte(`{"client_request_id":"stale","expected_text":"Chosen queued input","text":"Stale edit"}`))
				if stale.Code != http.StatusConflict {
					t.Fatalf("stale edit status=%d", stale.Code)
				}
			} else {
				if payload.Data.TurnID.String() == active.TurnID || len(payload.Data.Queue) != 1 || payload.Data.Queue[0].ID != first.QueueID {
					t.Fatalf("selected queue admission=%+v", payload.Data)
				}
				found := false
				for _, item := range payload.Data.Items {
					if item.Kind == flruntime.ThreadItemUser && item.Text == "Chosen queued input" {
						found = len(item.References) == 1 && item.References[0].ResourceRef == ""
					}
				}
				if !found {
					t.Fatal("chosen canonical message/reference missing")
				}
				replay := serveAIReadinessTestRequest(srv, origin, method, commandPath, nil)
				if replay.Code != http.StatusAccepted {
					t.Fatalf("replay status=%d body=%s", replay.Code, replay.Body.String())
				}
				var replayPayload struct {
					Data flruntime.ThreadView `json:"data"`
				}
				if err := json.Unmarshal(replay.Body.Bytes(), &replayPayload); err != nil || replayPayload.Data.TurnID != payload.Data.TurnID || replayPayload.Data.Cancellation != nil {
					t.Fatalf("replay interrupted current=%+v error=%v", replayPayload.Data, err)
				}
				missing := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/queue/missing/send-now", nil)
				if missing.Code != http.StatusConflict {
					t.Fatalf("missing queue status=%d body=%s", missing.Code, missing.Body.String())
				}
			}
			readonly := meta
			readonly.CanWrite = false
			readServer, readOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), readonly)
			denied := serveAIReadinessTestRequest(readServer, readOrigin, method, commandPath, body)
			if denied.Code != http.StatusForbidden {
				t.Fatalf("read-only queue command status=%d", denied.Code)
			}
			foreign := meta
			foreign.EndpointID = "foreign"
			foreignServer, foreignOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), foreign)
			denied = serveAIReadinessTestRequest(foreignServer, foreignOrigin, method, commandPath, body)
			if denied.Code != http.StatusNotFound {
				t.Fatalf("foreign queue command status=%d body=%s", denied.Code, denied.Body.String())
			}
		})
	}
}
