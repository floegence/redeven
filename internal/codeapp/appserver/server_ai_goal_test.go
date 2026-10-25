package appserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServerAIGoalReviewDetailPreservesEvidenceWhileWaitingForUser(t *testing.T) {
	const objective = "Deliver the result after confirming the target"
	const evidence = "The target must be selected by the user."
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct{ Tools []json.RawMessage }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeEvent := func(event any) {
			encoded, err := json.Marshal(event)
			if err != nil {
				t.Error(err)
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", encoded)
			w.(http.Flusher).Flush()
		}
		if len(request.Tools) == 0 {
			writeEvent(map[string]any{"type": "response.output_text.delta", "delta": "Confirm target"})
		} else {
			step := calls.Add(1)
			name, args := "goal", `{"operation":"review","expected_version":1,"outcome":"blocked","evidence":"The target must be selected by the user."}`
			if step > 1 {
				name, args = "ask_user", `{"reason_code":"user_decision_required","required_from_user":["target"],"evidence_refs":[],"questions":[{"id":"target","header":"Target","question":"Which target should be used?","response_mode":"write","is_secret":false}]}`
			}
			callID := fmt.Sprintf("goal-review-%d", step)
			item := map[string]any{"type": "function_call", "id": callID, "call_id": callID, "name": name, "arguments": args}
			for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
				writeEvent(map[string]any{"type": event, "output_index": 0, "item": item})
			}
		}
		writeEvent(map[string]any{"type": "response.completed", "response": map[string]any{"id": "goal-review-response", "model": "gpt-5-mini", "status": "completed"}})
		io.WriteString(w, "data: [DONE]\n\n")
		w.(http.Flusher).Flush()
	}))
	defer provider.Close()
	cfg := appserverTestAIConfig()
	cfg.Providers[0].BaseURL = provider.URL + "/v1"
	dir := t.TempDir()
	svc, err := ai.NewService(ai.Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh", Config: cfg,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := session.Meta{ChannelID: "ch_ai_readiness", EndpointID: "env_goal_review", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), meta)
	_, current, err := svc.ManageThreadGoal(t.Context(), &meta, ai.ThreadGoalRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: "goal", Operation: "set", Text: objective, NewThread: &ai.CreateThreadRequest{ModelID: "openai/gpt-5-mini"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ClientRequestID: "send", ThreadID: current.ThreadID.String(), Input: ai.RunInput{Text: "Complete the requested work"}}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, current.ThreadID.String())
		if err != nil {
			t.Fatal(err)
		}
		if len(detail.Current.Interactions) == 1 && !detail.Current.Interactions[0].Resolved {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Goal review did not reach the user interaction: calls=%d activity=%s failure=%+v items=%+v", calls.Load(), detail.Current.Activity, detail.Current.Failure, detail.Current.Items)
		}
		time.Sleep(5 * time.Millisecond)
	}
	response := performServerRequest(server, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+current.ThreadID.String(), origin, "")
	if response.Code != http.StatusOK {
		t.Fatalf("thread detail status=%d body=%s", response.Code, response.Body.String())
	}
	var wire struct {
		Data struct{ Current flruntime.ThreadView }
	}
	if err := json.Unmarshal(response.Body.Bytes(), &wire); err != nil {
		t.Fatal(err)
	}
	view := wire.Data.Current
	if view.Goal == nil || view.Goal.Status != "active" || len(view.Interactions) != 1 || view.Interactions[0].Resolved || calls.Load() != 2 {
		t.Fatalf("HTTP detail changed waiting or Goal state: %s", response.Body.String())
	}
	for _, item := range view.Items {
		if item.Activity == nil || item.Activity.ToolName != "goal" {
			continue
		}
		if item.Activity.Presentation != nil || item.ActivitySummary == nil {
			t.Fatal("thread detail must defer Goal presentation behind its summary")
		}
		body, err := json.Marshal(map[string]any{"item_id": item.ID, "path": "/payload/goal", "maximum_bytes": 65536, "maximum_nodes": 64})
		if err != nil {
			t.Fatal(err)
		}
		detail := performServerRequest(server, http.MethodPost, "/_redeven_proxy/api/ai/threads/"+current.ThreadID.String()+"/activity-value", origin, string(body))
		if detail.Code != http.StatusOK {
			t.Fatalf("Goal disclosure status=%d body=%s", detail.Code, detail.Body.String())
		}
		var value struct{ Data flruntime.ThreadActivityValue }
		if err := json.Unmarshal(detail.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		if value.Data.ItemID != item.ID || value.Data.ThreadID != view.ThreadID {
			t.Fatal("Goal disclosure changed canonical identity")
		}
		var payload fltools.StructuredActivityPayload
		if err := json.Unmarshal(append(append([]byte("{\"goal\":"), value.Data.Value...), '}'), &payload); err != nil {
			t.Fatal(err)
		}
		goal := payload.Goal
		if goal == nil || goal.Text != objective || goal.Outcome != "blocked" || goal.Evidence != evidence {
			t.Fatalf("HTTP Goal activity lost canonical review: %+v", goal)
		}
		return
	}
	t.Fatal("HTTP detail is missing the Goal activity")
}

func TestServerAIGoalMutationWithoutUserTurn(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	state := t.TempDir()
	var calls atomic.Int32
	requests := make(chan struct{}, 4)
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer provider.Close()
	defer close(release)
	cfg := appserverTestAIConfig()
	cfg.Providers[0].BaseURL = provider.URL + "/v1"
	svc, err := ai.NewService(ai.Options{Logger: logger, StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: cfg, ResolveProviderAPIKey: func(string) (string, bool, error) { calls.Add(1); return "sk-test", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := session.Meta{EndpointID: "env_goal", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	const channel = "ch_goal"
	server, err := New(Options{Logger: logger, Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte(" ")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), ResolveSessionMeta: resolveMetaForTest(channel, meta), AIServiceProvider: newStaticAIServiceProvider(svc)})
	if err != nil {
		t.Fatal(err)
	}
	initialCalls := calls.Load()
	path, origin := "/_redeven_proxy/api/ai/thread-goal", envOriginWithChannel(channel)
	for _, body := range []string{"null", "{}", `{"unknown":true}`, `{} {}`} {
		rr := performServerRequest(server, http.MethodPost, path, origin, body)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	req := ai.ThreadGoalRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: "goal-http", Operation: "set", Text: "Verify the result", NewThread: &ai.CreateThreadRequest{ModelID: "openai/gpt-5-mini"}}
	body, _ := json.Marshal(req)
	accepted := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if accepted.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	var response struct {
		Data struct {
			ThreadID string `json:"thread_id"`
			Current  struct {
				TurnID   string `json:"turn_id"`
				Activity string `json:"activity"`
			} `json:"current"`
			Goal struct {
				Version int    `json:"version"`
				Text    string `json:"text"`
			} `json:"goal"`
			Replayed bool `json:"replayed"`
		} `json:"data"`
	}
	if err := json.Unmarshal(accepted.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.ThreadID == "" || response.Data.Current.TurnID != "" || response.Data.Current.Activity != "idle" || response.Data.Goal.Text != req.Text {
		t.Fatalf("response=%s", accepted.Body.String())
	}
	replay := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if err := json.Unmarshal(replay.Body.Bytes(), &response); err != nil || !response.Data.Replayed {
		t.Fatalf("replay=%s err=%v", replay.Body.String(), err)
	}
	req.NewThread, req.ThreadID, req.ClientRequestID, req.Text = nil, response.Data.ThreadID, "goal-conflict", "Preserved edit"
	body, _ = json.Marshal(req)
	conflict := performServerRequest(server, http.MethodPost, path, origin, string(body))
	var conflictResult struct {
		Data struct {
			Conflict bool `json:"conflict"`
		} `json:"data"`
	}
	if err := json.Unmarshal(conflict.Body.Bytes(), &conflictResult); err != nil || !conflictResult.Data.Conflict {
		t.Fatalf("conflict=%s err=%v", conflict.Body.String(), err)
	}
	req.StorageGeneration = "stale"
	body, _ = json.Marshal(req)
	if rr := performServerRequest(server, http.MethodPost, path, origin, string(body)); rr.Code != http.StatusConflict {
		t.Fatalf("stale=%d %s", rr.Code, rr.Body.String())
	}
	if rr := performServerRequest(server, http.MethodPost, path, "https://unknown.example.com", string(body)); rr.Code < 400 {
		t.Fatal("unauthorized request accepted")
	}
	if calls.Load() != initialCalls {
		t.Fatalf("Goal mutation requested provider work: %d", calls.Load())
	}
	// The same endpoint distinguishes an explicit command from a popup save.
	req.StorageGeneration = svc.StorageGeneration()
	req.ClientRequestID, req.Operation, req.ExpectedVersion = "goal-submit-http", "submit", 1
	body, _ = json.Marshal(req)
	submitted := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if submitted.Code != http.StatusOK {
		t.Fatalf("submit=%d %s", submitted.Code, submitted.Body.String())
	}
	if err := json.Unmarshal(submitted.Body.Bytes(), &response); err != nil || response.Data.Current.TurnID == "" || response.Data.Current.Activity != "active" {
		t.Fatalf("submission=%s err=%v", submitted.Body.String(), err)
	}
	select {
	case <-requests:
	case <-time.After(5 * time.Second):
		t.Fatal("HTTP Goal submission never reached the model")
	}
	if _, err := svc.StopThread(t.Context(), &meta, req.ThreadID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		current, err := svc.GetThread(t.Context(), &meta, req.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if current.RunStatus != "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("stopped Goal execution did not settle")
		}
		time.Sleep(5 * time.Millisecond)
	}
	retried := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if err := json.Unmarshal(retried.Body.Bytes(), &response); err != nil || retried.Code != http.StatusOK || !response.Data.Replayed || response.Data.Current.Activity != "idle" {
		t.Fatalf("stopped replay=%s err=%v", retried.Body.String(), err)
	}
}

func TestServerBindsOnlyAuthorizedDraftAttachmentScope(t *testing.T) {
	server, svc, origin, otherOrigin := newUploadRouteServerWithAIConfig(t, appserverTestAIConfig())
	created, err := svc.CreateThreadWithOptions(t.Context(), &session.Meta{EndpointID: "env_upload", NamespacePublicID: "ns_upload", UserPublicID: "user_owner", ChannelID: "ch_upload_owner", CanRead: true, CanWrite: true, CanExecute: true}, ai.CreateThreadRequest{ClientRequestID: "binding-thread", ModelID: "openai/gpt-5-mini"})
	if err != nil {
		t.Fatal(err)
	}
	scope := createUploadRouteStagingScope(t, server, origin, "draft-request")
	path := "/_redeven_proxy/api/ai/upload-staging-scopes/" + scope.StagingScopeID
	for _, test := range []struct {
		name, origin, capability, body string
		ok                             bool
	}{
		{"missing capability", origin, "", `{"expected_target_id":"draft-request","thread_id":"` + created.ThreadID + `"}`, false},
		{"other owner", otherOrigin, scope.Capability, `{"expected_target_id":"draft-request","thread_id":"` + created.ThreadID + `"}`, false},
		{"wrong original target", origin, scope.Capability, `{"expected_target_id":"other-draft","thread_id":"` + created.ThreadID + `"}`, false},
		{"extra field", origin, scope.Capability, `{"thread_id":"` + created.ThreadID + `","extra":true}`, false},
		{"bind", origin, scope.Capability, `{"expected_target_id":"draft-request","thread_id":"` + created.ThreadID + `"}`, true},
		{"replay", origin, scope.Capability, `{"expected_target_id":"draft-request","thread_id":"` + created.ThreadID + `"}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(test.body))
			req.Header.Set("Origin", test.origin)
			req.Header.Set(uploadStagingCapabilityHeader, test.capability)
			rr := httptest.NewRecorder()
			server.ServeHTTP(rr, req.WithContext(context.Background()))
			if (rr.Code == http.StatusOK) != test.ok {
				t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}
