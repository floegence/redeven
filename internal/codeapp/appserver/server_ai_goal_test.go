package appserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServerAIGoalMutationWithoutUserTurn(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	state := t.TempDir()
	var calls atomic.Int32
	svc, err := ai.NewService(ai.Options{Logger: logger, StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: appserverTestAIConfig(), ResolveProviderAPIKey: func(string) (string, bool, error) { calls.Add(1); return "sk-test", true, nil }})
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
