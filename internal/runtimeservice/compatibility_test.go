package runtimeservice

import (
	"strings"
	"testing"
)

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

func TestNormalizeSnapshotNormalizesDesktopAIBrokerCapabilityAndBinding(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		Capabilities: Capabilities{
			DesktopAIBroker: Capability{Supported: true},
		},
		Bindings: Bindings{
			DesktopAIBroker: Binding{
				State:                 BindingState(" bound "),
				SessionID:             " broker-session ",
				SSHRuntimeKey:         " ssh:devbox ",
				ExpiresAtUnixMS:       -1,
				ModelSource:           " desktop_local_environment ",
				ModelCount:            -3,
				MissingKeyProviderIDs: []string{"anthropic", " ", "openai", "anthropic"},
				LastError:             " ",
			},
		},
	})

	if !snapshot.Capabilities.DesktopAIBroker.Supported {
		t.Fatalf("DesktopAIBroker.Supported = false, want true")
	}
	if snapshot.Capabilities.DesktopAIBroker.BindMethod != RuntimeControlBindMethodV1 {
		t.Fatalf("BindMethod = %q", snapshot.Capabilities.DesktopAIBroker.BindMethod)
	}
	binding := snapshot.Bindings.DesktopAIBroker
	if binding.State != BindingStateBound {
		t.Fatalf("State = %q, want %q", binding.State, BindingStateBound)
	}
	if binding.SessionID != "broker-session" || binding.SSHRuntimeKey != "ssh:devbox" {
		t.Fatalf("binding identity was not trimmed: %#v", binding)
	}
	if binding.ExpiresAtUnixMS != 0 || binding.ModelCount != 0 {
		t.Fatalf("negative numeric fields were not normalized: %#v", binding)
	}
	if got := strings.Join(binding.MissingKeyProviderIDs, ","); got != "anthropic,openai" {
		t.Fatalf("MissingKeyProviderIDs = %q", got)
	}
}

func TestNormalizeSnapshotMarksDesktopAIBrokerBindingUnsupportedWithoutCapability(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		Bindings: Bindings{
			DesktopAIBroker: Binding{State: BindingStateBound},
		},
	})
	if snapshot.Bindings.DesktopAIBroker.State != BindingStateUnsupported {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.DesktopAIBroker.State, BindingStateUnsupported)
	}
}

func TestNormalizeSnapshotNormalizesProviderLinkCapabilityAndBinding(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		Capabilities: Capabilities{
			ProviderLink: Capability{Supported: true},
		},
		Bindings: Bindings{
			ProviderLink: ProviderLinkBinding{
				State:                    ProviderLinkState(" linked "),
				ProviderOrigin:           " https://cp.example.invalid ",
				ProviderID:               " example_control_plane ",
				EnvPublicID:              " env_demo ",
				LocalEnvironmentPublicID: " lenv_demo ",
				BindingGeneration:        3,
				LastConnectedAtUnixMS:    1778750000000,
			},
		},
	})

	if !snapshot.Capabilities.ProviderLink.Supported {
		t.Fatalf("ProviderLink.Supported = false, want true")
	}
	if snapshot.Capabilities.ProviderLink.BindMethod != RuntimeControlBindMethodV1 {
		t.Fatalf("BindMethod = %q", snapshot.Capabilities.ProviderLink.BindMethod)
	}
	binding := snapshot.Bindings.ProviderLink
	if binding.State != ProviderLinkStateLinked || binding.RemoteEnabled {
		t.Fatalf("unexpected provider-link state: %#v", binding)
	}
	if binding.ProviderOrigin != "https://cp.example.invalid" ||
		binding.ProviderID != "example_control_plane" ||
		binding.EnvPublicID != "env_demo" ||
		binding.LocalEnvironmentPublicID != "lenv_demo" {
		t.Fatalf("provider-link identity was not normalized: %#v", binding)
	}
}

func TestNormalizeSnapshotPreservesProviderLinkRemoteEnabledFact(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		RemoteEnabled:   false,
		Capabilities: Capabilities{
			ProviderLink: Capability{Supported: true},
		},
		Bindings: Bindings{
			ProviderLink: ProviderLinkBinding{
				State:          ProviderLinkStateLinked,
				ProviderOrigin: "https://cp.example.invalid",
				ProviderID:     "example_control_plane",
				EnvPublicID:    "env_demo",
				RemoteEnabled:  false,
			},
		},
	})

	if snapshot.Bindings.ProviderLink.State != ProviderLinkStateLinked {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.ProviderLink.State, ProviderLinkStateLinked)
	}
	if snapshot.Bindings.ProviderLink.RemoteEnabled {
		t.Fatalf("ProviderLink.RemoteEnabled = true, want false")
	}
}

func TestNormalizeSnapshotMarksProviderLinkUnsupportedWithoutCapability(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerDesktop,
		DesktopManaged:  true,
		Compatibility:   CompatibilityCompatible,
		Bindings: Bindings{
			ProviderLink: ProviderLinkBinding{
				State:          ProviderLinkStateLinked,
				ProviderOrigin: "https://cp.example.invalid",
				ProviderID:     "example_control_plane",
				EnvPublicID:    "env_demo",
				RemoteEnabled:  true,
			},
		},
	})
	if snapshot.Bindings.ProviderLink.State != ProviderLinkStateUnsupported {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.ProviderLink.State, ProviderLinkStateUnsupported)
	}
	if snapshot.Bindings.ProviderLink.RemoteEnabled {
		t.Fatalf("RemoteEnabled = true, want false")
	}
}
