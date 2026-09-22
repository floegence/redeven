package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func browserStreamFixture(t *testing.T, runtime *ComputerUseRuntime, meta *session.Meta, view, kind string) (net.Conn, *bufio.Reader, <-chan error) {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() { _ = server.Close(); _ = client.Close() })
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	done := make(chan error, 1)
	go func() { done <- runtime.ServeBrowserStream(t.Context(), server, meta, nil, kind) }()
	if err := json.NewEncoder(client).Encode(map[string]string{"view": view}); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(client)
	var admission struct {
		OK bool `json:"ok"`
	}
	if err := browserStreamRequest(reader, 4096, &admission); err != nil || !admission.OK {
		t.Fatalf("stream admission: %+v %v", admission, err)
	}
	return client, reader, done
}

func TestBrowserStreamsKeepInputIndependentAndDOMCloseRevokesAllLanes(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	dom, _, domDone := browserStreamFixture(t, runtime, meta, view.ID, BrowserDOMStream)
	media, _, mediaDone := browserStreamFixture(t, runtime, meta, view.ID, BrowserMediaStream)
	// The client deliberately stops consuming media. Its bounded output copy
	// waits on this carrier while control continues on a different stream.
	input, replies, inputDone := browserStreamFixture(t, runtime, meta, view.ID, BrowserInputStream)
	token, err := runtime.AcquireBrowserViewControl(t.Context(), meta, view.ID, "page", false, true)
	if err != nil || token == "" {
		t.Fatalf("control: %q %v", token, err)
	}
	if err := json.NewEncoder(input).Encode(map[string]any{"token": "expired", "message": map[string]any{"type": "command", "id": 1, "tab": "page", "action": map[string]string{"kind": "click"}}}); err != nil {
		t.Fatal(err)
	}
	line, err := readComputerLine(replies, 4096)
	if err != nil {
		t.Fatalf("input waited for media consumption: %v", err)
	}
	var ack struct {
		Type, Code string
		ID         int
		OK         bool
	}
	if json.Unmarshal(line, &ack) != nil || ack.Type != "ack" || ack.ID != 1 || ack.OK || ack.Code != "not_allowed" {
		t.Fatalf("stale input acknowledgement: %s", line)
	}
	_ = dom.Close()
	for _, done := range []<-chan error{domDone, mediaDone, inputDone} {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("closing DOM retained a browser lane or lease")
		}
	}
	_ = media.Close()
	_ = input.Close()
	if _, err := runtime.browserView(meta, view.ID); err == nil {
		t.Fatal("closed observation retained its grant")
	}
	_, unlock, err := runtime.acquireComputerControl(context.Background(), TargetToolCall{TargetID: "page"})
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestBrowserStreamsRejectAnotherAuthenticatedChannel(t *testing.T) {
	runtime, meta, _, _ := browserViewFixture(t)
	view, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	other := *meta
	other.ChannelID = "other-channel"
	server, client := net.Pipe()
	defer client.Close()
	done := make(chan error, 1)
	go func() { done <- runtime.ServeBrowserStream(t.Context(), server, &other, nil, BrowserDOMStream) }()
	if err := json.NewEncoder(client).Encode(map[string]string{"view": view.ID}); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("a different authenticated channel reused the view ID")
	}
}
