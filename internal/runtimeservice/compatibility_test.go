package runtimeservice

import "testing"

func TestCurrentCompatibilityContractIsValid(t *testing.T) {
	contract := CurrentCompatibilityContract()
	if err := contract.Validate(); err != nil {
		t.Fatalf("contract.Validate() error = %v", err)
	}
	if contract.RuntimeProtocolVersion != ProtocolVersion {
		t.Fatalf("RuntimeProtocolVersion = %q, want %q", contract.RuntimeProtocolVersion, ProtocolVersion)
	}
	if contract.CompatibilityEpoch <= 0 {
		t.Fatalf("CompatibilityEpoch = %d, want positive", contract.CompatibilityEpoch)
	}
}

func TestApplyCompatibilityContractFillsSnapshot(t *testing.T) {
	snapshot := ApplyCompatibilityContract(Snapshot{
		RuntimeVersion: "dev",
		ServiceOwner:   OwnerDesktop,
		DesktopManaged: true,
	})
	contract := CurrentCompatibilityContract()
	if snapshot.ProtocolVersion != ProtocolVersion {
		t.Fatalf("ProtocolVersion = %q, want %q", snapshot.ProtocolVersion, ProtocolVersion)
	}
	if snapshot.Compatibility != CompatibilityCompatible {
		t.Fatalf("Compatibility = %q, want %q", snapshot.Compatibility, CompatibilityCompatible)
	}
	if snapshot.CompatibilityEpoch != contract.CompatibilityEpoch ||
		snapshot.MinimumDesktopVersion != contract.MinimumDesktopVersion ||
		snapshot.MinimumRuntimeVersion != contract.MinimumRuntimeVersion ||
		snapshot.CompatibilityReviewID != contract.ReleaseReview.ReviewID {
		t.Fatalf("compatibility contract fields were not applied: %#v", snapshot)
	}
	if snapshot.OpenReadiness.State != OpenReadinessOpenable {
		t.Fatalf("OpenReadiness.State = %q, want %q", snapshot.OpenReadiness.State, OpenReadinessOpenable)
	}
}

func TestNormalizeSnapshotBlocksOpenReadinessForHardCompatibilityFailures(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion:      ProtocolVersion,
		ServiceOwner:         OwnerDesktop,
		DesktopManaged:       true,
		Compatibility:        CompatibilityDesktopUpdateRequired,
		CompatibilityMessage: "Desktop is too old.",
	})
	if snapshot.OpenReadiness.State != OpenReadinessBlocked {
		t.Fatalf("OpenReadiness.State = %q, want %q", snapshot.OpenReadiness.State, OpenReadinessBlocked)
	}
	if snapshot.OpenReadiness.ReasonCode != "desktop_update_required" {
		t.Fatalf("OpenReadiness.ReasonCode = %q", snapshot.OpenReadiness.ReasonCode)
	}
	if snapshot.OpenReadiness.Message != "Desktop is too old." {
		t.Fatalf("OpenReadiness.Message = %q", snapshot.OpenReadiness.Message)
	}
}

func TestNormalizeSnapshotPreservesExplicitStartingReadiness(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		OpenReadiness: OpenReadiness{
			State:      OpenReadinessStarting,
			ReasonCode: "env_app_gateway_starting",
			Message:    "Env App gateway is starting.",
		},
	})
	if snapshot.OpenReadiness.State != OpenReadinessStarting ||
		snapshot.OpenReadiness.ReasonCode != "env_app_gateway_starting" ||
		snapshot.OpenReadiness.Message != "Env App gateway is starting." {
		t.Fatalf("unexpected OpenReadiness: %#v", snapshot.OpenReadiness)
	}
}

func TestEnvAppShellUnavailableReadinessIsBlocked(t *testing.T) {
	readiness := EnvAppShellUnavailableReadiness()
	if readiness.State != OpenReadinessBlocked {
		t.Fatalf("State = %q, want %q", readiness.State, OpenReadinessBlocked)
	}
	if readiness.ReasonCode != OpenReadinessReasonEnvAppShellUnavailable {
		t.Fatalf("ReasonCode = %q, want %q", readiness.ReasonCode, OpenReadinessReasonEnvAppShellUnavailable)
	}
	if readiness.Message == "" {
		t.Fatalf("Message is empty")
	}
}
