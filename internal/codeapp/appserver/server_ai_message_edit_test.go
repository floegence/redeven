package appserver

import (
	"encoding/json"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestServerMessageEditAdmissionReplayAndHistory(t *testing.T) {
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
	svc, err := ai.NewService(ai.Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: provider.URL, Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := session.Meta{ChannelID: "message-edit", EndpointID: "env_local", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	srv, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), meta)
	thread, err := svc.CreateThread(t.Context(), &meta, "Message edit", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	active, err := svc.SendUserTurn(t.Context(), &meta, ai.SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "original", Input: ai.RunInput{Text: "Original request"}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider did not start")
	}
	path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/message-edit"
	response := serveAIReadinessTestRequest(srv, origin, http.MethodGet, path, nil)
	var draft struct {
		Data ai.MessageEditDraft `json:"data"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &draft) != nil || draft.Data.Prompt != "Original request" {
		t.Fatalf("draft %d %s", response.Code, response.Body.String())
	}
	detail, err := svc.GetFlowerThreadDetail(t.Context(), &meta, thread.ThreadID)
	if err != nil || detail.Current.TurnID.String() != active.TurnID || detail.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("opening edit changed execution: %+v %v", detail, err)
	}
	for _, body := range []string{`{"unknown":true}`, `{} {}`, `{"content":{"unexpected":true}}`, `{"content":{"staging_scope_id":"wrong"}}`} {
		bad := serveAIReadinessTestRequest(srv, origin, http.MethodPost, path, []byte(body))
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid payload admitted %d %s", bad.Code, bad.Body.String())
		}
	}
	for _, query := range []string{"?other=value", "?revision_request_key=", "?revision_request_key=a&revision_request_key=b"} {
		bad := serveAIReadinessTestRequest(srv, origin, http.MethodGet, path+query, nil)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("ambiguous query admitted: %d %s", bad.Code, bad.Body.String())
		}
	}
	request := ai.EditMessageRequest{ClientRequestID: "replacement", StorageGeneration: draft.Data.StorageGeneration, ItemID: draft.Data.ItemID, StopActive: true, Content: ai.EditQueuedContent{ExpectedInputFingerprint: draft.Data.InputFingerprint, Text: "Replacement request"}}
	encode := func(req ai.EditMessageRequest) []byte {
		raw, err := json.Marshal(req)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	response = serveAIReadinessTestRequest(srv, origin, http.MethodPost, path, encode(request))
	var ack struct {
		Data flruntime.ThreadCommandAck `json:"data"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &ack) != nil || ack.Data.TurnID.String() == active.TurnID || ack.Data.TurnID == "" {
		t.Fatalf("edit %d %s", response.Code, response.Body.String())
	}
	replay := serveAIReadinessTestRequest(srv, origin, http.MethodPost, path, encode(request))
	var replayAck struct {
		Data flruntime.ThreadCommandAck `json:"data"`
	}
	if replay.Code != http.StatusOK || json.Unmarshal(replay.Body.Bytes(), &replayAck) != nil || replayAck.Data != ack.Data {
		t.Fatalf("replay %d %s", replay.Code, replay.Body.String())
	}
	request.Content.Text = "Conflicting replay"
	if got := serveAIReadinessTestRequest(srv, origin, http.MethodPost, path, encode(request)); got.Code != http.StatusConflict {
		t.Fatalf("conflict %d %s", got.Code, got.Body.String())
	}
	request.ClientRequestID = "stale"
	if got := serveAIReadinessTestRequest(srv, origin, http.MethodPost, path, encode(request)); got.Code != http.StatusConflict {
		t.Fatalf("stale %d %s", got.Code, got.Body.String())
	}
	history := serveAIReadinessTestRequest(srv, origin, http.MethodGet, path+"?revision_request_key="+url.QueryEscape("edit-message:replacement"), nil)
	if history.Code != http.StatusOK || !strings.Contains(history.Body.String(), "Original request") {
		t.Fatalf("history %d %s", history.Code, history.Body.String())
	}
	for _, secret := range []string{"resource_ref", "supplemental_context", "flower-resource:"} {
		if strings.Contains(history.Body.String(), secret) {
			t.Fatalf("exposed %s", secret)
		}
	}
	denied := meta
	denied.CanExecute = false
	deniedSrv, deniedOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(svc), denied)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		got := serveAIReadinessTestRequest(deniedSrv, deniedOrigin, method, path, encode(request))
		if got.Code != http.StatusForbidden {
			t.Fatalf("permission %d %s", got.Code, got.Body.String())
		}
	}
}
