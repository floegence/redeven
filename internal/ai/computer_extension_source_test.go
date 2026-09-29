package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

func extensionCarrierTestListener(t *testing.T) (string, net.Listener) {
	t.Helper()
	// Keep the Unix socket path short enough for Darwin, independent of the
	// generated test directory and the test name.
	directory, err := os.MkdirTemp("", "browser-pipe-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	listener, err := net.Listen("unix", filepath.Join(directory, "host.sock"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return directory, listener
}

func TestExtensionCarrierCancellationInterruptsPendingHandshake(t *testing.T) {
	directory, listener := extensionCarrierTestListener(t)
	entered, disconnected := make(chan struct{}), make(chan struct{})
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		t.Cleanup(func() { _ = conn.Close() })
		reader := bufio.NewReader(conn)
		if _, err := http.ReadRequest(reader); err != nil {
			return
		}
		close(entered)
		// Withhold the CONNECT response; only cancellation may release this
		// source handshake. No native browser or source effect is involved.
		_, _ = io.Copy(io.Discard, reader)
		close(disconnected)
	}()
	host := &browserSourceHost{directory: directory, ctx: t.Context()}
	client := &computerExtensionClient{}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		pipe, err := host.attachExtension(ctx, client, "fixture-target", "7", "fixture-binding")
		if pipe != nil {
			result <- errors.New("canceled handshake published a source")
			return
		}
		result <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("source handshake did not start")
	}
	started := time.Now()
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation result: %v", err)
		}
		t.Logf("pending source handshake canceled after %s", time.Since(started))
	case <-time.After(500 * time.Millisecond):
		t.Fatal("canceled source handshake waited for the transport deadline")
	}
	select {
	case <-disconnected:
	case <-time.After(time.Second):
		t.Fatal("canceled source handshake kept its socket open")
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.sources) != 0 {
		t.Fatal("canceled source handshake retained a binding")
	}
}

func TestExtensionCarrierOutlivesAdmissionContext(t *testing.T) {
	directory, listener := extensionCarrierTestListener(t)
	received := make(chan json.RawMessage, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		t.Cleanup(func() { _ = conn.Close() })
		reader := bufio.NewReader(conn)
		if _, err := http.ReadRequest(reader); err != nil {
			return
		}
		if _, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			return
		}
		raw, _ := browserbridge.ReadMessage(reader, 1<<20)
		received <- raw
		_, _ = io.Copy(io.Discard, reader)
	}()
	_, client, peer := extensionFixture(t)
	unbound := make(chan error, 1)
	go func() {
		raw, err := browserbridge.ReadMessage(peer, 1<<20)
		var command struct {
			ID, Command string
			Arguments   map[string]string
		}
		if err == nil {
			err = json.Unmarshal(raw, &command)
		}
		if err == nil && (command.Command != "unbind" || command.Arguments["binding"] != "fixture-binding") {
			err = errors.New("unexpected native binding retirement")
		}
		if err == nil {
			err = browserbridge.WriteMessage(peer, map[string]any{"id": command.ID, "result": true}, 1<<20)
		}
		unbound <- err
	}()
	host := &browserSourceHost{directory: directory, ctx: t.Context()}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	pipe, err := host.attachExtension(ctx, client, "fixture-target", "7", "fixture-binding")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pipe.close)
	cancel()
	payload := json.RawMessage(`{"id":"fixture-command","result":true}`)
	if !pipe.enqueue(payload) {
		t.Fatal("finished admission canceled the shared source carrier")
	}
	select {
	case raw := <-received:
		if string(raw) != string(payload) {
			t.Fatalf("source carrier stopped after admission finished: %s", raw)
		}
	case <-time.After(time.Second):
		t.Fatal("source carrier stopped after admission finished")
	}
	if err := pipe.drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := <-unbound; err != nil {
		t.Fatal(err)
	}
}
