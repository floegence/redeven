package protocol

import (
	"strings"
	"testing"
)

func TestCanonicalProviderRuntimeManagementTunnelPayloadMatchesRCPP(t *testing.T) {
	request := ProviderRuntimeManagementTunnelRequest{
		ProtocolVersion: ProviderRuntimeManagementProtocolVersion, EnvPublicID: " env_demo ", LifecycleTargetID: " target_demo ",
		TargetGeneration: 7, ClientKeyID: " client_demo ", ClientPublicKey: "public-key",
		Method: " post ", Route: " /gateway/v2/runtime-operations/prepare ", BodySHA256: strings.Repeat("A", 64),
		BodyB64u: "secret-body", Nonce: " nonce_demo ", TimestampUnixMS: 1234, Signature: "signature",
	}
	payload, err := CanonicalProviderRuntimeManagementTunnelPayload(request)
	if err != nil {
		t.Fatalf("CanonicalProviderRuntimeManagementTunnelPayload() error = %v", err)
	}
	want := `{"body_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","client_key_id":"client_demo","env_public_id":"env_demo","lifecycle_target_id":"target_demo","method":"POST","nonce":"nonce_demo","protocol_version":"rcpp-v3","route":"/gateway/v2/runtime-operations/prepare","target_generation":7,"timestamp_unix_ms":1234}`
	if string(payload) != want {
		t.Fatalf("payload = %s, want %s", payload, want)
	}
}
