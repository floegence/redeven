package appserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
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
	if !strings.HasPrefix(body, "data: ") || !strings.Contains(body, `"fragment_count":1`) || !strings.Contains(decodedFlowerLiveSSEData(t, body), `"kind":"ready"`) || !strings.HasSuffix(body, "\n\n") {
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
	if !strings.Contains(body, `"fragment_count":1`) || !strings.Contains(decodedFlowerLiveSSEData(t, body), `"kind":"ready"`) || !strings.HasSuffix(body, "\n\n: heartbeat\n\n") {
		t.Fatalf("stream did not contain two complete frames: %q", body)
	}
	if len(response.deadlineWrites) != 4 {
		t.Fatalf("deadline writes=%v, want set and clear for each frame", response.deadlineWrites)
	}
	for index := 1; index < len(response.deadlineWrites); index += 2 {
		if !response.deadlineWrites[index].IsZero() {
			t.Fatalf("frame %d left an active write deadline: %v", index/2, response.deadlineWrites)
		}
	}
}

func decodedFlowerLiveSSEData(t *testing.T, body string) string {
	t.Helper()
	first := strings.Split(strings.TrimPrefix(body, "data: "), "\n\n")[0]
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
