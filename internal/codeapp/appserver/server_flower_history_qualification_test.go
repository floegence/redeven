package appserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

// Unlike the Service-only opening fixture, this qualification traverses the
// product HTTP decoder, authorization, and response projection. The wrapper
// translates test URLs/envelopes only; request bodies reach serveHTTP unchanged.
// It accepts only isolated copies and never activates execution.
func TestServerFlowerHistoryScrollQualification(t *testing.T) {
	state := os.Getenv("REDEVEN_HISTORY_HTTP_STATE")
	if state == "" {
		t.Skip("isolated HTTP history qualification only")
	}
	id, dist := os.Getenv("REDEVEN_THREAD_OPEN_ID"), os.Getenv("REDEVEN_THREAD_OPEN_DIST")
	if id == "" || dist == "" {
		t.Fatal("explicit thread and UI distribution required")
	}
	marker, err := os.ReadFile(filepath.Join(state, "qualification-owner.json"))
	var owner struct{ Purpose string }
	if err != nil || json.Unmarshal(marker, &owner) != nil || owner.Purpose != "thread-open-qualification" {
		t.Fatal("isolated copy ownership required")
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	service, err := ai.NewService(ai.Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: appserverTestAIConfig(), Logger: logger, DeferExecution: true})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	settings, err := threadstore.Open(filepath.Join(state, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	thread, err := settings.GetThreadSettingsByCanonicalThreadID(t.Context(), id)
	_ = settings.Close()
	if err != nil || thread == nil {
		t.Fatalf("missing target settings: %v", err)
	}
	meta := session.Meta{EndpointID: thread.EndpointID, NamespacePublicID: thread.NamespacePublicID, UserPublicID: "isolated-history-reader", CanRead: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), meta)
	defer server.Close()
	done := make(chan struct{})
	stop := sync.OnceFunc(func() { close(done) })
	mux := http.NewServeMux()
	mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		r = r.Clone(r.Context())
		r.URL = &url.URL{Path: "/_redeven_proxy/api/ai/flower/stream"}
		r.Header.Set("Origin", origin)
		server.serveHTTP(w, r)
	})
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, r *http.Request) {
		op := r.URL.Query().Get("op")
		if op == "quit" {
			_, _ = io.WriteString(w, "true")
			stop()
			return
		}
		threadID := r.URL.Query().Get("id")
		if threadID == "" {
			threadID = id
		}
		path := "/_redeven_proxy/api/ai/threads/" + url.PathEscape(threadID)
		switch op {
		case "list":
			path = "/_redeven_proxy/api/ai/threads"
		case "detail":
		case "history":
			path += "/history"
		case "history_item":
			path += "/history-item"
		case "history_body":
			path += "/history-body"
		case "history_release":
			path += "/history-release"
		case "parent_events":
			path += "/subagent-events"
		case "activity_value":
			path += "/activity-value"
		case "activity_field":
			path += "/activity-field"
		case "activity_structure":
			path += "/activity-structure"
		default:
			http.NotFound(w, r)
			return
		}
		r = r.Clone(r.Context())
		r.URL = &url.URL{Path: path}
		if op == "list" {
			r.URL.RawQuery = "limit=200"
		}
		r.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		server.serveHTTP(response, r)
		w.Header().Set("Content-Type", "application/json")
		if response.Code != http.StatusOK {
			t.Logf("%s request bytes=%d status=%d", op, r.ContentLength, response.Code)
			w.WriteHeader(response.Code)
			_, _ = w.Write(response.Body.Bytes())
			return
		}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Error(err)
			http.Error(w, "invalid product envelope", 500)
			return
		}
		if len(envelope.Data) == 0 {
			envelope.Data = json.RawMessage("null")
		}
		_, _ = w.Write(envelope.Data)
	})
	mux.Handle("/", http.FileServer(http.Dir(dist)))
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	info, _ := json.Marshal(map[string]any{"url": httpServer.URL, "pid": os.Getpid(), "thread": id, "boundary": "product-http"})
	if err := os.WriteFile(filepath.Join(state, "fixture.json"), info, 0600); err != nil {
		t.Fatal(err)
	}
	t.Log("HTTP history qualification ready; execution deferred")
	select {
	case <-done:
	case <-t.Context().Done():
		t.Fatal(t.Context().Err())
	}
}
