package supervisor

import (
	"context"
	"encoding/json"
	"testing"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestArtifactVerifierBindsCustomBuildAttestationToOperation(t *testing.T) {
	buildInputs := json.RawMessage(`{"source_commit":"abc123","dirty":false}`)
	buildDigest, err := canonicalBuildInputsDigest(buildInputs)
	if err != nil {
		t.Fatal(err)
	}
	operation := gatewayprotocol.RuntimeOperation{
		OperationID: "rop_custom", LifecycleTargetID: "rlt_demo", TargetGeneration: 3,
		DesiredRuntime: gatewayprotocol.DesiredRuntime{Version: "0.11.0", Platform: "linux", Architecture: "amd64", ArtifactPolicy: gatewayprotocol.ArtifactPolicyCustomBuild},
		BuildInputs:    buildInputs,
	}
	metadata := gatewayprotocol.RuntimeArtifactMetadata{
		ArchiveSHA256:    "sha256:" + repeat("a", 64),
		ExecutableSHA256: "sha256:" + repeat("b", 64),
		BuildAttestation: mustRawJSON(t, customBuildAttestation{
			OperationID: operation.OperationID, LifecycleTargetID: operation.LifecycleTargetID,
			TargetGeneration: operation.TargetGeneration, BuildInputsDigest: buildDigest,
			ArchiveSHA256: "sha256:" + repeat("a", 64), ExecutableSHA256: "sha256:" + repeat("b", 64),
			Platform: "linux", Architecture: "amd64",
		}),
	}
	var attestation customBuildAttestation
	_ = json.Unmarshal(metadata.BuildAttestation, &attestation)
	if err := (ArtifactVerifier{}).Verify(context.Background(), operation, metadata, "unused"); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	attestation.ExecutableSHA256 = "sha256:" + repeat("c", 64)
	metadata.BuildAttestation = mustRawJSON(t, attestation)
	if err := (ArtifactVerifier{}).Verify(context.Background(), operation, metadata, "unused"); err == nil {
		t.Fatal("Verify accepted an attestation for different executable bytes")
	}
	attestation.ExecutableSHA256 = metadata.ExecutableSHA256
	attestation.TargetGeneration++
	metadata.BuildAttestation = mustRawJSON(t, attestation)
	if err := (ArtifactVerifier{}).Verify(context.Background(), operation, metadata, "unused"); err == nil {
		t.Fatal("Verify accepted an attestation for a different target generation")
	}
}

func TestCompatibilityManifestRequiresExplicitCrossEpochUpgrade(t *testing.T) {
	operation := gatewayprotocol.RuntimeOperation{DesiredRuntime: gatewayprotocol.DesiredRuntime{
		Version: "0.11.0", Platform: "linux", Architecture: "amd64", ArtifactPolicy: gatewayprotocol.ArtifactPolicyPublishedRelease,
	}}
	metadata := gatewayprotocol.RuntimeArtifactMetadata{ExecutableSHA256: "sha256:" + repeat("b", 64)}
	manifest := compatibilityManifest{SchemaVersion: 1, ReleaseSetID: "release-demo"}
	manifest.Gateway.SHA256 = "sha256:" + repeat("a", 64)
	manifest.Gateway.Protocol = gatewayprotocol.Version
	manifest.Gateway.Capabilities = []string{"runtime_operations_v2", "manual_recovery_v1", "signed_artifact_policy_v1"}
	manifest.Runtime.Version = "0.11.0"
	manifest.Runtime.SHA256 = metadata.ExecutableSHA256
	manifest.Runtime.ServiceProtocol = gatewayprotocol.RuntimeServiceProtocolV2
	manifest.Runtime.CompatibilityEpoch = gatewayprotocol.RuntimeCompatibilityEpochV2
	manifest.Runtime.Capabilities = []string{"lifecycle_fence_v1"}
	manifest.Runtime.Platform = "linux"
	manifest.Runtime.Architecture = "amd64"
	manifest.Compatibility.DesktopGatewayProtocols = []string{gatewayprotocol.Version}
	manifest.Compatibility.GatewayRuntimeEpochs = []int{gatewayprotocol.RuntimeCompatibilityEpochV2}
	manifest.Compatibility.RequiredUpgradeOrder = []string{"gateway", "runtime"}

	if err := validateCompatibilityManifest(operation, metadata, manifest, gatewayprotocol.RuntimeCompatibilityEpochV2-1); err == nil {
		t.Fatal("manifest accepted an undeclared cross-epoch managed upgrade")
	}
	manifest.Compatibility.UpgradeFromRuntimeEpochs = []int{gatewayprotocol.RuntimeCompatibilityEpochV2 - 1}
	if err := validateCompatibilityManifest(operation, metadata, manifest, gatewayprotocol.RuntimeCompatibilityEpochV2-1); err != nil {
		t.Fatalf("manifest rejected an explicitly authorized cross-epoch upgrade: %v", err)
	}
	manifest.Compatibility.UpgradeFromRuntimeEpochs = nil
	if err := validateCompatibilityManifest(operation, metadata, manifest, gatewayprotocol.RuntimeCompatibilityEpochV2); err != nil {
		t.Fatalf("manifest required upgrade_from_runtime_epochs for the current epoch: %v", err)
	}
}

func mustRawJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func repeat(value string, count int) string {
	out := ""
	for range count {
		out += value
	}
	return out
}
