package appserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

type cancelOnFlushResponseWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
	cancel context.CancelFunc
	once   sync.Once
}

func (w *cancelOnFlushResponseWriter) Header() http.Header {
	return w.header
}

func (w *cancelOnFlushResponseWriter) Write(payload []byte) (int, error) {
	return w.body.Write(payload)
}

func (w *cancelOnFlushResponseWriter) WriteHeader(status int) {
	w.status = status
}

func (w *cancelOnFlushResponseWriter) Flush() {
	w.once.Do(w.cancel)
}

func TestServeAIFlowerLiveStreamFlushesReadyFrameWithSafeHeaders(t *testing.T) {
	t.Parallel()
	aiSvc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	meta := &session.Meta{EndpointID: "env_sse", UserPublicID: "user_sse", CanRead: true}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/flower/stream?thread_id=thread_sse&thread_after_seq=0", nil).WithContext(ctx)
	response := &cancelOnFlushResponseWriter{header: make(http.Header), cancel: cancel}

	serveAIFlowerLiveStream(response, request, aiSvc, meta)

	if response.status != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.status, response.body.String())
	}
	if contentType := response.header.Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("Content-Type=%q", contentType)
	}
	if response.header.Get("Cache-Control") != "no-store" || response.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unsafe stream headers=%v", response.header)
	}
	body := response.body.String()
	if !strings.HasPrefix(body, "data: ") || !strings.Contains(body, `"kind":"ready"`) || !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("ready frame=%q", body)
	}
}
