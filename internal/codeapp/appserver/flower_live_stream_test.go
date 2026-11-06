package appserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

type cancelOnFlushResponseWriter struct {
	header    http.Header
	body      bytes.Buffer
	status    int
	cancel    context.CancelFunc
	once      sync.Once
	deadlines []time.Time
}

type cancelAfterHeartbeatResponseWriter struct {
	header         http.Header
	body           bytes.Buffer
	status         int
	cancel         context.CancelFunc
	flushes        int
	writeDeadline  time.Time
	deadlineWrites []time.Time
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

func (w *cancelOnFlushResponseWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func (w *cancelAfterHeartbeatResponseWriter) Header() http.Header {
	return w.header
}

func (w *cancelAfterHeartbeatResponseWriter) Write(payload []byte) (int, error) {
	if !w.writeDeadline.IsZero() && time.Now().After(w.writeDeadline) {
		return 0, context.DeadlineExceeded
	}
	return w.body.Write(payload)
}

func (w *cancelAfterHeartbeatResponseWriter) WriteHeader(status int) {
	w.status = status
}

func (w *cancelAfterHeartbeatResponseWriter) Flush() {
	w.flushes++
	if w.flushes == 2 {
		w.cancel()
	}
}

func (w *cancelAfterHeartbeatResponseWriter) SetWriteDeadline(deadline time.Time) error {
	w.writeDeadline = deadline
	w.deadlineWrites = append(w.deadlineWrites, deadline)
	return nil
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
	if !strings.HasPrefix(body, "data: ") || !strings.Contains(decodedFlowerLiveSSEData(t, body), `"kind":"ready"`) || !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("ready frame=%q", body)
	}
	if len(response.deadlines) < 2 || !response.deadlines[len(response.deadlines)-1].IsZero() {
		t.Fatalf("successful stream frame left an active write deadline: %v", response.deadlines)
	}
}

func TestServeAIFlowerLiveStreamRefreshesDeadlineForIdleHeartbeat(t *testing.T) {
	aiSvc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	meta := &session.Meta{EndpointID: "env_sse_heartbeat", UserPublicID: "user_sse_heartbeat", CanRead: true}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	request := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/flower/stream?thread_id=thread_sse_heartbeat&thread_after_seq=0", nil).WithContext(ctx)
	response := &cancelAfterHeartbeatResponseWriter{header: make(http.Header), cancel: cancel}

	serveAIFlowerLiveStreamWithTiming(response, request, aiSvc, meta, 100*time.Millisecond, 25*time.Millisecond)

	if response.status != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.status, response.body.String())
	}
	if response.flushes != 2 {
		t.Fatalf("flushes=%d, want ready frame and heartbeat", response.flushes)
	}
	body := response.body.String()
	if !strings.Contains(decodedFlowerLiveSSEData(t, body), `"kind":"ready"`) || !strings.HasSuffix(body, "\n\n: heartbeat\n\n") {
		t.Fatalf("stream did not contain two complete frames: %q", body)
	}
	if len(response.deadlineWrites) < 4 || !response.deadlineWrites[1].IsZero() || !response.deadlineWrites[len(response.deadlineWrites)-1].IsZero() {
		t.Fatalf("frame/handler cleanup left an active deadline: %v", response.deadlineWrites)
	}
}

func decodedFlowerLiveSSEData(t *testing.T, body string) string {
	t.Helper()
	first := strings.Split(strings.TrimPrefix(body, "data: "), "\n\n")[0]
	var direct map[string]json.RawMessage
	if err := json.Unmarshal([]byte(first), &direct); err != nil {
		t.Fatal(err)
	}
	if _, ok := direct["schema_version"]; ok {
		return first
	}
	var fragment ai.FlowerLiveStreamFragment
	if err := json.Unmarshal([]byte(first), &fragment); err != nil {
		t.Fatal(err)
	}
	data, err := base64.StdEncoding.DecodeString(fragment.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func readFlowerLiveStreamEnvelope(ctx context.Context, subscription *ai.FlowerLiveStreamSubscription) (*ai.FlowerLiveStreamFrame, error) {
	var result ai.FlowerLiveStreamFrame
	for index := 0; ; index++ {
		frame, err := subscription.Next(ctx)
		if err != nil {
			return nil, err
		}
		var direct map[string]json.RawMessage
		if err := json.Unmarshal(frame.Data, &direct); err != nil {
			return nil, err
		}
		if _, ok := direct["schema_version"]; ok {
			return frame, nil
		}
		var fragment ai.FlowerLiveStreamFragment
		if err := json.Unmarshal(frame.Data, &fragment); err != nil {
			return nil, err
		}
		data, err := base64.StdEncoding.DecodeString(fragment.DataBase64)
		if err != nil {
			return nil, err
		}
		result.Kind = frame.Kind
		result.Data = append(result.Data, data...)
		if index+1 == fragment.FragmentCount {
			return &result, nil
		}
	}
}

type failedFlowerLiveStream struct{ err error }

func (stream failedFlowerLiveStream) Next(context.Context) (*ai.FlowerLiveStreamFrame, error) {
	return nil, stream.err
}

func TestServeFlowerLiveStreamReportsTerminalSynchronizationError(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/flower/stream", nil)
	serveFlowerLiveStreamFrames(response, request, failedFlowerLiveStream{err: ai.ErrFlowerLiveSync}, time.Second, time.Second)
	want := "event: error\ndata: {\"code\":\"flower_live_sync_error\",\"message\":\"Flower live stream synchronization failed\"}\n\n"
	if response.Code != http.StatusOK || response.Body.String() != want {
		t.Fatalf("terminal synchronization event status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestServeFlowerLiveStreamKeepsOrdinaryReconnectFenceNonTerminal(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/flower/stream", nil)
	serveFlowerLiveStreamFrames(response, request, failedFlowerLiveStream{err: io.EOF}, time.Second, time.Second)
	if response.Body.Len() != 0 {
		t.Fatalf("ordinary reconnect fence became a terminal synchronization error: %q", response.Body.String())
	}
}

func TestFlowerLiveSubscriptionErrorsPreserveRecoveryClassification(t *testing.T) {
	for _, tc := range []struct {
		name       string
		err        error
		status     int
		retryAfter string
	}{
		{"runtime_rebinding", ai.ErrFlowerLiveSync, http.StatusServiceUnavailable, ""},
		{"wrapped_sync_failure", fmt.Errorf("baseline: %w", ai.ErrFlowerLiveSync), http.StatusServiceUnavailable, ""},
		{"baseline_timeout", fmt.Errorf("baseline: %w", context.DeadlineExceeded), http.StatusGatewayTimeout, ""},
		{"capacity", ai.ErrFlowerLiveTooManySubscribers, http.StatusTooManyRequests, "10"},
		{"invalid_request", errors.New("invalid Flower live stream request"), http.StatusBadRequest, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeFlowerLiveSubscriptionError(response, tc.err)
			if response.Code != tc.status || response.Header().Get("Retry-After") != tc.retryAfter {
				t.Fatalf("status=%d retry-after=%q, want %d %q", response.Code, response.Header().Get("Retry-After"), tc.status, tc.retryAfter)
			}
			var body apiResp
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.OK || body.Error == "" {
				t.Fatalf("invalid failure response: %s (%v)", response.Body.String(), err)
			}
		})
	}
}

// A real socket with a stalled reader proves request cancellation releases the
// handler instead of relying on an elapsed-time failure.
type saturatedFlowerLiveStream struct {
	payload []byte
	started chan struct{}
	once    sync.Once
}

func (stream *saturatedFlowerLiveStream) Next(ctx context.Context) (*ai.FlowerLiveStreamFrame, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	stream.once.Do(func() { close(stream.started) })
	return &ai.FlowerLiveStreamFrame{Data: stream.payload}, nil
}
func TestFlowerLiveSlowConsumerUsesCancellationWithoutWriteDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := &saturatedFlowerLiveStream{payload: bytes.Repeat([]byte("x"), 32<<20), started: make(chan struct{})}
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		serveFlowerLiveStreamFrames(w, r.WithContext(ctx), stream, time.Minute, flowerLiveWriteTimeout)
	}))
	defer server.Close()
	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(1024)
	}
	if _, err := io.WriteString(conn, "GET / HTTP/1.1\r\nHost: test\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stream.started:
	case <-time.After(time.Second):
		t.Fatal("stream did not start")
	}
	select {
	case <-done:
		t.Fatal("slow connected reader terminated before cancellation")
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled blocked write retained its handler")
	}
}
