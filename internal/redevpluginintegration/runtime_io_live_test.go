//go:build plugin_runtime_e2e

package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/bridge"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/runtimetarget"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

func TestPublishedAuthorWorkerRunsThroughRedevenRuntime(t *testing.T) {
	invoke := openLivePluginWorker(t, "REDEVEN_TEST_AUTHOR_PLUGIN_PACKAGE", "dev.redeven.qualification.worker.view")
	result, err := invoke("worker.echo", map[string]any{"message": "published author workflow"})
	if err != nil {
		t.Fatalf("invoke author worker: %v", err)
	}
	data, ok := result.Data.(map[string]any)
	if !ok || data["message"] != "published author workflow" || data["backend"] != "executed wasm worker scaffold" || data["transport"] != "rust runtime ipc" {
		t.Fatalf("unexpected worker result: %#v", result.Data)
	}
	_, err = invoke("worker.echo", map[string]any{"message": ""})
	workerError, ok := host.AsValidatedWorkerExecutionError(err)
	if !ok || workerError.Code != "INVALID_REQUEST" || workerError.Origin != host.WorkerErrorOriginPlugin {
		t.Fatalf("worker validation error lost: %T: %v", err, err)
	}
	result, err = invoke("worker.echo", map[string]any{"message": "after validation error"})
	if err != nil {
		t.Fatalf("invoke after worker rejection: %v", err)
	}
	data, ok = result.Data.(map[string]any)
	if !ok || data["message"] != "after validation error" {
		t.Fatalf("unexpected subsequent result: %#v", result.Data)
	}
}

func TestRecoveredRuntimeFirstInvocationReachesWorkerAfterFilesystemHostcalls(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the full I/O fixture requires the published Linux filesystem-watch implementation")
	}
	invoke := openLivePluginWorker(t, "REDEVEN_TEST_PLUGIN_PACKAGE", "io.view")
	fullIO := os.Getenv("REDEVEN_TEST_PLUGIN_IO_FULL") == "1"
	port := func(name string) float64 {
		if !fullIO {
			return 1
		}
		value, parseErr := strconv.ParseUint(os.Getenv(name), 10, 16)
		if parseErr != nil || value == 0 {
			t.Fatalf("%s is invalid", name)
		}
		return float64(value)
	}
	smokeParams := map[string]any{"server": map[string]any{
		"http": port("REDEVEN_TEST_PLUGIN_IO_HTTP_PORT"),
		"ws":   port("REDEVEN_TEST_PLUGIN_IO_WS_PORT"),
		"tcp":  port("REDEVEN_TEST_PLUGIN_IO_TCP_PORT"),
		"udp":  port("REDEVEN_TEST_PLUGIN_IO_UDP_PORT"),
	}}
	result, err := invoke("smoke.run", smokeParams)
	if fullIO {
		if workerError, ok := host.AsValidatedWorkerExecutionError(err); ok {
			t.Fatalf("full invocation worker error: %+v", workerError)
		}
		if err != nil {
			t.Fatalf("full invocation: %T: %+v", err, err)
		}
		encoded, err := json.Marshal(result.Data)
		if err != nil {
			t.Fatal(err)
		}
		var evidence struct {
			FS struct {
				Bytes                             int64
				SHA256                            string
				ExpectedSHA256                    string `json:"expected_sha256"`
				List, Stat, Rename, Watch, Remove bool
			}
			HTTP struct {
				DownloadBytes int64 `json:"download_bytes"`
				UploadBytes   int64 `json:"upload_bytes"`
				RequestBytes  int64 `json:"request_bytes"`
				Requests      int   `json:"requests_per_direction"`
				UploadLimit   bool  `json:"upload_limit_enforced"`
				DownloadLimit bool  `json:"download_limit_enforced"`
			}
			WebSocket struct{ Messages int }
			TCP       struct{ Exchanges int }
			UDP       struct{ Datagrams int }
		}
		if err := json.Unmarshal(encoded, &evidence); err != nil {
			t.Fatal(err)
		}
		if evidence.FS.Bytes != 64<<20 || evidence.FS.SHA256 != evidence.FS.ExpectedSHA256 || !evidence.FS.List || !evidence.FS.Stat || !evidence.FS.Rename || !evidence.FS.Watch || !evidence.FS.Remove || evidence.HTTP.DownloadBytes != 64<<20 || evidence.HTTP.UploadBytes != 64<<20 || evidence.HTTP.RequestBytes != 1<<20 || evidence.HTTP.Requests != 64 || !evidence.HTTP.UploadLimit || !evidence.HTTP.DownloadLimit || evidence.WebSocket.Messages != 100 || evidence.TCP.Exchanges != 100 || evidence.UDP.Datagrams != 100 {
			t.Fatalf("incomplete I/O evidence: %s", encoded)
		}
		t.Logf("verified I/O evidence: %s", encoded)
		return
	}
	workerError, ok := host.AsValidatedWorkerExecutionError(err)
	if !ok {
		t.Fatalf("first invocation did not reach the worker's network probe: %T: %v", err, err)
	}
	if workerError.Origin != host.WorkerErrorOriginPlugin || workerError.Code != "NETWORK_ERROR" {
		t.Fatalf("first invocation failed before completing filesystem hostcalls: %+v", workerError)
	}
}

func TestLiveWorkerRevokeClosesPendingNetworkResources(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getenv("REDEVEN_TEST_PLUGIN_IO_FULL") != "1" {
		t.Skip("requires the isolated Linux I/O target")
	}
	var integration *Integration
	var ctx context.Context
	var id string
	var revision uint64
	invoke := openLivePluginWorker(t, "REDEVEN_TEST_PLUGIN_PACKAGE", "io.view", func(i *Integration, c context.Context, plugin string, r uint64) {
		integration, ctx, id, revision = i, c, plugin, r
	})
	port := func(key string) float64 {
		v, err := strconv.Atoi(os.Getenv(key))
		if err != nil {
			t.Fatal(err)
		}
		return float64(v)
	}
	params := map[string]any{"server": map[string]any{"http": port("REDEVEN_TEST_PLUGIN_IO_HTTP_PORT"), "ws": port("REDEVEN_TEST_PLUGIN_IO_WS_PORT"), "tcp": port("REDEVEN_TEST_PLUGIN_IO_TCP_PORT"), "udp": port("REDEVEN_TEST_PLUGIN_IO_UDP_PORT")}}
	done := make(chan error, 1)
	go func() { _, err := invoke("smoke.hold", params); done <- err }()
	stateURL := fmt.Sprintf("http://127.0.0.1:%.0f/state", port("REDEVEN_TEST_PLUGIN_IO_HTTP_PORT"))
	client := &http.Client{Timeout: 2 * time.Second}
	state := func() map[string]int {
		response, err := client.Get(stateURL)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var v map[string]int
		if err := json.NewDecoder(response.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		select {
		case err := <-done:
			workerError, _ := host.AsValidatedWorkerExecutionError(err)
			t.Fatalf("hold stopped before resources opened: %T: %+v; worker: %+v", err, err, workerError)
		default:
		}
		v := state()
		if v["http_active"] > 0 && v["ws_active"] > 0 && v["tcp_active"] > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("resources did not open: %+v", v)
		}
		time.Sleep(10 * time.Millisecond)
	}
	disableCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, err := integration.host.DisablePlugin(disableCtx, host.DisableRequest{PluginInstanceID: id, ExpectedManagementRevision: revision, Reason: "user_disabled"})
	if err != nil {
		events, _ := integration.host.ListDiagnosticEvents(ctx, host.ListDiagnosticEventsRequest{PluginInstanceID: id, Limit: 50})
		t.Fatalf("disable error: %T: %+v; events: %+v; fixture: %+v", err, err, events, state())
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("pending invocation succeeded after revoke")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pending invocation did not settle")
	}
	deadline = time.Now().Add(5 * time.Second)
	for {
		v := state()
		if v["http_active"] == 0 && v["ws_active"] == 0 && v["tcp_active"] == 0 && v["http_closed"] > 0 && v["ws_closed"] > 0 && v["tcp_closed"] > 0 {
			t.Logf("revocation completed; pending invocation rejected; fixture: %+v", v)
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("resources remain active: %+v", v)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func openLivePluginWorker(t *testing.T, packageVariable, surfaceID string, capture ...func(*Integration, context.Context, string, uint64)) func(string, map[string]any) (host.CallMethodResult, error) {
	t.Helper()
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("the production plugin runtime requires Linux or macOS")
	}
	runtimePath := os.Getenv("REDEVEN_TEST_PLUGIN_RUNTIME")
	packagePath := os.Getenv(packageVariable)
	if runtimePath == "" || packagePath == "" {
		t.Skipf("REDEVEN_TEST_PLUGIN_RUNTIME and %s are required", packageVariable)
	}
	packageBytes, err := os.ReadFile(packagePath)
	if err != nil {
		t.Fatal(err)
	}

	const channelID = "channel_runtime_io_live"
	permissionPolicy := testPermissionPolicy(t, "execute_read_write")
	meta := &session.Meta{
		ChannelID: channelID, EndpointID: "env_runtime_io_live", UserPublicID: "user_runtime_io_live",
		CodeSpaceID: "env-ui", FloeApp: "com.floegence.redeven.agent",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	stateDir := t.TempDir()
	integration, err := New(context.Background(), Options{
		StateDir:         stateDir,
		AgentHomeDir:     t.TempDir(),
		PermissionPolicy: permissionPolicy,
		RuntimePath:      runtimePath,
		ResolveSessionMeta: func(got string) (*session.Meta, bool) {
			return meta, got == channelID
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := integration.Close(); err != nil {
			t.Errorf("close integration: %v", err)
		}
	})

	prime := httptest.NewRequest(http.MethodPost, "/_redevplugin/api/plugins/catalog/query", bytes.NewReader([]byte("{}")))
	prime.Host = "env.example.test"
	prime.Header.Set("Content-Type", "application/json")
	prime.Header.Set("Origin", "https://env.example.test")
	prime.Header.Set(csrfHeader, csrfProof)
	prime.Header.Set(sessionhop.HeaderChannelID, channelID)
	prime = WithRouteRole(prime, RouteRoleEnvTrusted)
	prime, err = WithTrustedOrigin(prime, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	primeResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(primeResponse, prime)
	if primeResponse.Code != http.StatusOK {
		t.Fatalf("prime authenticated plugin session status = %d body = %s", primeResponse.Code, primeResponse.Body.String())
	}

	resolved, err := canonicalPluginSessionContextFromMeta(channelID, meta)
	if err != nil {
		t.Fatal(err)
	}
	permissionCap := permissionPolicy.ResolveCap(meta.UserPublicID, meta.FloeApp)
	resolved.CanRead = meta.CanRead && permissionCap.Read
	resolved.CanWrite = meta.CanWrite && permissionCap.Write
	ctx := sessionctx.WithContext(context.Background(), resolved)
	ctx = context.WithValue(ctx, trustedOriginContextKey{}, "https://env.example.test")
	target, err := runtimetarget.Current()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := integration.host.StartRuntime(ctx, host.StartRuntimeRequest{Target: target}); err != nil {
		t.Fatalf("start runtime: %v", err)
	}

	now := time.Now().UTC().Add(-time.Minute)
	inspection, err := integration.host.InspectUploadedExternalPackage(ctx, host.InspectUploadedExternalPackageRequest{
		Intent:  host.ExternalPackageIntent{Action: "install"},
		Package: bytes.NewReader(packageBytes), DeclaredSize: int64(len(packageBytes)), Now: now,
	})
	if err != nil {
		t.Fatalf("inspect v9 package: %v", err)
	}
	installed, err := integration.host.InstallInspectedPackage(ctx, host.InstallInspectedPackageRequest{
		InspectionID: inspection.InspectionID, ExpectedPackageSHA256: inspection.InspectedHashes.PackageSHA256,
		Now: now.Add(time.Second),
	})
	if err != nil {
		t.Fatalf("install v9 package: %v", err)
	}
	if installed.Plugin == nil {
		t.Fatal("installed package has no plugin record")
	}
	// Installation and execution grants are independent platform decisions.
	for _, permission := range inspection.SecuritySummary.Permissions {
		granted, err := integration.host.GrantPermission(ctx, host.GrantPermissionRequest{
			PluginInstanceID: installed.Plugin.PluginInstanceID, PermissionID: permission.PermissionID,
			ExpectedPolicyRevision:     installed.Plugin.PolicyRevision,
			ExpectedManagementRevision: installed.Plugin.ManagementRevision,
			ExpectedRevokeEpoch:        installed.Plugin.RevokeEpoch,
			Now:                        now.Add(2 * time.Second),
		})
		if err != nil {
			t.Fatalf("grant execution permission: %v", err)
		}
		installed.Plugin.PolicyRevision = granted.Revisions.PolicyRevision
		installed.Plugin.ManagementRevision = granted.Revisions.ManagementRevision
		installed.Plugin.RevokeEpoch = granted.Revisions.RevokeEpoch
	}
	if surfaceID == "io.view" {
		for _, connector := range []struct{ id, scheme, port, suffix string }{
			{"http", "http", "REDEVEN_TEST_PLUGIN_IO_HTTP_PORT", "/"}, {"ws", "ws", "REDEVEN_TEST_PLUGIN_IO_WS_PORT", ""},
			{"tcp", "tcp", "REDEVEN_TEST_PLUGIN_IO_TCP_PORT", ""}, {"udp", "udp", "REDEVEN_TEST_PLUGIN_IO_UDP_PORT", ""},
		} {
			port := "1"
			if os.Getenv("REDEVEN_TEST_PLUGIN_IO_FULL") == "1" {
				port = os.Getenv(connector.port)
			}
			req := host.ReviewConnectionRequest{PluginInstanceID: installed.Plugin.PluginInstanceID, ConnectorID: "smoke." + connector.id, Destination: fmt.Sprintf("%s://127.0.0.1:%s%s", connector.scheme, port, connector.suffix), PrivatePrefixes: []string{"127.0.0.1/32"}}
			if connector.id == "http" {
				req.HTTPMethods = []string{"GET", "POST"}
			}
			review, err := integration.host.ReviewConnection(ctx, req)
			if err != nil {
				t.Fatalf("review %s: %v", connector.id, err)
			}
			if _, err := integration.host.ApproveConnection(ctx, host.ConnectionReviewRequest{PluginInstanceID: installed.Plugin.PluginInstanceID, ReviewID: review.ReviewID}); err != nil {
				t.Fatalf("approve %s: %v", connector.id, err)
			}
		}
	}
	if recovery, err := integration.host.RetryPluginRecovery(ctx, installed.Plugin.PluginInstanceID); err != nil {
		t.Fatalf("retry runtime recovery: %v", err)
	} else if recovery.Status != host.PluginRecoveryReady {
		t.Fatalf("runtime recovery = %+v", recovery)
	}

	const surfaceInstanceID = "surface_runtime_io_live"
	const bridgeChannelID = "bridge_runtime_io_live"
	bootstrap, err := integration.host.OpenSurface(ctx, host.OpenSurfaceRequest{
		PluginInstanceID:           installed.Plugin.PluginInstanceID,
		ExpectedManagementRevision: installed.Plugin.ManagementRevision,
		SurfaceID:                  surfaceID, SurfaceInstanceID: surfaceInstanceID, Now: now.Add(2 * time.Second),
	})
	if err != nil {
		t.Fatalf("open surface: %v", err)
	}
	prepared, err := integration.host.PrepareSurface(ctx, host.PrepareSurfaceRequest{
		SurfaceInstanceID: surfaceInstanceID, AssetTicket: bootstrap.AssetTicket, Now: now.Add(3 * time.Second),
	})
	if err != nil {
		t.Fatalf("prepare surface: %v", err)
	}
	handshake := bridge.Handshake{
		PluginID: bootstrap.PluginID, SurfaceID: bootstrap.SurfaceID,
		SurfaceInstanceID: bootstrap.SurfaceInstanceID, ActiveFingerprint: bootstrap.ActiveFingerprint,
		BridgeNonce: bootstrap.BridgeNonce, AssetSessionNonce: prepared.AssetSessionNonce,
		ManagementRevision: bootstrap.ManagementRevision, RevokeEpoch: bootstrap.RevokeEpoch,
	}
	gateway, err := integration.host.MintBridgeToken(ctx, host.MintBridgeTokenRequest{
		Handshake: handshake, BridgeChannelID: bridgeChannelID,
		HandshakeTranscriptSHA256: bridge.HandshakeTranscriptSHA256(handshake, bridgeChannelID),
		Now:                       now.Add(4 * time.Second),
	})
	if err != nil {
		t.Fatalf("mint bridge token: %v", err)
	}

	for _, callback := range capture {
		callback(integration, ctx, installed.Plugin.PluginInstanceID, installed.Plugin.ManagementRevision)
	}
	return func(method string, params map[string]any) (host.CallMethodResult, error) {
		callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		result, callErr := integration.host.CallPluginMethod(callCtx, host.CallMethodRequest{
			PluginInstanceID:  installed.Plugin.PluginInstanceID,
			SurfaceInstanceID: surfaceInstanceID, BridgeChannelID: bridgeChannelID,
			GatewayToken: gateway.GatewayToken, Method: method, Params: params,
		})
		if callErr != nil {
			events, diagnosticErr := integration.host.ListDiagnosticEvents(ctx, host.ListDiagnosticEventsRequest{PluginInstanceID: installed.Plugin.PluginInstanceID, Limit: 50})
			t.Logf("invocation diagnostics: %+v error: %v", events, diagnosticErr)
		}
		return result, callErr
	}
}
