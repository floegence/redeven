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
	if contract.CompatibilityEpoch != 45 {
		t.Fatalf("CompatibilityEpoch = %d, want Cloud v4 and model directory contract epoch 45", contract.CompatibilityEpoch)
	}
	if len(contract.UpgradeFromRuntimeEpochs) != 36 {
		t.Fatalf("UpgradeFromRuntimeEpochs = %v, want the reviewed epochs 9 through 44", contract.UpgradeFromRuntimeEpochs)
	}
	for index, epoch := range contract.UpgradeFromRuntimeEpochs {
		if epoch != index+9 {
			t.Fatalf("UpgradeFromRuntimeEpochs = %v, want contiguous epochs 9 through 44", contract.UpgradeFromRuntimeEpochs)
		}
	}
	if contract.MinimumDesktopVersion != "v0.13.0" || contract.MinimumRuntimeVersion != "v0.13.0" {
		t.Fatalf(
			"minimum versions = Desktop %q Runtime %q, want matched v0.13.0 pair",
			contract.MinimumDesktopVersion,
			contract.MinimumRuntimeVersion,
		)
	}
}

func TestApplyCompatibilityContractFillsSnapshot(t *testing.T) {
	snapshot := ApplyCompatibilityContract(Snapshot{
		RuntimeVersion: "dev",
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

func TestDegradedAIReadinessKeepsEnvironmentOpenable(t *testing.T) {
	snapshot := ApplyCompatibilityContract(Snapshot{
		AIReadiness: AIReadiness{State: "degraded", ReasonCode: "host_thread_settings_missing", IssueCount: 2},
	})
	if snapshot.OpenReadiness.State != OpenReadinessOpenable {
		t.Fatalf("OpenReadiness.State = %q, want openable", snapshot.OpenReadiness.State)
	}
	if snapshot.AIReadiness.State != "degraded" || snapshot.AIReadiness.ReasonCode != "host_thread_settings_missing" || snapshot.AIReadiness.IssueCount != 2 {
		t.Fatalf("AIReadiness = %#v", snapshot.AIReadiness)
	}
}

func TestNormalizeSnapshotKeepsOrdinaryAccessOpenForLifecycleCompatibilityFailures(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion:      ProtocolVersion,
		Compatibility:        CompatibilityDesktopUpdateRequired,
		CompatibilityMessage: "Desktop is too old.",
	})
	if snapshot.OpenReadiness.State != OpenReadinessOpenable {
		t.Fatalf("OpenReadiness = %#v, want ordinary Runtime access to remain openable", snapshot.OpenReadiness)
	}
}

func TestNormalizeSnapshotPreservesExplicitStartingReadiness(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		OpenReadiness: OpenReadiness{
			State:      OpenReadinessStarting,
			ReasonCode: "env_app_app_server_starting",
			Message:    "Env App app server is starting.",
		},
	})
	if snapshot.OpenReadiness.State != OpenReadinessStarting ||
		snapshot.OpenReadiness.ReasonCode != "env_app_app_server_starting" ||
		snapshot.OpenReadiness.Message != "Env App app server is starting." {
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

func TestNormalizeSnapshotNormalizesDesktopModelSourceCapabilityAndBinding(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		Capabilities: Capabilities{
			DesktopModelSource: Capability{Supported: true},
		},
		Bindings: Bindings{
			DesktopModelSource: Binding{
				State:                 BindingState(" bound "),
				SessionID:             " desktop-session ",
				ExpiresAtUnixMS:       -1,
				ConnectedAtUnixMS:     1778750000000,
				ModelSource:           " desktop_local_environment ",
				ModelCount:            -3,
				MissingKeyProviderIDs: []string{"anthropic", " ", "openai", "anthropic"},
				LastError:             " ",
			},
		},
	})

	if !snapshot.Capabilities.DesktopModelSource.Supported {
		t.Fatalf("DesktopModelSource.Supported = false, want true")
	}
	if snapshot.Capabilities.DesktopModelSource.BindMethod != RuntimeControlBindMethodV2 {
		t.Fatalf("BindMethod = %q", snapshot.Capabilities.DesktopModelSource.BindMethod)
	}
	binding := snapshot.Bindings.DesktopModelSource
	if binding.State != BindingStateBound {
		t.Fatalf("State = %q, want %q", binding.State, BindingStateBound)
	}
	if binding.SessionID != "desktop-session" {
		t.Fatalf("binding identity was not trimmed: %#v", binding)
	}
	if binding.ExpiresAtUnixMS != 0 || binding.ModelCount != 0 {
		t.Fatalf("negative numeric fields were not normalized: %#v", binding)
	}
	if binding.ConnectedAtUnixMS != 1778750000000 {
		t.Fatalf("ConnectedAtUnixMS = %d", binding.ConnectedAtUnixMS)
	}
	if got := strings.Join(binding.MissingKeyProviderIDs, ","); got != "anthropic,openai" {
		t.Fatalf("MissingKeyProviderIDs = %q", got)
	}
}

func TestNormalizeSnapshotMarksDesktopModelSourceBindingUnsupportedWithoutCapability(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		Bindings: Bindings{
			DesktopModelSource: Binding{State: BindingStateBound},
		},
	})
	if snapshot.Bindings.DesktopModelSource.State != BindingStateUnsupported {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.DesktopModelSource.State, BindingStateUnsupported)
	}
}

func TestNormalizeSnapshotNormalizesCloudLinkCapabilityAndBinding(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		Capabilities: Capabilities{
			CloudLink: Capability{Supported: true},
		},
		Bindings: Bindings{
			CloudLink: CloudLinkBinding{
				State:                    CloudLinkState(" linked "),
				CloudOrigin:              " https://provider.example.invalid ",
				CloudID:                  " example_control_plane ",
				EnvPublicID:              " env_demo ",
				LocalEnvironmentPublicID: " lenv_demo ",
				BindingGeneration:        3,
				LastConnectedAtUnixMS:    1778750000000,
			},
		},
	})

	if !snapshot.Capabilities.CloudLink.Supported {
		t.Fatalf("CloudLink.Supported = false, want true")
	}
	if snapshot.Capabilities.CloudLink.BindMethod != RuntimeControlBindMethodV2 {
		t.Fatalf("BindMethod = %q", snapshot.Capabilities.CloudLink.BindMethod)
	}
	binding := snapshot.Bindings.CloudLink
	if binding.State != CloudLinkStateLinked || binding.RemoteEnabled {
		t.Fatalf("unexpected provider-link state: %#v", binding)
	}
	if binding.CloudOrigin != "https://provider.example.invalid" ||
		binding.CloudID != "example_control_plane" ||
		binding.EnvPublicID != "env_demo" ||
		binding.LocalEnvironmentPublicID != "lenv_demo" {
		t.Fatalf("provider-link identity was not normalized: %#v", binding)
	}
}

func TestNormalizeSnapshotNormalizesRuntimeGatewayCapability(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		Capabilities: Capabilities{
			RuntimeGateway: Capability{Supported: true},
		},
	})

	if !snapshot.Capabilities.RuntimeGateway.Supported {
		t.Fatalf("RuntimeGateway.Supported = false, want true")
	}
	if snapshot.Capabilities.RuntimeGateway.BindMethod != RuntimeControlBindMethodV2 {
		t.Fatalf("BindMethod = %q, want %q", snapshot.Capabilities.RuntimeGateway.BindMethod, RuntimeControlBindMethodV2)
	}
}

func TestNormalizeSnapshotKeepsMissingRuntimeGatewayCapabilityUnsupported(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
	})

	if snapshot.Capabilities.RuntimeGateway.Supported {
		t.Fatalf("RuntimeGateway.Supported = true, want false")
	}
	if snapshot.Capabilities.RuntimeGateway.BindMethod != "" {
		t.Fatalf("BindMethod = %q, want empty", snapshot.Capabilities.RuntimeGateway.BindMethod)
	}
}

func TestNormalizeSnapshotPreservesCloudLinkRemoteEnabledFact(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		RemoteEnabled:   false,
		Capabilities: Capabilities{
			CloudLink: Capability{Supported: true},
		},
		Bindings: Bindings{
			CloudLink: CloudLinkBinding{
				State:         CloudLinkStateLinked,
				CloudOrigin:   "https://provider.example.invalid",
				CloudID:       "example_control_plane",
				EnvPublicID:   "env_demo",
				RemoteEnabled: false,
			},
		},
	})

	if snapshot.Bindings.CloudLink.State != CloudLinkStateLinked {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.CloudLink.State, CloudLinkStateLinked)
	}
	if snapshot.Bindings.CloudLink.RemoteEnabled {
		t.Fatalf("CloudLink.RemoteEnabled = true, want false")
	}
}

func TestNormalizeSnapshotMarksCloudLinkUnsupportedWithoutCapability(t *testing.T) {
	snapshot := NormalizeSnapshot(Snapshot{
		ProtocolVersion: ProtocolVersion,
		Compatibility:   CompatibilityCompatible,
		Bindings: Bindings{
			CloudLink: CloudLinkBinding{
				State:         CloudLinkStateLinked,
				CloudOrigin:   "https://provider.example.invalid",
				CloudID:       "example_control_plane",
				EnvPublicID:   "env_demo",
				RemoteEnabled: true,
			},
		},
	})
	if snapshot.Bindings.CloudLink.State != CloudLinkStateUnsupported {
		t.Fatalf("State = %q, want %q", snapshot.Bindings.CloudLink.State, CloudLinkStateUnsupported)
	}
	if snapshot.Bindings.CloudLink.RemoteEnabled {
		t.Fatalf("RemoteEnabled = true, want false")
	}
}
