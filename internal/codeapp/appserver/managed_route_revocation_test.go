package appserver

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

type revocableForwardBackend struct {
	stubPortForwardBackend
	registry *pfregistry.Registry
}

func (b *revocableForwardBackend) GetForward(ctx context.Context, id string) (*pfregistry.Forward, error) {
	return b.registry.GetForward(ctx, id)
}
func (b *revocableForwardBackend) ForwardAccessContext(ctx context.Context, id string) (context.Context, func(), error) {
	return b.registry.ForwardAccessContext(ctx, id)
}

func TestManagedRouteRevocationClosesExistingUpgradedStream(t *testing.T) {
	closed := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		defer close(closed)
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
		_ = buffer.Flush()
		_, _ = io.Copy(io.Discard, connection)
	}))
	defer upstream.Close()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	if err := registry.CreateForward(context.Background(), pfregistry.Forward{ForwardID: "demo", TargetURL: upstream.URL, AccessMode: pfregistry.AccessModeUnifiedProxy}); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{Backend: &stubBackend{}, PortForward: &revocableForwardBackend{registry: registry}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}}, ConfigPath: writeLocalUITestConfig(t), ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false }})
	if err != nil {
		t.Fatal(err)
	}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { srv.serveHTTP(w, WithLocalUIPortForwardRoute(r, "demo")) }))
	defer gateway.Close()
	connection, err := net.Dial("tcp", gateway.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = fmt.Fprintf(connection, "GET /pf/demo/socket HTTP/1.1\r\nHost: %s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", gateway.Listener.Addr())
	reader := bufio.NewReader(connection)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 101 {
		t.Fatalf("upgrade status = %d", response.StatusCode)
	}
	if err := registry.DeleteForward(context.Background(), "demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		t.Fatalf("revoked stream remains open: %v", err)
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("revoked upstream connection remains open")
	}
	result, err := http.Get(gateway.URL + "/pf/demo/")
	if err != nil {
		t.Fatal(err)
	}
	defer result.Body.Close()
	if result.StatusCode < 400 {
		t.Fatalf("revoked route still authorizes new requests: %d", result.StatusCode)
	}
}
