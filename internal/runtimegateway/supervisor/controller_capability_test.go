package supervisor

import (
	"context"
	"path/filepath"
	"testing"

	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
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
	if len(capability.ArtifactPolicies) != 1 || capability.ArtifactPolicies[0] != gatewayprotocol.ArtifactPolicyPublishedRelease {
		t.Fatalf("artifact policies = %#v", capability.ArtifactPolicies)
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
	if err := controller.bindings.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-before-replacement", RuntimeBinaryVersion: "0.11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest,
	}); err != nil {
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
	want := RuntimeValidation{
		RuntimeInstanceID: "runtime-offline", RuntimeBinaryVersion: "0.11.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest,
	}
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
	if err := controller.bindings.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-old-epoch", RuntimeBinaryVersion: "0.10.0",
		Platform: "linux", Architecture: "amd64",
		ServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2 - 1,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: digest,
	}); err != nil {
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
