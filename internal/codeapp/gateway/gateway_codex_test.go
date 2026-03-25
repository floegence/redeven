package gateway

import (
	"bytes"
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven-agent/internal/codexbridge"
	"github.com/floegence/redeven-agent/internal/session"
)

type stubCodexBackend struct {
	status               func(ctx context.Context) codexbridge.Status
	listThreads          func(ctx context.Context, limit int) ([]codexbridge.Thread, error)
	openThread           func(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error)
	startThread          func(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.Thread, error)
	startTurn            func(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error)
	archiveThread        func(ctx context.Context, threadID string) error
	subscribeThreadEvent func(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error)
	respondToRequest     func(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error
}

func (s *stubCodexBackend) Status(ctx context.Context) codexbridge.Status {
	if s.status != nil {
		return s.status(ctx)
	}
	return codexbridge.Status{}
}

func (s *stubCodexBackend) ListThreads(ctx context.Context, limit int) ([]codexbridge.Thread, error) {
	if s.listThreads != nil {
		return s.listThreads(ctx, limit)
	}
	return nil, nil
}

func (s *stubCodexBackend) OpenThread(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error) {
	if s.openThread != nil {
		return s.openThread(ctx, threadID)
	}
	return nil, nil
}

func (s *stubCodexBackend) StartThread(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.Thread, error) {
	if s.startThread != nil {
		return s.startThread(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) StartTurn(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error) {
	if s.startTurn != nil {
		return s.startTurn(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) ArchiveThread(ctx context.Context, threadID string) error {
	if s.archiveThread != nil {
		return s.archiveThread(ctx, threadID)
	}
	return nil
}

func (s *stubCodexBackend) SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error) {
	if s.subscribeThreadEvent != nil {
		return s.subscribeThreadEvent(ctx, threadID, afterSeq)
	}
	ch := make(chan codexbridge.Event)
	close(ch)
	return nil, ch, nil
}

func (s *stubCodexBackend) RespondToRequest(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error {
	if s.respondToRequest != nil {
		return s.respondToRequest(ctx, threadID, requestID, resp)
	}
	return nil
}

func codexTestDistFS() fs.FS {
	return fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
}

func TestGateway_SettingsUpdate_RejectsHostManagedCodexConfig(t *testing.T) {
	t.Parallel()

	cfgPath := writeTestConfig(t)
	before, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("ReadFile(before): %v", err)
	}
	channelID := "ch_test_codex_settings"
	envOrigin := envOriginWithChannel(channelID)

	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             codexTestDistFS(),
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/settings", bytes.NewBufferString(`{
  "codex": {
    "binary_path": "/usr/local/bin/codex"
  }
}`))
	req.Header.Set("Origin", envOrigin)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Codex is host-managed")) {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}

	after, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("ReadFile(after): %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("config.json changed unexpectedly:\n%s", string(after))
	}
}

func TestGateway_CodexRoutes_ExposeIndependentGatewaySurface(t *testing.T) {
	t.Parallel()

	channelID := "ch_test_codex_routes"
	envOrigin := envOriginWithChannel(channelID)

	thread := codexbridge.Thread{
		ID:             "thread_1",
		Preview:        "Fix the failing tests",
		ModelProvider:  "openai/gpt-5.4",
		CreatedAtUnixS: 10,
		UpdatedAtUnixS: 12,
		Status:         "running",
		CWD:            "/workspace",
	}

	var (
		gotStartThread   codexbridge.StartThreadRequest
		gotStartTurn     codexbridge.StartTurnRequest
		gotArchiveID     string
		gotRespondThread string
		gotRespondID     string
		gotRespondBody   codexbridge.PendingRequestResponse
		gotAfterSeq      int64
	)

	gw, err := New(Options{
		Backend: &stubBackend{},
		Codex: &stubCodexBackend{
			status: func(ctx context.Context) codexbridge.Status {
				return codexbridge.Status{
					Available:    true,
					Ready:        true,
					BinaryPath:   "/usr/local/bin/codex",
					AgentHomeDir: "/workspace",
				}
			},
			listThreads: func(ctx context.Context, limit int) ([]codexbridge.Thread, error) {
				return []codexbridge.Thread{thread}, nil
			},
			openThread: func(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error) {
				return &codexbridge.ThreadDetail{
					Thread:       thread,
					LastEventSeq: 2,
					ActiveStatus: "running",
				}, nil
			},
			startThread: func(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.Thread, error) {
				gotStartThread = req
				return &thread, nil
			},
			startTurn: func(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error) {
				gotStartTurn = req
				return &codexbridge.Turn{ID: "turn_1", Status: "running"}, nil
			},
			archiveThread: func(ctx context.Context, threadID string) error {
				gotArchiveID = threadID
				return nil
			},
			subscribeThreadEvent: func(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error) {
				gotAfterSeq = afterSeq
				ch := make(chan codexbridge.Event)
				close(ch)
				return []codexbridge.Event{{Seq: 3, Type: "thread_status_changed", ThreadID: threadID, Status: "running"}}, ch, nil
			},
			respondToRequest: func(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error {
				gotRespondThread = threadID
				gotRespondID = requestID
				gotRespondBody = resp
				return nil
			},
		},
		DistFS:             codexTestDistFS(),
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	t.Run("status", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/status", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"/usr/local/bin/codex"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("threads list", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads?limit=10", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"thread_1"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("start thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads", bytes.NewBufferString(`{"cwd":"/workspace","model":"gpt-5.4"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotStartThread.CWD != "/workspace" || gotStartThread.Model != "gpt-5.4" {
			t.Fatalf("unexpected start thread request: %+v", gotStartThread)
		}
	})

	t.Run("open thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads/thread_1", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"last_event_seq":2`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("start turn", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/turns", bytes.NewBufferString(`{"input_text":"please continue"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotStartTurn.ThreadID != "thread_1" || gotStartTurn.InputText != "please continue" {
			t.Fatalf("unexpected start turn request: %+v", gotStartTurn)
		}
	})

	t.Run("respond request", func(t *testing.T) {
		req := httptest.NewRequest(
			http.MethodPost,
			"/_redeven_proxy/api/codex/threads/thread_1/requests/request_1/response",
			bytes.NewBufferString(`{"type":"permissions","decision":"accept","answers":{"q1":["yes"]}}`),
		)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotRespondThread != "thread_1" || gotRespondID != "request_1" {
			t.Fatalf("unexpected request target: thread=%q request=%q", gotRespondThread, gotRespondID)
		}
		if gotRespondBody.Decision != "accept" || gotRespondBody.Type != "permissions" {
			t.Fatalf("unexpected request body: %+v", gotRespondBody)
		}
		if answers := gotRespondBody.Answers["q1"]; len(answers) != 1 || answers[0] != "yes" {
			t.Fatalf("unexpected answers: %+v", gotRespondBody.Answers)
		}
	})

	t.Run("archive thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/archive", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotArchiveID != "thread_1" {
			t.Fatalf("ArchiveThread=%q, want=%q", gotArchiveID, "thread_1")
		}
	})

	t.Run("event stream", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads/thread_1/events?after_seq=2", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotAfterSeq != 2 {
			t.Fatalf("after_seq=%d, want=2", gotAfterSeq)
		}
		if contentType := rr.Header().Get("Content-Type"); contentType != "text/event-stream" {
			t.Fatalf("Content-Type=%q, want=%q", contentType, "text/event-stream")
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("event: codex_event")) || !bytes.Contains(rr.Body.Bytes(), []byte(`"seq":3`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})
}
