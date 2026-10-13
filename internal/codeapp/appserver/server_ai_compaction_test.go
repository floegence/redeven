package appserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServerAIContextCompactionAdmissionBoundary(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	state := t.TempDir()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	var blockInvocation atomic.Bool
	svc, err := ai.NewService(ai.Options{Logger: logger, StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: appserverTestAIConfig(), ResolveProviderAPIKey: func(string) (string, bool, error) {
		if !blockInvocation.Load() { return "sk-test", true, nil }
		calls.Add(1)
		once.Do(func() { close(entered) })
		<-release
		return "sk-test", true, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	defer close(release)
	meta := session.Meta{EndpointID: "env_compact", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	thread, err := svc.CreateThread(t.Context(), &meta, "compact fixture", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	blockInvocation.Store(true)
	const channel = "ch_compaction"
	server, err := New(Options{Logger: logger, Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte(" ")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), ResolveSessionMeta: resolveMetaForTest(channel, meta), AIServiceProvider: newStaticAIServiceProvider(svc)})
	if err != nil {
		t.Fatal(err)
	}
	path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/context/compact"
	origin := envOriginWithChannel(channel)
	for _, body := range []string{`{"client_request_id":"unknown","input":{"text":"/compact"}}`, `{"client_request_id":"bad"} {}`, `null`} {
		rr := performServerRequest(server, http.MethodPost, path, origin, body)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid body status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	stale := performServerRequest(server, http.MethodPost, path, origin, `{"storage_generation":"stale","client_request_id":"stale"}`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale=%d %s", stale.Code, stale.Body.String())
	}
	denied := performServerRequest(server, http.MethodPost, path, "https://unknown.example.com", `{"client_request_id":"denied"}`)
	if denied.Code < 400 {
		t.Fatalf("unauthorized=%d", denied.Code)
	}
	if calls.Load() != 0 {
		t.Fatal("rejected request called factory")
	}
	body, _ := json.Marshal(ai.CompactThreadContextRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: "http-compact"})
	start := time.Now()
	accepted := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if accepted.Code != http.StatusAccepted || time.Since(start) > time.Second {
		t.Fatalf("blocked admission=%d %s", accepted.Code, accepted.Body.String())
	}
	var response struct {
		Data struct {
			Current struct {
				TurnKind string            `json:"turn_kind"`
				Items    []json.RawMessage `json:"items"`
			} `json:"current"`
		} `json:"data"`
	}
	if err := json.Unmarshal(accepted.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.Current.TurnKind != "context_compaction" || len(response.Data.Current.Items) != 0 {
		t.Fatalf("unexpected control turn: %s", accepted.Body.String())
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("factory did not start")
	}
	replay := performServerRequest(server, http.MethodPost, path, origin, string(body))
	if replay.Code != http.StatusAccepted {
		t.Fatalf("replay=%d %s", replay.Code, replay.Body.String())
	}
	busyBody, _ := json.Marshal(ai.CompactThreadContextRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: "busy"})
	busy := performServerRequest(server, http.MethodPost, path, origin, string(busyBody))
	if busy.Code != http.StatusConflict {
		t.Fatalf("busy=%d %s", busy.Code, busy.Body.String())
	}
	if calls.Load() != 1 {
		t.Fatalf("replay/busy repeated factory: %d", calls.Load())
	}
}
