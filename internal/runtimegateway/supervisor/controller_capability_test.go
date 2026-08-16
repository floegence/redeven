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

func TestRuntimeManagementCapabilityAllowsStartWhenInventoryProvesRuntimeAbsent(t *testing.T) {
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
	assertRuntimeOperationKinds(t, capability.Operations, gatewayprotocol.RuntimeOperationStart, gatewayprotocol.RuntimeOperationUpdate)
	if len(capability.ArtifactPolicies) != 2 || capability.ArtifactPolicies[0] != gatewayprotocol.ArtifactPolicyCustomBuild || capability.ArtifactPolicies[1] != gatewayprotocol.ArtifactPolicyPublishedRelease {
		t.Fatalf("artifact policies = %#v", capability.ArtifactPolicies)
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
