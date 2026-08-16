//go:build plugin_runtime_e2e

package redevpluginintegration

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v2/pkg/bridge"
	"github.com/floegence/redevplugin/v2/pkg/host"
	"github.com/floegence/redevplugin/v2/pkg/runtimetarget"
	"github.com/floegence/redevplugin/v2/pkg/sessionctx"
)

func TestRecoveredRuntimeFirstInvocationReachesWorkerAfterFilesystemHostcalls(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the production plugin runtime is Linux-only")
	}
	runtimePath := os.Getenv("REDEVEN_TEST_PLUGIN_RUNTIME")
	packagePath := os.Getenv("REDEVEN_TEST_PLUGIN_PACKAGE")
	if runtimePath == "" || packagePath == "" {
		t.Skip("REDEVEN_TEST_PLUGIN_RUNTIME and REDEVEN_TEST_PLUGIN_PACKAGE are required")
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
		Containers:       mustContainersAdapter(t, &capabilityEngineClient{}),
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
	approved := make([]string, 0, len(inspection.SecuritySummary.Permissions))
	for _, permission := range inspection.SecuritySummary.Permissions {
		approved = append(approved, permission.PermissionID)
	}
	activate := true
	installed, err := integration.host.InstallInspectedPackage(ctx, host.InstallInspectedPackageRequest{
		InspectionID: inspection.InspectionID, ExpectedPackageSHA256: inspection.InspectedHashes.PackageSHA256,
		ActivateAfterInstall: &activate, ApprovedPermissionIDs: approved, Now: now.Add(time.Second),
	})
	if err != nil {
		t.Fatalf("install v9 package: %v", err)
	}
	if installed.Plugin == nil {
		t.Fatal("installed package has no plugin record")
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
		SurfaceID:                  "io.view", SurfaceInstanceID: surfaceInstanceID, Now: now.Add(2 * time.Second),
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
		UIProtocolVersion: bootstrap.UIProtocolVersion,
	}
	gateway, err := integration.host.MintBridgeToken(ctx, host.MintBridgeTokenRequest{
		Handshake: handshake, BridgeChannelID: bridgeChannelID,
		HandshakeTranscriptSHA256: bridge.HandshakeTranscriptSHA256(handshake, bridgeChannelID),
		Now:                       now.Add(4 * time.Second),
	})
	if err != nil {
		t.Fatalf("mint bridge token: %v", err)
	}

	callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	smokeParams := map[string]any{"server": map[string]any{
		"http": float64(1), "ws": float64(1), "tcp": float64(1), "udp": float64(1),
	}}
	_, err = integration.host.CallPluginMethod(callCtx, host.CallMethodRequest{
		PluginInstanceID:  installed.Plugin.PluginInstanceID,
		SurfaceInstanceID: surfaceInstanceID, BridgeChannelID: bridgeChannelID,
		GatewayToken: gateway.GatewayToken, Method: "smoke.run",
		Params: smokeParams,
	})
	workerError, ok := host.AsValidatedWorkerExecutionError(err)
	if !ok {
		t.Fatalf("first invocation did not reach the worker's network probe: %T: %v", err, err)
	}
	if workerError.Origin != host.WorkerErrorOriginPlugin || workerError.Code != "NETWORK_ERROR" {
		t.Fatalf("first invocation failed before completing filesystem hostcalls: %+v", workerError)
	}
}
