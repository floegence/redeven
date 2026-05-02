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
}
