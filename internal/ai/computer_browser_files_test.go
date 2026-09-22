package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func browserFileFixture(t *testing.T, handle http.HandlerFunc) (*ComputerUseRuntime, *session.Meta, BrowserViewDescriptor) {
	t.Helper()
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/command" {
			var request struct{ ID string }
			_ = json.NewDecoder(r.Body).Decode(&request)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": true})
			return
		}
		handle(w, r)
	})
	executor := NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", t.TempDir())
	executor.sourceHost = host
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"page": executor}, t.TempDir())
	runtime.browserHost = host
	t.Cleanup(func() { _ = runtime.Close() })
	meta := &session.Meta{ChannelID: "channel", UserPublicID: "user", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	descriptor, err := runtime.OpenBrowserView(t.Context(), meta, BrowserViewRequest{Targets: []string{"page"}})
	if err != nil {
		t.Fatal(err)
	}
	view, _ := runtime.browserView(meta, descriptor.ID)
	view.mu.Lock()
	view.observing = true
	view.expiry.Stop()
	view.mu.Unlock()
	return runtime, meta, descriptor
}

func TestBrowserFilesFenceIdentityAndCancelOnViewClose(t *testing.T) {
	var admitted atomic.Int32
	canceled := make(chan struct{})
	runtime, meta, view := browserFileFixture(t, func(w http.ResponseWriter, r *http.Request) {
		admitted.Add(1)
		if r.URL.Path != "/download" || r.URL.Query().Get("target") != "page" || r.URL.Query().Get("id") != "opaque/id?x" {
			t.Error("file identity was not encoded")
		}
		w.Header().Set("X-Browser-Filename", "report.txt")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(canceled)
	})
	other := *meta
	other.ChannelID = "another"
	if _, err := runtime.OpenBrowserDownload(t.Context(), &other, view.ID, "page", "file"); err == nil {
		t.Fatal("cross-channel download admitted")
	}
	if _, err := runtime.OpenBrowserResource(t.Context(), meta, view.ID, "ungranted", "resource"); err == nil {
		t.Fatal("ungranted page admitted")
	}
	if admitted.Load() != 0 {
		t.Fatal("unauthorized file request reached source")
	}
	response, err := runtime.OpenBrowserDownload(t.Context(), meta, view.ID, "page", "opaque/id?x")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if err := runtime.CloseBrowserView(t.Context(), meta, view.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("view close retained download")
	}
	if _, err := io.ReadAll(response.Body); err == nil {
		t.Fatal("revoked download completed")
	}
}

func TestBrowserUploadStagesOutsideInputGateAndCancelsOnTakeover(t *testing.T) {
	entered, canceled := make(chan struct{}), make(chan struct{})
	runtime, meta, view := browserFileFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/upload" {
			t.Error("unexpected upload route")
		}
		_, _ = io.Copy(io.Discard, r.Body)
		close(entered)
		<-r.Context().Done()
		close(canceled)
	})
	token, err := runtime.AcquireBrowserViewControl(t.Context(), meta, view.ID, "page", false, false)
	if err != nil {
		t.Fatal(err)
	}
	file := BrowserUploadFile{Chooser: "chooser", Name: "note.txt", Size: 3}
	if _, err := runtime.UploadBrowserFile(t.Context(), meta, view.ID, "old", file, strings.NewReader("abc")); err == nil {
		t.Fatal("stale upload token admitted")
	}
	done := make(chan error, 1)
	go func() {
		_, err := runtime.UploadBrowserFile(t.Context(), meta, view.ID, token, file, strings.NewReader("abc"))
		done <- err
	}()
	<-entered
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	lease, err := runtime.acquireBrowserLease(ctx, "page", "next-view", false, true, nil)
	if err != nil {
		t.Fatalf("file transfer blocked takeover: %v", err)
	}
	defer lease.close(context.Background())
	select {
	case <-canceled:
	case <-ctx.Done():
		t.Fatal("takeover retained upload")
	}
	if err := <-done; err == nil {
		t.Fatal("revoked upload returned a usable file identity")
	}
}

func TestBrowserUploadStreamPreservesBinaryBodyAndReturnsOpaqueIdentity(t *testing.T) {
	payload := strings.Repeat("\x00binary\n", 10000)
	runtime, meta, view := browserFileFixture(t, func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != payload {
			t.Errorf("binary upload changed: %d %v", len(body), err)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "staged-file"})
	})
	token, err := runtime.AcquireBrowserViewControl(t.Context(), meta, view.ID, "page", false, false)
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	done := make(chan error, 1)
	go func() { done <- runtime.ServeBrowserStream(t.Context(), server, meta, nil, BrowserUploadStream) }()
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	if err := json.NewEncoder(client).Encode(map[string]any{"view": view.ID, "token": token, "chooser": "chooser", "name": "binary.bin", "size": len(payload)}); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(client)
	var response struct {
		OK bool
		ID string
	}
	if err := browserStreamRequest(reader, 4096, &response); err != nil || !response.OK {
		t.Fatalf("upload admission: %+v %v", response, err)
	}
	if _, err := io.WriteString(client, payload); err != nil {
		t.Fatal(err)
	}
	if err := browserStreamRequest(reader, 4096, &response); err != nil || !response.OK || response.ID != "staged-file" {
		t.Fatalf("upload completion: %+v %v", response, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
