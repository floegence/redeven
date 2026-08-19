package supervisor

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestRuntimeManagementCapabilityDoesNotDiscloseTargetWithoutGrant(t *testing.T) {
	controller, _ := newCapabilityTestController(t)

	capability, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "paired-client",
	})
	if err != nil {
		t.Fatalf("RuntimeManagementCapability() error = %v", err)
	}
	if capability.Support != gatewayprotocol.CapabilitySupportSupported || capability.Authorization.State != gatewayprotocol.AuthorizationDenied {
		t.Fatalf("capability = %#v", capability)
	}
	if capability.Readiness != gatewayprotocol.ManagementReadinessUnknown || capability.Target != nil || len(capability.Operations) != 0 || len(capability.ArtifactPolicies) != 0 {
		t.Fatalf("denied capability disclosed supervisor facts: %#v", capability)
	}
}

func TestRuntimeManagementCapabilityRejectsGatewayEnvironmentAlias(t *testing.T) {
	controller, _ := newCapabilityTestController(t)

	capability, err := controller.RuntimeManagementCapability(context.Background(), "env_alias", gatewaylifecycle.Access{
		ClientKeyID: "admin-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatalf("RuntimeManagementCapability() error = %v", err)
	}
	if capability.Support != gatewayprotocol.CapabilitySupportUnsupported || capability.PresentationState != gatewayprotocol.ManagementPresentationUnsupported {
		t.Fatalf("capability = %#v", capability)
	}
	if capability.Target != nil || capability.Readiness != gatewayprotocol.ManagementReadinessUnknown {
		t.Fatalf("unsupported capability disclosed target facts: %#v", capability)
	}
}

func TestRuntimeManagementCapabilityAllowsInstallWhenInventoryProvesRuntimeAbsent(t *testing.T) {
	controller, binding := newCapabilityTestController(t)

	capability, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "admin-client",
		Grants: []gatewayprotocol.RuntimeGrant{
			gatewayprotocol.RuntimeGrantManage,
			gatewayprotocol.RuntimeGrantCustomBuild,
		},
	})
	if err != nil {
		t.Fatalf("RuntimeManagementCapability() error = %v", err)
	}
	if capability.PresentationState != gatewayprotocol.ManagementPresentationAllowed || capability.Readiness != gatewayprotocol.ManagementReady {
		t.Fatalf("capability = %#v", capability)
	}
	if capability.Target == nil || capability.Target.LifecycleTargetID != binding.LifecycleTargetID || capability.Target.TargetGeneration != binding.TargetGeneration {
		t.Fatalf("capability target = %#v, want %#v", capability.Target, binding)
	}
	assertRuntimeOperationKinds(t, capability.Operations, gatewayprotocol.RuntimeOperationUpdate)
	if len(capability.ArtifactPolicies) != 2 ||
		capability.ArtifactPolicies[0] != gatewayprotocol.ArtifactPolicyCustomBuild ||
		capability.ArtifactPolicies[1] != gatewayprotocol.ArtifactPolicyPublishedRelease {
		t.Fatalf("artifact policies = %#v", capability.ArtifactPolicies)
	}
}

func TestOfflineRuntimeSnapshotRevisionIsJSONSafe(t *testing.T) {
	controller, _ := newCapabilityTestController(t)

	snapshot, err := controller.offlineSnapshot(context.Background())
	if err != nil {
		t.Fatalf("offlineSnapshot() error = %v", err)
	}
	if snapshot.SnapshotRevision < 0 || snapshot.SnapshotRevision > gatewayprotocol.MaxJSONSafeInteger {
		t.Fatalf("offline snapshot revision %d cannot round-trip through Desktop JavaScript", snapshot.SnapshotRevision)
	}
}

func TestRuntimeManagementCapabilityAdvertisesReconcileOnlyToBindingAdministrators(t *testing.T) {
	controller, _ := newCapabilityTestController(t)

	manager, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "manager-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertRuntimeOperationKinds(t, manager.Operations, gatewayprotocol.RuntimeOperationUpdate)

	bindingAdmin, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "binding-admin-client",
		Grants: []gatewayprotocol.RuntimeGrant{
			gatewayprotocol.RuntimeGrantManage,
			gatewayprotocol.RuntimeGrantManageBinding,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertRuntimeOperationKinds(t, bindingAdmin.Operations,
		gatewayprotocol.RuntimeOperationReconcile,
		gatewayprotocol.RuntimeOperationUpdate,
	)
}

func TestRuntimeManagementCapabilityFailsClosedAfterExternalBinaryReplacement(t *testing.T) {
	controller, binding := newCapabilityTestController(t)
	binaryPath := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, binaryPath, []byte("validated runtime"))
	digest, err := fileSHA256(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.bindings.RecordRuntimeValidation(completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-before-replacement", RuntimeBinaryVersion: "0.11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest,
	})); err != nil {
		t.Fatal(err)
	}
	writeExecutableFixture(t, binaryPath, []byte("externally replaced runtime"))

	capability, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "admin-client", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Readiness != gatewayprotocol.ManagementTemporarilyUnavailable || capability.ReasonCode != "runtime_identity_validation_required" || len(capability.Operations) != 0 {
		t.Fatalf("capability after external replacement = %#v", capability)
	}
}

func TestRefreshRuntimeValidationReusesPersistedFactsOnlyForExactOfflineBinary(t *testing.T) {
	controller, binding := newCapabilityTestController(t)
	binaryPath := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, binaryPath, []byte("validated offline runtime"))
	digest, err := fileSHA256(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	suiteDigest, _, err := managedRuntimeSuiteSHA256(filepath.Join(binding.RuntimeRoot, "runtime", "managed"))
	if err != nil {
		t.Fatal(err)
	}
	want := completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-offline", RuntimeBinaryVersion: "0.11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest, ManagedSuiteSHA256: suiteDigest,
	})
	if err := controller.bindings.RecordRuntimeValidation(want); err != nil {
		t.Fatal(err)
	}

	got, err := controller.RefreshRuntimeValidation(context.Background())
	if err != nil {
		t.Fatalf("RefreshRuntimeValidation() offline exact binary error = %v", err)
	}
	if got.ArtifactSHA256 != want.ArtifactSHA256 || got.CompatibilityEpoch != want.CompatibilityEpoch {
		t.Fatalf("RefreshRuntimeValidation() = %#v, want %#v", got, want)
	}

	writeExecutableFixture(t, binaryPath, []byte("externally replaced offline runtime"))
	if _, err := controller.RefreshRuntimeValidation(context.Background()); err == nil {
		t.Fatal("RefreshRuntimeValidation accepted stale facts after external binary replacement")
	}
}

func TestRuntimeManagementCapabilityFailsClosedForIncompatiblePersistedIdentity(t *testing.T) {
	controller, binding := newCapabilityTestController(t)
	binaryPath := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, binaryPath, []byte("older runtime"))
	digest, err := fileSHA256(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.bindings.RecordRuntimeValidation(completeTestRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-old-epoch", RuntimeBinaryVersion: "0.10.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2 - 1,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest,
	})); err != nil {
		t.Fatal(err)
	}

	capability, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "admin-client", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Readiness != gatewayprotocol.ManagementTemporarilyUnavailable || capability.ReasonCode != "runtime_identity_incompatible" || len(capability.Operations) != 0 {
		t.Fatalf("capability for incompatible persisted identity = %#v", capability)
	}
	if capability.Compatibility == nil || capability.Compatibility.CompatibilityEpoch != gatewayprotocol.RuntimeCompatibilityEpochV2-1 {
		t.Fatalf("capability hid the validated source epoch from the authorized client: %#v", capability.Compatibility)
	}
}

func TestRuntimeManagementCapabilityOffersUpdateForVerifiedLegacyRuntime(t *testing.T) {
	if testing.Short() {
		t.Skip("builds a Runtime process fixture")
	}
	controller, binding := newCapabilityTestController(t)
	managedBinary := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	if err := os.MkdirAll(filepath.Dir(managedBinary), 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "legacy-runtime-process.go")
	if err := os.WriteFile(source, []byte(recoveryRuntimeProcessHelperSource), 0o600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-o", managedBinary, source)
	build.Env = append(os.Environ(), "GOWORK=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build legacy Runtime fixture: %v\n%s", err, output)
	}
	readyFile := filepath.Join(t.TempDir(), "legacy-runtime.ready")
	process := exec.Command(managedBinary, "run", "--mode", "desktop", "--state-root", binding.RuntimeRoot)
	process.Env = append(os.Environ(), "REDEVEN_TEST_READY_FILE="+readyFile)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process.Process != nil {
			_ = process.Process.Kill()
			_, _ = process.Process.Wait()
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(readyFile); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("legacy Runtime fixture did not become ready")
		}
		time.Sleep(20 * time.Millisecond)
	}

	statusContext, stopStatus := context.WithCancel(context.Background())
	statusServer, err := runtimemanagement.NewServer(binding.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				InstanceID: "runtime-legacy", StateRoot: binding.RuntimeRoot,
				PID: process.Process.Pid, RuntimeVersion: "v0.7.0", BinaryPath: managedBinary,
				DesktopManaged: true, DesktopOwnerID: "desktop-owner-legacy",
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				RuntimeControl: &runtimemanagement.RuntimeControlEndpoint{
					ProtocolVersion: "redeven-runtime-control-v1",
					BaseURL:         "http://127.0.0.1:1",
					Token:           "legacy-token",
				},
			},
			RuntimeService: runtimeservice.Snapshot{
				RuntimeVersion: "v0.7.0", ProtocolVersion: "redeven-runtime-v1", CompatibilityEpoch: 5,
				ActiveWorkload: runtimeservice.Workload{TerminalCount: 3},
			},
		}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := statusServer.Start(statusContext); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stopStatus()
		_ = statusServer.Close()
	})

	capability, err := controller.RuntimeManagementCapability(context.Background(), gatewayprotocol.ReservedLocalEnvironmentID, gatewaylifecycle.Access{
		ClientKeyID: "admin-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage, gatewayprotocol.RuntimeGrantCustomBuild},
	})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Readiness != gatewayprotocol.ManagementReady || capability.ReasonCode != "runtime_update_required" {
		t.Fatalf("legacy Runtime capability = %#v", capability)
	}
	assertRuntimeOperationKinds(t, capability.Operations, gatewayprotocol.RuntimeOperationUpdate)
	if capability.Compatibility == nil || capability.Compatibility.CompatibilityEpoch != 5 || capability.Compatibility.RuntimeBinaryVersion != "v0.7.0" {
		t.Fatalf("legacy Runtime compatibility = %#v", capability.Compatibility)
	}

	snapshot, err := controller.Snapshot(context.Background(), *capability.Target)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Impact.Knowledge != gatewayprotocol.WorkloadUnknown || snapshot.ProcessInventoryDigest == "" || snapshot.WorkloadIdentityDigest == "" {
		t.Fatalf("legacy Runtime workload snapshot = %#v", snapshot)
	}
	fence, err := controller.BeginLifecycleFence(context.Background(), "op-legacy-update", *capability.Target)
	if err != nil {
		t.Fatal(err)
	}
	if fence.Token == "" || fence.Snapshot.ProcessInventoryDigest != snapshot.ProcessInventoryDigest || fence.Snapshot.WorkloadIdentityDigest != snapshot.WorkloadIdentityDigest {
		t.Fatalf("legacy Runtime lifecycle fence = %#v", fence)
	}
	if err := controller.stopLegacyRuntimeForUpdate(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	if err := process.Wait(); err != nil && process.ProcessState == nil {
		t.Fatalf("wait for legacy Runtime stop: %v", err)
	}
	process.Process = nil
	if err := controller.ReleaseLifecycleFence(context.Background(), fence.Token); err != nil {
		t.Fatal(err)
	}
}

func TestIsLegacyRuntimeServiceRejectsCurrentAndFutureEpochs(t *testing.T) {
	for _, test := range []struct {
		name      string
		protocol  string
		epoch     int
		wantMatch bool
	}{
		{name: "legacy v1", protocol: "redeven-runtime-v1", epoch: 5, wantMatch: true},
		{name: "legacy protocol at current epoch", protocol: "redeven-runtime-v1", epoch: gatewayprotocol.RuntimeCompatibilityEpochV2, wantMatch: false},
		{name: "current", protocol: gatewayprotocol.RuntimeServiceProtocolV2, epoch: gatewayprotocol.RuntimeCompatibilityEpochV2, wantMatch: false},
		{name: "future", protocol: "redeven-runtime-v3", epoch: gatewayprotocol.RuntimeCompatibilityEpochV2 + 1, wantMatch: false},
		{name: "unknown epoch", protocol: "redeven-runtime-v1", epoch: 0, wantMatch: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := isLegacyRuntimeService(runtimeservice.Snapshot{
				ProtocolVersion: test.protocol, CompatibilityEpoch: test.epoch,
			})
			if got != test.wantMatch {
				t.Fatalf("isLegacyRuntimeService() = %t, want %t", got, test.wantMatch)
			}
		})
	}
}

func newCapabilityTestController(t *testing.T) (*Controller, TargetBinding) {
	t.Helper()
	root := t.TempDir()
	bindings, err := OpenLocalBindingStore(filepath.Join(root, "gateway"), filepath.Join(root, "runtime"))
	if err != nil {
		t.Fatalf("OpenLocalBindingStore() error = %v", err)
	}
	controller, err := NewController(ControllerOptions{BindingStore: bindings})
	if err != nil {
		t.Fatalf("NewController() error = %v", err)
	}
	return controller, bindings.Binding()
}

func assertRuntimeOperationKinds(t *testing.T, got []gatewayprotocol.RuntimeOperationKind, want ...gatewayprotocol.RuntimeOperationKind) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("operation kinds = %#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("operation kinds = %#v, want %#v", got, want)
		}
	}
}
