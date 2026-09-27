package appserver

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
)

// Native Messaging starts this test binary exactly as it starts the CLI. Reuse
// the actual relay; every other invocation remains the normal Go test runner.
func TestMain(m *testing.M) {
	if len(os.Args) > 3 && os.Args[1] == "browser-bridge" {
		if err := browserbridge.Forward(context.Background(), os.Args[2], os.Args[3], os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// This opt-in product check uses the built browser document, the published
// Flowersec browser client and real Runtime stream/HTTP handlers. The client
// blocks source-site traffic and the public server has no proxy HTTP fallback.
func TestBrowserProjectionUsesOneFlowersecSession(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 after building the Env App")
	}
	var soak time.Duration
	if value := os.Getenv("REDEVEN_BROWSER_SOAK_SECONDS"); value != "" {
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds < 60 || seconds > 3600 {
			t.Fatal("soak duration must be 60..3600 seconds")
		}
		soak = time.Duration(seconds) * time.Second
	}
	qualificationTimeout := soak + 90*time.Second
	if os.Getenv("REDEVEN_BROWSER_PERFORMANCE_EVIDENCE") != "" {
		qualificationTimeout += 2 * time.Minute
	}
	if os.Getenv("REDEVEN_BROWSER_SITES_EVIDENCE") != "" {
		qualificationTimeout += 8 * time.Minute
	}
	ctx, cancel := context.WithTimeout(t.Context(), qualificationTimeout)
	defer cancel()
	ui, err := filepath.Abs("../../envapp/ui_src")
	if err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	arguments := []string{"scripts/checkBrowserProjection.mjs"}
	if soak > 0 {
		arguments = append([]string{"--expose-gc"}, arguments...)
	}
	cmd := exec.CommandContext(ctx, node, arguments...)
	cmd.Dir, cmd.Stderr = ui, os.Stderr
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = input.Close()
		if cmd.ProcessState == nil {
			_ = cmd.Process.Signal(syscall.SIGTERM)
			_ = cmd.Wait()
		}
	}()
	reader := bufio.NewScanner(output)
	reader.Buffer(make([]byte, 4096), 1<<20)
	if !reader.Scan() {
		t.Fatal("browser fixture did not start", reader.Err())
	}
	var fixture struct{ Origin, Endpoint, Tab, Profile, Certificate, Key, Resources string }
	managed := os.Getenv("REDEVEN_BROWSER_SOURCE") == "managed"
	if err := json.Unmarshal(reader.Bytes(), &fixture); err != nil {
		t.Fatal(err, reader.Text())
	}
	registry := ai.NewTargetRegistry()
	if err := registry.Register(ai.TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture"}); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(ui, "scripts/redevenComputerHost.mjs")
	if fixture.Resources != "" {
		helper = filepath.Join(fixture.Resources, "redevenComputerHost.mjs")
	}
	if override := os.Getenv("REDEVEN_BROWSER_TEST_HELPER"); override != "" {
		if !filepath.IsAbs(override) {
			t.Fatal("local debug helper must be absolute")
		}
		helper = override
	}
	profileDirectory := t.TempDir()
	runtime := ai.NewComputerUseRuntime(registry, map[string]ai.TargetToolExecutor{
		"browser-main": ai.NewPlaywrightTargetExecutor(node, helper, profileDirectory),
	}, t.TempDir())
	runtime.ConfigureManagedBrowser(t.TempDir())
	defer runtime.Close()
	meta := &session.Meta{ChannelID: "browser-projection", EndpointID: "env_local", UserPublicID: "browser-user", CodeSpaceID: "env-ui", FloeApp: "com.floegence.redeven.agent", CanRead: true, CanWrite: true, CanExecute: true}
	connection := ai.ComputerBrowserConnection{CDPURL: fixture.Endpoint, ProfileID: fixture.Profile, TabID: fixture.Tab}
	if managed {
		installBrowserProjectionPackage(t, ctx, runtime, meta)
		tabs, err := runtime.ManagedBrowserTabs(ctx, meta, "browser-main")
		if err != nil || len(tabs) != 1 {
			t.Fatalf("managed source: %+v %v", tabs, err)
		}
		connection = ai.ComputerBrowserConnection{ManagedProfileID: "browser-main", TabID: tabs[0].ID}
		if err := json.NewEncoder(input).Encode(map[string]any{"managedProfileDirectory": filepath.Join(profileDirectory, "browser-main")}); err != nil {
			t.Fatal(err)
		}
		if !reader.Scan() || string(reader.Bytes()) != `{"managedReady":true}` {
			t.Fatal("managed source fixture did not attach", reader.Text(), reader.Err())
		}
	}

	if fixture.Resources != "" {
		installations, err := browserbridge.Installations()
		if err != nil || len(installations) == 0 {
			t.Fatal("browser discovery unavailable", err)
		}
		kind := os.Getenv("REDEVEN_BROWSER_TEST_INSTALLATION_KIND")
		if kind == "" {
			kind = "google_chrome"
		}
		var selected browserbridge.Installation
		for _, installation := range installations {
			if installation.Kind == kind {
				selected = installation
			}
		}
		if selected.ID == "" {
			t.Fatal("requested browser installation is unavailable", kind)
		}
		setup, err := runtime.BrowserExtensionSetup(ctx, meta, selected.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(setup.ExtensionPath)
		if err = json.NewEncoder(input).Encode(map[string]any{"nativeHost": setup.NativeHost, "extensionID": setup.ExtensionID, "nativeManifestDirectory": selected.ManifestDirectory}); err != nil {
			t.Fatal(err)
		}
		if !reader.Scan() {
			t.Fatal("extension did not connect", reader.Err())
		}
		var connected struct {
			Connected              bool
			SourceURL, SourceTitle string
		}
		if json.Unmarshal(reader.Bytes(), &connected) != nil || !connected.Connected {
			t.Fatal("invalid extension connection", reader.Text())
		}
		status, err := runtime.BrowserExtensionStatus(meta)
		if err != nil || len(status.Profiles) != 1 {
			t.Fatalf("extension profiles: %+v, %v", status, err)
		}
		tabs, err := runtime.BrowserExtensionTabs(ctx, meta, status.Profiles[0].ID)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, tab := range tabs {
			if tab.URL == connected.SourceURL+"/" {
				connection = ai.ComputerBrowserConnection{ExtensionProfileID: status.Profiles[0].ID, TabID: tab.ID, TabURL: tab.URL, TabTitle: tab.Title}
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("source tab missing: %+v", tabs)
		}
	}
	target, err := runtime.ConnectBrowser(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{Backend: &stubBackend{}, DistFS: os.DirFS(filepath.Join(ui, "../ui/dist")), ConfigPath: writeTestConfig(t), ResolveSessionMeta: func(channel string) (*session.Meta, bool) { return meta, channel == meta.ChannelID }, ListenAddr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	srv.browserRuntime = runtime
	var resourceRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This listener is private to the authenticated Flowersec ProxyServer.
		r.Header.Set(sessionhop.HeaderChannelID, meta.ChannelID)
		if strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/browser/views/") && strings.HasSuffix(r.URL.Path, "/resource") && r.URL.Query().Get("target") != "" && r.URL.Query().Get("id") != "" {
			resourceRequests.Add(1)
		}
		srv.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{ai.BrowserDOMStream, ai.BrowserInputStream, ai.BrowserMediaStream, ai.BrowserUploadStream} {
		if err := handlers.HandleStream(kind, func(ctx context.Context, incoming flowersec.IncomingStream) error {
			return runtime.ServeBrowserStream(ctx, incoming.Stream, meta, nil, kind)
		}); err != nil {
			t.Fatal(err)
		}
	}
	proxy, err := flowersec.NewProxyServer(flowersec.ProxyServerOptions{Upstream: upstream.URL, UpstreamOrigin: fixture.Origin})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	if err := proxy.RegisterStreamHandlers(handlers); err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.LoadX509KeyPair(fixture.Certificate, fixture.Key)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if network := os.Getenv("REDEVEN_BROWSER_NETWORK"); network != "" {
		if network != "80ms-10mbps" {
			t.Fatal("unsupported browser qualification network")
		}
		listener = browserQualificationNetwork{Listener: listener}
	}
	endpoints, err := controlplane.NewEndpointSet(controlplane.EndpointConfig{ID: "browser-fixture", URL: "wss://" + listener.Addr().String() + flowersec.WebSocketDirectPath, TLS: controlplane.CAPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{Session: controlplane.SessionOptions{ChannelID: meta.ChannelID, ExpiresAt: time.Now().Add(3 * time.Minute), IdleTimeout: time.Minute, MaxInboundStreams: 64}, Endpoints: endpoints, RendezvousGroupID: "browser-fixture", ListenerAudience: "browser-fixture", UpstreamAddress: listener.Addr().String()})
	if err != nil {
		t.Fatal(err)
	}
	var sessions atomic.Int32
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{AllowedOrigins: []string{fixture.Origin}, MaxInboundStreams: 64,
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			return controlplane.AuthorizeRuntime(request, issued.AuthorizationRecord(), "browser-fixture")
		},
		ResolveHandlers: func(context.Context, controlplane.RuntimeAuthorizationRequest) (*flowersec.SessionHandlers, error) {
			return handlers, nil
		},
		OnSession: func(ctx context.Context, _ flowersec.Session, _ string) error {
			sessions.Add(1)
			<-ctx.Done()
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	server, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{Handler: acceptor.Handler(), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	if err := json.NewEncoder(input).Encode(map[string]any{"artifact": string(issued.ArtifactJSON()), "target": target.ID, "runtimePID": os.Getpid(), "connection": connection, "managed": managed}); err != nil {
		t.Fatal(err)
	}
	for reader.Scan() {
		t.Log(reader.Text())
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if sessions.Load() != 1 {
		t.Fatalf("browser windows opened %d sessions", sessions.Load())
	}
	if resourceRequests.Load() < 2 {
		t.Fatalf("only %d resource requests used the authenticated Runtime", resourceRequests.Load())
	}
}

// Exercise the public installer against the exact catalog archive. This is a
// task-owned Runtime installation, never an alias to a Playwright browser cache.
func installBrowserProjectionPackage(t *testing.T, ctx context.Context, runtime *ai.ComputerUseRuntime, meta *session.Meta) {
	t.Helper()
	packagePath := os.Getenv("REDEVEN_BROWSER_TEST_PACKAGE")
	if !filepath.IsAbs(packagePath) {
		t.Fatal("managed qualification requires an absolute catalog package archive")
	}
	archive, err := os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	status, err := runtime.ComputerBrowserInstallation(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	status, err = runtime.InstallComputerBrowser(ctx, meta, ai.ComputerBrowserInstallRequest{Action: "start", Source: "upload", PackageID: status.Package.ID})
	if err != nil {
		t.Fatal(err)
	}
	operation := status.OperationID
	buffer := make([]byte, 256*1024)
	var offset int64
	for {
		n, readErr := archive.Read(buffer)
		if n > 0 {
			_, err = runtime.InstallComputerBrowser(ctx, meta, ai.ComputerBrowserInstallRequest{Action: "chunk", OperationID: operation, Offset: offset, Data: base64.StdEncoding.EncodeToString(buffer[:n])})
			if err != nil {
				t.Fatal(err)
			}
			offset += int64(n)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			t.Fatal(readErr)
		}
	}
	_, err = runtime.InstallComputerBrowser(ctx, meta, ai.ComputerBrowserInstallRequest{Action: "complete", OperationID: operation})
	if err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err = runtime.ComputerBrowserInstallation(ctx, meta)
		if err != nil {
			t.Fatal(err)
		}
		if status.State == "installed" {
			break
		}
		if status.Error != "" {
			t.Fatalf("managed install: %s", status.Error)
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
