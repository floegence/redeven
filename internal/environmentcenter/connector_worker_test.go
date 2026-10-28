package environmentcenter

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
)

type connectorRoundTripFixture struct {
	call func(*http.Request) (*http.Response, error)
}

func (f connectorRoundTripFixture) RoundTrip(r *http.Request) (*http.Response, error) {
	return f.call(r)
}
func (connectorRoundTripFixture) Close() {}

func TestConnectorProxyPreservesTransportFailuresWithoutTrustingRuntimeHeaders(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		status int
		want   string
	}{
		{"offline", &gatewayError{Code: "MEMBER_OFFLINE"}, 0, "MEMBER_OFFLINE"},
		{"permission", ErrDenied, 0, "CENTER_ACCESS_DENIED"},
		{"private detail", errors.New("private endpoint or credential detail"), 0, "CENTER_CONNECTION_FAILED"},
		{"successful application", nil, 200, ""},
		{"application failure", nil, 502, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			worker := &connectorWorker{leases: map[string]*connectorLease{"lease": {owner: connectorRoundTripFixture{call: func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Header.Get("X-Redeven-Connector-Target") != "" {
					t.Error("IPC target header leaked to Runtime")
				}
				if test.err != nil {
					return nil, test.err
				}
				return &http.Response{StatusCode: test.status, Header: http.Header{connectorErrorHeader: {"MEMBER_OFFLINE"}}, Body: io.NopCloser(strings.NewReader("business response"))}, nil
			}}}}}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				worker.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ownerKey{}, true)))
			}))
			defer server.Close()
			transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
			}}
			defer transport.CloseIdleConnections()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			owner := &workerConnection{ctx: ctx, input: connectorLeaseRequest{Route: storedRoute{Route: Route{RuntimeID: "runtime-test", Origin: "https://env.example.test"}}}, current: &workerGeneration{lease: "lease", transport: transport, ctx: ctx}}
			request := httptest.NewRequest("POST", gatewaymembership.ServiceOrigin("runtime-test")+"/business", strings.NewReader("one mutation"))
			request.Host = "env.example.test"
			response, err := owner.RoundTrip(request)
			if test.want != "" {
				if err == nil || connectionCode(err) != test.want {
					t.Fatalf("classification: %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				if response.StatusCode != test.status || response.Header.Get(connectorErrorHeader) != "" {
					t.Fatal("Runtime response changed or trusted as Connector authority")
				}
			}
			if calls != 1 {
				t.Fatalf("business request replayed: %d", calls)
			}
		})
	}
}

func TestConnectorPreservesLeaseFailureClassification(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "rdv-worker-error-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	socket := filepath.Join(root, "worker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"Protocol": 1, "Error": "MEMBER_OFFLINE"})
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	owner := &workerConnection{ctx: ctx, cancel: cancel, socket: socket, uid: os.Geteuid(), input: connectorLeaseRequest{Protocol: 1}}
	_, err = owner.generation(ctx)
	if err == nil || connectionCode(err) != "MEMBER_OFFLINE" {
		t.Fatalf("worker lost actionable failure: %v", err)
	}
}

func TestConnectionCodeExposesOnlyBoundedMachineCodes(t *testing.T) {
	for _, code := range []string{"", "secret@example.test", "private key material", strings.Repeat("A", 81), "MEMBER_OFFLINE\nsecret"} {
		if got := connectionCode(&gatewayError{Code: code}); got != "CENTER_CONNECTION_FAILED" {
			t.Fatalf("unsafe error code escaped: %q", got)
		}
	}
	for _, code := range []string{"MEMBER_OFFLINE", "CENTER_BUSY", "CENTER_ACCESS_DENIED", "CENTER_CONNECTOR_UNSUPPORTED"} {
		if got := connectionCode(&gatewayError{Code: code}); got != code {
			t.Fatalf("machine code lost: %q", got)
		}
	}
}

func TestConnectorChecksActualPeerBeforeAcceptingSecrets(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "rdv-worker-peer-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	socket := filepath.Join(root, "connector.sock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- ServeConnector(ctx, socket, os.Geteuid()+1) }()
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Second}
	var response *http.Response
	for range 100 {
		response, err = client.Post("http://connector/v1/leases", "application/json", strings.NewReader("{}"))
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected peer response: %d", response.StatusCode)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestConnectorRejectsUnknownProtocolAndExpiredLease(t *testing.T) {
	worker := &connectorWorker{leases: map[string]*connectorLease{}}
	for _, input := range []struct {
		method, path, body string
		status             int
	}{
		{"POST", "/v1/leases", `{"Protocol":2}`, 400},
		{"POST", "/v1/leases", `{"Protocol":1,"arbitrary_command":"id"}`, 400},
		{"GET", "/v1/proxy/replayed-after-restart", "", 503},
	} {
		request := httptest.NewRequest(input.method, "http://connector"+input.path, strings.NewReader(input.body))
		request.Header.Set("Content-Type", "application/json")
		request = request.WithContext(context.WithValue(request.Context(), ownerKey{}, true))
		response := httptest.NewRecorder()
		worker.ServeHTTP(response, request)
		if response.Code != input.status {
			t.Fatalf("%s: %d", input.path, response.Code)
		}
	}
}

func TestConnectorCanceledOwnerCannotRecreateLease(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	owner := &workerConnection{ctx: ctx, cancel: cancel, socket: "/tmp/nonexistent-connector"}
	if _, err := owner.generation(context.Background()); err != ErrDenied {
		t.Fatalf("canceled owner recreated worker lease: %v", err)
	}
}

func TestConnectorClientVerifiesServerUIDBeforeSendingRouteSecrets(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "rdv-worker-spoof-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	socket := filepath.Join(root, "socket")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	bytesRead := make(chan int, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 4096)
		n, _ := conn.Read(buf)
		bytesRead <- n
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	owner := &workerConnection{ctx: ctx, cancel: cancel, socket: socket, uid: os.Geteuid() + 1, input: connectorLeaseRequest{Protocol: 1, Gateway: GatewayRecord{ClientPrivateKey: "must-not-be-sent"}}}
	if _, err := owner.generation(ctx); err == nil {
		t.Fatal("untrusted worker accepted")
	}
	select {
	case n := <-bytesRead:
		if n != 0 {
			t.Fatalf("sent %d bytes before authenticating worker", n)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker handshake stalled")
	}
}

func TestConnectorSocketRefusesExistingFileAndActiveOwner(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "rdv-worker-lock-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	file := filepath.Join(root, "file")
	if err = os.WriteFile(file, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = ServeConnector(context.Background(), file, os.Geteuid()); err == nil {
		t.Fatal("replaced ordinary file")
	}
	value, _ := os.ReadFile(file)
	if string(value) != "preserve" {
		t.Fatal("changed existing file")
	}
	socket := filepath.Join(root, "live")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		c, e := listener.Accept()
		if e == nil {
			defer c.Close()
			_, _ = io.Copy(io.Discard, c)
		}
	}()
	if err = ServeConnector(context.Background(), socket, os.Geteuid()); err == nil {
		t.Fatal("replaced live socket")
	}
}
