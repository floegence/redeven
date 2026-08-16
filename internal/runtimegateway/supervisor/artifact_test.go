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
		SHA256: "sha256:" + string(make([]byte, 64)),
		BuildAttestation: mustRawJSON(t, customBuildAttestation{
			OperationID: operation.OperationID, LifecycleTargetID: operation.LifecycleTargetID,
			TargetGeneration: operation.TargetGeneration, BuildInputsDigest: buildDigest,
			ArtifactSHA256: "sha256:" + string(make([]byte, 64)), Platform: "linux", Architecture: "amd64",
		}),
	}
	metadata.SHA256 = "sha256:" + repeat("a", 64)
	var attestation customBuildAttestation
	_ = json.Unmarshal(metadata.BuildAttestation, &attestation)
	attestation.ArtifactSHA256 = metadata.SHA256
	metadata.BuildAttestation = mustRawJSON(t, attestation)
	if err := (ArtifactVerifier{}).Verify(context.Background(), operation, metadata, "unused"); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	attestation.TargetGeneration++
	metadata.BuildAttestation = mustRawJSON(t, attestation)
	if err := (ArtifactVerifier{}).Verify(context.Background(), operation, metadata, "unused"); err == nil {
		t.Fatal("Verify accepted an attestation for a different target generation")
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
