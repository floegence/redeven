package appserver

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/session"
)

func TestPluginPlatformAdmissionReleasedAfterHTTPHandler(t *testing.T) {
	t.Parallel()

	srv := newDistRouteTestServer(t, fstest.MapFS{}, nil)
	var releases atomic.Int32
	srv.acquirePluginSession = func(channelID string) (*session.Meta, func(), bool) {
		if channelID != "local-ui" {
			t.Fatalf("admission channel = %q, want local-ui", channelID)
		}
		return &session.Meta{ChannelID: channelID}, func() { releases.Add(1) }, true
	}
	srv.pluginPlatform = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil))
	response := httptest.NewRecorder()
	srv.servePluginPlatform(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := releases.Load(); got != 1 {
		t.Fatalf("release count = %d, want 1", got)
	}
}

func TestPluginPlatformHijackHoldsAdmissionUntilConnectionClose(t *testing.T) {
	t.Parallel()

	srv := newDistRouteTestServer(t, fstest.MapFS{}, nil)
	var releases atomic.Int32
	srv.acquirePluginSession = func(channelID string) (*session.Meta, func(), bool) {
		return &session.Meta{ChannelID: channelID}, func() { releases.Add(1) }, true
	}
	var hijacked net.Conn
	srv.pluginPlatform = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Fatalf("Hijack: %v", err)
		}
		hijacked = conn
	})

	writer := newTestHijackWriter(t)
	defer writer.closePeer()
	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil))
	srv.servePluginPlatform(writer, req)
	if got := releases.Load(); got != 1 {
		t.Fatalf("release count after handler return = %d, want active-probe release 1", got)
	}
	if hijacked == nil {
		t.Fatal("handler did not receive hijacked connection")
	}
	if err := hijacked.Close(); err != nil {
		t.Fatalf("close hijacked connection: %v", err)
	}
	if got := releases.Load(); got != 2 {
		t.Fatalf("release count after connection close = %d, want 2", got)
	}
	if got := len(srv.pluginConns); got != 0 {
		t.Fatalf("tracked plugin connections = %d, want 0", got)
	}
}

func TestServerCloseClosesHijackedPluginConnection(t *testing.T) {
	t.Parallel()

	srv := newDistRouteTestServer(t, fstest.MapFS{}, nil)
	var releases atomic.Int32
	srv.acquirePluginSession = func(channelID string) (*session.Meta, func(), bool) {
		return &session.Meta{ChannelID: channelID}, func() { releases.Add(1) }, true
	}
	srv.pluginPlatform = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, _, err := w.(http.Hijacker).Hijack(); err != nil {
			t.Fatalf("Hijack: %v", err)
		}
	})

	writer := newTestHijackWriter(t)
	defer writer.closePeer()
	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil))
	srv.servePluginPlatform(writer, req)
	if err := srv.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if got := releases.Load(); got != 2 {
		t.Fatalf("release count after server close = %d, want 2", got)
	}
}

func TestPluginPlatformHijackRejectsGenerationRetiredBeforeTracking(t *testing.T) {
	t.Parallel()

	srv := newDistRouteTestServer(t, fstest.MapFS{}, nil)
	var calls atomic.Int32
	var releases atomic.Int32
	srv.acquirePluginSession = func(channelID string) (*session.Meta, func(), bool) {
		if calls.Add(1) == 1 {
			return &session.Meta{ChannelID: channelID}, func() { releases.Add(1) }, true
		}
		return nil, nil, false
	}
	var hijackErr error
	srv.pluginPlatform = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _, hijackErr = w.(http.Hijacker).Hijack()
	})

	writer := newTestHijackWriter(t)
	defer writer.closePeer()
	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil))
	srv.servePluginPlatform(writer, req)
	if hijackErr == nil {
		t.Fatal("Hijack succeeded after the plugin generation retired")
	}
	if got := releases.Load(); got != 1 {
		t.Fatalf("release count = %d, want initial admission release 1", got)
	}
	if got := len(srv.pluginConns); got != 0 {
		t.Fatalf("tracked plugin connections = %d, want 0", got)
	}
}

type testHijackWriter struct {
	header http.Header
	conn   net.Conn
	peer   net.Conn
}

func newTestHijackWriter(t *testing.T) *testHijackWriter {
	t.Helper()
	conn, peer := net.Pipe()
	return &testHijackWriter{header: make(http.Header), conn: conn, peer: peer}
}

func (w *testHijackWriter) Header() http.Header { return w.header }

func (w *testHijackWriter) Write(body []byte) (int, error) { return len(body), nil }

func (w *testHijackWriter) WriteHeader(int) {}

func (w *testHijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return w.conn, bufio.NewReadWriter(bufio.NewReader(w.conn), bufio.NewWriter(w.conn)), nil
}

func (w *testHijackWriter) closePeer() {
	_ = w.peer.Close()
}
