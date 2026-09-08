package appserver

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestBoundNativeCodeSpaceHTTP(t *testing.T) {
	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		w.Header().Add("Set-Cookie", "one=1")
		w.Header().Add("Set-Cookie", "two=2")
		w.Header().Set("X-Seen-Origin", r.Header.Get("Origin"))
		_, _ = io.Copy(w, r.Body)
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL)
	port, _ := strconv.Atoi(u.Port())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h, closeHandler, err := NewNativeCodeSpaceHandler(NativeCodeSpaceBinding{CodeSpaceID: "space-one", InstanceID: "instance-one", Port: port, WorkspacePath: "/work/project", Context: ctx})
	if err != nil {
		t.Fatal(err)
	}
	defer closeHandler()
	for _, path := range []string{"/echo?q=1&q=2", "/cs/space-one/echo%2Ffile?x=%2F", "/echo?literal=%zz&x=1;2"} {
		r := httptest.NewRequest("POST", "http://127.0.0.1:42345"+path, strings.NewReader("binary\x00body"))
		r.Header.Set("Origin", "null")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.String() != "binary\x00body" || w.Header().Get("X-Seen-Origin") != "null" || w.Header().Get("Content-Security-Policy") == "" || len(w.Result().Cookies()) != 2 {
			t.Fatalf("native response: %d %s %v", w.Code, w.Body.String(), w.Header())
		}
	}
	if strings.Join(paths, " ") != "/echo?q=1&q=2 /echo%2Ffile?x=%2F /echo?literal=%zz&x=1;2" {
		t.Fatalf("paths %q", paths)
	}
	for _, path := range []string{"/cs/space-two/file", "/_redeven_proxy/api/spaces", "/api/local/status", "/cs%2Fspace-one/echo"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:42345"+path, nil))
		if w.Code < 400 {
			t.Fatalf("reserved path admitted: %s", path)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:42345/", nil))
	if w.Code != 302 || w.Header().Get("Location") != "/?folder=%2Fwork%2Fproject" {
		t.Fatalf("workspace redirect %d %v", w.Code, w.Header())
	}
	cancel()
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:42345/echo", nil))
	if w.Code != http.StatusGone {
		t.Fatalf("stale instance served: %d", w.Code)
	}
}

func TestBoundNativeCodeSpaceCancelsUpgradedConnections(t *testing.T) {
	upstreamClosed := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		defer close(upstreamClosed)
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
		_ = buffer.Flush()
		_, _ = io.Copy(io.Discard, connection)
	}))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler, closeHandler, err := NewNativeCodeSpaceHandler(NativeCodeSpaceBinding{CodeSpaceID: "demo", InstanceID: "generation", Port: upstream.Listener.Addr().(*net.TCPAddr).Port, Context: ctx})
	if err != nil {
		t.Fatal(err)
	}
	defer closeHandler()
	gateway := httptest.NewServer(handler)
	defer gateway.Close()
	connection, err := net.Dial("tcp", gateway.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = fmt.Fprintf(connection, "GET /terminal HTTP/1.1\r\nHost: %s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", gateway.Listener.Addr())
	reader := bufio.NewReader(connection)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 101 {
		t.Fatalf("upgrade failed: %d", response.StatusCode)
	}
	cancel()
	if _, err := reader.ReadByte(); err != io.EOF {
		t.Fatalf("canceled upgrade did not close cleanly: %v", err)
	}
	select {
	case <-upstreamClosed:
	case <-time.After(3 * time.Second):
		t.Fatal("editor upgrade outlived its instance")
	}
}
