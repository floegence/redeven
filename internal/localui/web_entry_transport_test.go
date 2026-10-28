package localui

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
	"github.com/floegence/redeven/internal/webbinding"
	"github.com/floegence/redeven/internal/webconnector"
	"github.com/pquerna/otp/totp"
)

func webConnectorCertificate(t *testing.T) tls.Certificate {
	t.Helper()
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, public, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{raw}, PrivateKey: key, Leaf: cert}
}

type webEntryFixture struct {
	secret        string
	recoveryCodes []string
	runtime       *Server
	bindings      *webbinding.Store
	binding       webbinding.Binding
	proxy         *httptest.Server
	client        *http.Client
	transport     *webconnector.Transport
}

type webGatewayFixture struct {
	store       *gatewaymembership.Store
	connections *gatewaymembership.Connections
}

func newWebGatewayFixture(t *testing.T) *webGatewayFixture {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	store, _ := gatewayfixture.New(t, "https://"+listener.Addr().String(), listener.Addr().String())
	connections := gatewaymembership.NewConnections(gatewayflow.New(0, 0))
	t.Cleanup(connections.Close)
	store.SetCommitHandler(connections.Apply)
	endpoint, err := gatewaymembership.NewListener(store, connections, func(id string) bool { return id == "web-connector" })
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	gateway, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = gateway.Serve(listener) }()
	t.Cleanup(func() { _ = gateway.Close(); <-done })
	return &webGatewayFixture{store: store, connections: connections}
}

type webFixtureOptions struct {
	aiConfig  *config.AIConfig
	browser   bool
	gateway   *webGatewayFixture
	runtimeID string
	enrolled  *gatewaymembership.RuntimeConfig
	lifetime  time.Duration
}

func newWebEntryFixture(t *testing.T, options ...webFixtureOptions) *webEntryFixture {
	t.Helper()
	opts := webFixtureOptions{runtimeID: "runtime_local_ui_test"}
	if len(options) > 0 {
		opts = options[0]
	}
	if opts.runtimeID == "" {
		opts.runtimeID = "runtime_local_ui_test"
	}
	if opts.gateway == nil && opts.enrolled == nil {
		opts.gateway = newWebGatewayFixture(t)
	}
	var store *gatewaymembership.Store
	var connections *gatewaymembership.Connections
	if opts.gateway != nil {
		store, connections = opts.gateway.store, opts.gateway.connections
	}
	lifetime := opts.lifetime
	if lifetime == 0 {
		lifetime = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(t.Context(), lifetime)
	t.Cleanup(cancel)
	var err error
	state := opts.enrolled
	if state == nil {
		invitation, e := store.Invite("test-owner")
		if e != nil {
			t.Fatal(e)
		}
		state, err = gatewaymembership.PrepareRuntime(invitation, opts.runtimeID, gp.MemberMetadata{Hostname: "Web qualification"})
		if err != nil {
			t.Fatal(err)
		}
	}
	var stateMu sync.Mutex
	current := func() *gatewaymembership.RuntimeConfig { stateMu.Lock(); defer stateMu.Unlock(); return state.Clone() }
	persist := func(next *gatewaymembership.RuntimeConfig) error {
		stateMu.Lock()
		defer stateMu.Unlock()
		state = next.Clone()
		return nil
	}
	member, err := gatewaymembership.NewRuntimeConnection(current, persist)
	if err != nil {
		t.Fatal(err)
	}
	gate := accessgate.New(accessgate.Options{Password: "web-runtime-password"})
	var secret string
	var recoveryCodes []string
	if opts.browser {
		authDir := t.TempDir()
		hash, err := accessgate.HashPassword("web-runtime-password")
		if err != nil {
			t.Fatal(err)
		}
		if err = accessgate.WritePasswordHash(authDir, hash); err != nil {
			t.Fatal(err)
		}
		gate, err = accessgate.OpenPersistent(authDir)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = gate.Close() })
		setup, err := gate.Manage("fixture-owner", "Web qualification", accessgate.SecurityRequest{Action: "setup", Password: "web-runtime-password"})
		if err != nil {
			t.Fatal(err)
		}
		code, err := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
		if err != nil {
			t.Fatal(err)
		}
		verified, err := gate.Manage("fixture-owner", "Web qualification", accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = gate.Manage("fixture-owner", "Web qualification", accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
			t.Fatal(err)
		}
		secret, recoveryCodes = setup.Secret, verified.RecoveryCodes
	}
	runtime := newTestServer(t, gate)
	runtime.localPermissionCap = &config.PermissionSet{Read: true, Write: true, Execute: true}
	runtime.a = newRuntimeHealthTestAgentWithAI(t, runtime.configPath, gate, opts.aiConfig, opts.runtimeID)
	runtime.appServer = runtime.a.CodeAppServer()
	bindings, err := webbinding.Open(t.TempDir(), opts.runtimeID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bindings.Close() })
	runtime.webBindings = bindings
	if err = runtime.configureAcceptor(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	proxy := httptest.NewUnstartedServer(nil)
	origin := "https://" + proxy.Listener.Addr().String()
	if opts.browser {
		_, port, _ := net.SplitHostPort(proxy.Listener.Addr().String())
		origin = "https://" + opts.runtimeID + ".localhost:" + port
	}
	certificate := webConnectorCertificate(t)
	binding, err := bindings.Put(webbinding.Binding{RuntimeID: opts.runtimeID, AppScope: "envapp", ID: "entry", Origin: origin, PublicKeySHA256: webbinding.PublicKeyFingerprint(certificate.Leaf), Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	memberDone := make(chan error, 1)
	go func() { memberDone <- member.Run(ctx, runtime.gatewayMemberApplication) }()
	t.Cleanup(func() { cancel(); <-memberDone })
	for (connections != nil && !connections.IsConnected(current().MemberID)) || (connections == nil && member.Snapshot().State != flowersec.ConnectionConnected) {
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if opts.enrolled != nil {
		proxy.Close()
		return &webEntryFixture{secret: secret, recoveryCodes: recoveryCodes, runtime: runtime, bindings: bindings, binding: binding}
	}
	joined := current()
	offer, err := store.AccessOffer(ctx, joined.MemberID, "web-connector")
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := flowersec.ParseArtifact(offer.Artifact)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(joined.GatewayTLSRootPEM))
	session, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: joined.ConnectionEndpoints()[0].Address})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	transport, err := webconnector.New(ctx, webconnector.Options{Session: session, Service: offer.Service, Delegation: offer.Delegation, GatewayID: joined.GatewayID, MemberID: joined.MemberID, RuntimeID: joined.RuntimePublicID, BrowserOrigin: origin, DeviceReference: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ClientCertificate: certificate})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(transport.Close)
	target, _ := url.Parse(offer.Service.Origin)
	proxy.Config.Handler = &httputil.ReverseProxy{Rewrite: func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		r.Out.Host = strings.TrimPrefix(origin, "https://")
		r.Out.Header.Del("X-Forwarded-For")
		r.Out.Header.Del("X-Forwarded-Host")
		r.Out.Header.Del("X-Forwarded-Proto")
	}, Transport: transport}
	if opts.browser {
		certificateDir := t.TempDir()
		certPath, keyPath := filepath.Join(certificateDir, "server.pem"), filepath.Join(certificateDir, "server-key.pem")
		command := exec.CommandContext(ctx, "mkcert", "-cert-file", certPath, "-key-file", keyPath, "127.0.0.1", "localhost", opts.runtimeID+".localhost")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("create trusted browser certificate: %v %s", err, output)
		}
		pair, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			t.Fatal(err)
		}
		proxy.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS13}
	}
	proxy.StartTLS()
	if opts.browser {
		proxy.URL = origin
		proxy.Client().Transport.(*http.Transport).DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", proxy.Listener.Addr().String())
		}
	}
	t.Cleanup(proxy.Close)
	client := proxy.Client()
	client.Timeout = 10 * time.Second
	client.Jar, _ = cookiejar.New(nil)
	return &webEntryFixture{secret: secret, recoveryCodes: recoveryCodes, runtime: runtime, bindings: bindings, binding: binding, proxy: proxy, client: client, transport: transport}
}

func (f *webEntryFixture) request(t *testing.T, method, path, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, f.proxy.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet {
		request.Header.Set("Origin", f.proxy.URL)
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := f.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func TestWebEntryOverRealGateway(t *testing.T) {
	f := newWebEntryFixture(t)
	if len(f.runtime.listeners) != 0 || f.runtime.desktopBridgeListener != nil {
		t.Fatal("Runtime unexpectedly listens on TCP")
	}
	r := f.request(t, "GET", "/api/local/runtime", "")
	if r.StatusCode != http.StatusLocked {
		t.Fatal("public application not locked", r.StatusCode)
	}
	r.Body.Close()
	r = f.request(t, "POST", "/api/local/access/unlock", `{"password":"web-runtime-password"}`)
	if r.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(r.Body)
		t.Fatalf("login: %d %s", r.StatusCode, raw)
	}
	r.Body.Close()
	r = f.request(t, "POST", "/api/local/direct/connect_artifact", "{}")
	if r.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(r.Body)
		t.Fatalf("artifact: %d %s", r.StatusCode, raw)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if envelope.SpendScope.RuntimeOrigin != f.proxy.URL || len(envelope.ConnectArtifact) == 0 {
		t.Fatal("artifact did not retain browser origin")
	}
	f.binding.Enabled = false
	if _, err := f.bindings.Put(f.binding, f.binding.Revision); err != nil {
		t.Fatal(err)
	}
	r = f.request(t, "GET", "/api/local/runtime", "")
	if r.StatusCode != http.StatusMisdirectedRequest {
		t.Fatal("revoked binding still admitted", r.StatusCode)
	}
	r.Body.Close()
}

// This qualification launches an ordinary browser with its normal trust store.
// No Electron runtime or certificate-error bypass is involved.
func TestWebEntryBrowserQualification(t *testing.T) {
	if os.Getenv("REDEVEN_WEB_ENTRY_BROWSER") != "1" {
		t.Skip("set REDEVEN_WEB_ENTRY_BROWSER=1 with mkcert trust installed")
	}
	gateway := newWebGatewayFixture(t)
	first := newWebEntryFixture(t, webFixtureOptions{browser: true, gateway: gateway, runtimeID: "runtime-browser-a"})
	second := newWebEntryFixture(t, webFixtureOptions{browser: true, gateway: gateway, runtimeID: "runtime-browser-b"})
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/revoke-first" {
			http.NotFound(w, r)
			return
		}
		first.binding.Enabled = false
		if _, err := first.bindings.Put(first.binding, first.binding.Revision); err != nil {
			http.Error(w, "revoke failed", 500)
			return
		}
		w.WriteHeader(204)
	}))
	defer control.Close()
	fixture := map[string]any{"targets": []map[string]any{{"origin": first.proxy.URL, "secret": first.secret, "recoveryCodes": first.recoveryCodes}, {"origin": second.proxy.URL, "secret": second.secret, "recoveryCodes": second.recoveryCodes}}, "password": "web-runtime-password", "control": control.URL}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "../../scripts/check_web_entry_browser.mjs", path)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err = command.Run(); err != nil {
		t.Fatal(err)
	}
}
